# Hostinger Deployment — Environment Variables

Set these in the Hostinger **Node.js app → Environment variables** panel (not in a committed `.env` — `.env` is gitignored and not in the deploy zip). Full annotated reference: `.env.example`.

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
| `GEMINI_TEXT_FALLBACK_MODEL` | code default |
| `PETSIM_RIG_ENABLED` | `false` (AR auto-rig off) |
| `TRIPO_RIG_MODEL_VERSION` | `v2.0-20250506` |
| `PETSIM_PAID_APIS_ENABLED` / `_CLASSIFY_` / `_SEMANTIC_SCAN_ENABLED` | on |
| `PETSIM_CLASSIFY_DAILY_CAP` / `_RIG_` / `_SEMANTIC_SCAN_DAILY_CAP` | 25 / 5 / 50 |
| `ANIMATOR_WORKER_ENABLED` | enabled (`false` to disable) |
| `ANIMATOR_DATA_DIR` / `ANIMATOR_WORKER_CONCURRENCY` / `ANIMATOR_STALE_MS` | code defaults |
| `STUDIO_SERVICE_URL` | leave blank unless the separate Python Studio service is deployed; blank returns a clear 503 instead of proxying to localhost |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_HTTP_REFERER` / `OPENAI_X_TITLE` | only for the OpenAI-compatible multi-agent pipeline |
| `TWILIO_VERIFY_SERVICE_SID` | legacy SMS "from" fallback |
| `DB_PORT` | `3306` |
| `ADMIN_PHONE` | alias for `ADMIN_KEY` |
| `MODEL_CAP` | Max models a non-admin user may keep. Default `5`. Admins are exempt. |
| `DEPLOY_TARGET` | Per-site experience: `main` (pawsome3d.com, default) or `warehouse` (mypets.cc — future cold-storage viewer). Set `warehouse` in the mypets.cc Hostinger panel. |
| `PRINT_REQUEST_EMAIL` | Address the "Avatars-R-Us" 3D-print request form emails to. Falls back to `ADMIN_EMAIL`. |

---

## Pre-deploy checklist
1. Set all **Section 1** vars in the Hostinger panel (and confirm `VITE_GOOGLE_MAPS_API_KEY_BROWSER` is present **before** the build step).
2. Confirm `WORKER_SHARED_SECRET` is byte-identical on Hostinger and the Render worker.
3. Point the Stripe webhook at `https://pawsome3d.com/api/stripe-webhook` (events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`) and paste its `whsec_…` into `STRIPE_WEBHOOK_SECRET`.

### 2026-07-14 paid-provider limits addendum

The current launch defaults are maintained in `.env.example` and
`docs/DAILY_LIMITS.md`. In addition to the earlier AR flags, configure the
following endpoint switch when managing paid image workflows:

| Variable | Default | Purpose |
|---|---:|---|
| `PETSIM_IMAGE_GENERATION_ENABLED` | `true` | Shared budget switch for memory images, scene prompts, avatar references, and text-to-reference |

The corresponding daily request, aggregate request, and aggregate cost limits
use the `PETSIM_IMAGE_GENERATION_*` names. Keep `PETSIM_RIG_ENABLED=false`.
Run the staging-only abuse check from `docs/DAILY_LIMITS.md` before enabling
paid production traffic.
4. Build + start: `npm install && npm run build && npm start`. Watch the boot log for `[environments] Loaded N preset(s)` and no DB/storage errors.
5. Smoke test: sign in, generate one image (Gemini), one 3D model (Tripo), open the studio (environments list), and do one $ purchase (Stripe webhook confirms).
