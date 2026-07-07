# AR_PET_SIM_HARDENING_PLAN.md
# Pawsome3D AR Virtual Pet — Phased Production-Hardening Plan

**Version:** 1.0 · **Date:** 2026-07-06
**Companion to:** `AR_PET_SIM_SPEC.md` and `AR_PET_SIM_SCAFFOLD_PLAN.md`
**When to run:** after the scaffolding phases (AR1–AR9) reach functional parity. Hardening
phases H1–H8 can be interleaved, but H1 (tests/CI) should land early because every later
phase relies on it.

Test runner: repo built-in `node:test` (`node --test tests/*.test.mjs`).

---

## H1 — Test coverage & CI gate

- Extend `node:test` coverage: brain engine (done AR1), server endpoints (mocked LLM/Tripo/DB),
  breed-profile table integrity, navmesh cost math, phonetic matching.
- Add a CI workflow (`.github/workflows/ci.yml`): `npm ci` → `npm run lint` (tsc --noEmit)
  → `npm test` on every push/PR. Block merge on red.
- Add deterministic seeds for all randomness (utility noise, sampling) so tests are stable.
- Contract tests for each API route: shape in / shape out via zod schemas shared client+server.

**Exit:** green CI required to merge; coverage baseline recorded.

---

## H2 — Input validation & abuse limits

- zod-validate every request body AND every external response (LLM JSON, Tripo task payloads)
  before use — never trust upstream shape.
- Rate-limit the expensive endpoints (`/classify`, `/rig`, `/semantic-scan`) per-user with
  `express-rate-limit` (already a dep); separate stricter bucket for LLM/Tripo calls.
- File/upload guards: max image dimensions + MIME allowlist on photo upload; max audio blob
  size on button recordings.
- Reject oversized GLBs at bake-lod (already budgeted) AND at serve time.

**Exit:** malformed/oversized/hostile inputs return 4xx, never crash or reach a paid API.

---

## H3 — Auth & data isolation

- Every `/api/pets/:id/*` route verifies the JWT subject owns `avatar_id` behind the pet
  (row-level ownership check, not just "logged in").
- Semantic scans, commands, buttons scoped to `user_id`; no cross-tenant read.
- Signed, expiring B2 URLs for GLBs and audio blobs; no public bucket listing.
- Audit the existing admin account (`robs46859@gmail.com`) path — ensure avatar ownership
  checks don't silently grant admin everywhere.

**Exit:** an authenticated user cannot read or mutate another user's pet data (tested).

---

## H4 — AR performance & memory

- Enforce the §9/AR9 budget in code: reject render if GLB > 4 MB / > 30k tris / > 40 bones.
- Dispose three.js textures, geometries, materials, and render targets on AR session end
  (the doc's "volumetric cleanup" analogue); verify with a heap-growth test across
  open/close cycles.
- Throttle per-frame work: IK solve + navmesh queries off the hot path or capped Hz;
  semantic scan cached per anchor (never per frame).
- Target FPS ≥30 on a mid-range Android; capability-detect and degrade (occlusion→shadows,
  lighting→luminance) silently.

**Exit:** 10 open/close cycles show no monotonic memory growth; FPS target met on reference device.

---

## H5 — External-dependency resilience

- **Tripo:** timeouts, bounded retries with backoff, task-poll ceiling; on rig failure the
  avatar keeps the current (unrigged) path via feature flag — never a dead pet.
- **OpenRouter vision LLM:** retry-once at temp 0 (spec), then graceful fallback
  (size_class defaults for classify; empty/again-later for semantic scan). Log for review.
- **8th Wall engine binary:** PIN the version, self-host on B2 (CDN longevity risk per §9);
  add an integrity check (hash) on load.
- **B2:** upload retries; handle partial/failed uploads without corrupting a `pet_profiles` row
  (write URL only after confirmed upload).
- Circuit-breaker + user-visible "try again" states for each.

**Exit:** each upstream can be down/slow without corrupting data or hanging the client.

---

## H6 — Observability

- Structured logs with request id + user id (no PII in message bodies) around every external
  call, with latency + outcome.
- Counters: classify calls, rig jobs, semantic scans, LLM tokens, Tripo tasks — per day/user.
- Error reporting on the AR canvas (error boundary → report) and server unhandled-rejection trap.
- A lightweight `/healthz` covering DB, B2 reachability, and worker liveness.

**Exit:** every paid call and every failure is traceable from a single request id.

---

## H7 — Cost controls

- Cache aggressively: semantic scans per anchor hash (spec §6.4); breed classify result
  persisted on `pet_profiles` (never re-classify the same photo).
- Budget guards: per-user daily caps on classify/rig/scan; global kill-switch env flag for
  each paid API.
- Prefer the free vision model (Nemotron Nano VL) first; only escalate model on validation
  failure.
- Alert when daily LLM/Tripo spend crosses a threshold.

**Exit:** a single user cannot run up unbounded LLM/Tripo/B2 cost; spend is visible and capped.

---

## H8 — Privacy, permissions & sensitive-data handling

- Camera + microphone: explicit permission prompts with clear purpose; features degrade to
  buttons if denied (spec §7.2). Never record without a user gesture.
- Camera frames for semantic scan / lighting are processed transiently — store only the
  derived zone polygons, not raw frames; document retention.
- Voice: store phonetic keys + optional short audio blobs only with consent; allow delete.
- Aging/mortality OFF by default; on death, memorial album entry — NEVER delete pet data
  (spec §4.6); provide user-initiated export/delete for their own data.
- Privacy note / consent copy for camera, mic, and photo upload.

**Exit:** permissions are explicit and revocable; no raw camera/audio retained beyond need;
user can export and delete their data.

---

## Suggested ordering

H1 → H2 → H3 early (foundational). H4 alongside AR4–AR9 rendering work. H5/H7 alongside the
paid-API phases (AR2, AR3, AR6). H6 continuous. H8 before any public/beta exposure.
