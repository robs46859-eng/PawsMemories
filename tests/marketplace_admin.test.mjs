import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");

const adminModule = read("server/marketplaceAdmin.ts");
const server = read("server.ts");
const uploadLib = read("src/lib/adminUpload.ts");
const screen = read("src/components/MarketplaceAdminScreen.tsx");

/* ------------------------------------------------------------------ */
/* Endpoint surface + guards                                           */
/* ------------------------------------------------------------------ */

test("every marketplace admin endpoint is server-guarded", () => {
  const endpoints = [
    'app.get("/api/admin/marketplace/listings"',
    'app.get("/api/admin/marketplace/listings/:id/previews"',
    'app.get("/api/admin/marketplace/listings/:id/assets"',
    'app.post("/api/admin/marketplace/listings"',
    'app.patch("/api/admin/marketplace/listings/:id"',
    'app.post("/api/admin/marketplace/listings/:id/reorder"',
    'app.post("/api/admin/marketplace/upload-url"',
    'app.post("/api/admin/marketplace/assets"',
    'app.patch("/api/admin/marketplace/assets/:id"',
  ];
  for (const ep of endpoints) {
    const idx = server.indexOf(ep);
    assert.ok(idx > -1, `${ep} is missing`);
    const body = server.slice(idx, idx + 400);
    assert.ok(
      body.includes("requireMarketplaceAdmin"),
      `${ep} must call requireMarketplaceAdmin before doing anything`,
    );
  }
  // And the guard itself is real, not a stub.
  assert.match(server, /requireMarketplaceAdmin[\s\S]{0,200}isUserAdmin\(req\.user\.phone\)/);
});

/* ------------------------------------------------------------------ */
/* Trust boundary: HeadObject verification                             */
/* ------------------------------------------------------------------ */

test("confirmAsset verifies the stored object before any INSERT", () => {
  const fn = adminModule.slice(adminModule.indexOf("export async function confirmAsset"));
  const headIdx = fn.indexOf("headPrivateObject");
  const insertIdx = fn.indexOf("INSERT INTO marketplace_assets");
  assert.ok(headIdx > -1 && insertIdx > -1);
  assert.ok(headIdx < insertIdx, "HeadObject must run before the asset row exists");
  // Size and MIME must both be compared against the claim.
  assert.match(fn, /head\.sizeBytes !== input\.size_bytes/);
  assert.match(fn, /head\.mimeType !== input\.mime_type/);
  // And a key from another listing must be rejected.
  assert.match(fn, /object_key\.includes\(input\.listing_uuid\)/);
});

test("replacement supersedes and increments version — never deletes", () => {
  assert.match(adminModule, /SET status = 'superseded'/);
  assert.match(adminModule, /Number\(old\.version\) \+ 1/);
  assert.doesNotMatch(adminModule, /DELETE FROM marketplace_assets/);
  assert.doesNotMatch(adminModule, /DeleteObjectCommand/);
});

/* ------------------------------------------------------------------ */
/* Publish gate                                                        */
/* ------------------------------------------------------------------ */

test("publishing runs the full gate before any write", () => {
  const fn = adminModule.slice(adminModule.indexOf("export async function updateListing"));
  const gateIdx = fn.indexOf("assertPublishable");
  const updateIdx = fn.indexOf("UPDATE marketplace_listings");
  assert.ok(gateIdx > -1 && updateIdx > -1 && gateIdx < updateIdx,
    "a failed publish must leave the listing untouched");
  // The gate covers licence, preview, and priced-GLB requirements.
  const gate = adminModule.slice(adminModule.indexOf("export async function assertPublishable"));
  assert.match(gate, /assertCommercialLicence/);
  assert.match(gate, /preview_image/);
  assert.match(gate, /source_glb/);
});

test("archiving performs no entitlement writes", () => {
  assert.doesNotMatch(adminModule, /marketplace_entitlements/,
    "owners keep access to what they bought when a listing is archived");
});

/* ------------------------------------------------------------------ */
/* Upload pipeline (browser side)                                      */
/* ------------------------------------------------------------------ */

test("file bytes go straight to storage, never through an /api route", () => {
  // The only fetches to /api are the presign request and the confirm.
  assert.match(uploadLib, /xhr\.open\("PUT", url\)/);
  assert.doesNotMatch(uploadLib, /authedFetch\("\/api[^"]*",\s*\{[^}]*body:\s*(bytes|opts\.file)/);
  // sha-256 is computed locally with WebCrypto.
  assert.match(uploadLib, /crypto\.subtle\.digest\("SHA-256"/);
  // Content-Type must match the presign or B2 rejects the signature.
  assert.match(uploadLib, /setRequestHeader\("Content-Type", contentType\)/);
});

test("every upload stage reports progress, including a typed error stage", () => {
  for (const stage of ["requesting-url", "uploading", "hashing", "confirming", "done", "error"]) {
    assert.ok(uploadLib.includes(`"${stage}"`), `missing stage ${stage}`);
  }
});

/* ------------------------------------------------------------------ */
/* Screen wiring                                                       */
/* ------------------------------------------------------------------ */

test("admin screen and backend are preserved but retired from the user-facing shell", () => {
  const app = read("src/App.tsx");
  assert.doesNotMatch(app, /MarketplaceAdminScreen/);
  assert.doesNotMatch(app, /\[Screen\.ADMIN_MARKETPLACE\]: "\/admin\/marketplace"/);
  assert.match(app, /normalized === "\/marketplace" \|\| normalized === "\/admin\/marketplace"\) return Screen\.STORE/);
  assert.match(screen, /Marketplace Admin/);
  assert.match(server, /\/api\/admin\/marketplace\/listings/);
});

test("screen uses the shared upload pipeline rather than reimplementing it", () => {
  assert.match(screen, /uploadMarketplaceAsset/);
  assert.doesNotMatch(screen, /XMLHttpRequest|crypto\.subtle/);
});

/* ------------------------------------------------------------------ */
/* Listing editor form completeness                                    */
/* ------------------------------------------------------------------ */

test("editor covers every CreateListingSchema field", () => {
  // Field names that must appear in the form data or UI
  const requiredFields = [
    "name", "slug", "breed", "category", "description", "tags",
    "digital_price_cents", "physical_enabled",
    "print_size_min_mm", "print_size_max_mm", "print_notes",
    "dimensions", "sort_order",
  ];
  for (const field of requiredFields) {
    assert.ok(screen.includes(field), `editor form must reference ${field}`);
  }
});

test("editor enforces client-side validation mirroring schema rules", () => {
  // Slug format validation
  assert.match(screen, /SLUG_RE/);
  assert.ok(screen.includes("^[a-z0-9]"), "slug regex pattern must be present");
  // Physical requires size range
  assert.match(screen, /Physical printing requires/);
  // Price floor
  assert.match(screen, /Price must be at least/);
});

test("preview images display via signed URLs from the assets endpoint", () => {
  assert.match(screen, /\/api\/admin\/marketplace\/listings\/.*\/assets/);
  assert.match(screen, /setPreviews/);
  // Images rendered with src={p.url} — the signed URL
  assert.match(screen, /src=\{p\.url\}/);
});

test("GLB slot shows version history and supports replace via replacesAssetId", () => {
  assert.match(screen, /replacesAssetId/);
  assert.match(screen, /superseded/);
  assert.match(screen, /activeGlb/);
  assert.match(screen, /Version history/i);
});

test("listing reorder uses the reorder endpoint", () => {
  assert.match(screen, /\/reorder/);
  assert.match(screen, /handleReorder/);
});

/* ------------------------------------------------------------------ */
/* listingAssets server function                                       */
/* ------------------------------------------------------------------ */

test("listingAssets returns previews and glbs without exposing object_key", () => {
  const fn = adminModule.slice(adminModule.indexOf("export async function listingAssets"));
  assert.ok(fn.length > 0, "listingAssets function must exist");
  // Queries marketplace_assets
  assert.match(fn.slice(0, 1200), /FROM marketplace_assets/);
  // Returns signed URLs for previews
  assert.match(fn.slice(0, 1200), /getPrivateSignedUrl/);
  // Does not include object_key in the return shape for previews
  const returnBlock = fn.slice(fn.indexOf("previews.push"), fn.indexOf("previews.push") + 400);
  assert.ok(!returnBlock.includes("object_key:"), "object_key must not be in preview response");
});
