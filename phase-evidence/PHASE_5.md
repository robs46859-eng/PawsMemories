# Phase 5 Evidence: Fur Bin Library and Showcase

Status: Server foundation corrected; not signed off
Branch: `fix/text-mode-reference-screen`
Release commit: `TBD`
Feature flag: `FUR_BIN_V5_ENABLED` (server-authoritative, default `false`)
Migration: 24

## Review Decision

The agent implementation was not acceptable as complete. Internal registration trusted caller-supplied numeric asset IDs, storage totals, dimensions, and rig/facial badges; signed viewing used an administrator bypass; any authenticated user could moderate; pending or unpublished showcase records could be returned as public; and no V5 product UI was integrated.

The correction pass closes those fail-open boundaries while retaining the schema and service foundation.

## Corrected Foundation

- Migration 24 uses canonical `BIGINT` IDs and owned composite asset/version foreign keys.
- One active item is enforced per owner/canonical asset.
- Registration accepts asset UUID plus version number, verifies ownership/status, and ignores client capability assertions.
- Storage totals are recomputed from immutable canonical versions instead of trusting request values.
- Search is owner-scoped and supports tags, capability fields, pagination, and owner-checked collections.
- Rollback locks the item and verifies the target version belongs to the same asset.
- Signed URLs are generated with owner authorization and no administrator bypass.
- Publishing locks the item, requires a separate public/published derivative, binds one immutable version, and enforces commercial eligibility.
- Public reads require `approved`, a publish timestamp, and no unpublish timestamp.
- Moderation requires a database-backed administrator check, row lock, allowed transition, and audit history.
- Collection create/add and public showcase read routes were added.

## Verification

| Gate | Result |
|---|---|
| TypeScript (`npm run lint`) | PASS |
| Combined Phase 4/5 focused tests | 28/28 PASS, 0 skips against isolated MySQL databases |
| Full repository suite (Node 24.18.0) | 871 total: 868 PASS, 0 fail, 3 unrelated opt-in skips |
| Production build | PASS; 57-file release manifest generated |
| Animator doctor | PASS; optional Rhubarb warning only |
| Live private/public object storage | NOT RUN |
| Responsive V5 browser UI | NOT IMPLEMENTED |

## Remaining Exit Work

- Build the responsive private library and public showcase UI against `/api/fur-bin` with keyboard, reduced-motion, static fallback, and mobile GPU limits.
- Add a migration/compatibility adapter from the legacy union-backed Fur Bin screen.
- Derive dimensions and capability badges from canonical measured manifests and lineage.
- Implement creation of a separate public derivative and cover asset; never publish private source storage.
- Bind marketplace listings and purchased downloads to immutable deliverable versions.
- Add archive/delete compensation, tag maintenance, collection listing/removal, covers, history, stale signed-URL refresh, and exact owner storage aggregation.
- Run MySQL race/isolation tests, public/private guessed-UUID tests, live storage expiry tests, and the browser matrix.

## Exit Decision

Decision: `BLOCKED - KEEP FEATURE FLAG OFF`

Phase 5 has a corrected server foundation but lacks required product integration and external verification.
