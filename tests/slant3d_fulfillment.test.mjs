import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { draftSlantOrder, submitSlantOrderIfDraft, uploadSlantFileFromUrl } from "../server/slant3d.ts";

const originalFetch = globalThis.fetch;
const originalEnv = {
  apiKey: process.env.SLANT3D_API_KEY,
  platformId: process.env.SLANT3D_PLATFORM_ID,
  filamentId: process.env.SLANT3D_DEFAULT_FILAMENT_ID,
  baseUrl: process.env.SLANT3D_API_BASE_URL,
};

beforeEach(() => {
  process.env.SLANT3D_API_KEY = "sl-test-key";
  process.env.SLANT3D_PLATFORM_ID = "platform-test";
  process.env.SLANT3D_DEFAULT_FILAMENT_ID = "filament-test";
  process.env.SLANT3D_API_BASE_URL = "https://slant.test/v2/api";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    SLANT3D_API_KEY: originalEnv.apiKey,
    SLANT3D_PLATFORM_ID: originalEnv.platformId,
    SLANT3D_DEFAULT_FILAMENT_ID: originalEnv.filamentId,
    SLANT3D_API_BASE_URL: originalEnv.baseUrl,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Slant upload uses a durable STL URL and server-only bearer token", async () => {
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(String(init.body)) };
    return new Response(JSON.stringify({ success: true, data: { publicFileServiceId: "file-123" } }), { status: 200 });
  };
  const file = await uploadSlantFileFromUrl({ stlUrl: "https://media.example/model.stl", name: "pet", ownerId: "owner" });
  assert.equal(file.publicFileServiceId, "file-123");
  assert.equal(captured.url, "https://slant.test/v2/api/files");
  assert.equal(captured.init.headers.Authorization, "Bearer sl-test-key");
  assert.deepEqual(captured.body, { URL: "https://media.example/model.stl", name: "pet", platformId: "platform-test", ownerId: "owner", type: "stl" });
});

test("Slant draft includes shipping, the configured filament, and support generation", async () => {
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ success: true, data: { order: { publicId: "SLANT_1", status: "DRAFT" }, totals: { printingCost: 10, deliveryCost: 5, totalCost: 15 } } }), { status: 200 });
  };
  const order = await draftSlantOrder({
    publicFileServiceId: "file-123",
    ownerId: "owner",
    itemName: "Pet figurine",
    address: { name: "Ada Doglover", email: "ada@example.com", line1: "1 Main St", city: "Denver", state: "CO", zip: "80202", country: "US" },
  });
  assert.equal(order.publicId, "SLANT_1");
  assert.equal(order.totals.totalCost, 15);
  assert.equal(body.items[0].filamentId, "filament-test");
  assert.equal(body.items[0].options.slicerOptions.support_enable, true);
  assert.equal(body.customer.details.address.country, "US");
});

test("paid-order retry does not submit a Slant order twice", async () => {
  const methods = [];
  globalThis.fetch = async (_url, init = {}) => {
    methods.push(init.method || "GET");
    return new Response(JSON.stringify({ success: true, data: { status: "PAID" } }), { status: 200 });
  };
  const result = await submitSlantOrderIfDraft("SLANT_1");
  assert.equal(result.data.status, "PAID");
  assert.deepEqual(methods, ["GET"]);
});

test("draft Slant order is submitted exactly once", async () => {
  const methods = [];
  globalThis.fetch = async (_url, init = {}) => {
    const method = init.method || "GET";
    methods.push(method);
    return new Response(JSON.stringify({ success: true, data: { status: method === "POST" ? "PAID" : "DRAFT" } }), { status: 200 });
  };
  const result = await submitSlantOrderIfDraft("SLANT_1");
  assert.equal(result.data.status, "PAID");
  assert.deepEqual(methods, ["GET", "POST"]);
});
