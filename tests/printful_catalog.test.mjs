import test from "node:test";
import assert from "node:assert/strict";

// P0 of the marketplace customizer. These test the parsing/geometry logic
// against Printful's documented v1 response shapes with fetch stubbed — no
// network, no key required. The print-file geometry is the load-bearing part:
// a wrong pixel size produces a rejected or blurry physical product.

const ORIGINAL_FETCH = globalThis.fetch;
process.env.PRINTFUL_API_KEY = "sl-test-key"; // just needs to be truthy

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body === undefined) throw new Error(`unexpected fetch: ${path}`);
    return { ok: true, json: async () => ({ code: 200, result: body }) };
  };
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.PRINTFUL_API_BASE_URL;
});

test("listProducts maps the catalogue shape", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  stubFetch({
    "/products": [
      { id: 71, title: "Unisex Staple T-Shirt", brand: "Bella", type_name: "T-SHIRT", variant_count: 100, image: "x.png" },
      { id: 1, title: "Enhanced Matte Poster", type_name: "POSTER", variant_count: 6 },
    ],
  });
  const products = await cat.listProducts();
  assert.equal(products.length, 2);
  assert.equal(products[0].id, 71);
  assert.equal(products[0].type, "T-SHIRT");
  assert.equal(products[1].title, "Enhanced Matte Poster");
});

test("searchProducts filters by title/brand/type, case-insensitive", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  stubFetch({
    "/products": [
      { id: 71, title: "Unisex Staple T-Shirt", brand: "Bella", type_name: "T-SHIRT", variant_count: 100 },
      { id: 1, title: "Enhanced Matte Poster", type_name: "POSTER", variant_count: 6 },
    ],
  });
  const shirts = await cat.searchProducts("t-shirt");
  assert.equal(shirts.length, 1);
  assert.equal(shirts[0].id, 71);
  const byBrand = await cat.searchProducts("BELLA");
  assert.equal(byBrand[0].id, 71);
});

test("listVariants surfaces base cost in cents for the margin guard", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  stubFetch({
    "/products/1": {
      variants: [
        { id: 4465, name: "Poster 18×24", size: "18×24", price: "12.50", image: "p.png" },
        { id: 4466, name: "Poster 24×36", size: "24×36", price: "16.00" },
      ],
    },
  });
  const variants = await cat.listVariants(1);
  assert.equal(variants.length, 2);
  assert.equal(variants[0].id, 4465);
  assert.equal(variants[0].priceCents, 1250, "12.50 dollars must become 1250 cents");
  assert.equal(variants[1].priceCents, 1600);
});

test("getVariantPrintfiles resolves placement → px/dpi for the right variant", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  stubFetch({
    "/mockup-generator/printfiles/71": {
      printfiles: [
        { printfile_id: 1, width: 1800, height: 2400, dpi: 150 },
        { printfile_id: 2, width: 1800, height: 2400, dpi: 150 },
      ],
      variant_printfiles: [
        { variant_id: 4011, placements: { front: 1, back: 2 } },
        { variant_id: 4012, placements: { front: 1 } },
      ],
      available_placements: { front: "Front print", back: "Back print" },
    },
  });
  const pf = await cat.getVariantPrintfiles(71, 4011);
  assert.equal(pf.length, 2, "variant 4011 has front + back");
  const front = pf.find((p) => p.placement === "front");
  assert.deepEqual(
    { w: front.widthPx, h: front.heightPx, dpi: front.dpi },
    { w: 1800, h: 2400, dpi: 150 }
  );

  const pf2 = await cat.getVariantPrintfiles(71, 4012);
  assert.equal(pf2.length, 1, "variant 4012 is front-only");
});

test("getVariantPrintfiles drops placements with unusable dimensions", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  stubFetch({
    "/mockup-generator/printfiles/9": {
      printfiles: [
        { printfile_id: 1, width: 0, height: 2400, dpi: 150 }, // bad width
        { printfile_id: 2, width: 1800, height: 2400, dpi: 150 },
      ],
      variant_printfiles: [{ variant_id: 5, placements: { front: 1, back: 2 } }],
    },
  });
  const pf = await cat.getVariantPrintfiles(9, 5);
  assert.equal(pf.length, 1, "the zero-width placement must be discarded, not shipped");
  assert.equal(pf[0].placement, "back");
});

test("getVariantPrintfiles returns empty for an unknown variant rather than throwing", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  stubFetch({
    "/mockup-generator/printfiles/71": {
      printfiles: [{ printfile_id: 1, width: 1800, height: 2400, dpi: 150 }],
      variant_printfiles: [{ variant_id: 4011, placements: { front: 1 } }],
    },
  });
  assert.deepEqual(await cat.getVariantPrintfiles(71, 999999), []);
});

test("invalid ids are rejected before any fetch", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  await assert.rejects(() => cat.listVariants(0), /Invalid product id/);
  await assert.rejects(() => cat.getVariantPrintfiles(-1, 5), /Invalid product id/);
  await assert.rejects(() => cat.getVariantPrintfiles(71, 0), /Invalid variant id/);
});

test("configured-flag reflects PRINTFUL_API_KEY", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  assert.equal(cat.printfulCatalogConfigured(), true);
});

test("connection diagnostics distinguish a rejected token without exposing it", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: "Invalid token" } }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
  const result = await cat.verifyPrintfulCatalogConnection();
  assert.deepEqual(
    { reachable: result.reachable, providerStatus: result.providerStatus, code: result.code },
    { reachable: false, providerStatus: 401, code: "unauthorized" },
  );
  assert.equal(JSON.stringify(result).includes(process.env.PRINTFUL_API_KEY), false);
});

test("connection diagnostics confirm a reachable catalog", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  globalThis.fetch = async () => new Response(
    JSON.stringify({ code: 200, result: [] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const result = await cat.verifyPrintfulCatalogConnection();
  assert.equal(result.reachable, true);
  assert.equal(result.providerStatus, 200);
});

test("catalog requests discard an accidental v2 path from the configured Printful origin", async () => {
  const cat = await import("../server/printfulCatalog.ts");
  cat.clearCatalogueCache();
  process.env.PRINTFUL_API_BASE_URL = "https://api.printful.com/v2";
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ code: 200, result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await cat.listProducts();
  assert.equal(requestedUrl, "https://api.printful.com/products");
});
