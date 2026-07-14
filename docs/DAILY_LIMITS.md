# Paid Operation Daily Limits

The paid operations covered by this launch phase use the shared `PaidEndpoint`
configuration and call `db.reservePaidUsage` before invoking their providers.
Reservations are atomic across the per-user and global counters. A denied
reservation changes neither counter.

The image-generation row covers the older Gemini/Imagen-backed memory,
scene-background, avatar-reference, and text-to-reference workflows. One
reservation represents one logical request, including its bounded model
fallback chain and (where applicable) the avatar turnaround calls. Avatar
creation also takes a separate `model_3d` reservation before it starts Tripo.

Non-AI storage uploads, weather/maps/community lookups, and legacy background
workers remain outside this provider budget because they do not directly invoke
the image/video/3D providers covered here. Any new paid provider route must be
added to `PaidEndpoint` before it is enabled.

## Launch defaults

All request counters reset on the database's UTC day. Cost values are integer
micro-USD, where 1 USD is 1,000,000 micro-USD.

| Endpoint | Enabled by default | User/day | Global/day | Estimate/call | Global cost/day |
| --- | --- | ---: | ---: | ---: | ---: |
| `classify` | yes | 10 | 100 | $0.02 | $2 |
| `semantic_scan` | yes | 20 | 200 | $0.02 | $4 |
| `rig` | no | 0 | 0 | $1 | $0 |
| `video` | yes | 2 | 20 | $1 | $20 |
| `talking_video` | yes | 1 | 10 | $2 | $20 |
| `model_3d` | yes | 2 | 20 | $1 | $20 |
| `image_generation` | yes | 5 | 50 | $1 | $50 |
| `pawprint` | yes | 3 | 50 | $0.10 | $5 |

`PETSIM_PAID_APIS_ENABLED` is the master switch. Per-endpoint switches are
`PETSIM_CLASSIFY_ENABLED`, `PETSIM_SEMANTIC_SCAN_ENABLED`,
`PETSIM_RIG_ENABLED`, `PETSIM_VIDEO_ENABLED`,
`PETSIM_TALKING_VIDEO_ENABLED`, `PETSIM_MODEL_3D_ENABLED`, and
`PETSIM_IMAGE_GENERATION_ENABLED`, and `PETSIM_PAWPRINT_ENABLED`. Rig must
remain `false` until separately approved.

Each endpoint also supports these limit suffixes after `PETSIM_<ENDPOINT>`:

- `_DAILY_CAP`: per-user request cap.
- `_GLOBAL_DAILY_CAP`: request cap across all users.
- `_ESTIMATED_COST_MICRO_USD`: positive reserved cost for one call.
- `_GLOBAL_DAILY_COST_MICRO_USD`: aggregate reserved-cost cap.

Request and aggregate cost caps accept zero. Estimated call cost must be
positive. All values must be safe integers; blank, negative, fractional,
unrecognized, and unsafe values fall back to the launch defaults. See
`.env.example` for every exact variable and default.

## Staging abuse check

Run this only against an isolated or quiet staging database whose schema has
already been initialized. Prepare an untracked `.env.staging` with the staging
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. The database name
must contain `test` or `staging`; the script refuses any other name.

Exact safe command from the repository root:

```sh
ABUSE_TEST_ACK=staging-only node --env-file=.env.staging --import tsx scripts/paid-usage-abuse.mjs
```

The script directly issues 24 concurrent `db.reservePaidUsage` calls for each
of three scenarios. It uses the type-valid `pawprint` endpoint and unique test
users, proves the user, global request, and global cost caps are not exceeded,
then deletes its users and subtracts exactly their count and cost reservations.
It never invokes a paid provider.

Expected successful result:

```text
[PASS] user cap: 3 allowed, 21 denied (user_cap).
[PASS] global cap: 4 allowed, 20 denied (global_cap).
[PASS] global cost cap: 3 allowed, 21 denied (global_cost_cap).
[CLEANUP] Removed 3 test users and 10 paid-usage reservations.
ABUSE TEST PASS: user, global, and cost caps were never exceeded.
```

A failed precondition exits with code 2 and starts with `ABUSE TEST REFUSED`.
Any assertion or cleanup failure exits nonzero and starts with
`ABUSE TEST FAILED`. Do not retry a cleanup failure blindly; inspect the named
staging database and remove only rows bearing the printed run identifier.
