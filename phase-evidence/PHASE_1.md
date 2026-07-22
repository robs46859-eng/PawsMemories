# Phase 1 Evidence: Canonical Asset Registry and Storage Accounting

Status: Complete (Lead-corrected)
Branch: `fix/text-mode-reference-screen`
Start commit: `29fc88a5de9755e998da8b21fb83160ff4195970`
Agent closeout reviewed: `abed114ec88cdd3331ea8dcbe89552db09df86b1`
Release commit: the clean Phase 1 correction commit containing this evidence; the generated `release-manifest.json` is authoritative
Feature flag: `CANONICAL_ASSETS_ENABLED=false` by default, enforced in `server/assets/featureFlag.ts` before JWT-authenticated route access
Migration versions: 18-19

## Review Finding

The initial closeout report was not accepted as evidence. The router was mounted before JSON parsing, accepted caller-controlled `x-user-phone`, lacked the claimed feature flag, enforced mutation ownership only in selected routes, trusted raw object registration claims from normal users, and allowed cross-asset current-version pointers at the database layer. Its tests reproduced the spoofable header instead of production JWT authentication.

The lead correction fixed those gaps without editing applied migration 18. Migration 19 is the forward-only integrity correction.

## Corrected Contract

- All `/api/assets/*` routes are parsed, default-off, and protected by the existing JWT middleware.
- The client cannot select an identity through request headers.
- Raw storage registration and raw version ingestion are admin-only until a server-minted upload-confirm flow is introduced.
- Every service mutation requires explicit actor/admin or trusted-internal authorization; parent and child ownership are both checked for lineage.
- Asset rows are locked while selecting the next immutable version number or changing the current pointer.
- Concurrent legacy registration returns the single committed winner.
- Migration 19 enforces that `assets.current_version_id` belongs to the same asset and rejects self-lineage in MySQL.
- Signed-link path/query input is Zod-validated and TTL-bounded.
- Public storage URLs use the repository's virtual-hosted bucket convention; private objects continue to use short-lived signed URLs.
- Non-owner public metadata omits the owner's internal identifier and internal lineage IDs.
- `object_key` remains absent from public API metadata.

## Changed Files

| File | Reason |
|---|---|
| `.env.example` | Documents the server-only default-off canonical asset flag |
| `server.ts` | Mounts canonical routes after body parsing, feature enforcement, and JWT authentication |
| `server/assets/featureFlag.ts` | Server-authoritative default-off gate |
| `server/assets/routes.ts` | Removes spoofable identity, restricts raw writes, validates access input, and uses service authorization |
| `server/assets/service.ts` | Explicit mutation authorization, row-lock use, and concurrent idempotency recovery |
| `server/assets/repository.ts` | `SELECT ... FOR UPDATE` asset lookup |
| `server/assets/schemas.ts` | Coerced and bounded signed-access query schema |
| `server/assets/access.ts`, `storage.ts` | Correct public object URL construction |
| `server/assets/types.ts` | Privacy-safe optional owner field |
| `server/assets/legacyAdapters.ts` | Explicit trusted-internal mutation context |
| `server/migrations/runner.ts` | Migration 19 and authoritative schema version 19 |
| `tests/phase1_*.test.mjs` | MySQL, JWT, feature flag, ownership, malformed input, concurrency, and DB-integrity evidence |

## Automated Evidence

All commands used the package-required Node `v24.18.0` and npm `v11.16.0`.

| Gate | Command | Result | Skips |
|---|---|---|---|
| TypeScript | `npm run lint` | PASS, 0 errors | 0 |
| Phase 1 MySQL/JWT suite | `node --import tsx --test tests/phase1_*.test.mjs` | PASS, 27/27 | 0 |
| Complete test suite | `npm run test` | PASS, 786 passed, 0 failed | 3 pre-existing optional environment integrations |
| Production build | `npm run build` | PASS, Vite and server bundle | 0 |
| Whitespace | `git diff --check` | PASS | 0 |

## Integration Evidence

| Environment/fixture | Behavior exercised | Result |
|---|---|---|
| Homebrew MySQL 8.4 at `127.0.0.1:3306` | Fresh 18-19 migration, idempotent rerun, concurrent migration lock, immutable versions, composite current pointer, self-lineage check | PASS, 5/5 |
| Production asset service | Registration/versioning, owner denial, two-owner lineage denial, concurrent legacy idempotency, compatibility adapter | PASS, 7/7 |
| Express route integration | JWT identity, disabled flag, spoof-header denial, admin raw-write restriction, private owner isolation, malformed signed-link input | PASS, 8/8 |
| Accounting/reconciliation | Distinct object accounting, report/fix pointer drift, object-key non-disclosure | PASS, 3/3 |

## Release Artifact Rule

`pawsome3d-deploy.zip` is rebuilt only from the clean correction commit. Its commit, schema version 19, complete file count, and SHA-256 are generated outputs and are intentionally not embedded in this tracked file because doing so would make the archive self-referential and immediately stale. The release command and extracted verifier are:

```bash
bash scripts/build-deploy-zip.sh
```

## Exit Decision

- [x] Security and database review gaps corrected
- [x] Phase-specific MySQL/JWT tests pass with zero skips
- [x] Full TypeScript, test, and production-build gates pass
- [x] Tracker, scaffold, and handoff corrected
- [x] Phase 2 allocated migration 20 and prohibited from starting 3D before immutable approval

Decision: `SIGNED_OFF_LOCALLY_AFTER_CLEAN_ARCHIVE_GATE`
