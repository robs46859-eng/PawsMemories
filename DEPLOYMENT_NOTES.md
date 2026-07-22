# Pawsome3D — Architecture, Build & Deployment Reference

*Last updated: 2026-07-21*

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
| Source zip (git archive) | ~21MB | All source + no dist | YES — Hostinger builds it |
| Pre-built zip (dist only) | ~5–6MB | dist/ contents only | YES — needs correct package.json |
| Zip with node_modules | ~70MB+ | source + node_modules | NO — never upload these |
| Wrong-structure zip | any | files nested under `dist/subfolder/` | NO — Hostinger can't find entry |

The **~5–6MB pre-built zip** is the correct deployment artifact when zipping from inside `dist/` — it's server.cjs + the Vite frontend assets + static files. No node_modules, no TypeScript source.

The **~21MB source zip** is what `git archive HEAD` produces — full source without node_modules. Hostinger installs and builds it.

The **~70MB zips** were mistakes that accidentally included `node_modules/`.

---

## 3. Deployment — Full Step-by-Step

### OPTION A: Pre-built deploy (recommended — faster)

1. Build from the repo:
   ```bash
   npm run build
   ```
   This produces/updates `dist/`.

2. Create a deployment package.json:
   ```bash
   cat > /tmp/deploy-pkg.json << 'EOF'
   {
     "name": "paws-and-memories",
     "version": "0.0.0",
     "scripts": {
       "build": "echo 'Pre-built. No build step required.'",
       "start": "node server.cjs"
     },
     "engines": { "node": ">=18" }
   }
   EOF
   ```

3. Zip from inside `dist/`, then add the package.json:
   ```bash
   cd dist
   zip -r ../pawsome3d-deploy.zip . -x "*.map"
   cd ..
   cp /tmp/deploy-pkg.json package.json  # temporarily
   zip pawsome3d-deploy.zip package.json
   rm package.json  # restore
   ```

4. In Hostinger hPanel → Websites → pawsome3d.com → Deployments → **Upload new files** → upload zip → Redeploy.

5. Hostinger runs:
   ```
   npm install      (nothing to install — no dependencies listed)
   npm run build    (echoes "Pre-built." and exits 0)
   node server.cjs  (starts the Express app)
   ```

> **CRITICAL:** The `"build"` script is required even as a no-op — Hostinger ALWAYS runs `npm run build` and crashes without it.

### OPTION B: Source deploy (simpler — Hostinger builds)

1. Commit your work first (zip uses git HEAD):
   ```bash
   git add -A && git commit -m "your message"
   ```

2. Create the source zip with release manifest and archive verification:
   ```bash
   bash scripts/build-deploy-zip.sh
   ```
   This generates `pawsome3d-deploy.zip` (~20MB) after validating worktree cleanliness, embedding `release-manifest.json` with Node 24 engine validation, and verifying extracted archive integrity.

3. Upload to Hostinger same as step 4 above.

4. Hostinger runs:
   ```
   npm install      (installs all deps incl. vite + esbuild from dependencies)
   npm run build    (vite build + esbuild → dist/server.cjs)
   node dist/server.cjs
   ```

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

Receives `POST /render` with `{ script, args }` and a `x-worker-secret` header. Executes the Blender Python script headlessly and returns the result.

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
| x-dm-service (`pawsmemories-1`) | Should be suspended/deleted in Render dashboard |
| Old zip on Google Drive | `pawsmemories-redeploy-20260721-slim.zip` has wrong structure — replace with `pawsome3d-hostinger-fixed.zip` |

---

## 10. Pre-Deploy Checklist

```
[ ] All changes committed (git archive uses HEAD — uncommitted work is excluded)
[ ] npm run build succeeds locally
[ ] Zip structure is flat: package.json + server.cjs + index.html + assets/ all at root
[ ] package.json has BOTH "build" (can be no-op) and "start" scripts
[ ] Blender worker deployed first if worker code changed
[ ] DB_HOST=127.0.0.1 in Hostinger env vars
[ ] BLENDER_WORKER_URL=https://pawsmemories.onrender.com/render in Hostinger env vars
[ ] After deploy: visit pawsome3d.com and confirm app loads
```
