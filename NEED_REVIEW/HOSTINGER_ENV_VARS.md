# Hostinger Deployment — Environment Variables

Set these in the Hostinger **Node.js app → Environment variables** panel (not in a committed `.env` — `.env` is gitignored and not in the deploy zip). Full annotated reference: `.env.example`.

Runtime: select **Node.js 24 LTS**. The repository pins `24.18.0` in
`.nvmrc` and rejects Node 25 so native dependencies are installed for the same
runtime used to start the application. Use `npm install`, `npm run build`, and
`npm start` after changing the runtime; do not reuse `node_modules` from another
Node major version.

**Two timing rules:**
- `VITE_*` vars are **baked into the frontend at `npm run build`** — they must exist *before* the build runs, not just at server start.
- Everything else is read at **server start** (`npm start`). Changing one requires a restart.

---

## 1. REQUIRED — app will not function without these

| Var | Purpose | If missing |
|---|---|---|
| `JWT_SECRET` | Signs session tokens (use a long random string, ≥16 chars, not the placeholder) | Server refuses to boot / all logins fail |
| `DB_HOST` | MySQL host — use `127.0.0.1` on Hostinger (not `localhost`) | No database → no users/creations |
| `DB_NAME` | MySQL database name | Same |
| `DB_USER` | MySQL user | Same |
| `DB_PASSWORD` | MySQL password | Same |
| `ADMIN_EMAIL` | Admin login email (upserted on boot) | No admin → can't fulfill requests / direct-generate |
| `ADMIN_PASSWORD` | Admin login password | Same |
| `ADMIN_KEY` | Internal admin row key (any short string, e.g. `admin`) | Admin flag won't attach |
| `GEMINI_API_KEY` | Image + text AI (avatars, classify, Randy) | Image generation + chat fail |
| `TRIPO_API_KEY` | Image-to-3D + auto-rig | **All 3D model generation fails** |
| `MEDIA_BUCKET_NAME` | Object storage (Backblaze B2 / S3) bucket | Uploads fail → GLB/video/audio 404s |
| `MEDIA_BUCKET_URL` | Bucket S3 endpoint | Same |
| `MEDIA_BUCKET_KEY` | Bucket access key | Same |
| `MEDIA_BUCKET_SECRET` | Bucket secret key | Same |
| `BLENDER_WORKER_URL` | Render Blender microservice URL | Rigging / clip baking fail |
| `WORKER_SHARED_SECRET` | Shared secret — **must match the Render worker exactly** | Every worker call 401s |
| `APP_URL` | `https://pawsome3d.com` — Stripe redirects + SMS links | Broken checkout redirects / links |
| `STRIPE_SECRET_KEY` | Stripe API (`sk_live_…`) | Credit + album purchases fail |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhooks (`whsec_…`) | Payments never confirm |
| `VITE_GOOGLE_MAPS_API_KEY_BROWSER` | Frontend Maps (baked at build) — referrer-restricted | Location picker map won't load |
| `GOOGLE_MAPS_API_KEY_SERVER` | Server Street View / Places / Weather — **unrestricted or IP-restricted** | Backdrops, landmarks, nearby parks fail |

> Keep the two Google keys separate — never expose the server key to the browser.

---

## 2. RECOMMENDED — features degrade without them

| Var | Purpose | If missing |
|---|---|---|
| `HEYGEN_API_KEY` | Talking-pet video + animator voiceover | Voiceover/talking video disabled |
| `HEYGEN_DEFAULT_VOICE_ID` | Default HeyGen voice | Voiceover has no default voice |
| `TWILIO_ACCOUNT_SID` | SMS "your memory is ready" notifications | Fulfillment still works; SMS skipped |
| `TWILIO_AUTH_TOKEN` | " | " |
| `TWILIO_PHONE_NUMBER` | " | " |
| `NODE_ENV` | Set to `production` | Auto-detected via `dist/`, but set it anyway |

---

## 3. OPTIONAL — leave blank to use code defaults

| Var | Default / effect |
|---|---|
| `PORT` | `3000` (Hostinger often sets this itself) |
| `ALLOWED_ORIGINS` | Same-origin only if unset |
| `DATABASE_URL` | Alt to `DB_*`; not needed if `DB_*` set |
| `GEMINI_IMAGE_MODELS` | `gemini-3-pro-image,gemini-3.1-flash-image,gemini-2.5-flash-image` |
| `BIM_V2_ENABLED` / `VITE_BIM_V2_ENABLED` | `false` / `false` until credentialed IFC-worker and browser acceptance passes |
| `BIM_PROPOSAL_MODEL` | `gemini-2.5-flash` |
| `GEMINI_TEXT_FALLBACK_MODEL` | code default |
| `PETSIM_RIG_ENABLED` | `false` (AR auto-rig off) |
| `TRIPO_RIG_MODEL_VERSION` | `v2.0-20250506` |
| `PETSIM_PAID_APIS_ENABLED` / `_CLASSIFY_` / `_SEMANTIC_SCAN_ENABLED` | on |
| `PETSIM_CLASSIFY_DAILY_CAP` / `_RIG_` / `_SEMANTIC_SCAN_DAILY_CAP` | 25 / 5 / 50 |
| `ANIMATOR_WORKER_ENABLED` | enabled (`false` to disable) |
| `ANIMATOR_DATA_DIR` / `ANIMATOR_WORKER_CONCURRENCY` / `ANIMATOR_STALE_MS` | code defaults |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_HTTP_REFERER` / `OPENAI_X_TITLE` | only for the OpenAI-compatible multi-agent pipeline |
| `TWILIO_VERIFY_SERVICE_SID` | legacy SMS "from" fallback |
| `DB_PORT` | `3306` |
| `ADMIN_PHONE` | alias for `ADMIN_KEY` |
| `MODEL_CAP` | Max models a non-admin user may keep. Default `5`. Admins are exempt. |
| `DEPLOY_TARGET` | Per-site experience: `main` (pawsome3d.com, default) or `warehouse` (mypets.cc — future cold-storage viewer). Set `warehouse` in the mypets.cc Hostinger panel. |
| `PRINT_REQUEST_EMAIL` | Address the "Avatars-R-Us" 3D-print request form emails to. Falls back to `ADMIN_EMAIL`. |

---

## 4. PHASE 2-9 DARK-LAUNCH VALUES FOR THIS DEPLOYMENT

Set these exact values in Hostinger before building the frontend. They preserve
the current production behavior while the new code is deployed for staged review.

| Var | Value now | When it may change |
|---|---|---|
| `MULTIVIEW_APPROVAL_ENABLED` | `false` | After live Gemini/private-storage and browser approval |
| `VITE_MULTIVIEW_APPROVAL_ENABLED` | `false` | Same; must be set before build |
| `MODEL_BUILD_V3_ENABLED` | `false` | After credentialed Tripo/private-storage/Blender acceptance |
| `RIG_PIPELINE_V4_ENABLED` | `false` | After Render body/facial/accessory fixtures and human review |
| `FUR_BIN_V5_ENABLED` | `false` | After B2 privacy/publication and browser gates |
| `VITE_FUR_BIN_V5_ENABLED` | `false` | Same; must be set before build |
| `STATIONERY_V2_ENABLED` | `false` | After shipping contract, render worker, provider sandbox, and sample approval |
| `WAGS_V2_ENABLED` | `false` | After Wags UI and Stripe sandbox lifecycle audit |
| `BIM_V2_ENABLED` | `false` | After accepted-model resolver, Shell worker, and Render IFC acceptance |
| `VITE_BIM_V2_ENABLED` | `false` | Same; must be set before build |

Known values that remain active:

| Var | Value |
|---|---|
| `APP_URL` | `https://pawsome3d.com` |
| `BLENDER_WORKER_URL` | `https://pawsmemories.onrender.com/render` |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `3306` |
| `NODE_ENV` | `production` |
| `MEDIA_PRIVATE_BUCKET_NAME` | `pawsmemories-private` |
| `MEDIA_SIGNED_URL_TTL_SECONDS` | `900` |
| `BIM_WORKER_TIMEOUT_MS` | `180000` |

Do not invent or reuse secrets. Leave these unset while their feature is off:
`WAGS_STRIPE_WEBHOOK_SECRET`, `STATIONERY_RENDER_WORKER_URL`,
`STATIONERY_RENDER_WORKER_SECRET`, `PRINTFUL_WEBHOOK_SECRET`, and
`SLANT3D_WEBHOOK_SECRET`. When Wags is approved, create a separate Stripe endpoint
at `https://pawsome3d.com/api/wags-v2/stripe/webhooks`; its `whsec_...` value is
not the legacy `STRIPE_WEBHOOK_SECRET`.

Render worker variables are configured in Render, not Hostinger:

| Var | Value / rule |
|---|---|
| `WORKER_SHARED_SECRET` | Same secret as Hostinger |
| `RIG_PIPELINE_SOURCE_HOSTS` | Comma-separated exact hostname(s) from generated private signed source URLs; no scheme or wildcard |
| `IFC_MAX_CONCURRENT` | `1` |
| `PORT` | `10000` |

---

## Pre-deploy checklist
1. Set all **Section 1** vars in the Hostinger panel (and confirm `VITE_GOOGLE_MAPS_API_KEY_BROWSER` is present **before** the build step).
2. Confirm `WORKER_SHARED_SECRET` is byte-identical on Hostinger and the Render worker.
3. Point the Stripe webhook at `https://pawsome3d.com/api/stripe-webhook` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`) and paste its `whsec_…` into `STRIPE_WEBHOOK_SECRET`.
4. Build + start: `npm install && npm run build && npm start`. Watch the boot log for `[environments] Loaded N preset(s)` and no DB/storage errors.
5. Smoke test: sign in, generate one image (Gemini), one 3D model (Tripo), open the studio (environments list), and do one $ purchase (Stripe webhook confirms).

---

## Hermes implementation note (2026-07-15)

Hermes is server-only and defaults off. Leave `HERMES_ENABLED=false` until the edge
producer relay is ready, then set all of the following in the Hostinger Node.js
environment and restart the app:

| Var | Required value / effect |
|---|---|
| `HERMES_ENABLED` | `true` enables the authenticated `/api/hermes/*` routes; default is `false`. |
| `HERMES_EDGE_BRIDGE_URL` | HTTPS producer-relay base URL. Production rejects HTTP URLs. |
| `HERMES_EDGE_PRODUCER_SECRET` | Server-only Bearer secret for the producer relay. Never use a `VITE_` prefix. |
| `HERMES_TIMEOUT_MS` | Optional request timeout, `100`-`60000` ms; default `10000`. |

The server creates the dedicated `hermes_jobs` table idempotently at boot when MySQL
is configured; migration `server/migrations/009_hermes_jobs.sql` is also available for
managed migration runs. Fixed controls are 5 create requests/user/minute, 30/IP/minute,
60 status requests/user/minute, 60/IP/minute, and daily per-user caps of 20 translation
and 10 knowledge jobs.
