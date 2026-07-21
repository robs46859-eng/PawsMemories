import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import supertest from "supertest";
import { createHermesApp } from "../../server/hermes/app.ts";
import { EdgeHermesClient, HermesClientError } from "../../server/hermes/client.ts";
import { HermesConfigError, loadHermesConfig } from "../../server/hermes/config.ts";
import { HERMES_SANITIZED_ERRORS } from "../../server/hermes/router.ts";

const JWT_SECRET = "fixture-hermes-jwt-material-0123456789"; // gitleaks:allow
const PRODUCER_SECRET = "fixture-hermes-producer-material"; // gitleaks:allow
process.env.JWT_SECRET = JWT_SECRET;

const TRANSLATE_BODY = {
  payload: {
    text: "Hello",
    source_language: "English",
    target_language: "Spanish",
    context: "Friendly Pawsome3D account message",
  },
};
const KNOWLEDGE_BODY = {
  payload: {
    question: "What is a GLB?",
    context_chunks: ["A GLB is the binary container form of glTF used for 3D assets."],
    collection: "pawsome3d-ar",
  },
};
const LOOKS_BODY = {
  payload: {
    avatar_id: 42,
    prompt: "Four polished spring looks with distinct outfits and locations",
    identity_summary: "Golden retriever avatar with warm brown eyes and a blue collar",
    look_pack: "Spring editorial",
    look_count: 4,
    reference_photo_count: 12,
    aspect_ratio: "4:5",
    output_schema: "pawsome.look-spec.v1",
  },
};

const VALID_LOOK_SPEC = {
  schema_version: "pawsome.look-spec.v1",
  request_summary: "Four spring editorial looks preserving the avatar identity.",
  identity_rules: ["Keep face shape, coat markings, eye color, and collar unchanged."],
  looks: Array.from({ length: 4 }, (_, index) => ({
    id: `look-${index + 1}`,
    title: `Spring look ${index + 1}`,
    outfit: {
      style: "polished spring casual",
      garments: ["lightweight jacket", "cotton shirt"],
      colors: ["sky blue", "cream"],
      accessories: ["blue collar"],
    },
    pose: { stance: "relaxed standing pose", expression: "friendly", gaze: "toward camera" },
    environment: { setting: "sunlit garden", background: "soft greenery" },
    camera: { shot: "full-body", angle: "eye level" },
    lighting: "soft morning daylight",
    render_prompt: "Preserve identity; full-body spring editorial portrait in a sunlit garden.",
    negative_prompt: "identity drift, duplicate anatomy, text, logos, blur, artifacts",
  })),
};

const tokenFor = (owner) => jwt.sign({ phone: owner, uid: 1 }, JWT_SECRET, { expiresIn: "1h" });
const expiredToken = jwt.sign({ phone: "owner-a", uid: 1 }, JWT_SECRET, { expiresIn: "-1h" });

class FakeHermesStore {
  jobs = new Map();
  calls = { create: 0, setBridge: 0, get: 0, update: 0 };

  async createJob(input) {
    this.calls.create += 1;
    const now = new Date(0).toISOString();
    this.jobs.set(input.id, {
      ...input,
      bridgeJobId: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async setBridgeJob(input) {
    this.calls.setBridge += 1;
    const job = this.jobs.get(input.id);
    if (!job || job.owner !== input.owner) throw new Error("not found");
    Object.assign(job, {
      bridgeJobId: input.bridgeJobId,
      status: input.status,
      error: null,
      updatedAt: new Date(1_000).toISOString(),
    });
  }

  async getJob(id, owner) {
    this.calls.get += 1;
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) return null;
    return structuredClone(job);
  }

  async updateJob(input) {
    this.calls.update += 1;
    const job = this.jobs.get(input.id);
    if (!job || job.owner !== input.owner) throw new Error("not found");
    Object.assign(job, {
      status: input.status,
      result: structuredClone(input.result),
      error: input.error,
      updatedAt: new Date(2_000 + this.calls.update).toISOString(),
    });
  }

  seed(input) {
    const now = new Date(0).toISOString();
    this.jobs.set(input.id, {
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      ...input,
    });
  }
}

class FakeHermesClient {
  createCalls = [];
  getCalls = [];
  createImpl = async (_type, _payload, _idempotencyKey, callNumber) => ({
    job_id: `bridge-private-${callNumber}`,
    status: "queued",
  });
  getImpl = async () => ({ status: "running", result: null, error: null });

  async createJob(type, payload, idempotencyKey) {
    this.createCalls.push({ type, payload: structuredClone(payload), idempotencyKey });
    return this.createImpl(type, payload, idempotencyKey, this.createCalls.length);
  }

  async getJob(bridgeJobId) {
    this.getCalls.push(bridgeJobId);
    return this.getImpl(bridgeJobId, this.getCalls.length);
  }
}

class FakeDailyUsage {
  counts = new Map();
  calls = [];

  set(owner, type, count) {
    this.counts.set(`${owner}:${type}`, count);
  }

  async increment(owner, type) {
    this.calls.push({ owner, type });
    const key = `${owner}:${type}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
}

function harness(options = {}) {
  const store = options.store ?? new FakeHermesStore();
  const client = options.client ?? new FakeHermesClient();
  const dailyUsage = options.dailyUsage ?? new FakeDailyUsage();
  const app = createHermesApp({
    enabled: options.enabled ?? true,
    client: options.client === null ? null : client,
    store,
    dailyUsage,
  });
  return { request: supertest(app), store, client, dailyUsage };
}

async function post(request, path, owner, body, ip = "198.51.100.10") {
  return request
    .post(path)
    .set("Authorization", `Bearer ${tokenFor(owner)}`)
    .set("X-Forwarded-For", ip)
    .send(body);
}

test("Hermes auth rejects missing, malformed, expired, and claimless tokens before quota or provider", async () => {
  const { request, store, client, dailyUsage } = harness();
  const claimless = jwt.sign({ uid: 1 }, JWT_SECRET, { expiresIn: "1h" });
  const authHeaders = [null, "Bearer not-a-jwt", `Bearer ${expiredToken}`, `Bearer ${claimless}`];

  for (const authorization of authHeaders) {
    let call = request.post("/api/hermes/translate");
    if (authorization) call = call.set("Authorization", authorization);
    const response = await call.send(TRANSLATE_BODY);
    assert.equal(response.status, 401);
  }

  assert.equal(dailyUsage.calls.length, 0);
  assert.equal(client.createCalls.length, 0);
  assert.equal(store.calls.create, 0);
});

test("strict request validation runs before minute, daily, storage, or provider work", async () => {
  const { request, store, client, dailyUsage } = harness();
  const invalidBodies = [
    {},
    { payload: {} },
    { payload: "not-an-object" },
    { payload: { text: "Hello" }, extra: true },
    { payload: { text: "Hello", source_language: "English", target_language: "Spanish", extra: true } },
    { payload: { text: "x".repeat(6_001), source_language: "English", target_language: "Spanish" } },
    { payload: { question: "What is a GLB?", context_chunks: [], collection: "pawsome3d-ar" } },
    { payload: { items: new Array(1_001).fill(1) } },
  ];

  for (const body of invalidBodies) {
    const response = await post(request, "/api/hermes/translate", "owner-a", body);
    assert.equal(response.status, 400);
  }

  assert.equal(dailyUsage.calls.length, 0);
  assert.equal(client.createCalls.length, 0);
  assert.equal(store.calls.create, 0);
});

test("Hermes defaults disabled and disabled routes do no quota, storage, or provider work", async () => {
  assert.deepEqual(loadHermesConfig({}), { enabled: false, timeoutMs: 10_000 });

  const { request, store, client, dailyUsage } = harness({ enabled: false, client: null });
  const createResponse = await post(
    request,
    "/api/hermes/translate",
    "owner-a",
    TRANSLATE_BODY,
  );
  assert.equal(createResponse.status, 503);

  // A GET for an unknown job is 404, NOT 503 — and that is deliberate.
  //
  // router.ts defers the enabled-check until after the job lookup, because
  // Gemini-path jobs are written as "completed" synchronously and must remain
  // readable while HERMES_ENABLED=false. So the status route answers the
  // question actually asked ("does this job exist for me?") rather than
  // reporting the bridge's availability. For a random UUID the honest answer
  // is "no such job"; 503 would claim the service is down when the real
  // problem is that the caller asked for a job that was never created.
  //
  // This assertion previously expected 503, from before the Gemini adapter
  // path existed. The behaviour it was guarding is preserved below: a
  // disabled Hermes still performs no quota, provider, or write work.
  const statusResponse = await request
    .get(`/api/hermes/jobs/${randomUUID()}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(statusResponse.status, 404);

  assert.equal(dailyUsage.calls.length, 0, "a disabled Hermes must not consume quota");
  assert.equal(client.createCalls.length, 0, "a disabled Hermes must not call the provider");
  // `get: 1` is the lookup that produced the 404 above — a read is how we know
  // the job is absent. The guarantee under test is that nothing was WRITTEN.
  assert.deepEqual(store.calls, { create: 0, setBridge: 0, get: 1, update: 0 });
});

test("create relays the exact contract with local UUID idempotency and returns no bridge ID", async () => {
  const { request, store, client, dailyUsage } = harness();
  const response = await post(
    request,
    "/api/hermes/translate",
    "owner-a",
    TRANSLATE_BODY,
  );

  assert.equal(response.status, 202);
  assert.match(response.body.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(Object.keys(response.body).sort(), ["id", "status", "type"]);
  assert.equal(response.body.type, "translate");
  assert.equal(response.body.status, "queued");
  assert.equal(response.headers.location, `/api/hermes/jobs/${response.body.id}`);
  assert.equal(client.createCalls.length, 1);
  assert.deepEqual(client.createCalls[0], {
    type: "translate",
    payload: TRANSLATE_BODY.payload,
    idempotencyKey: response.body.id,
  });
  assert.deepEqual(dailyUsage.calls, [{ owner: "owner-a", type: "translate" }]);

  const stored = store.jobs.get(response.body.id);
  assert.equal(stored.owner, "owner-a");
  assert.equal(stored.bridgeJobId, "bridge-private-1");
  assert.equal(JSON.stringify(response.body).includes(stored.bridgeJobId), false);
});

test("Looks uses the fixed Outlines schema contract and accepts a schema-valid result", async () => {
  const { request, store, client, dailyUsage } = harness();
  const created = await post(request, "/api/hermes/looks", "looks-owner", LOOKS_BODY);
  assert.equal(created.status, 202);
  assert.equal(created.body.type, "looks");
  // The provider receives the PARSED payload, not the raw request body.
  // HermesLooksPayloadSchema declares `quality_tier` with .default("standard"),
  // so Zod materialises it when the caller omits it — and it must reach the
  // provider, since the tier is what selects the model chain (Draft/Standard/
  // Studio). Comparing against the raw body would assert that schema defaults
  // are silently dropped, which is the opposite of what we want.
  assert.deepEqual(client.createCalls[0].payload, {
    ...LOOKS_BODY.payload,
    quality_tier: "standard",
  });
  assert.deepEqual(dailyUsage.calls, [{ owner: "looks-owner", type: "looks" }]);

  client.getImpl = async () => ({ status: "completed", result: VALID_LOOK_SPEC, error: null });
  const completed = await request
    .get(`/api/hermes/jobs/${created.body.id}`)
    .set("Authorization", `Bearer ${tokenFor("looks-owner")}`);
  assert.equal(completed.status, 200);
  assert.deepEqual(completed.body.result, VALID_LOOK_SPEC);
  assert.deepEqual(store.jobs.get(created.body.id).result, VALID_LOOK_SPEC);
});

test("Looks rejects prompt-only or malformed JSON output at the application boundary", async () => {
  const { request, store, client } = harness();
  const created = await post(request, "/api/hermes/looks", "invalid-looks-owner", LOOKS_BODY);
  client.getImpl = async () => ({
    status: "completed",
    result: { text: "```json\\n{not actually valid}\\n```" },
    error: null,
  });

  const completed = await request
    .get(`/api/hermes/jobs/${created.body.id}`)
    .set("Authorization", `Bearer ${tokenFor("invalid-looks-owner")}`);
  assert.equal(completed.status, 502);
  assert.equal(completed.body.error, "Hermes returned an invalid Looks plan.");
  const stored = store.jobs.get(created.body.id);
  assert.equal(stored.status, "failed");
  assert.equal(stored.result, null);
  assert.equal(stored.error, HERMES_SANITIZED_ERRORS.jobFailed);
});

test("owner-scoped status returns 404 for missing or foreign jobs and sanitizes cached results", async () => {
  const { request, store, client } = harness();
  const created = await post(
    request,
    "/api/hermes/knowledge",
    "owner-a",
    KNOWLEDGE_BODY,
  );
  const localId = created.body.id;
  const bridgeId = store.jobs.get(localId).bridgeJobId;

  const foreign = await request
    .get(`/api/hermes/jobs/${localId}`)
    .set("Authorization", `Bearer ${tokenFor("owner-b")}`);
  assert.equal(foreign.status, 404);
  assert.equal(client.getCalls.length, 0);

  const missing = await request
    .get(`/api/hermes/jobs/${randomUUID()}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(missing.status, 404);
  assert.equal(client.getCalls.length, 0);

  client.getImpl = async () => ({
    status: "completed",
    result: {
      answer: "GLB is a binary glTF container.",
      job_id: bridgeId,
      nested: { trace: `private:${bridgeId}` },
    },
    error: null,
  });
  const owned = await request
    .get(`/api/hermes/jobs/${localId}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(owned.status, 200);
  assert.equal(owned.body.id, localId);
  assert.equal(owned.body.result.answer, "GLB is a binary glTF container.");
  assert.equal("job_id" in owned.body.result, false);
  assert.equal(owned.body.result.nested.trace, "private:[redacted]");
  assert.equal(JSON.stringify(owned.body).includes(bridgeId), false);
  assert.equal(client.getCalls.length, 1);

  const cached = await request
    .get(`/api/hermes/jobs/${localId}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(cached.status, 200);
  assert.equal(client.getCalls.length, 1, "terminal result is served from the owner-scoped store");
  assert.equal(JSON.stringify(store.jobs.get(localId).result).includes(bridgeId), false);
});

test("create minute limit is exactly 5 per user", async () => {
  const { request, client, dailyUsage } = harness();
  for (let index = 0; index < 5; index += 1) {
    const response = await post(
      request,
      "/api/hermes/translate",
      "rate-user",
      TRANSLATE_BODY,
      `198.51.100.${index + 1}`,
    );
    assert.equal(response.status, 202);
  }
  const blocked = await post(
    request,
    "/api/hermes/translate",
    "rate-user",
    TRANSLATE_BODY,
    "198.51.100.99",
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["retry-after"], "60");
  assert.equal(client.createCalls.length, 5);
  assert.equal(dailyUsage.calls.length, 5, "rate-limited request does not consume daily usage");
});

test("create minute limit is exactly 30 per IP across users", async () => {
  const { request, client, dailyUsage } = harness();
  for (let index = 0; index < 30; index += 1) {
    const response = await post(
      request,
      "/api/hermes/translate",
      `ip-owner-${index}`,
      TRANSLATE_BODY,
      "203.0.113.8",
    );
    assert.equal(response.status, 202);
  }
  const blocked = await post(
    request,
    "/api/hermes/translate",
    "ip-owner-30",
    TRANSLATE_BODY,
    "203.0.113.8",
  );
  assert.equal(blocked.status, 429);
  assert.equal(client.createCalls.length, 30);
  assert.equal(dailyUsage.calls.length, 30);
});

test("status minute limit is exactly 60 per user", async () => {
  const { request, store, client } = harness();
  const id = randomUUID();
  store.seed({
    id,
    owner: "status-owner",
    bridgeJobId: "bridge-status-user",
    type: "translate",
    status: "queued",
  });

  for (let index = 0; index < 60; index += 1) {
    const response = await request
      .get(`/api/hermes/jobs/${id}`)
      .set("Authorization", `Bearer ${tokenFor("status-owner")}`)
      .set("X-Forwarded-For", `198.51.100.${(index % 50) + 1}`);
    assert.equal(response.status, 200);
  }
  const blocked = await request
    .get(`/api/hermes/jobs/${id}`)
    .set("Authorization", `Bearer ${tokenFor("status-owner")}`)
    .set("X-Forwarded-For", "198.51.100.250");
  assert.equal(blocked.status, 429);
  assert.equal(client.getCalls.length, 60);
});

test("status minute limit is exactly 60 per IP across users", async () => {
  const { request, store, client } = harness();
  for (let index = 0; index < 61; index += 1) {
    store.seed({
      id: randomUUID(),
      owner: `status-ip-owner-${index}`,
      bridgeJobId: `bridge-status-ip-${index}`,
      type: "knowledge",
      status: "queued",
    });
  }
  const jobs = [...store.jobs.values()];

  for (let index = 0; index < 60; index += 1) {
    const job = jobs[index];
    const response = await request
      .get(`/api/hermes/jobs/${job.id}`)
      .set("Authorization", `Bearer ${tokenFor(job.owner)}`)
      .set("X-Forwarded-For", "203.0.113.40");
    assert.equal(response.status, 200);
  }
  const blockedJob = jobs[60];
  const blocked = await request
    .get(`/api/hermes/jobs/${blockedJob.id}`)
    .set("Authorization", `Bearer ${tokenFor(blockedJob.owner)}`)
    .set("X-Forwarded-For", "203.0.113.40");
  assert.equal(blocked.status, 429);
  assert.equal(client.getCalls.length, 60);
});

test("daily caps allow translation 20 and knowledge 10, then block before provider", async () => {
  const { request, client, dailyUsage } = harness();
  dailyUsage.set("daily-translate", "translate", 19);
  dailyUsage.set("daily-knowledge", "knowledge", 9);

  const translation20 = await post(
    request,
    "/api/hermes/translate",
    "daily-translate",
    TRANSLATE_BODY,
    "198.51.100.30",
  );
  assert.equal(translation20.status, 202);
  const translation21 = await post(
    request,
    "/api/hermes/translate",
    "daily-translate",
    TRANSLATE_BODY,
    "198.51.100.31",
  );
  assert.equal(translation21.status, 429);
  assert.equal(translation21.body.cap, 20);

  const knowledge10 = await post(
    request,
    "/api/hermes/knowledge",
    "daily-knowledge",
    KNOWLEDGE_BODY,
    "198.51.100.32",
  );
  assert.equal(knowledge10.status, 202);
  const knowledge11 = await post(
    request,
    "/api/hermes/knowledge",
    "daily-knowledge",
    KNOWLEDGE_BODY,
    "198.51.100.33",
  );
  assert.equal(knowledge11.status, 429);
  assert.equal(knowledge11.body.cap, 10);
  assert.equal(client.createCalls.length, 2, "over-cap requests never reach the bridge");
});

test("create timeout and provider errors are sanitized in responses and storage", async () => {
  for (const [thrown, expectedStatus] of [
    [new HermesClientError("timeout", "private bridge bridge-timeout-id"), 504],
    [new Error("Bearer private-secret at https://private.invalid"), 502],
  ]) {
    const client = new FakeHermesClient();
    client.createImpl = async () => { throw thrown; };
    const { request, store } = harness({ client });
    const response = await post(
      request,
      "/api/hermes/translate",
      `failure-owner-${expectedStatus}`,
      TRANSLATE_BODY,
    );
    assert.equal(response.status, expectedStatus);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("bridge-timeout-id"), false);
    assert.equal(serialized.includes("private-secret"), false);
    assert.equal(serialized.includes("private.invalid"), false);

    const stored = [...store.jobs.values()][0];
    assert.equal(stored.bridgeJobId, null);
    assert.equal(stored.status, "failed");
    assert.equal(stored.error, HERMES_SANITIZED_ERRORS.submissionFailed);
  }
});

test("bridge failure text and malformed bridge responses never leak through status or create", async () => {
  const { request, store, client } = harness();
  const created = await post(
    request,
    "/api/hermes/knowledge",
    "failure-owner",
    KNOWLEDGE_BODY,
  );
  const bridgeId = store.jobs.get(created.body.id).bridgeJobId;
  client.getImpl = async () => ({
    status: "failed",
    result: null,
    error: `producer secret and ${bridgeId}`,
  });
  const status = await request
    .get(`/api/hermes/jobs/${created.body.id}`)
    .set("Authorization", `Bearer ${tokenFor("failure-owner")}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.error, HERMES_SANITIZED_ERRORS.jobFailed);
  assert.equal(JSON.stringify(status.body).includes(bridgeId), false);
  assert.equal(store.jobs.get(created.body.id).error, HERMES_SANITIZED_ERRORS.jobFailed);

  const malformedClient = new FakeHermesClient();
  malformedClient.createImpl = async () => ({
    job_id: "bridge-malformed-private",
    status: "queued",
    unexpected: true,
  });
  const malformedHarness = harness({ client: malformedClient });
  const malformed = await post(
    malformedHarness.request,
    "/api/hermes/translate",
    "malformed-owner",
    TRANSLATE_BODY,
  );
  assert.equal(malformed.status, 502);
  assert.equal(JSON.stringify(malformed.body).includes("bridge-malformed-private"), false);
  const malformedStored = [...malformedHarness.store.jobs.values()][0];
  assert.equal(malformedStored.bridgeJobId, null);
  assert.equal(malformedStored.error, HERMES_SANITIZED_ERRORS.submissionFailed);
});

test("Hermes config enforces HTTPS with HTTP loopback restricted to tests", () => {
  const production = {
    HERMES_ENABLED: "true",
    HERMES_EDGE_BRIDGE_URL: "http://localhost:8787",
    HERMES_EDGE_PRODUCER_SECRET: PRODUCER_SECRET,
    NODE_ENV: "production",
  };
  assert.throws(() => loadHermesConfig(production), HermesConfigError);

  const testConfig = loadHermesConfig({ ...production, NODE_ENV: "test" });
  assert.equal(testConfig.enabled, true);
  assert.equal(testConfig.baseUrl, "http://localhost:8787");
  assert.equal(testConfig.timeoutMs, 10_000);

  const secure = loadHermesConfig({
    ...production,
    HERMES_EDGE_BRIDGE_URL: "https://bridge.example.test/base/",
    HERMES_TIMEOUT_MS: "2500",
  });
  assert.equal(secure.enabled, true);
  assert.equal(secure.baseUrl, "https://bridge.example.test/base");
  assert.equal(secure.timeoutMs, 2_500);
});

test("edge client sends bearer/idempotency headers, forbids redirects, and validates responses", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ job_id: "bridge-client-private", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const client = new EdgeHermesClient({
    enabled: true,
    baseUrl: "https://bridge.example.test/base",
    producerSecret: PRODUCER_SECRET,
    timeoutMs: 1_000,
  }, fetchFn);

  const response = await client.createJob("translate", TRANSLATE_BODY.payload, "local-idempotency-id");
  assert.deepEqual(response, { job_id: "bridge-client-private", status: "queued" });
  assert.equal(calls[0].url, "https://bridge.example.test/base/v1/jobs");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${PRODUCER_SECRET}`);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "local-idempotency-id");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    type: "translate",
    payload: TRANSLATE_BODY.payload,
  });

  const malformedClient = new EdgeHermesClient({
    enabled: true,
    baseUrl: "https://bridge.example.test",
    producerSecret: PRODUCER_SECRET,
    timeoutMs: 1_000,
  }, async () => new Response(JSON.stringify({ job_id: "bridge", status: "queued", extra: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(
    () => malformedClient.createJob("translate", TRANSLATE_BODY.payload, "local-id"),
    (error) => error instanceof HermesClientError && error.kind === "invalid_response",
  );
});

test("edge client aborts timed-out bridge requests without exposing request details", async () => {
  const client = new EdgeHermesClient({
    enabled: true,
    baseUrl: "https://bridge.example.test",
    producerSecret: PRODUCER_SECRET,
    timeoutMs: 10,
  }, async (_url, init) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("test timeout did not fire")), 250);
    init.signal.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(Object.assign(new Error("private timeout detail"), { name: "AbortError" }));
    }, { once: true });
  }));

  await assert.rejects(
    () => client.getJob("bridge-timeout-private"),
    (error) => error instanceof HermesClientError
      && error.kind === "timeout"
      && !error.message.includes("bridge-timeout-private"),
  );
});
