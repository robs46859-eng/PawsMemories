# Phase 9 — Model Cap, Mobile GPU Fix & mypets.cc "Cold Storage" Warehouse

**Prepared:** July 2026
**Decisions (confirmed):** same DB + bucket across both domains · per‑site `DEPLOY_TARGET` env var · hard 5‑model cap now, cold‑storage/warehouse deferred.

## Architecture context
- **One repo, two Hostinger sites.** `pawsome3d.com` (manual zip upload) and `mypets.cc` (Hostinger Git auto‑deploy on push) run the **same codebase** and point at the **same MySQL DB + Backblaze bucket**.
- Because the data is shared, "moving a model to cold storage" is a **`storage_tier` flag on the `avatars` row** — no files move, no cross‑DB migration.
- The two sites are told apart by a per‑site env var: **`DEPLOY_TARGET=main`** (pawsome3d) / **`DEPLOY_TARGET=warehouse`** (mypets.cc).

---

## Phase 9a — SHIPPED THIS PASS

### 1. Mobile GPU fix (`Avatar3DPlaypen.tsx`)
**Cause:** the models grid rendered a live WebGL `<model-viewer>` for **every** avatar with a `model_url`. An admin profile with many models spun up N WebGL contexts at once → mobile GPU overload/crash.
**Fix:** on mobile (`isMobile()`), each card shows a **static poster** (`avatar.image_url`) with a "▶ Tap to load 3D" button; the live viewer mounts only for the card the user taps. Desktop is unchanged. Result: at most one `<model-viewer>` context at a time on mobile.

### 2. Hard 5‑model cap (`server.ts`, `POST /api/avatars`)
Non‑admin users may keep at most **`MODEL_CAP`** (default 5) models. Checked **before** any credit charge or generation work, so a capped user is never billed. Admins are exempt (they own the shared preset library). Returns `403 { code: "MODEL_CAP_REACHED" }` with a clear message.

### 3. Config
- `MODEL_CAP` (default 5) and `DEPLOY_TARGET` (default `main`) added to `.env.example` + `docs/HOSTINGER_ENV_VARS.md`.
- **Action for you:** set `DEPLOY_TARGET=warehouse` in the mypets.cc Hostinger env, `DEPLOY_TARGET=main` (or leave unset) on pawsome3d.com.

**Frontend cap UX (small follow‑up):** the Create‑Model dialog should read the `MODEL_CAP_REACHED` code and show "You're at 5/5 models — delete one to make a new one." (Server enforcement is already live; this is just a friendlier client message.)

---

## Phase 9b — DEFERRED: cold‑storage "warehouse"

When you're ready to build the mypets.cc experience:

1. **Schema:** add `storage_tier ENUM('active','cold') DEFAULT 'active'` to `avatars`. The 5‑cap counts only `active` rows; `cold` rows are unlimited and don't count.
2. **Offload endpoint:** `POST /api/avatars/:id/cold-store` flips `storage_tier='cold'` (one‑way — no bring‑back, per your spec). Frees an active slot.
3. **`DEPLOY_TARGET` gate:** the frontend reads the mode (expose it via `/api/me` or a `/api/config`). `main` → full app, hides `cold` models from the active grid. `warehouse` (mypets.cc) → a read/manage "cold storage" view listing the user's `cold` models with their GLB URLs to copy.
4. **Animator URL‑paste:** cold models remain usable via the existing animator "paste asset URL/ID" path (already built) — that's how a cold model gets into a scene without returning to the active roster.
5. **Guardrails:** since the bucket is shared, cold‑storing never deletes the GLB; it only changes visibility/counting. Document a retention decision if you ever want to prune truly‑unused cold GLBs.

---

## Verification (9a)
- `tsc --noEmit` clean (pre‑commit hook enforces).
- Run `npm run test` + `npm run test:ar` before pushing.
- Manual: on a phone, open the models grid on the admin profile → no crash, cards show posters, tapping one loads its 3D. As a non‑admin test user with 5 models, creating a 6th returns the cap message and does **not** deduct credits.
