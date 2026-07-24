import test from "node:test";
import assert from "node:assert/strict";

process.env.PRINTFUL_API_KEY = "test-printful-key";

// ── Test 1: Margin Guard Formula ─────────────────────────────────────────────
test("computeRetailPrice formula enforces profit margin and minimum floor", async () => {
  const { computeRetailPrice } = await import("../server/customizerCheckout.ts");

  // Case 1: Published price wins when above floor & markup
  assert.equal(computeRetailPrice(5000, 1000, 80, 500), 5000);

  // Case 2: Markup percentage wins when base cost increases
  // cost = $20, 80% markup -> $36
  assert.equal(computeRetailPrice(1000, 2000, 80, 500), 3600);

  // Case 3: Minimum margin floor wins when markup is 0
  // cost = $20, floor = $5 -> $25
  assert.equal(computeRetailPrice(1000, 2000, 0, 500), 2500);
});

// ── Test 2: Sharp Compositor ──────────────────────────────────────────────────
test("buildPrintComposite composites image to exact printfile dimensions", async () => {
  const { buildPrintComposite } = await import("../server/customizerCheckout.ts");
  const sharp = (await import("sharp")).default;

  const sourceBuffer = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).png().toBuffer();

  const composite = await buildPrintComposite(sourceBuffer, 1200, 1600, 100, 100, 800, 1000);
  assert.ok(Buffer.isBuffer(composite));

  const metadata = await sharp(composite).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1600);
  assert.equal(metadata.format, "png");
});

// ── Test 3: checkoutDigital with Stripe Integration ────────────────────────
test("checkoutDigital creates Stripe session and updates digital order", async () => {
  const { checkoutDigital } = await import("../server/marketplacePublic.ts");

  const mockQueries = [];
  const fakePool = {
    async query(sql, params) {
      mockQueries.push({ sql, params });
      if (sql.includes("FROM marketplace_listings")) {
        return [[{ id: 10, name: "Shiba Inu 3D Model", digital_price_cents: 2900 }]];
      }
      if (sql.includes("FROM marketplace_assets")) {
        return [[{ id: 100 }]];
      }
      if (sql.includes("FROM marketplace_entitlements")) {
        return [[]]; // Not owned yet
      }
      if (sql.includes("FROM marketplace_digital_orders")) {
        return [[]]; // No existing order with this idempotency key
      }
      if (sql.includes("INSERT INTO marketplace_digital_orders")) {
        return [{ insertId: 55 }];
      }
      if (sql.includes("UPDATE marketplace_digital_orders SET stripe_session_id")) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };

  const fakeStripe = {
    checkout: {
      sessions: {
        async create(params) {
          assert.equal(params.mode, "payment");
          assert.equal(params.metadata.type, "marketplace_digital");
          assert.equal(params.metadata.digitalOrderId, "55");
          assert.equal(params.line_items[0].price_data.unit_amount, 2900);
          return { id: "cs_test_digital_999", url: "https://checkout.stripe.com/c/pay/cs_test_digital_999" };
        },
      },
    },
  };

  const result = await checkoutDigital(
    fakePool,
    "+15550001111",
    "shiba-uuid-123",
    "idem_key_777",
    fakeStripe,
    "http://localhost:3000"
  );

  assert.equal(result.orderId, 55);
  assert.equal(result.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_digital_999");
  assert.equal(result.stripeSessionId, "cs_test_digital_999");

  const updateQuery = mockQueries.find((q) => q.sql.includes("UPDATE marketplace_digital_orders SET stripe_session_id"));
  assert.ok(updateQuery, "Must update marketplace_digital_orders with stripe_session_id and checkout_url");
  assert.equal(updateQuery.params[0], "cs_test_digital_999");
});

// ── Test 4: Idempotent resume of digital checkout ─────────────────────────────
test("checkoutDigital resumes existing order when idempotency key is re-sent", async () => {
  const { checkoutDigital } = await import("../server/marketplacePublic.ts");

  const fakePool = {
    async query(sql) {
      if (sql.includes("FROM marketplace_listings")) {
        return [[{ id: 10, name: "Shiba Inu 3D Model", digital_price_cents: 2900 }]];
      }
      if (sql.includes("FROM marketplace_assets")) {
        return [[{ id: 100 }]];
      }
      if (sql.includes("FROM marketplace_entitlements")) {
        return [[]];
      }
      if (sql.includes("FROM marketplace_digital_orders")) {
        return [[{ id: 55, status: "awaiting_payment", checkout_url: "https://checkout.stripe.com/existing", stripe_session_id: "cs_existing" }]];
      }
      return [[]];
    },
  };

  const result = await checkoutDigital(fakePool, "+15550001111", "shiba-uuid-123", "idem_key_777");
  assert.equal(result.orderId, 55);
  assert.equal(result.checkoutUrl, "https://checkout.stripe.com/existing");
});
