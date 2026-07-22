# Pawsome3D Unified Platform Implementation Tracker

Updated: 2026-07-22  
Controlling design: `PAWSOME3D_PLATFORM_ARCHITECTURE_SPEC.md`
Execution scaffold: `BUILD_EXECUTION_SCAFFOLD.md`

This tracker records evidence, not agent claims. A phase is complete only after its exit criteria pass on the intended release commit and extracted deployment archive.

| Phase | Status | Current evidence | Remaining exit work |
|---|---|---|---|
| 0. Database and release stability | Complete | Node 24.18/npm 11.16; TypeScript clean; 767 tests: 766 pass, 1 unrelated opt-in Hostinger skip; 8/8 Phase 0 live MySQL tests; fail-closed build; exact-commit complete-file archive verifier | Release evidence: `phase-evidence/PHASE_0.md`; IFC remains pinned to the Render worker environment |
| 1. Asset registry | Not started | Existing storage and marketplace asset tables available for migration | Canonical assets/versions/relations, registration, accounting, reconciliation |
| 2. Multiview approval | Not started | Legacy dog turnaround and Tripo multiview code exist | Integrate active Create flow, high-resolution contract, immutable approval and optional retry |
| 3. Durable 3D build and verification | Not started | Tripo, Blender and partial validators exist | Durable attempts, authoritative post-mesh reports, correction/acceptance loop |
| 4. Rig, facial, accessories | Partial legacy foundation | Animator modules, optional rigging, viseme canonicalization, preview accessories | Deterministic species routing, actual facial fallback, production accessory GLBs/fitting/export |
| 5. Fur Bin showcase | Partial legacy foundation | Aggregated private library and model viewer | Asset-centric versions, publishing, tags/collections, marketplace link, accurate storage |
| 6. Stationery and fulfillment | Partial legacy foundation | Pawprints, Printful, Slant 3D flows | Managed high-resolution templates, server rendering, provider reconciliation and samples |
| 7. Wags subscription | Partial legacy foundation | Subscription/box/planner/delivery schema and services | Customer checkout UI, prepaid incentives, exactly-once entitlement/bonus tests |
| 8. Randy assistant | Partial legacy foundation | Procedural 3D head, Gemini chat, basic tours/actions | Production GLB/LOD, versioned module registry, grounded live context, action security |
| 9. Scaled shell and IFC | Partial foundation | Manual BIM, IFC import/export, dual checks | Image/text building lane, calibrated reconstruction, distinct shell/IFC acceptance |

## Cross-Cutting UI Track: Spatial Glow Light and Dark Modes

Status: Not started  
Controlling plan: `SPATIAL_GLOW_UI_IMPLEMENTATION_PLAN.md`  
Design sources: `liteDESIGN.md`, `darkDESIGN.md`

Implement the supplied light and dark Spatial Glow designs through shared semantic theme tokens and reusable components after Phase 0 release stability closes. The track includes Light, Dark, and System preferences; persisted selection without first-paint flashing; accessibility and performance gates; route-by-route migration; and visual regression coverage.

Mobile acceptance must treat the design documents' 16px margin as the minimum **visible clearance outside panel borders, shadows, and glows**. Use a normal fluid gutter of 20-24px plus safe-area insets, prohibit accidental document-level horizontal overflow, and verify bordered panels at 320px, 360px, 390px, and 430px viewport widths. Full details and exit criteria are maintained in the controlling plan.

## Phase 0 Checklist

- [x] Audit normal startup for destructive SQL; no automatic `DROP TABLE` or `TRUNCATE` found.
- [x] Bound MySQL pool settings and enable keepalive.
- [x] Add dependency readiness and pool shutdown.
- [x] Rethrow configured database initialization failures.
- [x] Guarantee `users.stripe_customer_id` in compatibility migration.
- [x] Repair marketplace digital checkout column contract.
- [x] Repair STL derivative persistence and compensating object cleanup.
- [x] Align manual print upload parser with the UI limit.
- [x] Guard and scope `clear-db.ts`.
- [x] Add and run representative legacy-schema migration test against live MySQL 8.4 (`tests/migrations_mysql_integration.test.mjs`, `tests/stl_concurrency_real.test.mjs`).
- [x] Introduce `schema_migrations` ledger, transition baseline (v001..015), v16 Stripe customer column, and v17 STL derivative active-only generated column unique constraint (`server/migrations/runner.ts`).
- [x] Add complete-file build/archive manifest, environment-file exclusion, fail-closed build chain, and shared extracted-archive verifier gate (`scripts/release-manifest-lib.mjs`, `scripts/generate-manifest.mjs`, `scripts/build-deploy-zip.sh`).
- [x] Run full TypeScript, JavaScript tests, and production build locally (767 total tests: 766 pass, 1 unrelated Hostinger opt-in skip; 8/8 Phase 0 MySQL tests; tsc and Vite+esbuild pass under Node 24.18.0).
- [x] Document IFC worker status (pinned environment `ifcopenshell==0.8.5` in Render container; local Python 3.14 lacks package).
- [x] Verify complete extracted archive file-set equality, SHA-256 checksums, commit, branch, schema version, engine, and clean/dirty state (`scripts/verify-release-directory.mjs`).

## Required Evidence Per Update

Record the branch and commit, changed files, exact verification totals, remaining risks, deployment/archive SHA, and manual checks. Keep worktree ownership disjoint when subagents are active. Do not mark later phases complete because similarly named older Animator phases exist.
