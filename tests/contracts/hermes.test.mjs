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
const TRANSLATION_RESULT = {
  translated_text: "Hola",
  source_language: "English",
  target_language: "Spanish",
  model: "gemma-4-e2b",
  processing_ms: 125,
};
const KNOWLEDGE_RESULT = {
  answer: "A GLB is a binary glTF container.",
  citations: [0],
  collection: "pawsome3d-ar",
  model: "gemma-4-e2b",
  processing_ms: 250,
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
      requestPayload: structuredClone(input.requestPayload),
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
      requestPayload: null,
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
    if (job.status === "completed" || job.status === "failed") return;
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
      requestPayload: null,
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
  getImpl = async () => ({ status: "leased", result: null, error: null });

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

  async reserve(owner, type, cap) {
    this.calls.push({ owner, type });
    const key = `${owner}:${type}`;
    const current = this.counts.get(key) ?? 0;
    if (current >= cap) return { allowed: false, count: current };
    const next = current + 1;
    this.counts.set(key, next);
    return { allowed: true, count: next };
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
    minuteLimits: options.minuteLimits,
    authorizeOwner: options.authorizeOwner ?? (async () => true),
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
  const uidless = jwt.sign({ phone: "owner-a" }, JWT_SECRET, { expiresIn: "1h" });
  const authHeaders = [
    null,
    "Bearer not-a-jwt",
    `Bearer ${expiredToken}`,
    `Bearer ${claimless}`,
    `Bearer ${uidless}`,
  ];

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

test("Hermes rejects a signed token whose user no longer exists", async () => {
  let authorizerCalls = 0;
  const { request, store, client, dailyUsage } = harness({
    authorizeOwner: async () => {
      authorizerCalls += 1;
      return false;
    },
  });
  const response = await post(request, "/api/hermes/translate", "deleted-owner", TRANSLATE_BODY);
  assert.equal(response.status, 401);
  assert.equal(authorizerCalls, 1);
  assert.equal(dailyUsage.calls.length, 0);
  assert.equal(client.createCalls.length, 0);
  assert.equal(store.calls.create, 0);
});

test("strict request validation runs after auth abuse controls but before daily, storage, or provider work", async () => {
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

  for (const [index, body] of invalidBodies.entries()) {
    const response = await post(
      request,
      "/api/hermes/translate",
      `invalid-owner-${index}`,
      body,
      `198.51.100.${index + 20}`,
    );
    assert.equal(response.status, 400);
  }

  assert.equal(dailyUsage.calls.length, 0);
  assert.equal(client.createCalls.length, 0);
  assert.equal(store.calls.create, 0);
});

test("database limiter failures fail closed before daily usage, storage, or provider work", async () => {
  const minuteLimits = {
    async consume() {
      throw new Error("private database detail");
    },
  };
  const { request, store, client, dailyUsage } = harness({ minuteLimits });
  const response = await post(request, "/api/hermes/translate", "limit-db-owner", TRANSLATE_BODY);
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "Hermes abuse controls are unavailable." });
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

  const statusResponse = await request
    .get(`/api/hermes/jobs/${randomUUID()}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(statusResponse.status, 503);
  assert.equal(dailyUsage.calls.length, 0);
  assert.equal(client.createCalls.length, 0);
  assert.deepEqual(store.calls, { create: 0, setBridge: 0, get: 0, update: 0 });
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
  assert.equal(stored.requestPayload, null);
  assert.equal(JSON.stringify(response.body).includes(stored.bridgeJobId), false);
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
      answer: `GLB is a binary glTF container. Trace ${bridgeId}`,
      citations: [0],
      collection: "pawsome3d-ar",
      model: "gemma-4-e2b",
      processing_ms: 125,
    },
    error: null,
  });
  const owned = await request
    .get(`/api/hermes/jobs/${localId}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(owned.status, 200);
  assert.equal(owned.body.id, localId);
  assert.equal(owned.body.result.answer, "GLB is a binary glTF container. Trace [redacted]");
  assert.equal(JSON.stringify(owned.body).includes(bridgeId), false);
  assert.equal(client.getCalls.length, 1);

  const cached = await request
    .get(`/api/hermes/jobs/${localId}`)
    .set("Authorization", `Bearer ${tokenFor("owner-a")}`);
  assert.equal(cached.status, 200);
  assert.equal(client.getCalls.length, 1, "terminal result is served from the owner-scoped store");
  assert.equal(JSON.stringify(store.jobs.get(localId).result).includes(bridgeId), false);
});

test("a delayed nonterminal poll cannot overwrite a completed result", async () => {
  const { request, store, client } = harness();
  const id = randomUUID();
  store.seed({
    id,
    owner: "race-owner",
    bridgeJobId: "bridge-race-private",
    type: "translate",
    status: "queued",
  });

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  client.getImpl = async (_bridgeId, callNumber) => {
    if (callNumber === 1) {
      await firstGate;
      return { status: "leased", result: null, error: null };
    }
    return { status: "completed", result: TRANSLATION_RESULT, error: null };
  };

  const firstPoll = request
    .get(`/api/hermes/jobs/${id}`)
    .set("Authorization", `Bearer ${tokenFor("race-owner")}`)
    .set("X-Forwarded-For", "198.51.100.61")
    .then((response) => response);
  while (client.getCalls.length < 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const completed = await request
    .get(`/api/hermes/jobs/${id}`)
    .set("Authorization", `Bearer ${tokenFor("race-owner")}`)
    .set("X-Forwarded-For", "198.51.100.62");
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, "completed");

  releaseFirst();
  const delayed = await firstPoll;
  assert.equal(delayed.status, 200);
  assert.equal(delayed.body.status, "completed");
  assert.deepEqual(delayed.body.result, TRANSLATION_RESULT);
  assert.equal(store.jobs.get(id).status, "completed");
  assert.deepEqual(store.jobs.get(id).result, TRANSLATION_RESULT);
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

test("valid-looking missing status IDs are limited before database lookup", async () => {
  const { request, store, client } = harness();
  for (let index = 0; index < 60; index += 1) {
    const response = await request
      .get(`/api/hermes/jobs/${randomUUID()}`)
      .set("Authorization", `Bearer ${tokenFor("missing-id-owner")}`)
      .set("X-Forwarded-For", `198.51.100.${(index % 50) + 1}`);
    assert.equal(response.status, 404);
  }
  const blocked = await request
    .get(`/api/hermes/jobs/${randomUUID()}`)
    .set("Authorization", `Bearer ${tokenFor("missing-id-owner")}`)
    .set("X-Forwarded-For", "198.51.100.250");
  assert.equal(blocked.status, 429);
  assert.equal(store.calls.get, 60, "blocked status request never reaches storage");
  assert.equal(client.getCalls.length, 0);
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

test("uncertain submissions remain recoverable without leaking provider details", async () => {
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
    assert.equal(response.status, 202);
    assert.equal(response.body.status, "submitting");
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("bridge-timeout-id"), false);
    assert.equal(serialized.includes("private-secret"), false);
    assert.equal(serialized.includes("private.invalid"), false);

    const stored = [...store.jobs.values()][0];
    assert.equal(stored.bridgeJobId, null);
    assert.equal(stored.status, "submitting");
    assert.deepEqual(stored.requestPayload, TRANSLATE_BODY.payload);
    assert.equal(stored.error, null);

    const status = await request
      .get(`/api/hermes/jobs/${stored.id}`)
      .set("Authorization", `Bearer ${tokenFor(stored.owner)}`);
    assert.equal(status.status, expectedStatus);
    assert.equal(JSON.stringify(status.body).includes("bridge-timeout-id"), false);
    assert.equal(JSON.stringify(status.body).includes("private-secret"), false);
  }
});

test("a timed-out create reconciles with the same idempotency key and one local job", async () => {
  const client = new FakeHermesClient();
  client.createImpl = async (_type, _payload, _idempotencyKey, callNumber) => {
    if (callNumber === 1) throw new HermesClientError("timeout");
    return { job_id: "bridge-recovered-private", status: "queued" };
  };
  const { request, store } = harness({ client });
  const created = await post(request, "/api/hermes/translate", "recovery-owner", TRANSLATE_BODY);
  assert.equal(created.status, 202);
  assert.equal(created.body.status, "submitting");

  const status = await request
    .get(`/api/hermes/jobs/${created.body.id}`)
    .set("Authorization", `Bearer ${tokenFor("recovery-owner")}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.status, "leased");
  assert.equal(store.jobs.size, 1);
  assert.equal(client.createCalls.length, 2);
  assert.equal(client.createCalls[0].idempotencyKey, created.body.id);
  assert.equal(client.createCalls[1].idempotencyKey, created.body.id);
  assert.equal(store.jobs.get(created.body.id).bridgeJobId, "bridge-recovered-private");
  assert.equal(store.jobs.get(created.body.id).requestPayload, null);
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
  assert.equal(malformed.status, 202);
  assert.equal(malformed.body.status, "submitting");
  assert.equal(JSON.stringify(malformed.body).includes("bridge-malformed-private"), false);
  const malformedStored = [...malformedHarness.store.jobs.values()][0];
  assert.equal(malformedStored.bridgeJobId, null);
  assert.equal(malformedStored.status, "submitting");
  assert.deepEqual(malformedStored.requestPayload, TRANSLATE_BODY.payload);

  const malformedStatus = await malformedHarness.request
    .get(`/api/hermes/jobs/${malformedStored.id}`)
    .set("Authorization", `Bearer ${tokenFor("malformed-owner")}`);
  assert.equal(malformedStatus.status, 502);
  assert.equal(JSON.stringify(malformedStatus.body).includes("bridge-malformed-private"), false);
});

test("unknown relay statuses and wrong type-specific results fail closed", async () => {
  const unknownHarness = harness();
  const unknownCreated = await post(
    unknownHarness.request,
    "/api/hermes/knowledge",
    "unknown-status-owner",
    KNOWLEDGE_BODY,
  );
  unknownHarness.client.getImpl = async () => ({
    status: "running",
    result: null,
    error: null,
  });
  const unknown = await unknownHarness.request
    .get(`/api/hermes/jobs/${unknownCreated.body.id}`)
    .set("Authorization", `Bearer ${tokenFor("unknown-status-owner")}`);
  assert.equal(unknown.status, 502);
  assert.equal(unknownHarness.store.jobs.get(unknownCreated.body.id).status, "queued");

  const wrongResultHarness = harness();
  const wrongCreated = await post(
    wrongResultHarness.request,
    "/api/hermes/translate",
    "wrong-result-owner",
    TRANSLATE_BODY,
  );
  wrongResultHarness.client.getImpl = async () => ({
    status: "completed",
    result: KNOWLEDGE_RESULT,
    error: null,
  });
  const wrongResult = await wrongResultHarness.request
    .get(`/api/hermes/jobs/${wrongCreated.body.id}`)
    .set("Authorization", `Bearer ${tokenFor("wrong-result-owner")}`);
  assert.equal(wrongResult.status, 502);
  assert.equal(wrongResultHarness.store.jobs.get(wrongCreated.body.id).status, "queued");
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
    () => client.getJob("bridge-timeout-private", "translate"),
    (error) => error instanceof HermesClientError
      && error.kind === "timeout"
      && !error.message.includes("bridge-timeout-private"),
  );
});
