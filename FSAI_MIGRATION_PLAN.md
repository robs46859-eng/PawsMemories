# FSAI.pro — BIM & Rigging Platform Migration Plan
**Goal:** Stand up fsai.pro as a standalone commercial product — 3D modeling for architects, engineers, game designers, and urban development — powered by the BIM/IFC and rigging architecture currently inside PawsMemories. Phased plan, no dates or timelines.

---

## Feasibility answer (short)

**Yes, on both counts.**

1. **The architecture is portable.** The BIM/rigging stack is already service-oriented: an Express API layer, a self-contained **blender-worker** (Docker on Render: TCP bridge, IfcOpenShell `ifc_worker.py`, bone maps, skeletal clip library), the **agent rig orchestrator** (`agent/graph/`), Tripo/Meshy integration (`tripo.ts`), Backblaze storage, and MySQL. Nothing binds it to pawsome3d.com except route mounting in `server.ts` and pet-specific triage/prompts — both cleanly severable.
2. **The current fsai.pro deployment should be replaced, not fixed.** The vrcmg repo on that domain is a different product entirely (AI video generation control plane — FastAPI on Google Cloud Run). None of it is reusable for a 3D/BIM platform. The domain is currently serving nothing.

---

## Phase 0 — Triage, access, and decisions

**Work**
- Recover hosting/DNS control for fsai.pro (registrar + wherever DNS currently points; vrcmg docs reference Hostinger DNS + Google Cloud Run staging endpoints).
- Diagnose why the domain is unreachable (dead Cloud Run services, DNS misconfig, or expired mapping) — for cleanup only, not repair.
- Disposition of vrcmg: archive the repo, or park the product on a subdomain (e.g. vrc.fsai.pro) / different domain. It should not occupy the apex.
- Inventory every external account needed: Backblaze, Render, Hostinger, Tripo/Meshy, Stripe (or chosen processor), SMS/email provider.

**Decisions to lock before Phase 1**
- **Dedicated vs shared blender-worker:** recommend a *dedicated* worker instance for FSAI (own Render service, own `WORKER_SHARED_SECRET`) so PawsMemories load and deploys never interfere.
- **Dedicated vs shared database:** recommend a *new* MySQL database — FSAI needs only a fraction of the PawsMemories schema and must not touch the mypets.cc production data.
- **Dedicated storage bucket:** new Backblaze bucket (or S3-compatible alternative) with its own keys.
- **Hosting for the FSAI API/app:** Hostinger (same prebuilt-zip pattern you already run) vs Cloud Run vs Render web service. Recommend whichever you can operate most reliably; the codebase doesn't care.

**Exit criteria:** DNS control confirmed, vrcmg dispositioned, all four decisions recorded.

---

## Phase 1 — Extract the engine into a new repo ("fsai")

Create a clean monorepo with two deployables and zero pet-domain code:

**`fsai-api` (Express/TypeScript) — carved from PawsMemories:**
- BIM module: `/api/bim/import-ifc`, `/preflight`, `/build` (shell + IFC4 modes with pre/post-build verification), `/builds`; `preflightBimModel`, `buildAndVerifyShell`, `bimModelCost`, `insertBimBuild`.
- Rigging module: agent orchestrator (`agent/graph/` — perceive/reason/act/verify/finalize, `facialVisemes.ts`), `server/rigBudget.ts`, `skeletonContract.ts`, `server/subjectProfiles.ts`, bone maps.
- Generation module: `tripo.ts` (`startImageTo3D`, `startRig`, pollers), the job table + background poller pattern, credit-reservation/idempotency/recovery logic from the create-pipeline (this logic is domain-neutral and battle-tested — keep it).
- Shared plumbing: `auth.ts` (email/password + reset hardening), `storage.ts` (Backblaze), rate limiters, CSP builder.
- Print/export module (optional but cheap to bring): `prepare_print_stl` route, Slant3D adapter.

**`fsai-blender-worker` (Docker) — near-verbatim copy of `blender-worker/`:**
- `bridge/tcp_server.py` (incl. `prepare_print_stl`), `ifc_worker/` (IfcOpenShell), `server.js`, bone maps, `skeletal-clips.js` / `skeletal-clips-human.js`, animation templates, profiles.

**Explicitly left behind:** pet triage (`imageTriage.ts` pet enums), `avatarPrompts.ts`, avatar needs/feeding/AR pet sim, Pawprints, PupCoins branding, SMS copy, HeyGen/Veo video paths (unless wanted later).

**Exit criteria:** both services build and boot locally against a scratch DB; worker responds to `ping`, `import_glb`, `convert-ifc`, `export_glb`.

---

## Phase 2 — Generalize the domain model

- Replace pet analysis with **subject profiles** as first-class input: `architectural_asset`, `character_biped`, `character_quadruped`, `prop/static`, `urban_massing`. The orchestrator already branches on `bodyType`/`species` — refactor to consume a profile object instead of `PetAnalysis`.
- **Re-enable skeletal clip baking** (the disabled Phase 5) behind a per-profile flag — game-design customers are exactly who wants baked clips; architects get static exports and never touch that path.
- Keep the viseme blendshape pass (`viseme_A..X`) as an optional "facial rig" add-on for character work.
- New DB schema (only what's needed): `users`, `projects`, `generation_jobs`, `bim_builds`, `models`, `orders`, `credits_ledger`. Write migrations from scratch — do not copy the 143 KB `db.ts` wholesale; extract just the functions these tables need.
- Neutral billing units (credits or per-job pricing) replacing PupCoins; keep the reserve→commit→recovery-required state machine.
- Export formats per vertical: GLB + IFC4 + STL now; document FBX/USD/OBJ as worker-side additions later (Blender can export all three via the same bridge).
- **Urban development note:** the imagetoasset ortho→CSG work is a natural fit here, but its STEP exporter is known-invalid — never authoritative. Treat it as a Phase 6+ candidate, GLB/IFC output only.

**Exit criteria:** an end-to-end job for each profile type runs locally: image→mesh (Tripo), mesh→rig (worker), model→IFC build, model→STL.

---

## Phase 3 — Infrastructure on fsai.pro

- Provision the dedicated blender-worker on Render (Docker); set fresh `WORKER_SHARED_SECRET`; verify cold-start behavior and the fail-fast bridge-exit handling you already added.
- Provision MySQL + Backblaze bucket; run migrations; set lifecycle rules for large artifacts.
- Deploy `fsai-api` to the chosen host; wire env matrix (`.env.example` first, then real values in the host's secret store — never in git; the repo already has gitleaks config to copy over).
- Point fsai.pro DNS at the new app; TLS; health endpoint; uptime monitoring.
- CI: build + test + artifact zip (mirroring your prebuilt-zip deploy pattern) or host-native deploy; include the worker's Docker build.

**Exit criteria:** https://fsai.pro serves the app shell over TLS; API health check green; worker reachable only via shared secret; a smoke job completes in production.

---

## Phase 4 — User-facing website and app UI

**Marketing site (public):**
- Positioning for four audiences: architecture, engineering, game design, urban development. Pages: home, per-vertical solution pages, pricing, gallery/portfolio (rendered from real pipeline output), docs, contact.
- SEO foundation from day one (you already have the `seo.ts` / sitemap / robots pattern to replicate).

**App (authenticated):**
- **BIM workspace:** port `BimModelBuilder.tsx` onto its own top-level route (the component is self-contained — its only problem in PawsMemories was being trapped inside AvatarDashboard). IFC import → preflight → build → verified download, plus build history from `bim_builds`.
- **Model generator:** a professionalized version of the create flow (reference → validate → approve) with the pet styling stripped; profile picker instead of species picker.
- **Rig studio:** resurrect the AnimatorScreen/rig UI components as the character-rigging workspace (source is preserved in PawsMemories; it was only gated, never deleted). Include clip preview once Phase 5 baking is re-enabled.
- **Library:** unified models list (pattern already exists in `/api/models/library`), downloads, re-exports.
- New design system: clean professional theme (not TerraPaw); dark-mode viewer default for 3D work.

**Exit criteria:** a new user can sign up, import an IFC or generate a model, run a build/rig, and download output entirely through the fsai.pro UI.

---

## Phase 5 — Commerce

- Payment processor integration (Stripe recommended) → credits ledger or per-job invoicing; webhooks feed the existing reserve/commit machine.
- Pricing tiers per vertical (IFC builds, rig jobs, clip baking, STL/print prep priced separately — `bimModelCost` already models per-mode pricing).
- Quotas + rate limits per plan; admin bypass equivalent for your account.
- Order history, receipts, and the read-only fulfillment-diagnostics pattern for support.
- Optional: physical print fulfillment (Slant3D adapter port) for architectural scale models.

**Exit criteria:** a real card can buy credits and spend them on a job; failed provider calls refund or escalate to recovery exactly as in PawsMemories.

---

## Phase 6 — Vertical depth (post-core)

- **Architecture/engineering:** IFC property-set editing, storey/element semantics UI, revision compare, Revit-friendly IFC4 export validation.
- **Game design:** FBX export, retarget presets per engine (Unity Humanoid / Unreal skeleton), batch clip baking, LOD baking (worker `bake_lod.py` already exists).
- **Urban development:** massing generator, ortho-image→block-model workflow (imagetoasset integration, GLB/IFC only), site-scale unit calibration reusing the mm-calibration approach from `prepare_print_stl`.

**Exit criteria:** at least one deep feature shipped per vertical, driven by first-customer feedback.

---

## Phase 7 — Hardening, QA, and launch

- Port and adapt the relevant test suites (BIM build verification, worker bridge tests, job recovery/idempotency tests, auth tests) into fsai CI.
- Load-test the worker (concurrent rig + IFC jobs); decide on queueing (current single-bridge model may need a job queue or second worker under load).
- Security pass: rate limits, body limits, CSP, secret rotation, backup/restore drill for DB + bucket.
- Runbooks: worker restart, recovery-required job handling, deploy/rollback.
- Launch checklist: DNS final, monitoring/alerting live, smoke suite green, vrcmg fully off the apex domain.
- **Non-goal guardrail:** PawsMemories/pawsome3d.com remains untouched throughout — extraction is copy-based, never a move; shared accounts (Tripo, Backblaze org) get separate keys per product.

**Exit criteria:** production smoke suite green, first paying-customer path verified end-to-end, rollback tested.

---

## Dependency map (what FSAI carries with it)

| Layer | Source in PawsMemories | FSAI disposition |
|---|---|---|
| IFC parse/build | `blender-worker/ifc_worker` + `/api/bim/*` | Copy verbatim, remount |
| Rigging | `agent/graph/*`, bone maps, `startRig` | Copy, refactor input to subject profiles |
| Mesh generation | `tripo.ts` (Tripo/Meshy) | Copy; new API keys |
| Visemes/facial | `agent/graph/nodes/facialVisemes.ts` | Copy as optional add-on |
| Clip baking | `skeletal-clips*.js` (currently disabled) | Copy + re-enable behind flag |
| STL/print | `prepare_print_stl`, slant3d.ts | Copy (optional vertical) |
| Jobs/credits | `generation_jobs` + reserve/commit/recovery | Copy pattern, new tables |
| Auth | `auth.ts` + hardening | Copy |
| Storage | `storage.ts` (Backblaze) | Copy; new bucket + keys |
| UI seeds | `BimModelBuilder.tsx`, AnimatorScreen, create-flow screens, model viewer | Port + restyle |
| Pet domain | triage, avatarPrompts, AR sim, Pawprints | Leave behind |
| vrcmg repo | Cloud Run video platform | Archive or relocate; not reused |
