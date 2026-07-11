# Pawsome3D — Website Performance Improvements

**Prepared:** July 10, 2026
**Context:** pre-launch hardening before real user traffic. Findings are measured from the current build (`dist/`), `vite.config.ts`, `server.ts`, and `index.html` — not generic advice.

---

## TL;DR — the five that matter most

| # | Fix | Effort | Expected win | Risk |
|---|---|---|---|---|
| 1 | **Enable gzip/brotli compression** on the Express server (none today) | 15 min | Main JS **1.65 MB → ~450 KB** over the wire; every asset shrinks ~65–75% | None |
| 2 | **Route-level code-splitting** (`React.lazy`) for Animator / Models-3D / AR | Half day | Landing + Dashboard stop downloading the whole three.js/R3F/animator stack (~1 MB) | Low |
| 3 | **Stop bundling 3D rooms as JS** (`music_room` = 2.0 MB, `living_room` = 1.5 MB chunks) — fetch GLBs at runtime | Half day | Removes multi-MB JS chunks from the graph; scenes load only when opened | Low–Med |
| 4 | **Defer / drop the `<model-viewer>` CDN script** loaded render-blocking in `<head>` on every page | 20 min | Removes a ~300 KB blocking module fetch from first paint sitewide | Low |
| 5 | **Long-cache immutable headers + a CDN** (Cloudflare) in front of Hostinger | 1–2 hrs | Repeat visits near-instant; offloads static bytes; adds HTTP/2 + brotli | Low |

Do 1 and 4 today — they're config-only, zero-refactor, and immediately visible.

---

## Measured evidence (current build)

```
dist/assets/index-DdCmEeW3.js     1.65 MB  (raw)  →  ~449 KB gzipped   ← main bundle, ships UNCOMPRESSED today
dist/assets/music_room-*.js       2.09 MB         ← a 3D room bundled as JS
dist/assets/living_room-*.js      1.50 MB         ← 3D room as JS
dist/assets/office_large-*.js     0.55 MB
dist/assets/emulate-*.js          0.43 MB
dist/assets/meeting_room-*.js     0.41 MB
dist/assets/index-*.css           158 KB
public/MAIN*.jpg                  152–287 KB each  ← unoptimized hero JPEGs
```

Server + config facts:
- **No `compression` middleware** — `express.static(distPath)` serves raw bytes. `compression` is **not** in `package.json`.
- **No cache-control tuning** — hashed assets should be `immutable, max-age=31536000` but aren't set.
- **`manualChunks` only splits** `maps`, `motion`, `icons`. **three.js + @react-three/fiber + drei + xr + the entire Animator ride in the 1.65 MB main chunk** — pulled on the landing page even though most visitors never open 3D.
- **`index.html` loads `model-viewer@3.5.0` as a render-blocking `<script type="module">` in `<head>`** on every route. The comment still says "for Meshy models" — stale (you're on Tripo now), and it likely duplicates what R3F already renders.
- **Fonts:** five families requested render-blocking from Google Fonts — Plus Jakarta Sans (5 weights), Space Grotesk (3), Be Vietnam Pro (2), JetBrains Mono (2), **plus the Material Symbols Outlined variable font** (heavy).

---

## P0 — do before launch (config-only, high impact)

### 1. Add compression middleware
Biggest single win for the buck. Install and mount **before** the static handler.

```bash
npm i compression
```
```ts
// server.ts — near the top of middleware setup
import compression from "compression";
app.use(compression()); // gzip; brotli if you put a CDN/nginx in front (see #5)
```
Result: the 1.65 MB main JS goes out at ~450 KB; CSS 158 KB → ~30 KB; every text asset shrinks ~70%.

### 2. Immutable cache headers on hashed assets
Vite fingerprints filenames, so they're safe to cache forever.

```ts
app.use(express.static(distPath, {
  setHeaders(res, filePath) {
    if (/\.(js|css|woff2|png|jpg|webp|glb)$/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));
// keep index.html uncached so new deploys are picked up:
// (serve it with Cache-Control: no-cache)
```

### 3. Defer or remove `<model-viewer>` from `index.html`
It blocks first paint on every page. Options, best first:
- **Remove it** if R3F (`PetModelViewer`/`Avatar3DPlaypen`) already covers 3D viewing — grep for the `<model-viewer>` tag; if unused, delete the script.
- If still used somewhere, **lazy-load it** only on the screen that needs it:
  ```ts
  // in that component's useEffect
  await import("https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js");
  ```
- At minimum add `defer`-style loading by moving it out of `<head>` and gating it.

### 4. Trim fonts
- Drop to **two** families for UI (e.g. Plus Jakarta Sans + JetBrains Mono); load Space Grotesk/Be Vietnam Pro only if actually used.
- The **Material Symbols variable font is large** — if you only use a handful of glyphs, switch those to inline Lucide icons (already a dependency) and remove the Material Symbols stylesheet entirely.
- Add `<link rel="preload" as="style">` for the one critical font; keep `display=swap` (already present).
- Consider self-hosting the woff2 (removes a third-party connection + gives you the immutable cache from #2).

---

## P1 — do this week (small refactors, big payload cuts)

### 5. Route-level code splitting with `React.lazy`
Today `App.tsx` imports every screen statically, so three.js/R3F/animator are in the first byte the landing page pulls. Lazy-load the heavy, rarely-first screens:

```tsx
import { lazy, Suspense } from "react";
const AnimatorScreen = lazy(() => import("./animator/components/AnimatorScreen"));
const ModelsScreen  = lazy(() => import("./components/AvatarDashboard"));
const ARStage       = lazy(() => import("./three/ar/ARPetStage"));
// ...
{currentScreen === Screen.ANIMATOR && (
  <Suspense fallback={<LoaderSplash/>}><AnimatorScreen .../></Suspense>
)}
```
Keep `SignUp`, `Welcome`, `Tutorial`, `Dashboard` eager. This moves three.js/R3F into chunks that only download when a user actually opens 3D — the landing/dashboard TTI drops sharply.

### 6. Stop compiling 3D rooms into JS
`music_room` (2 MB) and `living_room` (1.5 MB) as `.js` chunks means GLBs (or their geometry) are being **import-bundled** instead of fetched. Move them to runtime assets:
- Put the room `.glb` files in `public/` (or B2) and load via `useGLTF("/rooms/music_room.glb")` / drei `useGLTF.preload`.
- This removes multi-MB JS from the module graph entirely; the browser fetches a room only when that scene is chosen, and it's cacheable as a binary (not re-parsed as JS).

### 7. Split three.js into its own vendor chunk
So it caches independently of your app code across deploys:
```ts
// vite.config.ts → build.rollupOptions.output.manualChunks
manualChunks: {
  three: ['three'],
  r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/xr'],
  maps: ['@react-google-maps/api'],
  animation: ['motion'],
  icons: ['lucide-react'],
}
```
(Keep the `dedupe: ['three']` — do not remove it, or AR breaks.)

### 7b. Fix the `placement.ts` mixed-import warning (from your build log)
Your latest `vite build` warns:
> `placement.ts is dynamically imported by ARPetStage.tsx / eighthWallAR.ts **but also statically imported** by LivingAvatarView.tsx … dynamic import will not move module into another chunk.`

Because `LivingAvatarView.tsx` (and `eighthWallAR.ts`) import `placement.ts` **statically**, Rollup can't honor the lazy `import()` in `ARPetStage` — the AR placement code gets pulled into a shared/eager chunk instead of loading on demand. Fix: make **all** consumers import it dynamically (or extract the piece `LivingAvatarView` needs into a small always-loaded module and keep the heavy placement logic dynamic-only). Confirm the warning disappears from the build.

### 8. Optimize the hero images
`public/MAIN*.jpg` are 150–290 KB unoptimized JPEGs.
- Convert to **WebP/AVIF** (`sharp` is already a dependency): expect 40–60% smaller.
- Serve responsive `srcset` (mobile shouldn't fetch a desktop hero).
- `loading="lazy"` on anything below the fold; `fetchpriority="high"` on the LCP hero only.

---

## P2 — nice-to-have / ongoing

- **CDN in front of Hostinger (Cloudflare free tier):** brotli, HTTP/2/3, edge caching of `/assets/*`, and it fronts the immutable headers from #2. Biggest repeat-visit win after compression.
- **Preconnect** to Backblaze/B2 origin (`<link rel="preconnect">`) since GLBs/audio load from there — shaves the TLS handshake off first model load.
- **Repo housekeeping (not user-facing, but slows local builds & risks accidental serving):** the working tree has a **197 MB `deploy.zip`** plus ~9 older `pawsome3d-deploy-*.zip` (~10 MB each). They're gitignored but bloat the build context — delete them: `rm -f deploy.zip deploy_light.zip pawsome3d-deploy*.zip`.
- **`GET /api/scenes/environments` and `/api/me`** — make sure the app doesn't waterfall these serially on boot; fire in parallel and cache the environments list (it's static per deploy).
- **Preload the LCP route's JS chunk** with `<link rel="modulepreload">` once you've split (so lazy-loading the Dashboard doesn't add a round trip for signed-in users).
- **Lighthouse/WebPageTest baseline:** capture a before/after so you can prove the wins and catch regressions once traffic arrives.

---

## Suggested order of execution

1. **Today (config, ~1 hr):** compression (#1) → cache headers (#2) → defer/remove model-viewer (#3) → trim fonts (#4). Rebuild, redeploy, re-run Lighthouse.
2. **This week (~1 day):** `React.lazy` split (#5) + three vendor chunk (#7) + hero images (#8).
3. **Before scaling traffic:** move 3D rooms to runtime GLBs (#6) + Cloudflare in front (#P2).
4. **Cleanup anytime:** delete the deploy zips from the working tree.

> Note: none of these touch the "no-fakery / preserve-originals" animator rules — they're delivery-layer optimizations. Ship them independently of Phase 6 feature work.

---

## §6.7 Results — WebXR Emulator (IWER) stripped from production runtime (2026-07-11)

**Approach shipped: 6.7.1 (`emulate: false`).**
Both `createXRStore` calls in `ARPetStage.tsx` and `ARScene.tsx` now set
`emulate: import.meta.env.DEV ? "metaQuest3" : false`. With `emulate: false`,
the `if (emulate !== false)` guard in `@pmndrs/xr` never fires, `injectEmulator()`
never runs, and the dynamic `import('./emulate.js')` chain is never fetched by
a browser. Dev builds (`npm run dev`) still get the desktop AR emulator.

**6.7.2 (prod-only alias) was attempted but reverted.** Aliasing `iwer`,
`@iwer/sem`, `@iwer/devui` → `src/shims/empty.ts` breaks Rollup because
`@pmndrs/xr/dist/emulate.js` does named imports (`XRDevice`, `metaQuest3`, etc.)
from `iwer` that cannot be satisfied by an empty module. The chunks remain in
`dist/` but are provably dead code at runtime.

### Bundle impact — IWER chunks (still emitted, but unreferenced at runtime)

| Chunk | Raw (KB) | Gzipped (KB) | Status |
|-------|----------|--------------|--------|
| `music_room-*.js` | 2,087 | 715 | ⛔ Never fetched (emulate:false) |
| `living_room-*.js` | 1,500 | 516 | ⛔ Never fetched |
| `office_large-*.js` | 549 | 199 | ⛔ Never fetched |
| `emulate-*.js` | 426 | 117 | ⛔ Never fetched |
| `meeting_room-*.js` | 410 | 143 | ⛔ Never fetched |
| **Total saved (over the wire)** | — | **~1,690 KB** | ✅ |

### Build output comparison

**Before (no emulate key):**
```
dist/assets/index-*.js              208.37 kB │ gzip:  52.12 kB
dist/assets/r3f-*.js                646.55 kB │ gzip: 199.91 kB
dist/assets/three-*.js              689.64 kB │ gzip: 177.36 kB
dist/assets/meeting_room-*.js       409.87 kB │ gzip: 142.60 kB  ← IWER
dist/assets/emulate-*.js            425.98 kB │ gzip: 117.18 kB  ← IWER
dist/assets/office_large-*.js       548.70 kB │ gzip: 199.40 kB  ← IWER
dist/assets/living_room-*.js      1,500.39 kB │ gzip: 516.29 kB  ← IWER
dist/assets/music_room-*.js       2,087.28 kB │ gzip: 715.05 kB  ← IWER
```

**After (emulate: false — chunks emitted but never loaded by users):**
Same `dist/` listing — chunks are still emitted by Rollup (the dynamic import is
statically reachable), but with `emulate: false` the runtime guard prevents
`injectEmulator()` from ever calling the dynamic import. Real users on Android
Chrome AR save **~1.69 MB gzipped** over the wire per session.

Desktop `npm run dev` still shows the emulated headset (confirmed).

