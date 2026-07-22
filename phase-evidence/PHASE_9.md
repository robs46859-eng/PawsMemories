# Phase 9 Evidence: Calibrated Shell and IFC BIM

Status: Durable server code complete; production/UI integration blocked
Branch: `fix/text-mode-reference-screen`
Release commit: recorded by the generated `release-manifest.json`
Feature flags: `BIM_V2_ENABLED=false`, `VITE_BIM_V2_ENABLED=false`
Worker: Render with IfcOpenShell 0.8.5 and NumPy 2.2.1
Migration: 29

## Implemented Contract

- Calibrated text/multi-image proposals separate observed views from synthesized hypotheses and require trusted measurements, user-reviewed assumptions, and strict model relationships.
- Deterministic pre-build and post-build reports bind model, calibration, report, and output hashes. Shell is a lower-cost visual claim; IFC is at least four times the Shell price and must earn semantic evidence.
- Durable jobs/attempts provide owner-scoped idempotency, bounded retry, cancellation, explicit acceptance, leases, canonical private artifact registration, compensation cleanup, and truthful credit debit/refund/reconciliation.
- The authenticated HTTPS IFC worker validates bounded IFC/GLB/JSON output, IFC signature/reopen evidence, units, finite placements, hierarchy, unique GlobalIds, property sets, openings/fills, semantic sidecar, and conversion report.

## Automated Evidence

| Gate | Result |
|---|---|
| Focused Randy/BIM tests | 60/60 PASS (46 BIM, 14 Randy) |
| Migration 29 MySQL integration | PASS |
| TypeScript | PASS |
| Full Node suite under Node 24.18 | 1,031 pass / 0 fail / 3 optional skips |
| Production build | PASS; 59 release files |

## Remaining Exit Work

- Persist and resolve the exact server-approved accepted model snapshot for durable work; the production service must not trust a caller-reconstructed model.
- Add a real authenticated Shell worker. Current durable Shell processing fails closed rather than fabricating GLB output.
- Switch `BimModelBuilder` from the legacy synchronous build route to durable enqueue/status/accept/download flow.
- Run credentialed Gemini fixtures, Render rotated/unit/two-room IFC fixtures, private downloads, debit/refund failures, and the full light/dark mobile browser matrix.

Decision: merge/deploy default-off; do not mount or enable the durable BIM production path until accepted-model and Shell-worker blockers close.
