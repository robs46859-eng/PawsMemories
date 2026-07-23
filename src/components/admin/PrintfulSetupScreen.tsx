import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { authedFetch } from "../../api";
import { readJsonResponse } from "../../apiResponse";

interface Product { id: number; title: string; image: string | null; type: string | null; variantCount: number }
interface Variant { id: number; name: string; priceCents: number | null }
interface Placement { placement: string; widthPx: number; heightPx: number; dpi: number }

export default function PrintfulSetupScreen({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<{ configured: boolean; storeIdConfigured: boolean } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [productId, setProductId] = useState(0);
  const [variantId, setVariantId] = useState(0);
  const [placement, setPlacement] = useState("");
  const [listingId, setListingId] = useState("");
  const [retailPrice, setRetailPrice] = useState("24.99");
  const [shape, setShape] = useState<"rect" | "circle" | "arch">("rect");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const checkConnection = async () => {
    setBusy("connection"); setError(""); setMessage("");
    try {
      const result = await readJsonResponse<{ configured: boolean; storeIdConfigured: boolean }>(
        await authedFetch("/api/admin/customizer/status"),
        "Could not check Printful.",
      );
      setStatus(result);
      if (!result.configured) throw new Error("Add the Printful token in Hostinger before syncing.");
      const diagnostics = await readJsonResponse<{ reachable: boolean; message: string; code: string; providerStatus: number | null }>(
        await authedFetch("/api/admin/customizer/diagnostics"),
        "Could not verify Printful.",
      );
      if (!diagnostics.reachable) throw new Error(diagnostics.message);
      const catalog = await readJsonResponse<{ products: Product[] }>(
        await authedFetch("/api/admin/customizer/products"),
        "Printful did not accept this connection.",
      );
      setProducts(catalog.products || []);
      setMessage(`Connected. ${catalog.products?.length || 0} catalog products are available.`);
    } catch (cause: any) { setError(cause.message); }
    finally { setBusy(""); }
  };

  const syncCatalog = async () => {
    setBusy("sync"); setError(""); setMessage("");
    try {
      await readJsonResponse(await authedFetch("/api/admin/customizer/refresh", { method: "POST" }), "Could not refresh catalog.");
      await checkConnection();
      setMessage("Catalog synchronized with Printful.");
    } catch (cause: any) { setError(cause.message); setBusy(""); }
  };

  useEffect(() => { checkConnection(); }, []);

  useEffect(() => {
    setVariants([]); setVariantId(0); setPlacements([]); setPlacement("");
    if (!productId) return;
    setBusy("variants");
    authedFetch(`/api/admin/customizer/products/${productId}/variants`).then((response) => readJsonResponse<{ variants: Variant[] }>(
      response,
      "Could not load variants.",
    )).then((result) => setVariants(result.variants || []))
      .catch((cause) => setError(cause.message))
      .finally(() => setBusy(""));
  }, [productId]);

  useEffect(() => {
    setPlacements([]); setPlacement("");
    if (!productId || !variantId) return;
    setBusy("template");
    authedFetch(`/api/admin/customizer/products/${productId}/variants/${variantId}/template`).then((response) => readJsonResponse<{ placements: Placement[] }>(
      response,
      "Could not load print template.",
    )).then((result) => {
      setPlacements(result.placements || []);
      setPlacement(result.placements?.[0]?.placement || "");
    }).catch((cause) => setError(cause.message))
      .finally(() => setBusy(""));
  }, [productId, variantId]);

  const publish = async () => {
    const spec = placements.find((item) => item.placement === placement);
    const priceCents = Math.round(Number(retailPrice) * 100);
    if (!Number(listingId) || !productId || !variantId || !spec || priceCents <= 0) {
      setError("Choose a listing, product, variant, placement, and valid retail price.");
      return;
    }
    setBusy("publish"); setError(""); setMessage("");
    try {
      await readJsonResponse(await authedFetch("/api/admin/customizer/customizable-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: Number(listingId),
          printfulProductId: productId,
          printfulVariantId: variantId,
          placement,
          printfileWidthPx: spec.widthPx,
          printfileHeightPx: spec.heightPx,
          printfileDpi: spec.dpi,
          boxX: 0.05, boxY: 0.05, boxW: 0.9, boxH: 0.9,
          boxShape: shape,
          retailPriceCents: priceCents,
          status: "published",
        }),
      }), "Could not publish product.");
      setMessage("Product published. It is now available to the Pawprints/customizer checkout.");
    } catch (cause: any) { setError(cause.message); }
    finally { setBusy(""); }
  };

  const field = "min-h-11 w-full rounded-xl border border-outline-variant/40 bg-surface px-3 text-sm text-on-surface";
  return <main className="w-full max-w-5xl px-4 py-8 sm:px-6">
    <button type="button" onClick={onClose} className="inline-flex items-center gap-2 text-sm font-black text-primary"><ArrowLeft size={16} /> Back</button>
    <div className="mt-5 rounded-[2rem] border border-white/30 bg-surface/80 p-6 shadow-xl backdrop-blur-2xl">
      <p className="text-xs font-black uppercase tracking-[.18em] text-primary">Admin fulfillment</p>
      <h1 className="mt-2 text-3xl font-black">Printful product sync</h1>
      <p className="mt-2 text-sm text-on-surface-variant">Connect the server token, select a physical variant, verify its authoritative print file, price it, and publish it.</p>

      <section className="mt-6 grid gap-3 rounded-2xl bg-surface-container p-4 sm:grid-cols-[1fr_auto_auto]">
        <div><strong>{status?.configured ? "Token configured" : "Token missing"}</strong><p className="text-xs text-on-surface-variant">{status?.storeIdConfigured ? "Store ID configured" : "Store-scoped token or PRINTFUL_STORE_ID required"}</p></div>
        <button type="button" onClick={checkConnection} disabled={!!busy} className="rounded-xl border border-primary/30 px-4 py-2 text-sm font-black text-primary">Check connection</button>
        <button type="button" onClick={syncCatalog} disabled={!!busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary"><RefreshCw size={15} /> Sync catalog</button>
      </section>

      {error && <p className="mt-4 rounded-xl bg-error/10 p-3 text-sm font-bold text-error" role="alert">{error}</p>}
      {message && <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-600/10 p-3 text-sm font-bold text-emerald-700" role="status"><CheckCircle2 size={16} /> {message}</p>}
      {busy && <p className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary"><Loader2 size={14} className="animate-spin" /> Working…</p>}

      <section className="mt-6 grid gap-5 md:grid-cols-2">
        <label className="text-xs font-black uppercase tracking-wide">Marketplace listing ID<input className={`${field} mt-2`} inputMode="numeric" value={listingId} onChange={(event) => setListingId(event.target.value)} placeholder="Existing listing ID" /></label>
        <label className="text-xs font-black uppercase tracking-wide">Printful product<select className={`${field} mt-2`} value={productId} onChange={(event) => setProductId(Number(event.target.value))}><option value={0}>Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title} {product.type ? `— ${product.type}` : ""}</option>)}</select></label>
        <label className="text-xs font-black uppercase tracking-wide">Physical variant<select className={`${field} mt-2`} value={variantId} onChange={(event) => setVariantId(Number(event.target.value))}><option value={0}>Choose variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}{variant.priceCents ? ` — $${(variant.priceCents / 100).toFixed(2)} base` : ""}</option>)}</select></label>
        <label className="text-xs font-black uppercase tracking-wide">Print placement<select className={`${field} mt-2`} value={placement} onChange={(event) => setPlacement(event.target.value)}><option value="">Choose placement</option>{placements.map((item) => <option key={item.placement} value={item.placement}>{item.placement} — {item.widthPx}×{item.heightPx}px @ {item.dpi} DPI</option>)}</select></label>
        <label className="text-xs font-black uppercase tracking-wide">Photo shape<select className={`${field} mt-2`} value={shape} onChange={(event) => setShape(event.target.value as any)}><option value="rect">Rectangle</option><option value="circle">Circle</option><option value="arch">Arch</option></select></label>
        <label className="text-xs font-black uppercase tracking-wide">Retail price (USD)<input className={`${field} mt-2`} type="number" min="1" step="0.01" value={retailPrice} onChange={(event) => setRetailPrice(event.target.value)} /></label>
      </section>
      <button type="button" onClick={publish} disabled={!!busy} className="mt-6 w-full rounded-xl bg-primary px-5 py-3 text-sm font-black text-on-primary disabled:opacity-50">Publish product</button>
    </div>
  </main>;
}
