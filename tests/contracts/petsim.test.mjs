/**
 * Contract tests for the Pet Simulator paid routes.
 *
 * These exercise the exact production paid-route app from
 * `server/petSimApp.ts` (createPetSimApp) with injected
 * deterministic fakes + call counters. No real port is bound and no
 * real provider is contacted (supertest drives the in-process app).
 *
 * Coverage required by AR_PET_SIM_HARDENING_PLAN_V2.md P1:
 *   - missing / malformed / expired auth
 *   - two-user ownership isolation
 *   - disabled paid endpoints (rig 501; master kill-switch 503)
 *   - per-user daily caps (429)
 *   - invalid requests rejected BEFORE provider calls (call count 0)
 *   - deterministic provider fakes with call counters
 */

import assert from "node:assert/strict";
import { test, before, afterEach } from "node:test";
import supertest from "supertest";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { createPetSimApp } from "../../server/petSimApp.ts";

const JWT_SECRET = "test-secret-contract-0123456789";
// The real requireAuth() (imported by the router) reads process.env.JWT_SECRET.
process.env.JWT_SECRET = JWT_SECRET;
// Keep rig disabled by default (P0 containment).
process.env.PETSIM_RIG_ENABLED = "false";

// ---- Two-user ownership fixture --------------------------------------------
// userA owns avatar 11 (pet 101); userB owns avatar 22 (pet 202).
const AVATARS = {
  11: { id: 11, user_phone: "userA", avatar_type: "dog", meshy_handle: "owned-task-a" },
  22: { id: 22, user_phone: "userB", avatar_type: "dog", meshy_handle: "owned-task-b" },
};
const PETS = {
  101: { id: 101, avatar_id: 11, user_phone: "userA" },
  202: { id: 202, avatar_id: 22, user_phone: "userB" },
};
const petByAvatar = { 11: PETS[101], 22: PETS[202] };
const semanticScans = new Map();

// ---- Call counters + scriptable usage --------------------------------------
let classifyCalls = 0;
let scanCalls = 0;
let rigCalls = 0;
let uploadCalls = 0;
let usageCalls = 0;
let forcedReservationDenial = null;
// Per-endpoint scriptable daily-usage counts (default within cap).
const usage = { classify: 1, rig: 1, semantic_scan: 1 };

const db = {
  getAvatarById: async (id, owner) => {
    const a = AVATARS[id];
    if (!a || a.user_phone !== owner) return null;
    return a;
  },
  getAvatarByIdForRig: async (id, owner) => {
    const a = AVATARS[id];
    if (!a || a.user_phone !== owner) return null;
    return a;
  },
  getPetProfileByAvatar: async () => null,
  getPetProfileById: async (id, owner) => {
    const p = PETS[id];
    if (!p || p.user_phone !== owner) return null;
    return p;
  },
  upsertPetProfile: async () => ({ breed: "Pug", breed_confidence: 0.8 }),
  reservePaidUsage: async (owner, ep, limits) => {
    usageCalls++;
    const count = usage[ep] ?? 1;
    const reason = forcedReservationDenial || (count > limits.userDailyCap ? "user_cap" : null);
    return {
      allowed: !reason,
      reason: reason || undefined,
      userCount: count,
      globalCount: 1,
      globalReservedCostMicroUsd: limits.estimatedCostMicroUsd,
    };
  },
  getSemanticScan: async (owner, key) => semanticScans.get(`${owner}:${key}`) ?? null,
  saveSemanticScan: async (owner, key, zones) => {
    semanticScans.set(`${owner}:${key}`, zones);
  },
  savePetRigUrls: async () => {},
  setAvatarGenerationFailed: async () => {},
};

const providers = {
  classify: async () => {
    classifyCalls++;
    return {
      breed: "Pug",
      breed_confidence: 0.8,
      breed_top3: ["Pug"],
      size_class: "small",
      build: {
        legLengthRatio: 0.5,
        snoutLengthRatio: 0.3,
        earType: "floppy",
        tailType: "curly",
        coat: "short",
      },
      temperament: {
        energy: 0.5,
        sociability: 0.5,
        stubbornness: 0.5,
        foodMotivation: 0.5,
        vocality: 0.5,
      },
      faceLandmarks: { leftEye: [0.3, 0.4], rightEye: [0.7, 0.4], nose: [0.5, 0.6] },
    };
  },
  semanticScan: async () => {
    scanCalls++;
    return { zones: [{ cls: "natural_ground", points: [[0, 0], [1, 0], [1, 1]] }] };
  },
  startRig: async () => {
    rigCalls++;
    return "rig-handle-123";
  },
  pollTripoUntilDone: async () => ({ glbUrl: "http://example.com/m.glb" }),
  uploadBinaryFromUrl: async () => {
    uploadCalls++;
    return "http://example.com/m.glb";
  },
  uploadBase64Binary: async () => {
    uploadCalls++;
    return "http://example.com/lod.glb";
  },
  bakeLod: async () => ({
    glb_base64: "Z2xibA=", // "glb" base64
    stats: { tris: 100, bones: 10, bytes: 1000, retarget_confidence: 0.9, leg_chains_ok: true },
  }),
};

// ---- App under test -------------------------------------------------------
let app;
let request;
let DATA_URL;
let LARGE_DATA_URL;
before(async () => {
  const tinyJpeg = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  }).jpeg().toBuffer();
  DATA_URL = `data:image/jpeg;base64,${tinyJpeg.toString("base64")}`;

  // Deterministic noise keeps the PNG above the full server's 1 MiB global
  // parser limit while remaining under the paid image route's bounded limit.
  const width = 600;
  const height = 600;
  const pixels = Buffer.allocUnsafe(width * height * 3);
  let state = 0x12345678;
  for (let i = 0; i < pixels.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[i] = state & 0xff;
  }
  const largePng = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
  LARGE_DATA_URL = `data:image/png;base64,${largePng.toString("base64")}`;

  app = createPetSimApp({ db, providers, paidLimiter: undefined });
  request = supertest(app);
});

const tokenFor = (phone) => jwt.sign({ phone, uid: 1 }, JWT_SECRET, { expiresIn: "1h" });
const EXPIRED = jwt.sign({ phone: "userA", uid: 1 }, JWT_SECRET, { expiresIn: "-1h" });
afterEach(() => {
  classifyCalls = 0;
  scanCalls = 0;
  rigCalls = 0;
  uploadCalls = 0;
  usageCalls = 0;
  usage.classify = 1;
  usage.rig = 1;
  usage.semantic_scan = 1;
  forcedReservationDenial = null;
  semanticScans.clear();
  process.env.PETSIM_RIG_ENABLED = "false";
});

// ---- Authentication -------------------------------------------------------
test("rejects requests with no token (401)", async () => {
  const res = await request.post("/api/pets/classify").send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(res.status, 401);
});

test("rejects malformed token (401)", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", "Bearer not-a-jwt")
    .send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(res.status, 401);
});

test("rejects expired token (401)", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${EXPIRED}`)
    .send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(res.status, 401);
});

// ---- Ownership isolation (two users) --------------------------------------
test("owner A can classify their own avatar; wrong owner 404", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(res.status, 200);
  assert.equal(classifyCalls, 1, "provider called once for valid owner");

  const bad = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userB")}`)
    .send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(bad.status, 404, "userB must not see userA's avatar");
  assert.equal(classifyCalls, 1, "no extra provider call for rejected wrong-owner");
});

test("owner B's pet cannot be classified by userA (404 + no provider call)", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 22, imageBase64: DATA_URL });
  assert.equal(res.status, 404);
  assert.equal(classifyCalls, 0, "provider NEVER called when ownership fails");
});

test("semantic-scan is isolated per owner", async () => {
  const anchorHash = "shared-physical-anchor";
  const a = await request
    .post("/api/ar/semantic-scan")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ imageBase64: DATA_URL, anchorHash });
  assert.equal(a.status, 200);
  assert.equal(a.body.cached, false);
  assert.equal(scanCalls, 1);

  const b = await request
    .post("/api/ar/semantic-scan")
    .set("Authorization", `Bearer ${tokenFor("userB")}`)
    .send({ imageBase64: DATA_URL, anchorHash });
  assert.equal(b.status, 200);
  assert.equal(b.body.cached, false, "userB must not receive userA's cached scan");
  assert.equal(scanCalls, 2);

  const aCached = await request
    .post("/api/ar/semantic-scan")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ imageBase64: DATA_URL, anchorHash });
  assert.equal(aCached.status, 200);
  assert.equal(aCached.body.cached, true);
  assert.equal(scanCalls, 2, "only the owning user's cached result is reused");
});

// ---- Disabled paid endpoints ---------------------------------------------
test("rig endpoint is disabled by default (501)", async () => {
  const res = await request
    .post("/api/pets/101/rig")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({});
  assert.equal(res.status, 501);
  assert.equal(rigCalls, 0, "rig provider never called while disabled");
});

test("enabled rig route enforces two-user ownership before usage or provider calls", async () => {
  process.env.PETSIM_RIG_ENABLED = "true";
  const res = await request
    .post("/api/pets/202/rig")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({});
  assert.equal(res.status, 404);
  assert.equal(usageCalls, 0);
  assert.equal(rigCalls, 0);
  assert.equal(uploadCalls, 0);
});

test("enabled rig route rejects a caller-supplied provider task id", async () => {
  process.env.PETSIM_RIG_ENABLED = "true";
  const res = await request
    .post("/api/pets/101/rig")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ genTaskId: "unowned-provider-task" });
  assert.equal(res.status, 400);
  assert.equal(usageCalls, 0);
  assert.equal(rigCalls, 0);
  assert.equal(uploadCalls, 0);
});

test("master kill-switch returns 503 for classify (no provider call)", async () => {
  const prev = process.env.PETSIM_PAID_APIS_ENABLED;
  process.env.PETSIM_PAID_APIS_ENABLED = "false";
  try {
    const res = await request
      .post("/api/pets/classify")
      .set("Authorization", `Bearer ${tokenFor("userA")}`)
      .send({ avatarId: 11, imageBase64: DATA_URL });
    assert.equal(res.status, 503);
    assert.equal(classifyCalls, 0, "provider not called when master switch off");
  } finally {
    process.env.PETSIM_PAID_APIS_ENABLED = prev ?? "";
  }
});

// ---- Per-user caps ------------------------------------------------------
test("per-user cap returns 429 and blocks provider", async () => {
  usage.classify = 999; // already over the default cap (25)
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(res.status, 429);
  assert.equal(classifyCalls, 0, "provider not called when over cap");
});

test("aggregate request cap returns 503 and blocks provider", async () => {
  forcedReservationDenial = "global_cap";
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: DATA_URL });
  assert.equal(res.status, 503);
  assert.equal(res.body.reason, "global_cap");
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 1);
});

test("aggregate cost cap returns 503 and blocks provider", async () => {
  forcedReservationDenial = "global_cost_cap";
  const res = await request
    .post("/api/ar/semantic-scan")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ imageBase64: DATA_URL, anchorHash: "cost-cap-anchor" });
  assert.equal(res.status, 503);
  assert.equal(res.body.reason, "global_cost_cap");
  assert.equal(scanCalls, 0);
  assert.equal(usageCalls, 1);
});

// ---- Invalid requests rejected before provider --------------------------
test("missing imageBase64 rejected before provider (400, 0 calls)", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11 });
  assert.equal(res.status, 400);
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 0);
});

test("imageUrl is rejected (P2 schema never() — 400, no provider)", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageUrl: "http://evil.example/m.jpg" });
  assert.equal(res.status, 400);
  assert.equal(classifyCalls, 0, "SSRF-via-URL input rejected before provider");
  assert.equal(usageCalls, 0);
});

test("malformed avatarId rejected before provider (400, 0 calls)", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: "abc", imageBase64: DATA_URL });
  assert.equal(res.status, 400);
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 0);
});

test("malformed base64 data URL rejected before provider", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: "data:image/jpeg;base64,%%%%" });
  assert.equal(res.status, 400);
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 0);
});

test("header-only JPEG is rejected before quota or provider", async () => {
  const headerOnlyJpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    0x00, 0x02, 0x00, 0x03,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: `data:image/jpeg;base64,${headerOnlyJpeg.toString("base64")}` });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.validation, ["INVALID_IMAGE"]);
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 0);
});

test("production image parser accepts a valid request above the global 1 MiB limit", async () => {
  const requestBytes = Buffer.byteLength(JSON.stringify({ avatarId: 11, imageBase64: LARGE_DATA_URL }));
  assert.ok(requestBytes > 1024 * 1024, "fixture must exercise the route-specific parser");
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: LARGE_DATA_URL });
  assert.equal(res.status, 200);
  assert.equal(classifyCalls, 1);
});

test("production image parser rejects requests above its hard JSON ceiling", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: "x".repeat(6 * 1024 * 1024) });
  assert.equal(res.status, 413);
  assert.deepEqual(res.body.validation, ["REQUEST_TOO_LARGE"]);
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 0);
});

test("declared MIME mismatch is rejected before quota or provider", async () => {
  const pngBytes = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000000000000000000049454e4400000000",
    "hex",
  );
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: `data:image/jpeg;base64,${pngBytes.toString("base64")}` });
  assert.equal(res.status, 400);
  assert.equal(classifyCalls, 0);
  assert.equal(usageCalls, 0);
});

test("semantic scan rejects malformed image data before quota or provider", async () => {
  const res = await request
    .post("/api/ar/semantic-scan")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ imageBase64: "data:image/png;base64,AAAA" });
  assert.equal(res.status, 400);
  assert.equal(scanCalls, 0);
  assert.equal(usageCalls, 0);
});

test("force is accepted and reaches the non-cached classify path", async () => {
  const res = await request
    .post("/api/pets/classify")
    .set("Authorization", `Bearer ${tokenFor("userA")}`)
    .send({ avatarId: 11, imageBase64: DATA_URL, force: true });
  assert.equal(res.status, 200);
  assert.equal(classifyCalls, 1);
});
