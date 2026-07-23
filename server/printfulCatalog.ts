/**
 * Printful catalogue adapter (P0 of MARKETPLACE_CUSTOMIZER_SPEC.md).
 *
 * server/printful.ts already handles *orders*. This module handles the
 * *catalogue* — the products, variants, and (the part that actually matters for
 * a customizer) the authoritative print-file dimensions per placement.
 *
 * Why the print-file spec is the whole point: a poster tolerates a wrong-sized
 * image; a garment does not. Every variant declares an exact print-file pixel
 * size and DPI per placement (front, back, sleeve, mug wrap…). The buyer's photo
 * must be composited to *those* pixels or Printful rejects the file or prints it
 * blurry. So we never hard-code sizes — we read them here and cache them.
 *
 * Auth and error handling deliberately mirror server/printful.ts so there is one
 * mental model for the Printful surface. Catalogue reads are cached in-process:
 * the catalogue changes rarely and these endpoints are rate-limited.
 */

interface PrintfulConfig {
  base: string;
  headers: Record<string, string>;
}

export class PrintfulCatalogError extends Error {
  constructor(
    message: string,
    public readonly providerStatus: number | null,
    public readonly code: "not_configured" | "unauthorized" | "forbidden" | "rate_limited" | "provider_error" | "network_error",
  ) {
    super(message);
    this.name = "PrintfulCatalogError";
  }
}

function configuration(): PrintfulConfig {
  const token = process.env.PRINTFUL_API_KEY || "";
  const base = (process.env.PRINTFUL_API_BASE_URL || "https://api.printful.com").replace(/\/$/, "");
  if (!token) throw new PrintfulCatalogError("Printful is not configured: set PRINTFUL_API_KEY.", null, "not_configured");
  return {
    base,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Store scoping is optional: a store-scoped token implies its store. Only
      // send the header when an ID is configured (mirrors server/printful.ts).
      ...(process.env.PRINTFUL_STORE_ID ? { "X-PF-Store-Id": process.env.PRINTFUL_STORE_ID } : {}),
    },
  };
}

/** True when a catalogue call can be attempted. */
export function printfulCatalogConfigured(): boolean {
  return Boolean(process.env.PRINTFUL_API_KEY);
}

async function parse(response: Response): Promise<any> {
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const code = response.status === 401 ? "unauthorized"
      : response.status === 403 ? "forbidden"
      : response.status === 429 ? "rate_limited"
      : "provider_error";
    throw new PrintfulCatalogError(
      payload?.error?.message || payload?.error || `Printful returned ${response.status}.`,
      response.status,
      code,
    );
  }
  // v1 wraps successful bodies in { code, result, ... }.
  return payload?.result ?? payload;
}

async function get(path: string, timeoutMs = 30_000): Promise<any> {
  const { base, headers } = configuration();
  try {
    return parse(await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) }));
  } catch (error) {
    if (error instanceof PrintfulCatalogError) throw error;
    throw new PrintfulCatalogError(
      error instanceof Error ? error.message : "Could not reach Printful.",
      null,
      "network_error",
    );
  }
}

export async function verifyPrintfulCatalogConnection(): Promise<{
  configured: boolean;
  reachable: boolean;
  providerStatus: number | null;
  code: string;
  message: string;
}> {
  if (!printfulCatalogConfigured()) {
    return { configured: false, reachable: false, providerStatus: null, code: "not_configured", message: "PRINTFUL_API_KEY is not configured." };
  }
  try {
    await get("/products", 10_000);
    return { configured: true, reachable: true, providerStatus: 200, code: "ok", message: "Printful catalog connection is working." };
  } catch (error) {
    if (error instanceof PrintfulCatalogError) {
      return {
        configured: true,
        reachable: false,
        providerStatus: error.providerStatus,
        code: error.code,
        message: error.code === "unauthorized" ? "Printful rejected the token."
          : error.code === "forbidden" ? "The Printful token does not have access to this resource or store."
          : error.code === "rate_limited" ? "Printful rate-limited the catalog request."
          : error.code === "network_error" ? "The server could not reach Printful."
          : "Printful returned an error.",
      };
    }
    return { configured: true, reachable: false, providerStatus: null, code: "provider_error", message: "Printful catalog verification failed." };
  }
}

// ── In-process cache ─────────────────────────────────────────────────────────
// Small and bounded (the catalogue is a few hundred products). A TTL keeps it
// from going stale across a long-running process without a manual bust.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
interface CacheEntry<T> {
  value: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await loader();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Drop cached catalogue data (test seam + admin "refresh catalogue" button). */
export function clearCatalogueCache(): void {
  cache.clear();
}

// ── Types (only the fields the customizer needs) ─────────────────────────────

export interface CatalogueProduct {
  id: number;
  title: string;
  brand: string | null;
  model: string | null;
  type: string | null; // e.g. "T-SHIRT", "POSTER", "MUG"
  image: string | null;
  variantCount: number;
}

export interface CatalogueVariant {
  id: number;
  productId: number;
  name: string;
  size: string | null;
  color: string | null;
  colorCode: string | null;
  image: string | null;
  priceCents: number | null; // Printful base cost, for the margin guard
}

export interface PlacementPrintfile {
  placement: string; // "front" | "back" | "default" | "mug" | …
  widthPx: number;
  heightPx: number;
  dpi: number;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** All catalogue products (paged internally by Printful; v1 returns the lot). */
export async function listProducts(): Promise<CatalogueProduct[]> {
  return cached("products", async () => {
    const rows = (await get("/products")) as any[];
    if (!Array.isArray(rows)) return [];
    return rows.map((p) => ({
      id: Number(p.id),
      title: String(p.title || p.model || `Product ${p.id}`),
      brand: p.brand ?? null,
      model: p.model ?? null,
      type: p.type_name || p.type || null,
      image: p.image ?? null,
      variantCount: Number(p.variant_count || 0),
    }));
  });
}

/** Case-insensitive title/brand/type search over the cached catalogue. */
export async function searchProducts(query: string, limit = 40): Promise<CatalogueProduct[]> {
  const q = query.trim().toLowerCase();
  const all = await listProducts();
  if (!q) return all.slice(0, limit);
  return all
    .filter((p) =>
      [p.title, p.brand, p.type].some((f) => (f || "").toLowerCase().includes(q))
    )
    .slice(0, limit);
}

/** Variants for a product, with base cost for the margin guard. */
export async function listVariants(productId: number): Promise<CatalogueVariant[]> {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error(`Invalid product id: ${productId}`);
  }
  return cached(`variants:${productId}`, async () => {
    // v1: /products/{id} → { product, variants }
    const payload = await get(`/products/${productId}`);
    const variants = (payload?.variants || payload) as any[];
    if (!Array.isArray(variants)) return [];
    return variants.map((v) => ({
      id: Number(v.id),
      productId,
      name: String(v.name || `Variant ${v.id}`),
      size: v.size ?? null,
      color: v.color ?? null,
      colorCode: v.color_code ?? null,
      image: v.image ?? null,
      priceCents:
        v.price != null && !Number.isNaN(Number(v.price))
          ? Math.round(Number(v.price) * 100)
          : null,
    }));
  });
}

/**
 * Authoritative print-file dimensions per placement for a product's variants.
 * This is the field that governs canvas resolution — everything else is
 * cosmetic. Shape of /mockup-generator/printfiles/{id}:
 *   { printfiles: [{ printfile_id, width, height, dpi }...],
 *     variant_printfiles: [{ variant_id, placements: { front: printfile_id }}],
 *     available_placements: { front: "Front print", ... } }
 * We resolve each placement to its printfile's px/dpi for a specific variant.
 */
export async function getVariantPrintfiles(
  productId: number,
  variantId: number
): Promise<PlacementPrintfile[]> {
  if (!Number.isInteger(productId) || productId <= 0) throw new Error(`Invalid product id: ${productId}`);
  if (!Number.isInteger(variantId) || variantId <= 0) throw new Error(`Invalid variant id: ${variantId}`);

  const payload = await cached(`printfiles:${productId}`, () =>
    get(`/mockup-generator/printfiles/${productId}`)
  );

  const printfiles: any[] = payload?.printfiles || [];
  const byId = new Map<number, any>(printfiles.map((pf) => [Number(pf.printfile_id), pf]));
  const variantRow = (payload?.variant_printfiles || []).find(
    (v: any) => Number(v.variant_id) === variantId
  );
  if (!variantRow?.placements) return [];

  const out: PlacementPrintfile[] = [];
  for (const [placement, printfileId] of Object.entries(variantRow.placements)) {
    const pf = byId.get(Number(printfileId));
    if (!pf) continue;
    const widthPx = Number(pf.width);
    const heightPx = Number(pf.height);
    const dpi = Number(pf.dpi) || 150;
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
      continue; // never hand a bad size downstream — it produces a rejected order
    }
    out.push({ placement, widthPx, heightPx, dpi });
  }
  return out;
}

/**
 * Convenience for the admin editor: everything needed to author a template for
 * one (product, variant) — the variant plus its placement print-file specs.
 */
export async function getTemplateContext(productId: number, variantId: number): Promise<{
  variant: CatalogueVariant | null;
  placements: PlacementPrintfile[];
}> {
  const [variants, placements] = await Promise.all([
    listVariants(productId),
    getVariantPrintfiles(productId, variantId),
  ]);
  return {
    variant: variants.find((v) => v.id === variantId) ?? null,
    placements,
  };
}
