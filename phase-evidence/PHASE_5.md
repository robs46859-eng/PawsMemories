# Phase 5 Evidence: Fur Bin Library and Showcase

Status: Code complete; external acceptance pending
Branch: `fix/text-mode-reference-screen`
Release commit: recorded by the generated `release-manifest.json`
Feature flags: `FUR_BIN_V5_ENABLED=false`, `VITE_FUR_BIN_V5_ENABLED=false`
Migrations: 24 and 26

## Implemented Contract

- Owner-scoped private library API and responsive V5 UI support search, measured filters, collections, signed viewing, rollback, archive, history, storage totals, and explicit loading/empty/error states.
- Capability badges are derived from canonical measured evidence and immutable version events, not client claims.
- Publishing requires a separate commercial-eligible public/published derivative. Private source bytes and storage identities never enter public DTOs.
- Publication and moderation are state-checked, hash-bound, append-only events; public reads expose only approved current publications.
- The client refreshes expired signed URLs, distinguishes private source from public derivative, supports reduced motion/static fallback, and preserves mobile outer gutters.

## Automated Evidence

| Gate | Result |
|---|---|
| TypeScript | PASS |
| Phase 5 tests | 18/18 PASS |
| Full Node suite, Node 24.18 | 1,031 PASS / 0 fail / 3 optional skips |
| Production build | PASS; 59 release files |

## Remaining Exit Work

- Run live B2 private/public signed-URL expiry, unpublish, rollback, and publication-race checks.
- Complete keyboard, screen-reader, reduced-motion, weak-GPU, and light/dark browser review at 320/360/390/430px and desktop.
- Verify marketplace purchases remain bound to the immutable published deliverable version.

Decision: merge/deploy default-off; do not enable until storage and human browser gates pass.
