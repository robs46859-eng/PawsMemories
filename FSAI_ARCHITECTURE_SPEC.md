# FSAI.pro — Full Architecture & API Specification
**Product:** Automated 3D modeling platform for architects, engineers, game designers, and urban development.
**Companion doc:** `FSAI_MIGRATION_PLAN.md` (phasing). This document is the engineering specification: architecture, deployment, UI, BIM full-fidelity requirements, rigging/physics requirements, and the complete API surface. No dates or timelines. The spec is not signed off until every API call in §8 has a schema, auth rule, error contract, and test (§11).

---

## 0. Agent build directive (read first)

You are building FSAI from this document. This section is binding. Where this spec is silent, choose the simplest option that satisfies the §8 API contract and record the choice in `DECISIONS.md` at the repo root — do not invent features and do not amend §8.

### 0.1 Inputs you need before starting

1. This document and `FSAI_MIGRATION_PLAN.md`.
2. A read-only copy of the PawsMemories repository (source of the extraction map, Appendix A). **Never modify PawsMemories.**
3. Credentials via environment only (§3 env matrix). If a credential is missing, stub the integration behind its interface and continue; do not block.

### 0.2 Binding technology decisions (no substitutions)

| Concern | Decision |
|---|---|
| API | Node 20, Express, TypeScript, zod schemas in `/shared` (single source for client + server) |
| Web | Vite + React + TypeScript, Tailwind. One SPA serving marketing (prerendered routes) + app |
| 3D viewer | three.js. **The browser NEVER parses IFC.** All IFC parsing happens in the worker (IfcOpenShell); the browser renders only GLB tiles + JSON manifests from §8.3. Do not add web-ifc or any second parser — one parser, one source of truth |
| Worker | Docker: Python 3.11, IfcOpenShell (current stable), Blender headless (current LTS), existing TCP bridge pattern |
| DB | MySQL 8, migrations via plain SQL files in `/api/migrations`, applied by a `migrate` script on deploy |
| Auth | Access JWT (15 min) held in memory client-side; refresh token in httpOnly Secure cookie; rotation on refresh |
| Payments | Stripe (Checkout + webhook). No other processor |
| Hosting | Web+API: Hostinger, PM2 process manager (`pm2 reload fsai-api`). Worker: Render Docker. Deploy: GitHub Actions zip pipeline (§3). Manual zip upload is the fallback, same artifact |
| Facial visemes | Behind `options.visemes` flag, default **off** |
| Print/STL | In scope (endpoint #39); reuses `prepare_print_stl` |

### 0.3 Repository layout (create exactly this)

```
fsai/
├── .github/workflows/deploy.yml
├── DECISIONS.md
├── shared/          # zod schemas + TS types for every §8 endpoint; skeleton contracts
├── api/
│   ├── src/{routes,auth,bim,rig,generate,billing,providers,db,storage}/
│   ├── migrations/
│   └── tests/
├── web/
│   ├── src/{marketing,app,bim,rig,viewer,components,api}/
│   └── tests/
└── worker/
    ├── bridge/tcp_server.py
    ├── ifc_worker/          # v2 (§5)
    ├── rig/                 # orchestrator port + physics_validate
    ├── server.js
    └── tests/
```

### 0.4 Build order — do not advance past a milestone until its acceptance check is green

| M | Deliverable | Acceptance check |
|---|---|---|
| M0 | Repo scaffold, CI running tests on empty modules, `/api/health` deployed to staging via the full Actions→Hostinger pipeline | Pipeline green end-to-end incl. rollback drill |
| M1 | Auth + users + credits ledger (#1–#9) | Contract tests for all 9 endpoints |
| M2 | Worker deployed with existing bridge methods (`ping`, `import_glb`, `export_glb`, `prepare_print_stl`) + `/api/health/worker` | Round-trip GLB import/export through the API |
| M3 | **ifc_worker v2** (`parse_audit_ifc`) + import endpoints #14–#20 | FR-BIM-1 audit sums correct on all reference fixtures (incl. full-MEP and IFC4x3 civil files); zero silent drops |
| M4 | BIM viewer per §4.3 UX spec + samples #10–#13 | §4.3.2 usability acceptance test passes |
| M5 | Build/export #21–#25 with FR-BIM-9 round-trip | Post-build gates green incl. per-discipline counts |
| M6 | Generation #26–#31 (reserve→commit→recovery ported) | Recovery-required path tested; refund path tested |
| M7 | Rigging #32–#36: contract rigs, anatomy checks, `physics_validate` @ 9.8 m/s², clip baking | Broken-rig fixture (flipped knee) FAILS validation; reference biped/quadruped PASS |
| M8 | Library/exports #37–#41, billing #42–#45, marketing site + hero | Full §11 checklist; Stripe test-mode purchase → credits → paid job |

### 0.5 Prohibitions

- No endpoints beyond §8. No UI screens beyond §4. No second IFC parser. No localStorage for tokens.
- No pet-domain code, names, or copy anywhere in fsai.
- Never mark a milestone done with failing or skipped tests.

---

## 1. Purpose and scope

FSAI extracts the BIM/IFC and rigging engines proven inside PawsMemories and productizes them on fsai.pro.

**In scope:** IFC import/build/export with full-model fidelity (all disciplines), automated rigging for game-ready characters with anatomical + physics validation, image/text-to-3D generation, sample sandbox with free IFC files, credits/billing, GitHub Actions → Hostinger deployment.

**Non-goals:** touching pawsome3d.com/PawsMemories production (copy-based extraction only); reusing the vrcmg codebase (unrelated product — archived off the apex domain); pet-domain features.

**Hard product requirements driving this spec:**
1. **R1 — BIM is the hero.** The homepage leads with BIM automation, with a live sample viewer.
2. **R2 — Try before buy.** Users can run the software on prefab/open-source/free IFC files without payment.
3. **R3 — Full-model fidelity.** The BIM output must read and show the ENTIRE file: MEP, Civil, Digital, Structural, Architectural — no silently dropped components. Each discipline is a layer with its own properties and role-specific tools.
4. **R4 — Correct rigging.** Gaming models ship rigged, anatomically correct, validated under gravity 9.8 m/s² (downward −Z world axis).

---

## 2. System topology

```
                        ┌─────────────────────────────────────────────┐
                        │              fsai.pro (Hostinger)           │
                        │                                             │
   Browser ──HTTPS──►   │  Static SPA (marketing + app, Vite build)   │
                        │  fsai-api  (Node/Express, TypeScript)       │
                        │   ├─ Auth / sessions (JWT + refresh)        │
                        │   ├─ BIM module        /api/bim/*           │
                        │   ├─ Samples module    /api/samples/*       │
                        │   ├─ Generation module /api/generate/*      │
                        │   ├─ Rig module        /api/rig/*           │
                        │   ├─ Library/exports   /api/models/*        │
                        │   ├─ Billing           /api/billing/*       │
                        │   └─ Job poller (background loop)           │
                        └───────┬──────────────┬──────────────┬───────┘
                                │ shared-secret│              │
                                ▼              ▼              ▼
                  ┌──────────────────┐  ┌────────────┐  ┌───────────────┐
                  │ fsai-blender-    │  │ MySQL      │  │ Backblaze B2  │
                  │ worker (Render,  │  │ (fsai db,  │  │ (fsai bucket: │
                  │ Docker)          │  │ dedicated) │  │ ifc/ glb/ stl/│
                  │ ├ TCP bridge     │  └────────────┘  │ tiles/ audits)│
                  │ ├ ifc_worker v2  │                  └───────────────┘
                  │ │ (IfcOpenShell) │        ┌─────────────────────────┐
                  │ ├ rig engine     │◄──────►│ External: Tripo/Meshy   │
                  │ ├ physics_validate│       │ (image→mesh), Stripe,   │
                  │ └ export (glb/   │        │ email provider          │
                  │   fbx/stl/ifc)   │        └─────────────────────────┘
                  └──────────────────┘
```

**Components**

| Component | Source lineage | Runtime |
|---|---|---|
| `fsai-web` | New marketing site + app UI seeded from `BimModelBuilder.tsx`, AnimatorScreen, create-flow screens | Static (Vite) served by Hostinger |
| `fsai-api` | Extracted from PawsMemories `server.ts` (BIM, jobs, credits, auth, storage) | Node 20, Express, same host |
| `fsai-blender-worker` | Copy of `blender-worker/` + ifc_worker **v2** + new `physics_validate` | Docker on Render, private, shared-secret auth |
| MySQL (dedicated) | New schema (§9) — never the mypets.cc DB | Managed MySQL |
| Backblaze bucket (dedicated) | New bucket + keys | S3-compatible |
| Job poller | Reserve→commit→recovery state machine from create-pipeline | In-process loop in fsai-api |

**Trust boundaries:** browser ↔ fsai-api (JWT); fsai-api ↔ worker (`WORKER_SHARED_SECRET` header, worker not publicly routable by contract); fsai-api ↔ Stripe (webhook signature); worker ↔ nothing inbound except fsai-api.

---

## 3. Deployment architecture (GitHub Actions → Hostinger zip)

Combines both preferred options: **GitHub Actions builds the zip; Hostinger receives it.** Manual zip upload remains the documented fallback (same artifact).

**Repository:** `fsai` monorepo — `/web`, `/api`, `/worker`, `/shared` (types + API contracts), `/.github/workflows`.

**Pipeline (`deploy.yml`):**
1. **test** — `node --test` for api/shared; worker Python tests (`ifc_worker/tests`); contract tests (§11).
2. **build** — `vite build` (web) → `dist/`; `tsc` (api); assemble `fsai-deploy.zip` = `dist/` + compiled api + `package.json` + prod `node_modules` (or install-on-host script) + `public/` (robots, sitemap, sample thumbnails). Zip is the release artifact, attached to the run.
3. **deploy-web** — push zip to Hostinger via SSH/SFTP (host secrets in GitHub Actions secrets), unzip to release dir, atomic symlink swap, `pm2 reload fsai-api`. Rollback = repoint symlink to previous release (kept N=3).
4. **deploy-worker** — build/push worker Docker image; trigger Render deploy hook. Worker deploys are independent of web deploys.
5. **smoke** — hit `/api/health`, `/api/health/worker`, load one sample IFC end-to-end (§8.2), fail the run on any red.

**Environments:** `staging.fsai.pro` and production — staging is mandatory. Every deploy lands on staging, passes smoke, then the **same artifact** is promoted to production. Secrets live only in GitHub Actions secrets + host env stores; `.env.example` in repo; gitleaks config carried over from PawsMemories.

**Env matrix (minimum):** `DATABASE_URL`, `JWT_SECRET`, `WORKER_URL`, `WORKER_SHARED_SECRET`, `B2_KEY_ID/B2_APP_KEY/B2_BUCKET`, `TRIPO_API_KEY`, `STRIPE_SECRET/STRIPE_WEBHOOK_SECRET`, `EMAIL_API_KEY`, `APP_URL=https://fsai.pro`.

---

## 4. Frontend architecture

### 4.1 Marketing site (public, SEO-first)

- **Hero = BIM automation (R1).** Above the fold: headline on automated full-building BIM processing, an **embedded live viewer** running a real prefab IFC (rendered by the same viewer component as the app — not a video), and two CTAs: "Try it on a sample building" (→ sandbox, no signup) and "Import your IFC" (→ signup).
- Hero proof strip: parse-audit stats from the demo model rendered live — "N elements · 5 disciplines · 0 dropped components" — reinforcing the full-fidelity promise.
- Section order: BIM hero → automation explainer (import→audit→layers→export loop) → discipline layers showcase (interactive layer toggles on the demo model) → verticals (Architecture/Engineering, Game Design with rig demo, Urban Development) → pricing → gallery → docs/FAQ.
- Tech: same SPA bundle, prerendered/SSG routes for SEO; `seo.ts` pattern, sitemap, robots ported from PawsMemories.

### 4.2 Sample sandbox (R2)

- Curated **prefab IFC library** stored in the fsai bucket and seeded in the DB (`sample_assets`): small residential (arch+struct), commercial floor w/ full MEP, IFC4x3 road/alignment segment (civil), plus a rigged demo character for the gaming page.
- Sources: buildingSMART official sample files and other permissively licensed open IFC datasets. **Each sample record stores source URL + license text; license shown in the viewer footer.** Only redistribute files whose licenses permit it; otherwise fetch-on-demand from source.
- Sandbox rules: no auth required; sample jobs run with `sandbox: true` (no credits, capped concurrency, results cached — identical sample+options serve the cached audit/tiles rather than re-running the worker). Exports/downloads from sandbox require signup (conversion gate).

### 4.3 App (authenticated)

Routes: `/app` (dashboard) · `/app/bim` (BIM workspace) · `/app/bim/:buildId` · `/app/generate` (profile-driven creation flow) · `/app/rig/:modelId` (rig studio) · `/app/library` · `/app/orders` · `/app/settings`.

#### 4.3.1 BIM workspace UX specification (normative — the previous viewer was confusing; these rules exist to prevent that)

**Layout (fixed, never rearrangeable, no floating windows):**
- **Left pane:** two stacked sections, always visible: (1) discipline **Layers** list, (2) spatial **Tree** (Project→Site→Building→Storey→Space). Nothing else lives here.
- **Center:** the 3D viewport. One viewport, no split views, no camera modes to choose — orbit/pan/zoom only, plus a persistent **"Fit view"** button and a storey clipping slider.
- **Right pane:** context panel. Empty state reads "Select an element to see its properties." When an element is selected it shows: breadcrumb (Storey › System › Element), name/class, property sets, and the layer's tool palette (§5.3). It never shows tools for layers that aren't selected.
- **Top bar:** model name, parse-audit completeness badge ("N/N components · 0 dropped" — green only when audit buckets sum correctly), and ONE primary action per state (Import → Build → Download). Never two primary buttons at once.

**Interaction rules (binding):**
1. After import, the model opens with **all layers visible**, camera auto-fitted, audit badge shown. The user sees the whole building first — no empty screen, no "choose a mode" prompt.
2. Layer rows: name, element count, visibility checkbox, and a **Solo** button (isolates that layer; clicking Solo again restores). Solo state is shown by dimming all other layer rows — never a hidden toggle.
3. Every control has a **visible text label**. No icon-only toolbars anywhere in the workspace.
4. Click element → select + populate right pane. `Esc` or click-empty-space → deselect. Double-click → zoom to element. That is the complete selection model; no marquee, no multi-select in v1.
5. No modes. Tools act on the current selection or the current layer; the UI never enters a state where clicking does something different than it did before.
6. Maximum 7 visible controls per pane; overflow goes behind a single labeled **"More tools"** button per layer palette.
7. Loading, empty, and error states are designed states with copy — never a blank canvas. Import progress shows the worker stage (parsing → auditing → tiling) with real progress from #15.
8. Color modes: exactly two — "By discipline" (default, fixed legend rendered under the layer list) and "By system" (MEP). A legend is always visible when colors mean something.
9. First-run: a dismissible 3-step callout overlay (Layers → click an element → Build), shown once per user. No multi-page tutorials.

**Viewer implementation:** three.js; one `THREE.Group` per discipline (layer toggle = group visibility — O(1)); GLB tiles (discipline×storey) fetched from #20 with tiles outside the camera frustum deprioritized; element picking via per-tile id maps from the tiles manifest; browser holds no IFC data beyond manifests (§0.2).

#### 4.3.2 Usability acceptance test (gates M4)

A first-time tester (or scripted E2E mimicking one) starting from the sandbox must, **without documentation**: open a sample, identify how many components the file contains (audit badge), hide everything except MEP-HVAC (Solo), open one duct's properties, and restore the full view — in under 60 seconds of active interaction and without a wrong click that changes application state. Any failure is an M4 blocker, fixed before proceeding.

**Rig studio:** model viewer with skeleton overlay, clip preview player, and the **validation report card** (anatomy + physics checks from §6) displayed before export is enabled.

**User roles (per-account, multi-select):** `architect`, `structural`, `mep`, `civil`, `digital`, `game_dev`, `urban`. Role selection drives default visible layers and which tool palette the context panel shows. Roles are UI/permission presets, not billing tiers.

---

## 5. BIM Ingestion Engine v2 — full-model fidelity (R3)

### 5.1 Why v1 misses components (grounded in current code)

The current `ifc_worker.py` (449 lines):
- imports only `model.by_type("IfcElement")` + `IfcSpace` — anything not under those supertypes, or lacking a resolvable representation, is dropped **silently**;
- records only `storeyName` for containment — no systems, no discipline classification, no property sets;
- counts `IfcBuildingElementProxy` separately but renders proxies indistinctly;
- the authoring/export map supports **9 classes only** (wall, slab, roof, opening, door, window, space, column, beam) — no MEP, no civil, no distribution elements.

This is exactly the observed symptom: "the model does not show or read the entire file and is missing many components."

### 5.2 v2 parse requirements (normative)

- **FR-BIM-1 (No silent drops).** Iterate **all `IfcProduct`** entities. Every entity ends in exactly one of: `rendered`, `rendered_proxy` (geometry converted but class unmapped), `no_geometry` (annotations, sensors without representation — still listed in tree/properties), or `failed` (with reason). The four buckets must sum to the file's product count. This is the **parse audit** and it is returned to the client on every import.
- **FR-BIM-2 (Discipline classification).** Every product is assigned a discipline layer by IFC class (table §5.3), overridable by `IfcRelAssignsToGroup`/system membership. Unknown classes go to `general` — never omitted.
- **FR-BIM-3 (Property sets).** Extract all Psets/Qtos per element (`ifcopenshell.util.element.get_psets`) into the element manifest; lazy-load full psets per element via API to keep payloads bounded.
- **FR-BIM-4 (Systems).** Extract `IfcSystem` / `IfcDistributionSystem` / `IfcRelServiceBuildings` groupings so MEP elements can be viewed per-system (e.g., "CHW-1 chilled water loop"), not just per-discipline.
- **FR-BIM-5 (Spatial tree).** Full Project→Site→Building→Storey→Space containment for every element (not just storey name).
- **FR-BIM-6 (Schema coverage).** IFC2x3, IFC4, and **IFC4x3** (civil: alignments, earthworks, bridges/roads). Schema detected and reported in the audit.
- **FR-BIM-7 (Scale).** Models >50 MB or >30k products are converted to **GLB tiles per discipline×storey** and streamed; the viewer must never require the whole model in one buffer.
- **FR-BIM-8 (Automation loop reinforced).** Import → audit → auto-layered viewer → verified build/export runs with zero manual mapping steps; the audit is the automated guarantee, and the existing pre/post-build verification gates (element counts, GlobalIds, dimension tolerance) extend to per-discipline counts.
- **FR-BIM-9 (Round-trip).** IFC export (build mode `ifc`) must write back elements of **any** imported class, not the 9-class map: unmapped classes export as their original class via IfcOpenShell entity cloning, preserving GlobalIds, Psets, and placement.

### 5.3 Discipline layer taxonomy

| Layer | IFC classes (non-exhaustive; supertypes shown) | Layer-specific tools (context panel) |
|---|---|---|
| **Structural** | IfcColumn, IfcBeam, IfcMember, IfcPlate, IfcFooting, IfcPile, IfcReinforcingElement, IfcTendon, structural analysis items (IfcStructuralItem) | Section/material properties, load-bearing flag filter, structural grid overlay, quantity takeoff (volume/weight), clash check vs MEP |
| **Architectural** | IfcWall, IfcSlab, IfcRoof, IfcDoor, IfcWindow, IfcStair, IfcRamp, IfcRailing, IfcCurtainWall, IfcCovering, IfcFurnishingElement, IfcSpace | Room/space schedules, area takeoff, door/window schedules, finishes, storey clipping |
| **MEP — HVAC** | IfcDuctSegment/Fitting/Silencer, IfcAirTerminal, IfcFan, IfcCoil, IfcChiller, IfcBoiler, IfcPump (HVAC systems), IfcFlowSegment supertype | System isolation (per IfcDistributionSystem), flow-direction display, equipment schedule, connectivity trace (ports) |
| **MEP — Plumbing/Fire** | IfcPipeSegment/Fitting, IfcSanitaryTerminal, IfcValve, IfcTank, IfcFireSuppressionTerminal, IfcInterceptor | Pipe run isolation, fixture counts, riser view, sprinkler coverage listing |
| **MEP — Electrical** | IfcCableSegment/CarrierSegment, IfcOutlet, IfcLightFixture, IfcSwitchingDevice, IfcElectricAppliance, IfcTransformer, IfcElectricDistributionBoard | Circuit/system grouping, panel schedules, fixture counts, cable tray routing view |
| **Civil** | IFC4x3: IfcAlignment, IfcRoad, IfcBridge, IfcEarthworksElement, IfcPavement, IfcKerb; IfcSite, IfcGeographicElement, IfcCivilElement | Alignment stationing, cut/fill volumes, terrain toggle, site coordinate/CRS readout |
| **Digital / BMS** | IfcSensor, IfcActuator, IfcController, IfcAlarm, IfcCommunicationsAppliance, IfcAudioVisualAppliance, IfcProtectiveDeviceTrippingUnit | Point list (BMS schedule), sensor→controlled-element links, digital-twin export (element + point JSON) |
| **General** | IfcBuildingElementProxy, unclassified IfcProduct | Proxy inspector (raw psets + geometry), "reclassify" action feeding FR-BIM-2 overrides |

Each layer carries: visibility toggle, color-by-layer or by-system mode, isolation mode, per-layer element count from the audit, and the role-specific tool palette above. Properties panels are schema-driven (rendered from extracted Psets), so discipline-specific fields appear without hardcoding.

### 5.4 Role → default experience

`architect` → Architectural + Structural visible, others dimmed; `mep` → MEP layers isolated with systems panel open; `structural` → Structural + grid overlay; `civil`/`urban` → Civil + Site + massing tools; `digital` → Digital/BMS point list; `game_dev` → skips BIM defaults, lands on rig studio. All layers remain available to every user — roles set defaults and tool prominence only.

---

## 6. Rigging engine — anatomical correctness and physics (R4)

Lineage: agent orchestrator (perceive→reason→act→verify→finalize), bone maps (`bonemap.json`, `bonemap.human.json`), skeleton contracts, skeletal clip libraries (re-enabled), viseme pass (optional facial add-on).

**Skeleton contracts (normative):** per-profile canonical skeletons — `character_biped` (humanoid, Unity-Humanoid-compatible naming), `character_quadruped`, `character_winged`, `prop/static` (no rig). Contract defines required bones, hierarchy, roll/axis conventions (+Y along bone, −Z world down), and symmetry pairs.

**FR-RIG-1 (Rig presence).** Every model generated under a `character_*` profile MUST leave the pipeline with an armature satisfying its skeleton contract, or the job fails with a validation report — never "silently static." (Contrast: PawsMemories' current create flow ships unrigged GLBs; FSAI's gaming path must not.)

**FR-RIG-2 (Anatomical validation)** — automated checks in the verify node, all reported per-job:
- bone count/hierarchy matches contract; no orphan bones;
- joint placement within tolerance of mesh landmarks (hips at pelvis centroid, knees/elbows at limb midpoint bends, chain lengths within symmetry tolerance L/R < 2%);
- joint rotation limits sane (knees/elbows hinge on one axis; no inverted bend directions);
- weight painting: every vertex weighted, max 4 influences, no island weighted to a distant bone (weight-distance heuristic);
- visual verification (existing vision-based verify node) confirms silhouette integrity in T-pose and a test pose.

**FR-RIG-3 (Physics validation @ 9.8 m/s²)** — new worker method `physics_validate`:
- Blender rigid-body/ragdoll scene: world gravity set to **(0, 0, −9.8) m/s²**; model scaled to real-world units from profile height (m).
- **Drop test:** model spawned 0.5 m above ground plane must settle without limb inversion or mesh interpenetration.
- **Stand test:** armature in rest pose under gravity with feet pinned — center of mass must project inside the support polygon (feet bounding hull) within tolerance; reported as `balanced: true/false`.
- **Pendulum test:** free limbs (arms/tail) released from horizontal must swing downward (validates joint axes are not flipped — a limb that swings upward fails).
- Mass distribution assigned per contract segment percentages (e.g., biped: head 8%, torso 50%, per-leg 16%…); report includes total mass, COM height, and per-test pass/fail.
- Export blocks until FR-RIG-2 and FR-RIG-3 pass or the user explicitly overrides with `acceptValidationWarnings: true` (recorded on the model).

**FR-RIG-4 (Clips).** Skeletal clip baking re-enabled per-profile (idle/walk/run/jump set for bipeds; quadruped set incl. tail; clip list per contract). Clips baked only after validation passes so animations inherit a correct rig.

**FR-RIG-5 (Exports).** GLB (primary), FBX (engine-ready; Unity Humanoid / Unreal mapping via bone-name remap tables), optional viseme blendshapes (`viseme_A..X`) as facial add-on.

---

## 7. Generation pipeline (shared by verticals)

Reserve→commit→recovery job machine carried over intact: credits reserved with idempotency key → external provider start (Tripo/Meshy) → `generation_jobs` row commit → poller finalizes → post-processing per profile (none for `prop/static`; rig+validate for `character_*`; nothing BIM-related — BIM is import-driven, not generative). Provider-start failure refunds; DB-commit failure after provider start escalates to `recovery_required` (no automatic refund; support queue). Sandbox jobs bypass credits with caps (§4.2).

---

## 8. Complete API specification

Conventions: JSON bodies; `Authorization: Bearer <JWT>` where auth = ✅; errors always `{ error: string, code?: string }`; standard errors on every authed route: `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `429 RATE_LIMITED`; `402 INSUFFICIENT_CREDITS` on paid actions; `503 GENERATION_SERVICE_UNAVAILABLE` when an external provider is down. All list endpoints support `?limit&offset`.

### 8.1 Auth & account

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 1 | `POST /api/auth/register` | – | `{email, password}` | `201 {user, token, refreshToken}` | 400 invalid; 409 `EMAIL_TAKEN` |
| 2 | `POST /api/auth/login` | – | `{email, password}` | `{user, token, refreshToken}` | 401 bad credentials; 429 |
| 3 | `POST /api/auth/refresh` | refresh token | `{refreshToken}` | `{token, refreshToken}` | 401 expired/revoked |
| 4 | `POST /api/auth/logout` | ✅ | – | `204` | – |
| 5 | `POST /api/auth/password-reset` | – | `{email}` | `202` (always, no enumeration) | 429 |
| 6 | `POST /api/auth/password-reset/confirm` | – | `{token, newPassword}` | `204` | 400 invalid/expired token |
| 7 | `GET /api/me` | ✅ | – | `{user, roles, credits, plan}` | – |
| 8 | `PATCH /api/me` | ✅ | `{name?, roles?[]}` | `{user}` | 400 |
| 9 | `GET /api/me/credits` | ✅ | – | `{balance, ledger:[{delta, reason, jobId?, at}]}` | – |

### 8.2 Samples (sandbox — R2)

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 10 | `GET /api/samples` | – | – | `[{id, name, description, discipline_summary, size_bytes, schema, license:{name, sourceUrl, text}, thumbnailUrl}]` | – |
| 11 | `POST /api/samples/:id/open` | – | – | `{sessionId, audit, layers, treeUrl, tilesManifestUrl}` — served from cache when warm | 404; 429 sandbox concurrency cap |
| 12 | `GET /api/samples/:id/audit` | – | – | parse audit (schema in #14) | 404 |
| 13 | `POST /api/samples/:id/promote` | ✅ | – | copies sample result into user's projects: `{projectId, importId}` | 404 |

Sandbox sessions are anonymous, TTL-bound, read-only; every export/download route rejects sandbox sessions with `403 SIGNUP_REQUIRED`.

### 8.3 BIM (R3)

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 14 | `POST /api/bim/import-ifc` | ✅ | `{ifcBase64}` or `{ifcUrl}`; >25 MB must use `POST /api/uploads` (#40) then `{uploadId}` | `202 {importId, jobId}` → poll #15. Final result: `{importId, schema, audit:{totalProducts, rendered, renderedProxy, noGeometry, failed:[{globalId, class, reason}], byDiscipline:{[layer]:{count, classes:{[ifcClass]:n}}}, bySystem:[{systemId, name, type, elementCount}]}, glbUrl | tilesManifestUrl}` | 400 not IFC; 413 too large for inline; 422 parse failure (with partial audit) |
| 15 | `GET /api/bim/imports/:id` | ✅ | – | `{status: queued|parsing|tiling|done|failed, audit?, progress?}` | 404 |
| 16 | `GET /api/bim/imports/:id/tree` | ✅ | – | full spatial tree `{project→sites→buildings→storeys→spaces→elementIds}` (FR-BIM-5) | 404 |
| 17 | `GET /api/bim/imports/:id/layers` | ✅ | – | `[{layer, count, systems:[...], colorDefault}]` | 404 |
| 18 | `GET /api/bim/imports/:id/elements` | ✅ | `?layer&system&storey&class&limit&offset` | `[{globalId, class, name, layer, storey, systemIds[], bucket}]` — bucket = audit bucket (FR-BIM-1) | 404 |
| 19 | `GET /api/bim/elements/:globalId/properties` | ✅ | `?importId` | `{psets:{...}, qtos:{...}, materials[], containment, systems[]}` (FR-BIM-3, lazy) | 404 |
| 20 | `GET /api/bim/imports/:id/tiles/:tileId` | ✅ | – | GLB binary (discipline×storey tile, FR-BIM-7) | 404 |
| 21 | `POST /api/bim/preflight` | ✅ | `{mode: shell|ifc, model}` | `{verification, mode, price}` (unchanged contract from PawsMemories) | 400 |
| 22 | `POST /api/bim/build` | ✅ | `{mode, model, importId?}` | `{success, mode, price, preflight, postBuild:{…, byDisciplineCounts, roundTripPreserved}, glb_base64?|glbUrl, ifcUrl?, saved, balance}` — postBuild extends existing gates with per-discipline counts + FR-BIM-9 round-trip check | 402; 422 preflight failed |
| 23 | `GET /api/bim/builds` | ✅ | – | `[{id, name, mode, price, glbUrl, ifcUrl, sidecarUrl, elementCount, byDiscipline}]` | – |
| 24 | `GET /api/bim/builds/:id/download` | ✅ | `?format=glb|ifc|sidecar` | signed URL redirect | 404 |
| 25 | `POST /api/bim/export-ifc` | – | – | `410` (unchanged: use verified build flow) | – |

### 8.4 Generation

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 26 | `GET /api/generate/profiles` | ✅ | – | `[{id: character_biped|character_quadruped|character_winged|prop_static|urban_massing, label, rigContract?, clipSet?, price}]` | – |
| 27 | `POST /api/generate/reference` | ✅ | `{profileId, prompt?, imageBase64?|imageUrl?, style?}` | `{sessionId, candidateUrl}` (no credits spent) | 400; 502 image gen failed |
| 28 | `POST /api/generate/session/:id` | ✅ | `{customizationState?, validationState?}` | `{session}` (MD5 staleness hash retained) | 404; 400 |
| 29 | `POST /api/generate/approve` | ✅ | `{sessionId, idempotencyKey}` | `{jobId, status: building}` — reserve→Tripo start→commit | 402; 409 already reserved; 503 provider (refunded); 500 `RECOVERY_REQUIRED` |
| 30 | `GET /api/jobs/:id` | ✅ | – | `{status: queued|running|rigging|validating|baking_clips|done|failed, modelId?, validationReport?, error?}` | 404 |
| 31 | `POST /api/jobs/:id/retry` | ✅ | – | `{status}` (stuck-state reset, ported from avatar retry) | 404; 409 not retryable |

### 8.5 Rigging (R4)

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 32 | `POST /api/rig` | ✅ | `{modelId, contract: biped|quadruped|winged, options:{visemes?: bool, clips?: string[]}}` | `202 {jobId}` | 402; 404 model |
| 33 | `GET /api/rig/:jobId` | ✅ | – | `{status, validationReport?:{anatomy:{checks:[{name, pass, detail}]}, physics:{gravity: 9.8, dropTest, standTest:{balanced, comOffset}, pendulumTest, pass}}, riggedModelId?}` | 404 |
| 34 | `POST /api/rig/:jobId/accept-warnings` | ✅ | `{acceptValidationWarnings: true}` | unblocks export; recorded on model | 404; 409 hard-fail not overridable |
| 35 | `POST /api/rig/:jobId/bake-clips` | ✅ | `{clips: string[]}` | `202 {jobId}` — only after validation pass (FR-RIG-4) | 409 `VALIDATION_INCOMPLETE` |
| 36 | `POST /api/retarget` | ✅ | `{modelId, target: unity_humanoid|unreal}` | `202 {jobId}` → remapped export | 404; 422 contract mismatch |

### 8.6 Library, exports, uploads

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 37 | `GET /api/models` | ✅ | `?type=generated|rigged|bim` | unified library `[{id, name, type, profileId?, urls:{glb?, fbx?, ifc?, stl?}, validation?, createdVia}]` | – |
| 38 | `GET /api/models/:id/download` | ✅ | `?format=glb|fbx|stl|ifc` | signed URL | 404; 409 format not yet exported |
| 39 | `POST /api/models/:id/export` | ✅ | `{format: fbx|stl, options?:{targetHeightMm? (25–300, STL)}}` | `202 {jobId}` — STL path reuses `prepare_print_stl` (manifold report included) | 402; 422 not printable |
| 40 | `POST /api/uploads` | ✅ | multipart or `{sizeBytes, mime}` → resumable | `{uploadId, putUrl}` | 413 plan limit |
| 41 | `DELETE /api/models/:id` | ✅ | – | `204` | 404 |

### 8.7 Billing

| # | Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|---|
| 42 | `GET /api/billing/prices` | – | – | `{creditPacks[], jobPrices:{bim_shell, bim_ifc, generate_by_profile, rig, clips, export_fbx, export_stl}}` | – |
| 43 | `POST /api/billing/checkout` | ✅ | `{packId}` | `{checkoutUrl}` (Stripe session) | 400 |
| 44 | `POST /api/billing/webhook` | Stripe sig | Stripe event | `200` — credits ledger append, idempotent by event id | 400 bad signature |
| 45 | `GET /api/orders` | ✅ | – | order/print history | – |

### 8.8 Ops & internal (worker) API

| # | Method & path | Auth | Purpose |
|---|---|---|---|
| 46 | `GET /api/health` | – | app + DB + bucket status |
| 47 | `GET /api/health/worker` | – | proxies worker `ping` (cold-start aware) |
| 48 | Worker HTTP (shared secret): `POST /import-glb` · `POST /export-glb` · `POST /prepare-print` · `POST /convert-ifc` · `POST /export-ifc` · `POST /parse-audit` (new, FR-BIM-1..6) · `POST /rig` (contract-driven) · `POST /physics-validate` (new, FR-RIG-3) · `POST /bake-clips` · `POST /execute` (bpy, internal only) · `GET /ping` | `X-Worker-Secret` | Bridge methods (TCP): existing `import_glb, export_glb, prepare_print_stl, save_checkpoint, restore_checkpoint, ping, execute_bpy` + new `parse_audit_ifc, rig_from_contract, physics_validate, bake_clips`. Worker is never exposed to browsers. |

**API sign-off rule:** endpoints #1–#48 constitute the complete surface. Any route added later amends this section first; nothing ships unlisted. Per-endpoint sign-off tracked in §11.

---

## 9. Data model (MySQL, dedicated)

- `users` (id, email, password_hash, roles JSON, plan, created) · `refresh_tokens` · `password_resets`
- `credits_ledger` (user_id, delta, reason, job_id?, stripe_event_id?, at) — balance is a SUM, no mutable counter
- `projects` (user_id, name) · `uploads` (id, user_id, url, mime, size)
- `bim_imports` (id, user_id, project_id, source_url, schema, status, audit JSON, tiles_manifest_url)
- `bim_elements` (import_id, global_id, class, layer, storey, bucket, name) — indexed for #18; psets fetched from sidecar on demand
- `bim_builds` (ported: id, user_id, name, mode, price, glb_url, ifc_url, sidecar_url, element_count, by_discipline JSON)
- `generation_sessions` (ported create_pipeline_sessions: status draft→reference_ready→build_starting→building→done|recovery_required, idempotency_key, customization/validation state + MD5 hash)
- `generation_jobs` (ported: kind, operation_name, credits_reserved, status, error)
- `models` (id, user_id, type, profile_id, urls JSON, validation_report JSON, accept_warnings bool)
- `rig_jobs` (model_id, contract, status, validation_report JSON)
- `sample_assets` (id, name, source_url, license JSON, bucket_key, cached_audit JSON)
- `orders` (print/fulfillment, ported pattern)

## 10. Security

JWT short-lived + refresh rotation; bcrypt password hashing (ported auth.ts); rate limits per route class (auth 5/min, paid actions per-user, sandbox per-IP); body limits (inline IFC ≤25 MB, else resumable upload); CSP allowing only self + bucket origins (ported builder); worker reachable only with `X-Worker-Secret`, secret distinct from PawsMemories'; Stripe webhook signature verification; signed, expiring download URLs; gitleaks in CI; secrets only in GitHub Actions + host env.

---

## 11. Specification sign-off checklist

The spec is **signed off** only when every row is checked. (Status column intentionally blank — this is the gate, not a status report.)

**Per-endpoint (48 rows, §8):** request schema defined in `/shared` (zod) ▢ · auth rule enforced + tested ▢ · error contract tested ▢ · happy-path integration test ▢ · rate limit assigned ▢.

**Per-requirement:**
- R1: hero renders live sample viewer with real audit stats ▢
- R2: sandbox open→view→layer-toggle with zero auth; export gate returns `SIGNUP_REQUIRED` ▢
- R3/FR-BIM-1: audit buckets sum to file product count on all reference files (incl. a full-MEP model and an IFC4x3 civil model); zero silent drops ▢
- FR-BIM-2..9: discipline classification, psets, systems, tree, schema coverage, tiling, automation loop, round-trip — each with a dedicated test fixture ▢
- R4/FR-RIG-1..3: contract rig present on every character job ▢; anatomy checks pass on reference characters ▢; physics validation runs at gravity 9.8 m/s² and correctly fails a deliberately broken rig (flipped knee fixture) ▢
- Deployment: Actions pipeline produces the zip, deploys to Hostinger, smoke passes, rollback demonstrated ▢
- Security: authz matrix tested (sandbox vs user vs admin), worker unreachable without secret ▢

**UX gate:** the §4.3.2 usability acceptance test passes ▢ (this row exists because the previous BIM viewer failed on usability, not capability).

**Explicit gap acknowledgments carried into build:** current ifc_worker covers only IfcElement+IfcSpace with 9 authored classes — replaced by v2 (§5); current create flow ships unrigged GLBs — FSAI character profiles must not (FR-RIG-1); skeletal clip baking currently disabled upstream — re-enabled behind validation gate (FR-RIG-4).

---

## Appendix A — Extraction map (PawsMemories → fsai)

Copy-based. Source repo is read-only. "Port" = copy then adapt; "Rewrite" = use as reference only.

| Source (PawsMemories) | Destination (fsai) | Action |
|---|---|---|
| `blender-worker/bridge/tcp_server.py` (incl. `prepare_print_stl`) | `worker/bridge/tcp_server.py` | Copy; add `parse_audit_ifc`, `rig_from_contract`, `physics_validate`, `bake_clips` methods |
| `blender-worker/server.js`, `Dockerfile` | `worker/server.js`, `Dockerfile` | Copy; add routes for new bridge methods; new `WORKER_SHARED_SECRET` |
| `blender-worker/ifc_worker/ifc_worker.py` | `worker/ifc_worker/` | **Rewrite** as v2 per §5 (reference for GLB conversion + unit scaling only) |
| `blender-worker/bonemap.json`, `bonemap.human.json` | `worker/rig/bonemaps/` | Copy |
| `blender-worker/skeletal-clips.js`, `skeletal-clips-human.js`, `animation-templates.js` | `worker/rig/clips/` | Copy; re-enable behind FR-RIG-4 validation gate |
| `blender-worker/jobs/bake_lod.py` | `worker/jobs/bake_lod.py` | Copy (game-design LOD, post-M8) |
| `agent/graph/orchestrator.ts` + `agent/graph/nodes/*` (perceive/reason/act/verify/finalize/recover/visual-verify/facialVisemes) | `api/src/rig/orchestrator/` | Port; replace `PetAnalysis` input with subject-profile objects (§2 of migration plan); keep verify/visual-verify |
| `agent/tools/blender_mcp.ts` | `api/src/rig/blenderClient.ts` | Port |
| `tripo.ts` (`startImageTo3D`, `startRig`, pollers, `isTripoHandle`) | `api/src/providers/tripo.ts` | Copy; new API key |
| `server.ts` BIM section (routes at ~462–600: import-ifc, preflight, build, builds + `preflightBimModel`, `buildAndVerifyShell`, `bimModelCost`) | `api/src/routes/bim.ts`, `api/src/bim/` | Port; extend gates per FR-BIM-8/9; wire to worker v2 |
| `server.ts` create-pipeline section (~4405–4640: generate-reference, update, approve + reserve/commit/recovery db fns) | `api/src/routes/generate.ts` | Port; strip pet prompts; profiles from §7 |
| `server.ts` job poller (Meshy branch) | `api/src/jobs/poller.ts` | Port; add rig/validate post-processing stage for `character_*` |
| `auth.ts` + password-reset + rate-limit patterns | `api/src/auth/` | Port to email+JWT+refresh per §0.2 |
| `storage.ts` (Backblaze) | `api/src/storage.ts` | Copy; new bucket/keys |
| `skeletonContract.ts` | `shared/contracts/skeletons.ts` | Port; extend to biped/quadruped/winged contracts (§6) |
| `server/rigBudget.ts`, `server/subjectProfiles.ts` | `api/src/rig/` | Port; generalize profiles |
| `server/slant3d.ts`, print-order routes | `api/src/routes/orders.ts` | Port (post-M8 if deferred) |
| `db.ts` — ONLY: job fns (`createJob/updateJobStatus/getJob/getRunningJobs/restoreReservedGenerationCredits`), credit fns, `insertBimBuild/listBimBuilds`, create-pipeline session fns | `api/src/db/` | Port function-by-function against the §9 schema. **Do not copy db.ts wholesale** |
| `src/components/BimModelBuilder.tsx` | `web/src/bim/` | **Rewrite** UI per §4.3.1 (previous layout is the confusing one — reuse API-call logic only) |
| `src/animator/components/AnimatorScreen.tsx` (viewer/skeleton overlay parts) | `web/src/rig/` | Port viewer + validation report card; drop timeline/dope-sheet complexity for v1 |
| Create-flow screens (`src/components/create-flow/*`) | `web/src/app/generate/` | Port flow logic; restyle, profile picker replaces species picker |
| `seo.ts`, `public/robots.txt`, `sitemap.xml` patterns | `web/src/marketing/` | Port pattern with fsai routes |
| `.gitleaks.toml`, `.githooks` | repo root | Copy |
| Pet triage, avatarPrompts, AR sim, Pawprints, HeyGen/Veo, SMS copy | — | **Do not port** |
