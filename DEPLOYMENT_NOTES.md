# Pawsome3D — Architecture, Build & Deployment Reference

*Last updated: 2026-07-22*

---

## 1. System Architecture

Three separate services. Each deploys independently.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (pawsome3d.com)                                            │
│  React 19 + Vite — served as static assets from Hostinger          │
└────────────────────────┬────────────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────────────┐
│  HOSTINGER (pawsome3d.com)   [SERVICE 1 — Main App]                │
│  Node.js 24 + Express 4                                            │
│  Entry: dist/server.cjs                                            │
│  • Serves Vite frontend from dist/                                  │
│  • All /api/* routes (auth, avatars, payments, AI, etc.)           │
│  • MySQL (Hostinger built-in) for users, avatars, transactions     │
│  • Connects to Google Gemini, Tripo3D, Stripe, Twilio, S3          │
│  • Sends Blender scripts to the worker via HTTP                    │
└────────────────────────┬────────────────────────────────────────────┘
                         │ POST /render (WORKER_SHARED_SECRET auth)
┌────────────────────────▼────────────────────────────────────────────┐
│  RENDER — pawsmemories.onrender.com  [SERVICE 2 — Blender Worker]  │
│  Docker container (Node 20 + Blender 5.1.2 + Python/bpy)          │
│  Entry: blender-worker/server.js                                   │
│  • Receives { script, args } from main app                         │
│  • Executes Blender headlessly (bpy) and returns results           │
│  • Hosts render artifacts, IFC conversion                          │
│  • BLENDER_WORKER_URL = https://pawsmemories.onrender.com/render   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  RENDER — pawsmemories-1.onrender.com  [SERVICE 3 — X DM Bot]     │
│  Node.js 20 (NOT Docker)                                           │
│  Entry: x-dm-service/dist/index.js                                 │
│  Status: SHOULD BE DISABLED (not used in production)               │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Build Pipeline (Main App)

### What the build does

```bash
npm run build
# = vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
```

Step 1 — `vite build`: compiles the entire React frontend, processes Tailwind, and emits hashed production bundles to `dist/assets/` plus `dist/index.html`.

Step 2 — `esbuild server.ts`: bundles the Express server (server.ts + auth.ts + db.ts etc.) into a single `dist/server.cjs` file (~955KB). The `--packages=external` flag leaves npm packages (express, mysql2, stripe, etc.) out of the bundle so they're resolved from `node_modules` at runtime.

### Why file sizes vary

| Zip | Size | What's inside | Works on Hostinger? |
|---|---|---|---|
| Source zip (git archive) | ~21MB | All source + no dist | NO for the current host — Hostinger's Node 24.6 minor is below the build contract |
| Verified pre-built zip | ~5–6MB | `dist/`, launcher, package files | YES — recommended and produced by the release script |
| Zip with node_modules | ~70MB+ | source + node_modules | NO — never upload these |
| Wrong-structure zip | any | files nested under `dist/subfolder/` | NO — Hostinger can't find entry |

The **~5–6MB pre-built zip** is the correct deployment artifact. It contains the locally compiled `dist/`, a root `server.cjs` Hostinger launcher, and the exact package/lock files needed to install runtime dependencies. It never contains `node_modules`, TypeScript source, or environment files.

The **~21MB source zip** is what `git archive HEAD` produces. Keep it for source transfer only; do not use it for the current Hostinger deployment because the host reports Node 24.6 while the build is pinned to Node 24.15 or newer.

The **~70MB zips** were mistakes that accidentally included `node_modules/`.

---

## 3. Deployment — Full Step-by-Step

### Production deploy: verified pre-built archive

1. From a clean, committed `main` checkout under Node 24.18, run:
   ```bash
   bash scripts/build-deploy-zip.sh
   ```
   The script runs the fail-closed build, verifies the exact-commit release manifest, creates the Hostinger launcher and package metadata in an isolated staging directory, rejects secrets and forbidden directories, and verifies the extracted archive.

2. In Hostinger hPanel → Websites → pawsome3d.com → Deployments → **Upload new files** → upload `pawsome3d-deploy.zip` → Redeploy.

3. Hostinger runs:
   ```
   npm install      (installs the locked external runtime dependencies)
   npm run build    (verified pre-built no-op)
   node server.cjs  (loads dist/server.cjs)
   ```

> **CRITICAL:** The `"build"` script is required even as a no-op — Hostinger ALWAYS runs `npm run build` and crashes without it.

Do not hand-edit `package.json` or assemble this archive manually. The release script preserves dependencies (the server bundle externalizes npm packages) while replacing only the host-side lifecycle scripts in the staged copy.

### Do NOT do

- Upload a zip with files nested inside a subdirectory (`dist/index.html` in the zip must be at the root `index.html`, not `dist/index.html`).
- Upload anything with `node_modules/` included.
- Push directly to `main` — it is branch-protected (6 required CI checks). Use PR branches.

---

## 4. Service Redeploy Order

When deploying a full update across all services:

```
1. Render Docker (blender-worker / pawsmemories.onrender.com)
2. Render Node   (x-dm-service   / pawsmemories-1.onrender.com)  ← skip if unused
3. Hostinger     (main app       / pawsome3d.com)
```

Reason: the main app calls the Blender worker. Deploy the worker first so it's ready before Hostinger restarts.

The schema 30 acceptance-correction release changes both sides of the Blender
contract (`physics_validate` plus exact print preparation), so steps 1 and 3 are
both required. The X-DM service is independent and may remain suspended.

For code-only changes to the main app only: just step 3.

---

## 5. Environment Variables

Set in Hostinger → Websites → pawsome3d.com → Deployments → Settings → Environment variables.

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Long random string ≥32 chars |
| `ADMIN_KEY` | Internal seed key (non-secret) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin login credentials |
| `GEMINI_API_KEY` | Google Gemini — required for all AI features |
| `GEMINI_IMAGE_MODELS` | `gemini-3-pro-image,gemini-3.1-flash-image,gemini-3.1-flash-lite-image,gemini-2.5-flash-image` |
| `TRIPO_API_KEY` | Tripo3D Image-to-3D |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe Checkout + webhook |
| `APP_URL` | `https://pawsome3d.com` |
| `DB_HOST` | `127.0.0.1` (**NOT** `localhost`) |
| `DB_PORT` | `3306` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL credentials |
| `DB_CONNECTION_LIMIT` | Bounded pool connection limit (default 10, max 50) |
| `DB_MAX_IDLE` | Maximum idle connections (capped at DB_CONNECTION_LIMIT) |
| `DB_IDLE_TIMEOUT_MS` | Idle connection timeout in ms (default 60000) |
| `DB_CONNECT_TIMEOUT_MS` | Initial connection timeout in ms (default 10000) |
| `DB_KEEPALIVE_DELAY_MS` | TCP keepalive initial delay in ms (default 0) |
| `DB_QUEUE_LIMIT` | Max queued requests waiting for pool connection (default 0 = infinite) |
| `APP_COMMIT_SHA` | Commit SHA for release provenance (exposed at /version and /readyz) |
| `APP_BUILD_TIME` | ISO build timestamp for release provenance |
| `GOOGLE_MAPS_API_KEY_SERVER` | Server-side Maps key (no referrer restriction) |
| `VITE_GOOGLE_MAPS_API_KEY_BROWSER` | Browser Maps key (baked in at build time) |
| `MEDIA_BUCKET_NAME` / `MEDIA_BUCKET_URL` / `MEDIA_BUCKET_KEY` / `MEDIA_BUCKET_SECRET` | S3-compatible object storage |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | SMS notifications |
| `BLENDER_WORKER_URL` | `https://pawsmemories.onrender.com/render` |
| `WORKER_SHARED_SECRET` | Auth header for blender-worker |
| `MODEL_BUILD_V3_ENABLED` / `RIG_PIPELINE_V4_ENABLED` | Keep `false` for the baseline release |
| `FUR_BIN_V5_ENABLED` / `VITE_FUR_BIN_V5_ENABLED` | Keep `false`; Vite value must exist before build |
| `STATIONERY_V2_ENABLED` | Keep `false` until shipping/provider gates pass |
| `WAGS_V2_ENABLED` | Keep `false` until Stripe sandbox and UI gates pass |
| `WAGS_STRIPE_WEBHOOK_SECRET` | Separate Wags v2 endpoint secret; do not reuse the legacy webhook secret |
| `BIM_V2_ENABLED` / `VITE_BIM_V2_ENABLED` | Keep `false` until durable BIM integration and acceptance pass |
| `BIM_WORKER_TIMEOUT_MS` | `180000` unless a measured Render run requires adjustment |
| `HEYGEN_API_KEY` / `HEYGEN_DEFAULT_VOICE_ID` | HeyGen talking avatar video |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_MODEL_ID` / `ELEVENLABS_DEFAULT_VOICE_ID` | Animator voice preview |
| `RHUBARB_BIN` | Optional path to Rhubarb Linux binary |

**DB_HOST must be `127.0.0.1`, not `localhost`.** mysql2 on Node 18+ resolves `localhost` to IPv6 (`::1`), which Hostinger MySQL grants don't cover.

**Hostinger Remote MySQL host:** set to `%` (wildcard) in phpMyAdmin to allow connections from Render.

---

## 6. Blender Worker

**Path in repo:** `blender-worker/`  
**Deployed at:** `https://pawsmemories.onrender.com`  
**Entry:** `blender-worker/server.js`  
**Runtime:** Docker (Node 20 + Blender 5.1.2 + headless Linux deps)

Receives authenticated render, rig, validation, and print-preparation requests
with a `x-worker-secret` header. The `WORKER_SHARED_SECRET` value must be identical
on Render and Hostinger. The schema 30 release also protects
`POST /physics-validate`; deploy the worker before the matching main app.

`sanitizeBlenderScript()` in server.ts patches deprecated Blender 5.1 API calls before sending (removes `use_contact_shadows`, swaps `PointLight.distance` → `energy`, etc.).

To redeploy: push to `main` (if auto-deploy is on) or manually trigger in Render dashboard.

---

## 7. AI Image Models (Nano Banana family)

```typescript
// server.ts line ~3553
const IMAGE_MODELS = [
  "gemini-3-pro-image",        // try first
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-2.5-flash-image"     // last fallback
];
```

Server tries each in order until one succeeds. Controlled by `GEMINI_IMAGE_MODELS` env var.

---

## 8. Recent Changes

### Schema 30 acceptance corrections (2026-07-22)

- Reject ambiguous/cropped full-body human references before paid generation.
- Recover create/rig work only through durable leases, source fingerprints,
  bounded attempts, terminal-state checks, and idempotent refunds.
- Repair and validate the exact Blender-exported STL before manufacturing.
- Add the authenticated `physics_validate` worker route/tool.
- Add visible Voice Test and Scaled BIM preview screens.
- Remove legacy marketplace/manual print panels from Shop routing.
- Disable X-DM fallback polling by default and stop it after 401/403.

The former deployment zip predates these corrections and is rejected. Build a new
`pawsome3d-deploy.zip` from the committed correction release.

### Text-mode generate-reference fix (2026-07-21, branch `fix/text-mode-reference-screen`)

`CreateReferenceScreen.tsx`: `useEffect` previously only called `generateCandidate()` when `state.inputPhotoUrl` was truthy. In text mode, that's always null — so the screen was blank every time.

Fix: check `hasInput` based on active mode:
```typescript
const hasInput = state.inputMode === "text"
  ? !!(state.textPrompt || "").trim()
  : !!state.inputPhotoUrl;
```

**Merge this branch before next deploy.**

### Marketplace Customizer P1 (2026-07-20, commit `87a17f9`)

- `wags_customizer_sessions`, `wags_customizer_line_items`, `wags_marketplace_items` tables
- Stripe checkout + webhook for customizer orders
- 35 tests passing

---

## 9. Known Issues

| Issue | Status |
|---|---|
| Text-mode blank screen | Fixed — needs merge from `fix/text-mode-reference-screen` |
| Multi-angle turnaround views | Not wired into create pipeline (only in `/api/avatars` for dogs) |
| x-dm-service (`pawsmemories-1`) | Suspend/delete if unused; otherwise deploy with `X_DM_POLLING_ENABLED=false` |
| Old zip on Google Drive | `pawsmemories-redeploy-20260721-slim.zip` has wrong structure — replace it with the newly generated `pawsome3d-deploy.zip` |

If the X-DM service is intentionally retained, enable polling only when DM lookup
fallback is required and its X API credentials have been verified. A 401 or 403
now suspends polling until the service restarts.

---

## 10. Pre-Deploy Checklist

```
[ ] All changes committed (git archive uses HEAD — uncommitted work is excluded)
[ ] npm run build succeeds locally
[ ] Zip structure is flat: package.json + server.cjs + index.html + assets/ all at root
[ ] package.json has BOTH "build" (can be no-op) and "start" scripts
[ ] Blender worker deployed first if worker code changed
[ ] WORKER_SHARED_SECRET matches on Hostinger and the Blender worker
[ ] DB_HOST=127.0.0.1 in Hostinger env vars
[ ] BLENDER_WORKER_URL=https://pawsmemories.onrender.com/render in Hostinger env vars
[ ] After deploy: visit pawsome3d.com and confirm app loads
```
