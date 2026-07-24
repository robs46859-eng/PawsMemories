import React, { useState, useEffect } from "react";
import {
  Search,
  Package,
  Ruler,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Tag,
  Eye,
  Save,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Sliders,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  searchPrintfulCatalogue,
  fetchPrintfulVariants,
  fetchPrintfulTemplateContext,
  createCustomizableProduct,
  updateCustomizableProduct,
  fetchCustomizerProductsAdmin,
  type CustomizableProduct,
} from "../api";

interface CustomizerAdminScreenProps {
  onBack?: () => void;
}

export default function CustomizerAdminScreen({ onBack }: CustomizerAdminScreenProps) {
  // Navigation tabs: Catalogue Browse vs Existing Products
  const [activeTab, setActiveTab] = useState<"author" | "manage">("author");

  // Existing customizable products state
  const [productsList, setProductsList] = useState<CustomizableProduct[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Authoring wizard step: 1: search product -> 2: pick variant -> 3: template editor & price -> 4: review & publish
  const [step, setStep] = useState<number>(1);

  // Step 1: Catalogue search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Step 2: Selected product & variant
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [variants, setVariants] = useState<any[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<any | null>(null);

  // Step 3: Template context & placement box
  const [placements, setPlacements] = useState<any[]>([]);
  const [selectedPlacement, setSelectedPlacement] = useState<string>("default");
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  // Printfile spec (auto-filled from Printful API)
  const [printfileWidthPx, setPrintfileWidthPx] = useState<number>(1800);
  const [printfileHeightPx, setPrintfileHeightPx] = useState<number>(2400);
  const [printfileDpi, setPrintfileDpi] = useState<number>(150);

  // Placement box normalized (0..1)
  const [boxX, setBoxX] = useState<number>(0.1);
  const [boxY, setBoxY] = useState<number>(0.1);
  const [boxW, setBoxW] = useState<number>(0.8);
  const [boxH, setBoxH] = useState<number>(0.8);
  const [boxShape, setBoxShape] = useState<"rect" | "circle" | "arch">("rect");

  // Retail pricing & margin guard
  const [retailPriceDollars, setRetailPriceDollars] = useState<string>("39.99");
  const [listingId, setListingId] = useState<number>(1);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load existing products on mount or tab change
  const refreshProductsList = async () => {
    setLoadingList(true);
    try {
      const list = await fetchCustomizerProductsAdmin();
      setProductsList(list);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (activeTab === "manage") {
      refreshProductsList();
    }
  }, [activeTab]);

  // Initial catalogue load for search
  useEffect(() => {
    handleSearchCatalogue("");
  }, []);

  const handleSearchCatalogue = async (q: string) => {
    setSearching(true);
    try {
      const items = await searchPrintfulCatalogue(q);
      setSearchResults(items);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: "error", text: err.message || "Could not search Printful catalogue." });
    } finally {
      setSearching(false);
    }
  };

  const handleSelectProduct = async (product: any) => {
    setSelectedProduct(product);
    setSelectedVariant(null);
    setLoadingVariants(true);
    setStep(2);
    try {
      const vars = await fetchPrintfulVariants(product.id);
      setVariants(vars);
    } catch (err: any) {
      console.error(err);
      setMessage({ type: "error", text: err.message || "Failed to load variants." });
    } finally {
      setLoadingVariants(false);
    }
  };

  const handleSelectVariant = async (variant: any) => {
    setSelectedVariant(variant);
    setLoadingTemplate(true);
    setStep(3);
    try {
      const ctx = await fetchPrintfulTemplateContext(selectedProduct.id, variant.id);
      setPlacements(ctx.placements || []);
      const firstPlacement = ctx.placements?.[0];
      if (firstPlacement) {
        setSelectedPlacement(firstPlacement.placement || "default");
        setPrintfileWidthPx(firstPlacement.widthPx);
        setPrintfileHeightPx(firstPlacement.heightPx);
        setPrintfileDpi(firstPlacement.dpi || 150);
      }
      // Preset default pricing: base cost * 1.8 or minimum $29.99
      const baseCostCents = variant.priceCents || 1500;
      const defaultRetail = Math.max(2999, Math.ceil(baseCostCents * 1.8));
      setRetailPriceDollars((defaultRetail / 100).toFixed(2));
    } catch (err: any) {
      console.error(err);
      setMessage({ type: "error", text: err.message || "Failed to load template context." });
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handlePlacementChange = (placementName: string) => {
    setSelectedPlacement(placementName);
    const p = placements.find((x) => x.placement === placementName);
    if (p) {
      setPrintfileWidthPx(p.widthPx);
      setPrintfileHeightPx(p.heightPx);
      setPrintfileDpi(p.dpi || 150);
    }
  };

  // Margin calculation
  const baseCostCents = selectedVariant?.priceCents || 0;
  const retailPriceCents = Math.round(parseFloat(retailPriceDollars || "0") * 100);
  const marginCents = retailPriceCents - baseCostCents;
  const marginPercent = baseCostCents > 0 ? Math.round((marginCents / baseCostCents) * 100) : 0;
  const isLoss = marginCents < 0;

  const handleSaveProduct = async (status: "draft" | "published") => {
    if (isLoss) {
      setMessage({ type: "error", text: "Retail price creates a loss vs Printful base cost." });
      return;
    }
    if (!selectedProduct || !selectedVariant) {
      setMessage({ type: "error", text: "Missing product or variant selection." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        listingId: Number(listingId) || 1,
        printfulProductId: selectedProduct.id,
        printfulVariantId: selectedVariant.id,
        placement: selectedPlacement,
        printfileWidthPx,
        printfileHeightPx,
        printfileDpi,
        boxX,
        boxY,
        boxW,
        boxH,
        boxShape,
        retailPriceCents,
        status,
      };
      await createCustomizableProduct(payload);
      setMessage({ type: "success", text: `Product saved as ${status} successfully!` });
      setActiveTab("manage");
      setStep(1);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to save product." });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (item: CustomizableProduct) => {
    const nextStatus = item.status === "published" ? "draft" : "published";
    try {
      await updateCustomizableProduct(item.id, { status: nextStatus });
      refreshProductsList();
    } catch (err: any) {
      console.error(err);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant/30 pb-5">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-xl border border-outline-variant/40 p-2 text-on-surface-variant hover:bg-surface-container"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Package size={18} />
              <span className="text-xs font-black uppercase tracking-wider">Admin Workspace</span>
            </div>
            <h1 className="text-2xl font-black text-on-surface">Printful Product Customizer</h1>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex rounded-xl bg-surface-container p-1 text-xs font-bold">
          <button
            onClick={() => setActiveTab("author")}
            className={`rounded-lg px-4 py-2 transition ${
              activeTab === "author" ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Author New Blank
          </button>
          <button
            onClick={() => setActiveTab("manage")}
            className={`rounded-lg px-4 py-2 transition ${
              activeTab === "manage" ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Authored Products ({productsList.length})
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`mt-4 flex items-center gap-2 rounded-xl p-4 text-xs font-bold ${
            message.type === "success" ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30" : "bg-rose-500/10 text-rose-600 border border-rose-500/30"
          }`}
        >
          {message.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* VIEW 1: AUTHOR NEW BLANK */}
      {activeTab === "author" && (
        <div className="mt-6">
          {/* Breadcrumb Steps */}
          <div className="mb-8 flex items-center justify-between gap-2 border-b border-outline-variant/20 pb-4 text-xs font-bold text-on-surface-variant">
            <button
              onClick={() => setStep(1)}
              className={`flex items-center gap-1.5 ${step === 1 ? "text-primary font-black" : "hover:text-on-surface"}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">1</span>
              Browse Catalogue by Name
            </button>
            <span>→</span>
            <button
              disabled={!selectedProduct}
              onClick={() => selectedProduct && setStep(2)}
              className={`flex items-center gap-1.5 ${step === 2 ? "text-primary font-black" : "disabled:opacity-40"}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">2</span>
              Pick Variant & Specs
            </button>
            <span>→</span>
            <button
              disabled={!selectedVariant}
              onClick={() => selectedVariant && setStep(3)}
              className={`flex items-center gap-1.5 ${step === 3 ? "text-primary font-black" : "disabled:opacity-40"}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary">3</span>
              Template Box & Pricing
            </button>
          </div>

          {/* STEP 1: CATALOGUE SEARCH BY NAME WITH THUMBNAILS */}
          {step === 1 && (
            <div>
              <div className="relative max-w-lg">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  type="text"
                  placeholder="Search Printful products by name (e.g. Mug, Shirt, Poster, Tote)..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    handleSearchCatalogue(e.target.value);
                  }}
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest py-3 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:border-primary focus:outline-none"
                />
              </div>

              {searching ? (
                <div className="mt-8 flex justify-center py-12">
                  <Loader2 className="animate-spin text-primary" size={24} />
                </div>
              ) : (
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {searchResults.map((p) => (
                    <article
                      key={p.id}
                      onClick={() => handleSelectProduct(p)}
                      className="group cursor-pointer overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface/80 p-3 transition hover:border-primary hover:shadow-lg"
                    >
                      <div className="aspect-square overflow-hidden rounded-xl bg-surface-container-highest">
                        <img
                          src={p.image || "https://placehold.co/300?text=No+Thumbnail"}
                          alt={p.title}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div className="mt-3">
                        <span className="text-[10px] font-black uppercase text-primary tracking-wider">{p.type || "Product"}</span>
                        <h3 className="line-clamp-1 text-xs font-bold text-on-surface">{p.title}</h3>
                        <p className="mt-1 text-[11px] text-on-surface-variant">{p.variantCount} variants</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: VARIANT PICKER */}
          {step === 2 && selectedProduct && (
            <div>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-on-surface">{selectedProduct.title}</h2>
                  <p className="text-xs text-on-surface-variant">Select a variant to author template dimensions.</p>
                </div>
                <button
                  onClick={() => setStep(1)}
                  className="rounded-xl border border-outline-variant/40 px-3 py-1.5 text-xs font-bold text-on-surface-variant hover:bg-surface-container"
                >
                  Change Product
                </button>
              </div>

              {loadingVariants ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="animate-spin text-primary" size={24} />
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {variants.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => handleSelectVariant(v)}
                      className="group cursor-pointer rounded-xl border border-outline-variant/40 bg-surface/80 p-4 transition hover:border-primary hover:bg-surface-container"
                    >
                      <div className="flex items-center gap-3">
                        {v.colorCode && (
                          <span
                            className="h-5 w-5 rounded-full border border-black/20 shadow-inner"
                            style={{ backgroundColor: v.colorCode }}
                          />
                        )}
                        <div className="flex-1 overflow-hidden">
                          <h4 className="truncate text-xs font-bold text-on-surface">{v.name}</h4>
                          <p className="text-[11px] text-on-surface-variant">
                            Size: {v.size || "Std"} {v.color ? `· ${v.color}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-outline-variant/20 pt-2 text-xs font-black text-primary">
                        <span>Printful Base Cost</span>
                        <span>{v.priceCents ? `$${(v.priceCents / 100).toFixed(2)}` : "N/A"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: TEMPLATE EDITOR WITH DRAGGABLE PLACEMENT BOX & MARGIN GUARD */}
          {step === 3 && selectedProduct && selectedVariant && (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              {/* Left Column: Visual Placement Box Drag/Scale Preview */}
              <div className="lg:col-span-7">
                <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-on-surface">Visual Placement Box Editor</h3>
                    <div className="flex gap-2">
                      {(["rect", "circle", "arch"] as const).map((shape) => (
                        <button
                          key={shape}
                          onClick={() => setBoxShape(shape)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase transition ${
                            boxShape === shape ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
                          }`}
                        >
                          {shape}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interactive Visual Canvas Container */}
                  <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-highest flex items-center justify-center">
                    {/* Mockup Image Background */}
                    <img
                      src={selectedVariant.image || selectedProduct.image || "https://placehold.co/600?text=Product+Mockup"}
                      alt="Product Mockup"
                      className="absolute inset-0 h-full w-full object-contain opacity-80"
                    />

                    {/* Normalized Draggable/Resizable Placement Box Overlay */}
                    <div
                      className="absolute border-2 border-primary bg-primary/20 transition-all cursor-move flex items-center justify-center"
                      style={{
                        left: `${boxX * 100}%`,
                        top: `${boxY * 100}%`,
                        width: `${boxW * 100}%`,
                        height: `${boxH * 100}%`,
                        borderRadius: boxShape === "circle" ? "50%" : boxShape === "arch" ? "50% 50% 0 0" : "0",
                      }}
                    >
                      <span className="text-[10px] font-black text-primary bg-surface/90 px-2 py-0.5 rounded shadow">
                        Placement Box ({Math.round(boxW * 100)}% × {Math.round(boxH * 100)}%)
                      </span>
                    </div>
                  </div>

                  {/* Range Sliders for Precision Position & Dimension Adjustments */}
                  <div className="mt-6 grid grid-cols-2 gap-4 text-xs font-bold">
                    <div>
                      <label className="text-on-surface-variant">Box X Position: {Math.round(boxX * 100)}%</label>
                      <input
                        type="range"
                        min="0"
                        max="0.9"
                        step="0.01"
                        value={boxX}
                        onChange={(e) => setBoxX(parseFloat(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                    <div>
                      <label className="text-on-surface-variant">Box Y Position: {Math.round(boxY * 100)}%</label>
                      <input
                        type="range"
                        min="0"
                        max="0.9"
                        step="0.01"
                        value={boxY}
                        onChange={(e) => setBoxY(parseFloat(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                    <div>
                      <label className="text-on-surface-variant">Box Width: {Math.round(boxW * 100)}%</label>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.01"
                        value={boxW}
                        onChange={(e) => setBoxW(parseFloat(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                    <div>
                      <label className="text-on-surface-variant">Box Height: {Math.round(boxH * 100)}%</label>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.01"
                        value={boxH}
                        onChange={(e) => setBoxH(parseFloat(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Auto-filled Specs & Margin Guard */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                {/* Auto-filled Print-File Specs (Read-Only to Admin) */}
                <div className="rounded-2xl border border-outline-variant/40 bg-surface/80 p-5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                    Auto-Filled Specs (No Raw IDs Typed)
                  </h3>
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between border-b border-outline-variant/20 py-1">
                      <span className="text-on-surface-variant">Product</span>
                      <span className="font-bold text-on-surface">{selectedProduct.title}</span>
                    </div>
                    <div className="flex justify-between border-b border-outline-variant/20 py-1">
                      <span className="text-on-surface-variant">Variant</span>
                      <span className="font-bold text-on-surface">{selectedVariant.name}</span>
                    </div>
                    {placements.length > 0 && (
                      <div className="flex justify-between border-b border-outline-variant/20 py-1">
                        <span className="text-on-surface-variant">Placement</span>
                        <select
                          value={selectedPlacement}
                          onChange={(e) => handlePlacementChange(e.target.value)}
                          className="rounded border border-outline-variant/40 bg-surface px-2 py-0.5 font-bold text-on-surface"
                        >
                          {placements.map((p) => (
                            <option key={p.placement} value={p.placement}>
                              {p.placement}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex justify-between border-b border-outline-variant/20 py-1">
                      <span className="text-on-surface-variant">Print File Resolution</span>
                      <span className="font-bold text-on-surface">
                        {printfileWidthPx} × {printfileHeightPx} px @ {printfileDpi} DPI
                      </span>
                    </div>
                  </div>
                </div>

                {/* Retail Price & Margin Guard */}
                <div className="rounded-2xl border border-outline-variant/40 bg-surface/80 p-5">
                  <h3 className="text-xs font-black uppercase tracking-wider text-primary">
                    Retail Price & Margin Guard
                  </h3>

                  <div className="mt-4">
                    <label className="block text-xs font-bold text-on-surface-variant">Retail Price ($ USD)</label>
                    <div className="relative mt-1">
                      <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={retailPriceDollars}
                        onChange={(e) => setRetailPriceDollars(e.target.value)}
                        className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest py-2.5 pl-9 pr-4 text-sm font-bold text-on-surface"
                      />
                    </div>
                  </div>

                  {/* Margin Breakdown Card */}
                  <div className={`mt-4 rounded-xl p-4 text-xs ${isLoss ? "bg-rose-500/10 border border-rose-500/30" : "bg-emerald-500/10 border border-emerald-500/30"}`}>
                    <div className="flex justify-between font-bold">
                      <span>Printful Base Cost:</span>
                      <span>${(baseCostCents / 100).toFixed(2)}</span>
                    </div>
                    <div className="mt-1 flex justify-between font-black">
                      <span>Profit Margin:</span>
                      <span className={isLoss ? "text-rose-600" : "text-emerald-600"}>
                        ${(marginCents / 100).toFixed(2)} ({marginPercent}%)
                      </span>
                    </div>
                    {isLoss && (
                      <p className="mt-2 text-[11px] font-bold text-rose-600">
                        Warning: This price creates a loss. Margin guard will block publication.
                      </p>
                    )}
                  </div>

                  <div className="mt-4">
                    <label className="block text-xs font-bold text-on-surface-variant">Attached Marketplace Listing ID</label>
                    <input
                      type="number"
                      value={listingId}
                      onChange={(e) => setListingId(parseInt(e.target.value, 10) || 1)}
                      className="mt-1 w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest py-2 px-3 text-xs font-bold text-on-surface"
                    />
                  </div>
                </div>

                {/* Save / Publish Lifecycle Actions */}
                <div className="flex gap-3">
                  <button
                    disabled={saving || isLoss}
                    onClick={() => handleSaveProduct("draft")}
                    className="flex-1 rounded-xl border border-outline-variant/40 bg-surface-container py-3 text-xs font-black text-on-surface hover:bg-surface-container-high disabled:opacity-50"
                  >
                    Save as Draft
                  </button>
                  <button
                    disabled={saving || isLoss}
                    onClick={() => handleSaveProduct("published")}
                    className="flex-1 rounded-xl bg-primary py-3 text-xs font-black text-on-primary hover:bg-primary/90 disabled:opacity-50"
                  >
                    Publish to Shop
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: AUTHORED PRODUCTS MANAGEMENT TABLE */}
      {activeTab === "manage" && (
        <div className="mt-6">
          {loadingList ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-primary" size={24} />
            </div>
          ) : productsList.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-outline-variant/50 p-12 text-center text-xs font-bold text-on-surface-variant">
              No authored products found. Use "Author New Blank" to add products.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-outline-variant/40 bg-surface/80">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-outline-variant/30 bg-surface-container text-on-surface-variant font-black uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-4">ID</th>
                    <th className="p-4">Listing ID</th>
                    <th className="p-4">Placement</th>
                    <th className="p-4">Resolution</th>
                    <th className="p-4">Retail Price</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/20 font-bold text-on-surface">
                  {productsList.map((item) => (
                    <tr key={item.id} className="hover:bg-surface-container/50">
                      <td className="p-4">#{item.id}</td>
                      <td className="p-4">Listing #{item.listing_id}</td>
                      <td className="p-4 uppercase">{item.placement}</td>
                      <td className="p-4 font-mono text-[11px]">
                        {item.printfile_width_px}×{item.printfile_height_px} px
                      </td>
                      <td className="p-4 font-black text-primary">${(item.retail_price_cents / 100).toFixed(2)}</td>
                      <td className="p-4">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${
                            item.status === "published"
                              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30"
                              : "bg-amber-500/10 text-amber-600 border border-amber-500/30"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleToggleStatus(item)}
                          className="rounded-lg border border-outline-variant/40 px-3 py-1 text-[11px] font-bold text-on-surface-variant hover:bg-surface-container"
                        >
                          {item.status === "published" ? "Unpublish" : "Publish"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
