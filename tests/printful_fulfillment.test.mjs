import assert from "node:assert/strict";
import test from "node:test";

process.env.PRINTFUL_API_KEY = "test-printful-token";
process.env.PRINTFUL_API_BASE_URL = "https://printful.test";
process.env.PRINTFUL_STORE_ID = "store-123";

const { createPrintfulOrder, confirmPrintfulOrderIfDraft, verifyPrintfulConfiguration } = await import("../server/printful.ts");

function response(result, status = 200) {
  return new Response(JSON.stringify({ result }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Printful order is created as a draft with the server-owned product mapping", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response({ id: 42, status: "draft", costs: { total: "12.34" } });
  };
  try {
    const order = await createPrintfulOrder({
      recipient: { name: "Ada", email: "ada@example.com", address1: "1 Main St", city: "Denver", state_code: "CO", country_code: "US", zip: "80202" },
      imageUrl: "https://media.example.com/pawprint.png",
      variantId: 987,
      templateId: 654,
      quantity: 2,
      externalId: "pawprint-idempotent-1",
    });
    assert.equal(order.id, "42");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://printful.test/orders?confirm=false&update_existing=true");
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-printful-token");
    assert.equal(calls[0].init.headers["X-PF-Store-Id"], "store-123");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.external_id, "pawprint-idempotent-1");
    assert.equal(body.items[0].variant_id, 987);
    assert.equal(body.items[0].product_template_id, 654);
    assert.equal(body.items[0].files[0].url, "https://media.example.com/pawprint.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Printful confirmation submits a draft exactly once", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return response({ id: 42, status: "draft" });
    return response({ id: 42, status: "pending" });
  };
  try {
    const order = await confirmPrintfulOrderIfDraft("42");
    assert.equal(order.status, "pending");
    assert.deepEqual(calls.map((call) => [call.url, call.init.method || "GET"]), [
      ["https://printful.test/orders/42", "GET"],
      ["https://printful.test/orders/42/confirm", "POST"],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Printful paid-order retry does not reconfirm a non-draft order", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response({ id: 42, status: "pending" });
  };
  try {
    const order = await confirmPrintfulOrderIfDraft("42");
    assert.equal(order.status, "pending");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Printful deployment verification reads orders without creating one", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response([]);
  };
  try {
    const result = await verifyPrintfulConfiguration();
    assert.deepEqual(result, { authenticated: true, storeContext: "explicit", ordersReadable: true });
    assert.equal(calls[0].url, "https://printful.test/orders?limit=1&offset=0");
    assert.equal(calls[0].init.method, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
