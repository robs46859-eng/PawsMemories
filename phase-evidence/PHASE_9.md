# Phase 9 Evidence: Calibrated Shell and IFC BIM

Status: Calibration/verification foundation complete; durable release integration and external acceptance pending
Branch: `codex/phases-8-9`
Release commit: TBD
Feature flags: `BIM_V2_ENABLED=false` (server authority), `VITE_BIM_V2_ENABLED=false` (client presentation)
Worker: Render, IfcOpenShell 0.8.5, NumPy 2.2.1

## Implemented Contract

- Text proposals require a bounded description and trusted measurement. Image proposals require at least two real decoded JPEG/PNG/WebP views; each claimed observed view must have bytes, while synthesized views are tracked only as hypotheses.
- Gemini receives a high-authority anti-injection instruction. Its output must pass strict Zod, BIM relationship validation, and calibrated dimensional verification before appearing as an editable proposal.
- A generated proposal never authorizes a paid build. The user reviews it and runs an independent pre-build server gate; the server repeats that gate immediately before charging.
- Shell costs 60 credits and is labeled a scaled visual GLB without BIM semantics. IFC costs 300 credits and is labeled semantic IFC4 only after its stronger gate passes.
- Before and after reports contain deterministic hashes, trusted dimensions, per-axis tolerances, visible/inferred/unknown facts, and explicit limitations.
- IFC post-build checks schema reopen, unit scale, finite placements, element and unique-GlobalId counts, storeys, property sets, spatial hierarchy, void/fill relationships, semantic GLB conversion, and optional CRS-label preservation.
- A CRS label does not claim surveyed easting, northing, elevation, rotation, engineering adequacy, or code compliance.
- Refund responses no longer claim success if the automatic credit return fails; they expose a pending disposition.

## Automated Evidence

| Gate | Result |
|---|---|
| TypeScript | PASS |
| New Phase 9 tests | 14/14 PASS |
| Focused AI/BIM plus existing BIM/pricing regressions | 105/105 PASS |
| Python syntax compilation | PASS |
| Post-rebase full Node suite under Node 24.18 | 889 pass / 892 total / 3 opt-in skips / 0 failures |
| Production build and manifest | PASS, 55 release files |
| Animator subsystem doctor | PASS; optional Rhubarb warning only |

## Remaining Exit Work

- Replace legacy public BIM artifact URLs with private object keys and owner-scoped short-lived signed downloads.
- Move paid BIM builds onto a durable idempotent job, credit-event, retry, and refund-reconciliation ledger. The current synchronous legacy route is not a Phase 9 production billing contract.
- Run the six Python worker tests in the pinned Render environment. Local Python 3.14.6 does not have IfcOpenShell.
- Run one real Gemini text fixture and one multi-image calibrated building fixture with human review of inferred elements.
- Download and independently inspect one shell GLB and one IFC4/semantic GLB pair.
- Exercise successful and failed/refund flows with test credits and durable storage.
- Complete light/dark browser tests at 320, 360, 390, and 430px plus desktop.
- Build the deployment archive only after integration with the active Phase 4-5 lane and final release commit.

Decision: The calibration/verification patch can be integrated default-off. Phase 9 is not code-complete or approved for production enablement until private storage and durable billing integration close.
