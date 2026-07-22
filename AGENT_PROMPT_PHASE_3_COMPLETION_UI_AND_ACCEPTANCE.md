# Antigravity Prompt: Finish Phase 3 UI and Acceptance

Work in `/Users/robert/Desktop/claude7126/PawsMemories`. Read `AGENTS.md`, `SKILLS.md`, `BUILD_EXECUTION_SCAFFOLD.md`, `PHASED_IMPLEMENTATION.md`, `HANDOFF.md`, `phase-evidence/PHASE_3.md`, and `phase-evidence/PHASE_3_CHECKLIST.html` before editing. The lead correction in `HANDOFF.md` is authoritative. Do not revert uncommitted lead changes and do not begin Phase 4.

## Objective

Finish Phase 3 as a customer-usable, default-off vertical slice: approved multiview references -> quote -> explicit credit confirmation -> durable build -> progress/recovery -> verified GLB review -> retry or acceptance. Preserve server-authoritative authorization, billing, canonical identity, and state transitions.

## Required execution

1. Audit the current diff and run TypeScript plus `tests/phase2_*.test.mjs` and `tests/phase3_*.test.mjs`. Fix failures without weakening assertions.
2. Add the Phase 3 UI to the existing Create workflow using established app patterns. Show price and balance before charging; require explicit confirmation; show stable job state after refresh; handle cancellation, failure/refund, and retry; display validation metrics and signed GLB safely; require explicit hash-bound acceptance.
3. Add standard high-resolution review renders (front, rear, left, right, three-quarter) through the existing Blender worker boundary. Persist them as canonical private assets with lineage. Never fabricate evidence or mark a render complete without an actual artifact.
4. Add an advisory likeness comparison between approved Phase 2 views and standard renders. Label scores advisory, expose limitations, and never represent them as dimensional or identity proof.
5. Add adversarial tests for concurrent starts, retry charge/refund cycles, stale-lease recovery, restart from a persisted provider handle, artifact/lineage persistence failure cleanup, cross-owner access, malformed provider GLBs, external texture URIs, and hydrated public DTOs.
6. Test UI states with fake provider/storage first. If credentials are present, execute a real Tripo/private-storage sandbox run; otherwise record `BLOCKED: credentials absent` without claiming passage.
7. Verify light and dark themes plus widths 320, 360, 390, and 430px. Preserve visible border/glow clearance and prevent horizontal overflow. Capture evidence paths.
8. Keep `MODEL_BUILD_V3_ENABLED` and any client flag false by default. Do not expose object keys, provider secrets, raw internal IDs, or untrusted external URLs.
9. Continuously update `phase-evidence/PHASE_3_CHECKLIST.html` notes and comments, then update `phase-evidence/PHASE_3.md`, `PHASED_IMPLEMENTATION.md`, and `HANDOFF.md` with measured results only.

## Mandatory gates

- `git diff --check`
- `npm run lint`
- Phase 2 focused tests
- Phase 3 focused tests with zero skips
- complete `npm run test`
- `npm run build`
- `npm run animator:doctor`
- browser/mobile/accessibility review
- credentialed provider evidence or an explicit blocker

Stop before commit and report changed files, exact gate totals, evidence paths, remaining blockers, and risks. Do not claim Phase 3 complete unless every checklist item has verifiable evidence.
