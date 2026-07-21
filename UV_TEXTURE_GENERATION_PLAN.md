# UV-Aware Pet Mesh Texture Generation — Architecture Plan

**Status:** Design — not scheduled. Milestones only, no dates per instruction.
**Scope:** True Tripo3D-class retexturing of the **pet's own mesh** — AI-generated texture maps applied through the model's UV coordinates. Distinct from the shipped accessory Texturizer (material overrides on wardrobe items) and explicitly deferred by it.
**Companions:** `WARDROBE_WAGS_AND_TEXTURIZER_SPEC.md` §1 (accessory texturing), `GEMINI_CALL_AUDIT.md` (image models), `IMPLEMENTATION_SPEC.md`.

---

## 0. Why this is a separate architecture, not a Texturizer extension

The accessory Texturizer swaps a `MeshStandardMaterial` on a *procedurally placed accessory*. Retexturing the pet itself is a different problem in four ways:

1. **UVs are load-bearing.** A texture is meaningless without a UV layout mapping 2D pixels onto 3D surface. Tripo-generated pet GLBs arrive with automatic UV atlases — islands packed by an algorithm, seams in arbitrary places, texel density uneven. Anything painted in image space must respect that specific layout or it lands scrambled.
2. **The likeness is the product.** Every existing pipeline guard (palette-lock in `extractPalette`, identity rules in `LookSpecV1`) exists because the customer's pet must stay recognizable. A face-repainting texture pass can destroy the product's entire value while producing a technically beautiful texture.
3. **2D generators don't think in UV space.** Gemini's image models produce *pictures*, not UV atlases. Asking a 2D model to paint directly into an unwrapped atlas produces garbage at seams and stretched islands. The industry answer is **multi-view projection + bake**, not direct atlas generation.
4. **Print is a separate question.** The current fulfillment path (STL → Slant 3D, single filament) discards all color. A textured *print* requires a different provider and format. This plan keeps digital and print texture paths separated so digital can ship without fulfillment changes.

---

## 1. Target user flows

**F1 — Restyle my pet's coat (digital).** Prompt or preset ("winter coat", "galaxy fur", "clay figurine surface") → pet model re-rendered with new surface texture in Fido's Styles → saved as a project variant in the Fur Bin. Likeness-preserving by default; likeness-breaking styles clearly labeled as stylized.

**F2 — Repair / enhance the generated texture.** Tripo textures sometimes come back muddy (the palette-lock exists precisely because multiview color drift is the #1 failure). A "re-bake texture from my photos" action re-projects the user's approved reference views onto the existing mesh for a cleaner result.

**F3 — Full-color print (future, gated).** Export the textured model in a color-carrying format to a color-capable print provider. Gated until such a provider is integrated; never offered on the Slant path.

---

## 2. Architecture overview

```
                      ┌────────────────────────────────────────────┐
                      │            Hostinger (server.ts)           │
 Browser ── request ──►  /api/texture/jobs   (auth, credits, Zod)  │
                      │        │ job row (texture_jobs)            │
                      └────────┼───────────────────────────────────┘
                               │ signed GLB URL + params (x-worker-secret)
                               ▼
                      ┌────────────────────────────────────────────┐
                      │       Blender worker (Render, Docker)      │
                      │  UV1  validate/repair UVs, report atlas    │
                      │  UV2  render N canonical views + masks     │
                      │       (depth, normal, UV-island id maps)   │
                      └────────┼───────────────────────────────────┘
                               │ view renders
                               ▼
                      ┌────────────────────────────────────────────┐
                      │     Gemini image models (existing client)  │
                      │  UV3  stylize each view, conditioned on    │
                      │       source view + prompt + palette lock  │
                      └────────┼───────────────────────────────────┘
                               │ stylized views
                               ▼
                      ┌────────────────────────────────────────────┐
                      │       Blender worker (same container)      │
                      │  UV4  re-project views onto mesh, bake to  │
                      │       UV atlas, blend seams, fill occluded │
                      │  UV5  derive PBR set (albedo/rough/normal) │
                      └────────┼───────────────────────────────────┘
                               │ textured GLB (KTX2-compressed)
                               ▼
                        Backblaze public media bucket → viewer / Fur Bin
```

Every box above already exists as infrastructure: the Blender worker (`BLENDER_WORKER_URL` + `WORKER_SHARED_SECRET`), the Gemini client and `IMAGE_MODELS` chain, Backblaze storage, and the job-table pattern (`hermes_jobs`, `print_orders`). The new work is the five capabilities, not new services.

### Key design decisions

**D1 — Multi-view projection-bake, not direct atlas painting.** The 2D generator only ever sees *renders of the pet* (front, back, left, right, top, three-quarters — 6–8 canonical views). Stylized outputs are re-projected onto the mesh using the render camera transforms and baked into the UV atlas in Blender (`bpy` bake with a projection shader). Seams are handled by per-view confidence masks (surface-normal-to-camera angle) and Poisson/feather blending in overlap regions. Occluded texels (inner thighs, under-chin) inherit from the nearest visible region via inpainting in atlas space — acceptable because these regions are barely visible.

**D2 — Likeness preservation is a first-class parameter.** Each job carries `identity_strength: high | medium | stylized`. `high` conditions each view generation on the original render of that same view (image-to-image, low strength) and re-injects the existing palette-lock string; `stylized` allows full repaint but the UI labels the result as an art style, not the pet. This reuses the exact philosophy already in `extractPalette` and `HermesLookSpecSchema.identity_rules`.

**D3 — Per-view generation uses the existing tier machinery.** Draft/Standard/Studio map to `IMAGE_MODELS_BY_TIER` exactly as looks generation does. A Draft texture is 4 views at low resolution; Studio is 8 views at high resolution with a second seam-repair pass.

**D4 — The bake is authoritative, the generator is advisory.** Nothing from the 2D model touches the mesh or UVs. Geometry, UV layout, and rig are immutable inputs; only pixel data in the atlas changes. This guarantees a textured model still prints (geometry unchanged), still animates (rig untouched), and still fits its wardrobe attachments.

**D5 — Formats.** Working format glTF/GLB with `KHR_texture_basisu` (KTX2/BasisU compression) for web delivery; bake masters kept as PNG in the private bucket for re-processing. Print export (F3, gated) targets **3MF with vertex/texture color** or textured OBJ+MTL zip — decided when a color print provider is chosen.

**D6 — Storage boundaries follow the marketplace rule.** Derived textures for a user's own pet → public media bucket (like look variations). Bake masters and intermediate view sets → private bucket (`marketplace/`-style keys), since they're re-processing assets, not deliverables.

---

## 3. Build milestones

Ordered; each is independently verifiable and useful on its own. No dates.

### UV1 — Atlas audit and repair
Blender worker endpoint `/texture/uv-audit`: given a GLB, report UV coverage, island count, overlap %, texel density variance, seam map. Repair mode: `Smart UV Project` re-unwrap when overlaps exceed threshold, preserving material slots.
**Done when:** every avatar in the test fixture set returns an audit JSON, and re-unwrap produces zero overlapping islands on the worst offender.

### UV2 — Canonical view rendering
Worker renders N calibrated views with fixed camera intrinsics, plus per-view depth, normal, and UV-island-ID passes (EXR). These are the projection ground truth.
**Done when:** view sets for a fixture avatar re-project a checkerboard texture back onto the mesh with < 1px mean drift on visible surfaces.

### UV3 — View stylization via Gemini
Server-side: per-view image-to-image through the existing client, conditioned on the source view, prompt, palette lock, and `identity_strength`. Tier → model chain via `IMAGE_MODELS_BY_TIER`.
**Done when:** a "galaxy fur" prompt returns 6 stylized views that agree with each other on color placement (cross-view consistency score above threshold on the fixture set).

### UV4 — Projection bake and seam blend
Worker endpoint `/texture/bake`: re-project stylized views using UV2 transforms, confidence-mask blend, atlas-space inpaint of occluded texels, emit baked albedo.
**Done when:** baked fixture models show no visible seam at the projection boundaries under orbit inspection, and the Edison test applies: no view-dependent artifacts.

### UV5 — PBR derivation and packaging
Derive roughness (from stylization prompt class) and normal detail (high-pass of albedo where appropriate); package GLB with KTX2 textures; upload; register in Fur Bin as a variant of the source creation (never overwriting the original — same versioning philosophy as `marketplace_assets`).
**Done when:** a textured variant loads in the Fido's Styles viewer with correct materials, and the original remains untouched and selectable.

### UV6 — Job orchestration and API
`texture_jobs` table (queued → rendering_views → stylizing → baking → done/failed, one FK to the creation, idempotency key, tier, identity_strength). Endpoints: `POST /api/texture/jobs` (auth, credits via `CREDIT_PRICES`, Idempotency-Key, Zod schema in `server/textureSchemas.ts`), `GET /api/texture/jobs/:id`. Honest staged progress, mirroring the looks job pattern.
**Done when:** the full pipeline runs end-to-end from one API call on a fixture avatar; a replayed request with the same idempotency key returns the same job.

### UV7 — Fido's Styles integration
"Coat" tool in the left rail (peer of Looks/Wardrobe): prompt + preset styles + identity_strength control + tier picker (same Draft/Standard/Studio UX rules as looks: outcome names, cost and wait up front, no silent downgrades). Before/after uses the existing compare affordance. Digital-only labeling consistent with the Texturizer gate.
**Done when:** a user can restyle, compare, save as variant, and revert — with the original always recoverable.

### UV8 — Fidelity re-bake (flow F2)
"Re-bake from my photos": the user's approved multiview reference images (already produced by the create flow) are treated as the stylized views and projected/baked directly — no generation step. This is the cheapest, most likeness-faithful path and doubles as the pipeline's own QA harness.
**Done when:** a fixture avatar re-baked from its own reference views scores higher likeness (palette distance to reference) than its original Tripo texture.

### UV9 — Color print gate (flow F3, optional)
Only if/when a color-capable provider is chosen: export 3MF/textured-OBJ, provider quote integration following the `slant3d.ts` module pattern, and a separate `print_orders.provider` value. Until then the UI never offers textured prints — the existing "prints are single-color" gate stays.
**Done when:** a textured fixture model round-trips the chosen provider's validation. (Blocked on a provider decision; deliberately last.)

---

## 4. Risks and their mitigations

| Risk | Mitigation |
|---|---|
| Cross-view inconsistency (the classic failure) | Palette-lock string injected into every view generation (existing technique); low-strength img2img conditioning on source views; UV8 re-bake as fallback |
| Seam artifacts at projection boundaries | Confidence-mask blending + Studio-tier second repair pass (UV4); checkerboard drift test as regression gate (UV2) |
| Likeness destruction | `identity_strength` default `high`; original never overwritten; before/after compare mandatory in UI (UV7) |
| Worker cost/latency on KVM-class hosts | Views render at bounded resolution per tier; bake is CPU-cheap relative to render; jobs queue through the existing worker rather than a new service |
| Scope creep into print | UV9 hard-gated behind a provider decision; digital path never blocks on it |

---

## 5. Explicit non-goals

- Real-time texture painting/brushing in the browser (different product).
- Texturing wardrobe accessories through this pipeline (the shipped Texturizer covers accessories; merging the two is a UV7-era decision).
- Any change to the STL/Slant single-color fulfillment path.
- Direct-to-atlas diffusion models (revisit only if a UV-native generator becomes available through an approved provider).
