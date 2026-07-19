# Deployment Review — 3D Model Automation & Module Impact Audit
**Date:** 2026-07-19 · **Deployment reviewed:** `pawsome3d-deploy.zip` (built Jul 18 15:03, matches git HEAD `7387e9d`)

---

## 1. What the recent major update was

The update is the **Phase 2 "3D Create-to-Print Pipeline"** (`3dd45be`, Jul 18 11:33) plus 10 follow-up commits the same day:

| Commit | Purpose |
|---|---|
| `3dd45be` | Phase 2: Create-to-Print pipeline (new Create flow, HomePage, Marketplace, **UnderConstructionLock gating**) |
| `0fc0dd9`–`b7643f9` | Integration test schema + recovery idempotency fixes |
| `ec01ea0` | Create flow auth token fix |
| `88d7ca7` | Model job finalization + streak claims fix |
| `bcde4af` | Truncated pipeline validation state fix |
| `289004b` | Unified model library + Treatstock checkout + **new `prepare_print_stl` in blender-worker** |
| `bcea686` | Slant 3D + Printful fulfillment (also touched `src/pawprints/collageEngine.ts`) |
| `2050d09` | Fulfillment readiness hardening (also touched `server/hermes/app.ts`) |
| `edebd5f`, `7387e9d` | Shipment tracking + read-only fulfillment diagnostics |

Total: ~5,270 insertions across 49 files. The built `dist/` bundle in the deploy zip contains the gated UI (verified in `dist/assets/index-CAL0_2HA.js`), so **everything below describes what is live**.

---

## 2. What happens when you click Generate

There are now **two generation pipelines**. Only the new one is reachable from the UI.

### A. New Create-to-Print flow (the one users get)

```
CreateScreen → CreateReferenceScreen → CreateCustomizeScreen → CreateValidateScreen → CreateCheckoutScreen
```

1. **Generate reference** — `POST /api/create-pipeline/generate-reference` (server.ts:4405). Calls `generatePetReferenceImage()` (Gemini image gen, avatarPrompts.ts) to produce a candidate reference image; uploads it to Backblaze; creates/updates a `create_pipeline_sessions` row (status `reference_ready`). No PupCoins charged at this step.
2. **Customize/Validate** — `POST /api/create-pipeline/update` (server.ts:4489). Stores customization + validation state; an MD5 hash of the customization state is embedded in the validation state so stale validations are rejected. Model must pass `isPrintable`.
3. **Approve (the paid "Generate model" click)** — `POST /api/create-pipeline/approve` (server.ts:4528):
   - Reserves PupCoins with an idempotency key (`reservePipelineSessionForBuild`)
   - Calls `startImageTo3D()` in **tripo.ts** (Tripo, Meshy handle stored as `meshy:`-prefixed `operation_name`)
   - Commits a `generation_jobs` row (kind `model`); failure after the provider call escalates to `recovery_required` instead of refunding (prevents free models)
4. **Completion** — the shared background poller + `/api/.../status` branch (server.ts:~4962/~5107) calls `pollImageTo3D()`; on done it uploads the **raw GLB straight from Tripo to Backblaze** (`uploadBinaryFromUrl`), sets `creation.model_url`, and sends an SMS.
5. **Print path** — `/api/print/slant3d/checkout`, Printful/Treatstock routes → **blender-worker** `POST /prepare-print` → bridge `import_glb` + new `prepare_print_stl` (tcp_server.py): joins meshes, scales to a 25–300 mm target height, triangulates, checks non-manifold edges/degenerate faces, exports STL.

### B. Legacy Furball3D avatar flow (backend alive, UI locked)

`POST /api/avatars` (server.ts:2148) → triage (`server/imageTriage.ts`) → turnaround/multiview generation → Tripo → status poller (server.ts:2498) → on mesh completion spawns the **agent build pipeline** `runBuildPipeline()` (`agent/graph/orchestrator.ts`): import into Blender (blender-worker TCP bridge) → perceive/reason/act (rigging) → visual verification against the original photo → finalize. Static objects skip rigging by design.

---

## 3. Is rigging occurring?

**Not for anything generated through the current UI.**

- **New Create flow: no rigging at all.** The GLB from Tripo/Meshy is uploaded verbatim. There is no Blender pass, no armature, no skeleton, no blendshapes. It is a print-oriented static mesh (the pipeline even requires `isPrintable`).
- **Legacy avatar flow: rigging code is intact** (orchestrator → blender-worker, bone maps `bonemap.json` / `bonemap.human.json`, human rig hints, `startRig` in tripo.ts) — but the only UI entry point (`Screen.MODELS` / Furball3D) now renders `UnderConstructionLock` ("The legacy Furball3D builder is offline while we migrate to the new create-to-print workflow"), so **no user can trigger rigging**.
- Independently of this update, **skeletal clip baking (the 15 clips) was already disabled** — server.ts explicitly notes: *"Skeletal clip baking (Phase 5) is intentionally disabled… avatars now ship as static, clip-free GLBs. In-app procedural motion (AvatarModel.tsx) is unaffected."*

So: rigging automation exists and is wired end-to-end, but it is **dormant** in the deployed product.

## 4. Does the model have lip-sync capability?

**The capability exists in three layers; none is currently reachable, and new models lack the prerequisite blendshapes:**

1. **Build-time visemes** — `agent/graph/nodes/facialVisemes.ts` injects `viseme_A…viseme_X` blendshapes (with jaw-fallback if no face mesh) during legacy avatar finalize (`act.ts:795`, `finalize.ts:20`; contract recorded as `facialVisemeContract: "viseme_A..viseme_X"`). Commits `895bcda`/`5b5ba7c` added this and fixed synthetic-viseme mesh deformation. **Only legacy-path models get these. New Create-flow GLBs have no visemes.**
2. **Server lip-sync service** — `server/animator/lipsync.ts` (Rhubarb-based viseme tracks with caching + post-processing) exposed at `POST /animator/lipsync`, `/lipsync`, `/animator/speech-preview`, `/scenes/voiceover` — all still mounted in server.ts (line 601) and functional.
3. **Client live speech** — `src/animator/speech/liveSpeech.ts` / `speak.ts`, consumed by `AnimatorScreen.tsx`.

**However:** the Animation Studio (`Screen.ANIMATOR`) is now gated behind `UnderConstructionLock` ("coming soon"), so users cannot reach lip-sync. Even after unlocking, models generated by the new flow would need a Blender viseme pass before they can lip-sync.

## 5. Can it still do IFC parsing?

**Backend: yes, fully intact. Frontend: no — the UI was collaterally locked out.**

- All `/api/bim/*` endpoints are unchanged: `import-ifc` (462), `preflight` (473), `build` (480, shell + IFC4 modes with pre/post-build verification, GlobalId + dimension-tolerance checks), `builds` (565); `export-ifc` returns 410 by design.
- `blender-worker/ifc_worker/ifc_worker.py` (IfcOpenShell) untouched since the BIM phases 0–3 commits; the bridge (`convert-ifc` path in blender-worker/server.js:305) still calls it. The only blender-worker change in this update was **additive** (`prepare_print_stl`).
- **But** `BimModelBuilder.tsx` is rendered only inside `AvatarDashboard.tsx`, and `3dd45be` **removed `<AvatarDashboard>` from App.tsx** (Screen.MODELS → UnderConstructionLock). The BIM builder is therefore unreachable in the deployed app.

---

## 6. Modules affected that were "not supposed to be" affected

| Module | Change | Assessment |
|---|---|---|
| **App.tsx screen gating** | Furball3D (`Screen.MODELS`), Animation Studio (`Screen.ANIMATOR`), Fido's Styles (`Screen.PAWLISHER`) all replaced by `UnderConstructionLock` | The single biggest side-effect. Locks out rigging, lip-sync/animator, **and (collaterally) the BIM/IFC builder**, since AvatarDashboard was the only host of BimModelBuilder |
| `tests/animator_handoff.test.mjs` | Rewritten to assert the animator is *gated* rather than *functional* | Tests were changed to match the lockout, so CI will not flag it |
| `server/imageTriage.ts` + `avatarPrompts.ts` | `subjectClass` enum widened from `human/dog/object` to 10 classes (`ExtendedSubjectClass`) | Shared with the legacy avatar pipeline — behavior of legacy triage changes when re-enabled; low risk but untested against the legacy path |
| `src/shellNavigation.ts` | Furball3D and Fido's Styles removed from top nav; Create + Marketplace added; Animate stays in sidebar (but leads to a lock screen) | Intentional per TerraPaw remodel, but Animate now navigates to a dead end |
| `blender-worker` (bridge + server.js) | New `prepare_print_stl` method + `/prepare-print` route | Additive only; rig/IFC/export paths untouched |
| `server/hermes/app.ts` | Store falls back to an "unavailable" stub when DB not ready | Defensive hardening; no functional regression |
| `src/pawprints/collageEngine.ts` | 4 new layouts (polaroid, triptych, magazine, panorama) | Additive; mosaic branch restructured but existing layouts preserved |

**Bottom line:** no module was *deleted or broken* — the animator, rig pipeline, and BIM code are all present and the backends still respond — but the Phase 2 commit intentionally gated three whole product areas in the UI, and that gating **silently took the BIM/IFC builder down with it** because it lived inside the Furball3D dashboard. The animator test suite was rewritten to accept the gate, so nothing failed.

---

## 7. Full frontend → backend mapping (as deployed)

| UI surface | Endpoint(s) | Backend service |
|---|---|---|
| Create flow (reference) | `POST /api/create-pipeline/generate-reference` | Gemini image gen → Backblaze |
| Create flow (customize/validate) | `POST /api/create-pipeline/update` | MySQL `create_pipeline_sessions` |
| Create flow (checkout/generate) | `POST /api/create-pipeline/approve` | Tripo/Meshy via tripo.ts → `generation_jobs` → poller → Backblaze GLB |
| Model library | `GET /api/models/library` | Unified: pipeline models + legacy avatars |
| Print checkout | `POST /api/print/slant3d/checkout`, printful/treatstock routes, `GET /api/print/orders[/…/status]` | server/slant3d.ts, server/printful.ts, fulfillmentReadiness/Tracking → blender-worker `/prepare-print` (STL) |
| Pawprints | `/api/pawprints/*` | collageEngine + Printful products |
| 🔒 Furball3D (locked) | `POST /api/avatars`, `GET /api/avatars/:id/status`, `/retry` | Triage → Tripo → agent orchestrator → blender-worker (rig + visemes) |
| 🔒 Animation Studio (locked) | `/animator/*`, `/scenes/*`, `/lipsync`, `/rig`, `/retarget` | server/animator (Rhubarb lip-sync, jobs, worker) + studio FastAPI proxy (port 8001) |
| 🔒 BIM builder (collaterally locked) | `POST /api/bim/import-ifc`, `/preflight`, `/build`, `GET /api/bim/builds` | blender-worker bridge → ifc_worker.py (IfcOpenShell, IFC4) |

Deployment topology is unchanged: main app on Hostinger, blender-worker on Render (shared `WORKER_SHARED_SECRET`), media on Backblaze, DB on the legacy MySQL instance.

---

## 8. Recommendations

1. **Decide whether the BIM lockout was intended.** If not, mount `BimModelBuilder` on its own screen (it does not depend on the avatar dashboard) — the backend is ready today.
2. Remove or redirect the sidebar **Animate** entry while the studio is locked (currently a dead end).
3. If new Create-flow models will ever animate or lip-sync, add a Blender post-pass (rig + `facialVisemeBpyScript`) — the worker already supports it via `import_glb`/`execute_bpy`.
4. Re-run the legacy avatar triage against the widened `ExtendedSubjectClass` enum before unlocking Furball3D — that shared change is untested on the legacy path.
5. The rewritten `animator_handoff` test now enforces the lock; when unlocking, restore the original assertions so regressions surface.
