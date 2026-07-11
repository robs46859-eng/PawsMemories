# Pawsome3D — Status Update & Phase 6 Kickoff

**Date:** July 11, 2026
**Branch:** `main` (perf + Arkham presets committed, pushed, zipped, deploying)

## Where things stand

**Shipped this cycle (committed + pushed):**
- **Arkham scene presets** — 4 environment presets (Security Ops, Gymnasium, Infirmary, Approach Road) + 16:9 2048px assets, validated against `EnvironmentPresetSchema`. Cell Block + Prison Yard remain spec-only (need generated/HDRI assets).
- **Performance P0** — gzip compression middleware, immutable cache headers on hashed assets, `<model-viewer>` lazy-loaded instead of site-wide.
- **Performance P1** — `React.lazy` split of the three 3D-pulling surfaces (`AnimatorScreen`, `AvatarDashboard`, `RandyChat`); `three`/`r3f` vendor chunks; fixed the `placement.ts` mixed static/dynamic import warning.
  - **Result: initial JS 1,735 KB → 208 KB (491 → 52 KB gzipped), ~90% smaller.** three.js now loads only when a 3D screen opens.
- **Docs** — planning/analysis docs consolidated under `docs/`.

**Not yet started:** Phase 6.

## Phase 6 — what it is

A stabilization + pre-launch hardening pass (no new features). Full agent-ready plan: `docs/PHASE6_IMPLEMENTATION_PLAN.md`. Recommended order: **6.7 → 6.1 → 6.2 → 6.3 → 6.4 → 6.6 → 6.5**.

### Key discovery folded into Phase 6 (§6.7)
The 2 MB `music_room`/`living_room` bundle chunks are **not** app scene assets — they are the **IWER WebXR emulator** (`@iwer/sem` + `iwer` + `@iwer/devui`) that `@react-three/xr → @pmndrs/xr` bundles so AR can be faked on desktop. `createXRStore` defaults `emulate` to `'metaQuest3'`, so **every real user opening AR downloads ~4.7 MB they can't use.** Fix is one line per store: `emulate: import.meta.env.DEV ? "metaQuest3" : false`. This replaces the earlier (mistaken) "move rooms to runtime GLBs" idea — smaller, safer, bigger win.

### Biggest stability risk (§6.2)
Model-URL durability. Ephemeral Tripo URLs get persisted in several write-paths, guaranteeing future 404s. Concrete bugs found and documented (B1–B5 in the plan):
- Two paths upload **GLB bytes via the image uploader** (`uploadBase64Image`) → wrong MIME/folder.
- Three paths **persist the raw provider URL** (either as a no-rig fallback or a mirror-failure fallback).
- The correct template already exists at `POST /api/pets/:id/rig`.
Plus a dry-run backfill/repair job to fix already-broken rows.

## Immediate next actions
1. Hand `docs/PHASE6_IMPLEMENTATION_PLAN.md` + the agent prompt (`docs/PHASE6_AGENT_PROMPT.md`) to the coding agent.
2. Agent does **6.7 first** (isolated payload win, verify bundle drop), then **6.2** (404s hurt most under real traffic).
3. Each step: `tsc --noEmit` clean, `npm run test` + `npm run test:ar` green, commit on the Mac (`rm -f .git/*.lock` first — sandbox can't unlink `.git`).

## Open follow-ons (not launch-blocking)
Hero images → WebP/AVIF; Cloudflare CDN in front of Hostinger; `preconnect` to Backblaze; delete the 197 MB `deploy.zip` from the working tree. Tracked in `docs/WEBSITE_PERFORMANCE_IMPROVEMENTS.md`.
