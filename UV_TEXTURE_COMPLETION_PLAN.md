# UV Texture Generation — Completion Plan

**Supersedes the milestone status in `UV_TEXTURE_GENERATION_PLAN.md` §3.** That
document's architecture and design decisions (D1–D6) still stand and are not
revised here. What changed is the *status*: commit messages claimed phases that
were never functional, and this plan replaces those claims with verified state
plus the ordered work to finish.

**Companion docs:** `UV_TEXTURE_GENERATION_PLAN.md` (architecture),
`MARKETPLACE_AND_STYLES_SPEC.md`, `GEMINI_CALL_AUDIT.md`.

---

## 0. Verified status

Established by reading the running database, the worker's route table, and the
source — not from commit messages. Commits `2717e38` ("Phase UV3-UV9") and
`b7dcf34` ("texture re-bake (UV8)") describe very different completeness levels.

| Milestone | Claimed | Verified | Evidence |
|---|---|---|---|
| UV1 Atlas audit | — | **Partial** | `_uv_audit()` + smart-project repair live inside `rebake_texture.py`. No standalone `/texture/uv-audit`. |
| UV2 Canonical views | UV3–UV9 | **Not built** | Worker has no `/texture/render-views`. No depth/normal/island passes. |
| UV3 Gemini stylization | UV3–UV9 | **Stub** | `textureJob.ts` — see §1. |
| UV4 Projection bake | UV3–UV9 | **Core exists** | Real projection bake in `rebake_texture.py`, reachable only via `/texture/rebake`. No standalone `/texture/bake`. |
| UV5 PBR + KTX2 | UV3–UV9 | **Not built** | No roughness/normal derivation, no `KHR_texture_basisu`. |
| UV6 Jobs + API | UV3–UV9 | **Split** | `texture_jobs` table, idempotency, ownership all sound. Rebake path works; stylize path quarantined. |
| UV7 Fido's Styles | UV3–UV9 | **Split** | Texture-repair panel works. Coat panel existed but drove the broken endpoint; now gated. |
| UV8 Fidelity re-bake | done | **Done** | Pipeline + reversible override + CIEDE2000 likeness gate (`server/textureLikeness.ts`), 20 tests. |
| UV9 Color print | UV3–UV9 | **Not started** | Correct — gated on a provider decision, as designed. |

`texture_jobs` contains **zero rows** in production, consistent with the stylize
path having never run.

---

## 1. The quarantined stylize path

`server/textureJob.ts` is disabled behind `TEXTURE_STYLIZE_ENABLED` (default
false); `POST /api/texture/jobs` returns 503 before any credit, database, or
provider work. Four independently fatal defects:

1. **Worker endpoints don't exist.** Calls `/texture/render-views` and
   `/texture/bake`; the worker's only texture route is `/texture/rebake`.
2. **Not image-to-image.** `ai.models.generateImages({model, prompt, config})`
   passes no source image. D2 requires low-strength img2img conditioned on the
   source render. As written each view is invented independently, so cross-view
   consistency — the plan's named #1 failure mode — is impossible by
   construction. `identity_strength` only appends a prompt sentence.
3. **Wrong `creations` columns.** Inserts `(id, avatar_id, type, title, status)`;
   the table has `(id AUTO_INCREMENT, user_phone, album_id, media_type, style,
   …, model_url, pet_name, pet_breed, asset_type)`.
4. **Billing against non-existent tables.** Debits `user_credits` and writes
   `credit_ledger`. Neither exists. Billing goes through `users.credits` +
   `credit_transactions` via `deductCredits()`. This threw `ER_NO_SUCH_TABLE`,
   which is the only reason the route never took money for an impossible job.

**Do not lift the flag until all four are fixed** (UV3 below). The client mirror
is `VITE_TEXTURE_STYLIZE_ENABLED`; both flip together.

---

## 2. Ordered remaining work

Dependency order. Each phase is independently shippable and verifiable.

### UV2 — Canonical view rendering *(in progress)*

Worker endpoint `POST /texture/render-views`: import a GLB, place N calibrated
orthographic cameras, render per-view beauty passes, and return them with the
camera parameters needed to re-project.

**The load-bearing constraint is camera-convention parity.** `rebake_texture.py`
already projects through a specific convention — azimuth 0 = camera on −Y
looking toward +Y, clockwise from above, `ortho_scale = max(size) * 1.1`,
`radius = max(size.x, size.y) * 1.5`. If UV2 renders through a different
convention, every downstream bake silently lands rotated. UV2 therefore reuses
those exact constants, and a source-level test asserts the two files agree.

*Deferred:* depth/normal/UV-island EXR passes. The projection bake re-derives
facing weights from geometry at bake time and does not consume them, so they are
cost without a consumer until a bake path needs them. Revisit at UV4.

**Done when:** a fixture GLB returns N views plus camera metadata; the emitted
convention constants match `rebake_texture.py` exactly (enforced by test); a
checkerboard round-trip shows sub-pixel drift on visible surfaces.

### UV3 — Rewrite view stylization

Replace `textureJob.ts` wholesale. Requirements:
- **True img2img** conditioned on the UV2 render of that same view. If the SDK
  path for image-conditioned generation is unavailable, UV3 stops and the flag
  stays down — do not ship text-to-image and call it restyling.
- `identity_strength` → actual conditioning strength, not prompt text.
- Palette-lock string injected per view (reuse `extractPalette` /
  `paletteLockClause` from `avatarPrompts.ts`).
- Model chain resolved through the shared `IMAGE_MODELS` machinery, not a local
  literal.
- Billing through `deductCredits()` / `restoreReservedGenerationCredits()`, with
  refund on failure. Costs from `CREDIT_PRICES`.
- Variant registration using the real `creations` columns.

**Done when:** 6 stylized views for one prompt agree on colour placement above a
cross-view consistency threshold on the fixture set; a failed job refunds; a
replayed idempotency key returns the same job.

### UV4 — Standalone projection bake

Promote the bake in `rebake_texture.py` to a shared entry point serving both the
photo re-bake (UV8) and stylized views (UV3), exposed as `/texture/bake`.
Add confidence-mask seam blending and atlas-space inpainting for occluded
texels beyond today's original-texture floor.

*Prerequisite:* extract the camera/projection helpers shared by
`rebake_texture.py` and `render_views.py` into one module. Deliberately **not**
done during UV2 — the bake path is working and tested, and it cannot be
validated in a sandbox without Blender. Refactor it when a Blender environment
is available to run the fixture set before and after.

**Done when:** baked fixtures show no visible seam under orbit inspection; the
existing 20 UV8 tests still pass unchanged.

### UV5 — PBR derivation and packaging

Roughness from stylization prompt class, normal detail via high-pass of albedo
where appropriate, GLB packaged with `KHR_texture_basisu` (KTX2), bake masters
as PNG to the **private** bucket per D6.

**Done when:** a textured variant loads in the Fido's Styles viewer with correct
materials; the original remains untouched and selectable; KTX2 payload is
materially smaller than the PNG equivalent.

### UV6 — Complete job orchestration

Mostly done. Remaining: staged progress honestly reflecting
`rendering_views → stylizing → baking`, and per-tier view counts/resolutions
(Draft 4 low-res, Studio 8 high-res + second seam pass) per D3.

### UV7 — Fido's Styles Coat tool

Un-gate the Coat panel once UV3/UV4 land. Needs tier picker with cost and wait
stated up front, no silent downgrades, before/after compare, digital-only
labelling.

**Done when:** a user can restyle, compare, save as variant, and revert, with
the original always recoverable.

### UV8 — Fidelity re-bake ✅ **Done**

Pipeline, reversible viewer override, and the acceptance gate:
`server/textureLikeness.ts` scores palette distance to the user's reference
photos in CIELAB using CIEDE2000 (validated against all 34 Sharma et al.
conformance pairs), reported per-job in `texture_jobs.stats_json` as
`{before, after, delta, improved}` and surfaced in the UI as a percentage.

Scoring runs *after* upload inside its own catch — a metric must never destroy a
deliverable that already succeeded.

### UV9 — Colour print gate

Unchanged and correctly last. Blocked on a colour-capable provider decision.
Until then the UI never offers textured prints.

---

## 3. Decisions still open

| # | Decision | Blocks | Notes |
|---|---|---|---|
| 1 | Does the approved Gemini model chain expose image-conditioned generation? | UV3 | If not, UV3 needs a different provider or the feature stays down. This is the single largest risk to the stylize path. |
| 2 | Per-tier view counts and resolutions | UV2 caps, UV6 | D3 says Draft 4 / Studio 8; exact resolutions want a worker cost measurement on the Render instance. |
| 3 | Colour print provider | UV9 | Determines 3MF vs textured OBJ. |
| 4 | Merge accessory Texturizer into this pipeline? | UV7 | Plan §5 defers this to a UV7-era decision. |

---

## 4. Risk register delta

The original §4 risks stand. Two additions from this audit:

| Risk | Mitigation |
|---|---|
| Commit messages overstating completeness | Every milestone above carries a verifiable "done when". Status claims are checked against the database and route table, not the log. |
| Camera-convention drift between render and bake | Source-level parity test between `render_views.py` and `rebake_texture.py`; single shared module at UV4. |
