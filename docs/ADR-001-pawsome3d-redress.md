# ADR-001: Pawsome3D Redress — Navigation, BIM Relocation, Optional Rigging

**Status:** Accepted
**Deciders:** Robert Smith

## Context

The Phase 2 create-to-print update (`3dd45be`..`7387e9d`) gated Furball3D, Animation Studio, and Fido's Styles behind `UnderConstructionLock`. Collateral effects: the BIM builder became unreachable (it lived inside AvatarDashboard), the sidebar "Animate" entry dead-ends into a lock screen, Store/AR routes point at the locked screen, the animator CI test was rewritten to accept the lockout, and the product sells "Rigged 3D Avatar (80 PupCoins)" while the create flow ships only unrigged static GLBs.

## Decision

1. **BIM leaves pawsome3d.** BIM/IFC becomes the flagship of fsai.pro (see `FSAI_ARCHITECTURE_SPEC.md`). Pawsome3d removes BIM UI affordances and points users to fsai.pro. Backend `/api/bim/*` endpoints stay mounted (harmless, still used by admin/tests) until FSAI is live.
2. **No dead-end navigation.** Any nav entry whose destination is a lock screen is removed or re-pointed at the Create flow. Lock screens remain only as deep-link fallbacks.
3. **Rigging becomes an explicit paid option on the create flow** (checkbox +35 = published 80 total; facial checkbox +20), executed by the existing agent orchestrator + blender-worker pipeline as a post-mesh stage, guarded by automated rig-quality checks (neck sag, face contortion, limb misalignment, twist collapse, foot contact, weight hygiene) with gravity-based validation at 9.8 m/s². Rig failure after retry falls back to the static model and refunds only the add-on.
4. **CI must protect gated modules.** Integrity assertions for animator/lipsync sources are restored so gating can never silently become deletion.

## Options considered (rigging execution)

**A — Rig in the create-flow poller via existing orchestrator (chosen):** reuses proven pipeline and worker; no new services; failure isolation via `done_static_fallback`. Con: couples poller latency to Blender availability — mitigated by async job status (`rigging`/`validating`) already modeled.
**B — Re-enable legacy Furball3D screen instead:** no new wiring, but resurrects a UI slated for replacement and keeps two parallel creation flows. Rejected.
**C — External rigging API (e.g., provider auto-rig):** less control, no custom guards, recurring cost. Rejected.

## Consequences

- Easier: one creation flow sells static and rigged models honestly; worker guards are shared with FSAI (`physics_validate` built once).
- Harder: poller gains a second stage (mesh → rig) and a partial-refund path; worker load increases per rigged order.
- Revisit: re-enabling Animation Studio (consumes rigged models + visemes) and skeletal clip baking once rig quality holds in production.
