# DEPLOYMENT_NOTES.md
# Pawsome3D — deployment gotchas & checklist

Practical notes for shipping the app (main app on Hostinger, blender-worker on Render).
Keep this current — it captures things that have bitten us or will.

---

## 1. `index.html` is a Vite **dev** template — you MUST build for production

`index.html` at the repo root ends with:

```html
<script type="module" src="/src/main.tsx"></script>
```

That `/src/main.tsx` path **only works under the Vite dev server**. It does not exist in a
production deploy. If you serve the raw repo-root `index.html`, the page loads the fonts +
`<model-viewer>` CDN script and then a blank `#root` — no app.

**Correct flow:** `npm run build` runs `vite build`, which emits `dist/index.html` with the
`/src/main.tsx` reference rewritten to the hashed production bundles (`/assets/*.js`, `*.css`).
Deploy must run the build and serve **`dist/`**, never the repo root.

### How the server decides dev vs prod
`server.ts` (bottom) auto-detects production:

```ts
const distPath = path.join(process.cwd(), 'dist');
const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, 'index.html'));
```

- **Prod** (dist/index.html exists): `express.static(dist)` + SPA catch-all → `dist/index.html`.
- **Dev** (no dist): mounts Vite middleware.

So on Hostinger the deploy must `npm install && npm run build` (produces `dist/`) **before**
`npm start`. If `dist/index.html` is missing, the server tries to load Vite at runtime (which
should not be present in a prod install) and the app won't serve correctly. Symptom of a
half-built deploy: blank page, or 500s mentioning `vite`.

---

## 2. SPA catch-all masks unknown API routes

Production serving ends with:

```ts
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
```

This is registered **after** all `/api/*` routes, so real endpoints work. BUT any **unmatched**
`/api/...` path (typo, un-deployed route, wrong method) returns **`index.html` (200 HTML)**, not
a 404 JSON. When debugging "my API returns HTML", the route isn't registered/matched — it's not
a CORS or build problem. (Future hardening H-item: add an `/api/*` 404 JSON handler before the
catch-all.)

---

## 3. Deploy zip is built from `git archive HEAD` — commit first

`bash scripts/build-deploy-zip.sh` → `pawsome3d-deploy.zip`. It archives **HEAD**, so any
uncommitted/staged work is **excluded**. Always commit before building, or the zip ships stale
code. (Sanity check in the script confirms a few critical files exist.) The zip is **source
only** — Hostinger runs `npm install && npm run build` on it.

## 4. Stale `.git/*.lock` and Git unlink limitations in Sandbox

The Cowork/sandbox mount blocks git `unlink` calls. This causes commands that require locks or unlinks (like `git commit`, `git rebase`, or modifying `.git/index`) to fail with "Unable to create '.git/HEAD.lock': File exists" or "Device or resource busy".

**Workaround**: 
- **Commits**: Commits must be finalized locally on the Mac (or whatever host OS is mounting the sandbox). Avoid running mutating git commands inside the sandbox/Dev/CI environment. 
- **Deploy Zip Fallback**: If you need to build the deploy zip inside a restricted sandbox environment where `git ls-files` fails due to lock issues, you can run the `scripts/build-deploy-zip.sh` script to output to a temporary non-mount directory, but it's best to run `bash scripts/build-deploy-zip.sh` on the host Mac after committing.

## 5. Environment variables

Set in the host env (see `.env.example` for the full list). Notable ones:

- `GEMINI_API_KEY` — vision + text LLM (pet classify, semantic scan).
- `TRIPO_API_KEY` — image→3D + auto-rig.
- `BLENDER_WORKER_URL` + `WORKER_SHARED_SECRET` — must match the Render worker (`x-worker-secret`).
- `MEDIA_BUCKET_*` — Backblaze B2 for GLB/audio uploads. **Retention policy**: B2 buckets have no lifecycle expiration rules set (objects live forever). Any 404s for `models/` are typically due to provider URL leakage (fixed in Phase 6), not bucket cleanup.
- **AR pet sim (new):**
  - `PETSIM_RIG_ENABLED` — feature flag for `POST /api/pets/:id/rig` (**off by default**;
    avatars without a rig keep the current render path).
  - `TRIPO_RIG_MODEL_VERSION` — optional; defaults to `v2.0-20250506` in code.

`.env` is gitignored, so it is **not** in the deploy zip — set vars in the Hostinger panel.

---

## 6. Three.js single-copy (AR rendering)

`vite.config.ts` sets `resolve.dedupe: ['three']`. Do not remove it — multiple three.js copies
break `GLTFLoader`, materials, and all AR rendering ("Multiple instances of Three.js"). If you
add an R3F-ecosystem dependency, verify the build still dedupes three.

---

## 7. External CDN dependencies at runtime

`index.html` loads from third-party CDNs: Google Fonts, `Material Symbols`, and
`model-viewer@3.5.0` (`ajax.googleapis.com`). These must be reachable from the client (and
allowed by any CSP). The **8th Wall iOS AR engine** binary should be **pinned + self-hosted on
B2** (its hosted service shut down Feb 2026 — CDN longevity risk, per spec §9).

---

## 8. Two HTML entry points

There is both `index.html` (the app) and `landing-index.html` (a standalone marketing landing
page). Don't confuse them — the SPA build entry is `index.html`. If the landing page is served,
it's wired separately; the app build/serve path above is for `index.html` → `dist/`.

---

## Quick pre-deploy checklist
1. `git commit` all intended work (deploy zip archives HEAD).
2. `npm run lint` (`tsc --noEmit`) clean; `npm run test` + `npm run test:ar` green.
3. `bash scripts/build-deploy-zip.sh` → upload `pawsome3d-deploy.zip`.
4. Host runs `npm install && npm run build` → **confirm `dist/index.html` exists** → `npm start`.
5. Set/verify env vars (esp. `WORKER_SHARED_SECRET` matches the worker; feature flags).
6. Smoke-test: load `/` (app renders, not blank), hit one `/api/*` route (JSON, not HTML).
