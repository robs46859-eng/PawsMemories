# Paws & Memories — Phased Production Repair Spec

**Created:** July 1, 2026
**Companion to:** `PRODUCTION_READINESS_REVIEW.md` (read that first — this document assumes its findings)
**Status:** Proposed, not started

Phases are ordered by risk: each phase should be merged and smoke-tested before the next begins. Phase 0 is a hard gate — do not put this app in front of real, unknown users before it's done.

---

## Phase 0 — Security lockdown (before any public traffic)

### 0.1 Authenticate the Blender worker
**Problem:** `blender-worker/server.js` executes arbitrary Python (`POST /execute`) with no auth (see review §2.1).

**Fix:**
1. Add `WORKER_SHARED_SECRET` to both the main app's env and the blender-worker's env (a long random string, distinct from `JWT_SECRET`).
2. In `blender-worker/server.js`, add middleware before the `requireBridge` list:
   ```js
   function requireWorkerAuth(req, res, next) {
     const provided = req.get("x-worker-secret");
     if (!provided || provided !== process.env.WORKER_SHARED_SECRET) {
       return res.status(401).json({ error: "Unauthorized" });
     }
     next();
   }
   app.use(["/scene", "/viewport", "/execute", "/undo", "/checkpoint",
            "/export-glb", "/import-glb", "/agent/build"], requireWorkerAuth);
   ```
   Apply it *before* `requireBridge` in the middleware chain (order matters — reject unauthenticated requests before doing any Blender work).
3. In `agent/tools/blender_client.ts`, wherever `fetch(url, options)` is called (line ~137), add the header:
   ```ts
   headers: { ...options.headers, "x-worker-secret": process.env.WORKER_SHARED_SECRET || "" }
   ```
4. Also rate-limit `/health` and consider IP-restricting the Render.com service to the main app server's outbound IP if Render supports it at your plan tier.

### 0.2 Fix the CSP so video and 3D models actually load
**File:** `server.ts:135-152`

```ts
app.use((_req, res, next) => {
  const bucketOrigin = new URL(process.env.MEDIA_BUCKET_URL || "https://example.invalid").origin;
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.google.com https://*.googleapis.com",
      "script-src-elem 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maps.googleapis.com",
      "worker-src 'self' blob:",
      `img-src 'self' blob: data: https: http://localhost:*`,
      `media-src 'self' ${bucketOrigin}`,
      `connect-src 'self' https://maps.googleapis.com https://*.googleapis.com https://maps.google.com ${bucketOrigin}`,
      "font-src 'self' https://fonts.gstatic.com data:",
      "frame-src 'self' https://*.google.com https://js.stripe.com",
    ].join("; ")
  );
  next();
});
```
After deploying, manually verify in a real browser devtools console (Network + Console tabs) that a video creation plays and a 3D avatar model loads with zero CSP violation warnings — this is the kind of bug that won't show up in `tsc` or in a local dev server without the header.

### 0.3 Fix SSRF in `/api/download`
**File:** `server.ts:1189`

```ts
app.get("/api/download", requireAuth, async (req: AuthedRequest, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).send("Missing url parameter");
  const allowed = process.env.MEDIA_BUCKET_URL;
  if (!allowed || !url.startsWith(allowed)) {
    return res.status(403).send("URL not allowed");
  }
  // ...rest unchanged
});
```

### 0.4 Verify album ownership before reassigning a creation
**File:** `server.ts:1159-1185`, `db.ts`

```ts
if (album_id !== undefined && album_id !== null) {
  const [albumRows] = await getPool().query(
    "SELECT id FROM albums WHERE id = ? AND user_phone = ? LIMIT 1",
    [album_id, req.user!.phone]
  ) as any;
  if (!albumRows.length) {
    return res.status(403).json({ success: false, error: "Album not found or not yours." });
  }
  updates.album_id = album_id;
}
```

### 0.5 Add basic hardening
- `npm install express-rate-limit` and apply a limiter to `/api/auth/login`, `/api/auth/signup`, and `/api/create-video` (e.g. 10 req/min/IP).
- Register process-level safety nets in `server.ts`, near the top of the boot sequence:
  ```ts
  process.on("unhandledRejection", (reason) => {
    console.error("[FATAL] Unhandled rejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[FATAL] Uncaught exception:", err);
  });
  ```
  Logging-only, non-exiting, is the right default here given the many fire-and-forget background jobs — the goal is to stop a single bad async throw from silently killing the whole process without a trace, not to add a crash-and-restart loop.

---

## Phase 1 — Core functional fixes

### 1.1 Fix Veo video byte extraction
**File:** `server.ts:1549`, `server.ts:1682`
```ts
let videoUrl: string;
if (videoData.uri) {
  const gcsRes = await fetch(videoData.uri);
  const buf = Buffer.from(await gcsRes.arrayBuffer());
  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${buf.toString("base64")}`);
} else if (videoData.imageBytes) {
  videoUrl = await uploadBase64Image(`data:video/mp4;base64,${videoData.imageBytes}`);
} else {
  throw new Error("Veo returned no video URI or bytes");
}
```
Apply identically at both line numbers (on-demand poll route and background poller).

### 1.2 Fix the invalid Gemini image model name
**File:** `server.ts:816`, `server.ts:935`
```ts
// Replace 'gemini-2.5-flash-image' with a real image-generation model, e.g.:
model: 'gemini-2.0-flash-exp-image-generation',
```
Confirm the exact current model name against Google's Gemini API docs at implementation time — model names/aliases change; don't hardcode from this spec without checking.

### 1.3 Fix Twilio SMS sender
**File:** `.env.example`, `server.ts:1480, 1518, 1565, 1623, 1658, 1697`
1. Add to `.env.example`:
   ```
   TWILIO_PHONE_NUMBER="+1XXXXXXXXXX"
   ```
2. Replace `from: process.env.TWILIO_VERIFY_SERVICE_SID` with `from: process.env.TWILIO_PHONE_NUMBER` at all six sites.
3. Send one real test SMS end-to-end after deploying (fulfill a test memory request) — this path has apparently never worked, so don't trust a code read alone.

### 1.4 Fix the avatar-status polling race
**File:** `server.ts:376-433`

Add an in-process lock keyed by avatar ID before spawning the background pipeline, so two near-simultaneous polls can't both pass the check:
```ts
const avatarBuildLocks = new Set<number>(); // module-level, near other in-memory state

// inside the route, right after confirming poll.done && !poll.error:
if (avatarBuildLocks.has(avatarId)) {
  return res.json({ status: "rigging" }); // already building, don't double-spawn
}
avatarBuildLocks.add(avatarId);
await getPool().query(`UPDATE avatars SET meshy_handle = NULL WHERE id = ?`, [avatarId]);
await updateAvatarGenerationStatus(avatarId, "rigging");
// ...spawn background IIFE as before, and in its finally block:
finally {
  avatarBuildLocks.delete(avatarId);
}
```
This is an in-memory lock, which is good enough for a single-process deployment; if the app ever runs multiple Node instances behind a load balancer, replace with a DB-level `SELECT ... FOR UPDATE` or a Redis lock.

### 1.5 Fix the sprite-load fallback (closes failing test #10)
**File:** `src/components/Avatar3DPlaypen.tsx`

Add a `showFallbackImage` condition alongside the existing `showSpriteError` block, rendering the pet's original photo instead of (or above) the dead-end error card:
```tsx
const showFallbackImage = (spriteLoadFailed || (!avatar.sprite_sheet_url && avatar.generation_status === "done")) && !!avatar.image_url;

// in the render, replace/augment the showSpriteError block:
{showFallbackImage && (
  <img
    src={avatar.image_url}
    alt={avatar.name}
    className="w-32 h-32 sm:w-40 sm:h-40 rounded-full object-cover drop-shadow-xl"
  />
)}
```
Re-run `node --test tests/*.test.mjs` after this change — test #10 should flip to passing.

### 1.6 Make the brightness/contrast sliders do something
**File:** `server.ts` (~line 816, before the prompt is finalized)
```ts
if (brightness > 70) promptText += ` Use very bright, high-key lighting.`;
else if (brightness < 30) promptText += ` Use moody, low-key dramatic lighting.`;
if (contrast > 70) promptText += ` High contrast, punchy colors.`;
else if (contrast < 30) promptText += ` Soft, low-contrast, pastel tones.`;
```

### 1.7 Use the real album cover
**File:** `server.ts:1104, 1124`
```ts
imageUrl: a.cover_url || "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=80&w=600&auto=format&fit=crop",
```
(`db.ts`'s `getAlbums` already computes `cover_url` — this is purely an API-layer fix.)

### 1.8 Add a React error boundary
**File:** `src/App.tsx` (or a new `src/components/ErrorBoundary.tsx` wrapping the app root in `src/main.tsx`)
Standard class-based boundary catching render errors and showing a "Something went wrong, reload" screen instead of a blank white page.

---

## Phase 2 — Cleanup & documentation accuracy

- Delete or clearly quarantine dead code: `avatar-agent.ts`, `meshy.ts`, `huggingface-3d.ts` (confirm zero imports first — already verified in the review), and move `scratch-gradio*.js`, `test-*.ts`, `test_*.ts`, `check_db.js`/`check_db.cjs` into a `/scripts/manual/` folder with a README noting these hit live APIs and are not part of the build.
- Update `.env.example` and `README.md`'s env var table to add the missing `HEYGEN_API_KEY` / `HEYGEN_DEFAULT_VOICE_ID`, and either remove `ANTHROPIC_API_KEY`/`OPENAI_*`/`OLLAMA_*`/`MESHY_API_KEY`/`HUGGINGFACE_*` (if staying single-model) or actually wire them into `reason.ts`/`act.ts` (if the multi-model architecture described in the README is still the intended direction — see Phase 3.2 for where that would plug in).
- Fix `package.json`'s `"name": "react-example"` to `"paws-and-memories"` or similar.
- Replace the three remaining dynamic `require("./db")` calls in route handlers (`server.ts:237, 268, 281`) with the top-level `getPool`/named imports already used everywhere else, for consistency (low risk, but removes an inconsistency that makes the codebase harder to trust at a glance).

---

## Phase 3 — 3D Avatar Generation Overhaul

This is the core request: make the avatar pipeline actually produce (and *show*) a stronger 3D result. Ordered by impact-to-effort ratio — do 3.1 first, it's the single highest-leverage change.

### 3.1 Stop discarding the 3D asset — render the real GLB in the Playpen
**Today:** `Avatar3DPlaypen.tsx` draws a baked 128×128 sprite sheet to a `<canvas>`, with "3D Parallax Hover" implemented purely as a CSS/Framer-Motion tilt on the flat image. The actual rigged, lit, textured GLB this whole multi-agent pipeline produces is only ever seen through the separate `PetModelViewer` (Google `<model-viewer>`) component, which isn't part of day-to-day feeding/watering/play interactions.

**Change:** Render the GLB directly in the Playpen instead of a sprite:
- Reuse `<model-viewer>` (already loaded via CDN in `index.html`) inside `Avatar3DPlaypen.tsx`, or adopt a lightweight `@react-three/fiber` canvas if finer animation-state control is needed than `<model-viewer>`'s built-in `animation-name` attribute allows.
- Drive the existing action states (`eating`, `drinking`, `running`, `playing`, `sleeping`, `photo`) as named GLB animation clips (already baked during the build pipeline — `finalize.ts` exports the rigged GLB with animations/skins enabled) via `<model-viewer animation-name="eating" autoplay>` instead of sprite-frame stepping.
- Keep the sprite-sheet render as a lightweight fallback tier for low-end devices/slow connections (feature-detect WebGL support, or a user/device settings toggle), but it should be the exception path, not the default — and per Phase 1.5, it must fall back further to the static photo if it fails too, never to a blank state.
- This single change is what actually surfaces all the material/rig/lighting quality work below to users — without it, none of the rest of this phase is visible in normal use.

### 3.2 Structure & rigging
- **Multi-view capture:** Prompt users to optionally supply 2-3 angle photos (front, side, 3/4) in the avatar creation flow (`CreateAvatarDialog.tsx`), and pass them to Tripo3D's multiview mode if available on your plan tier (check current Tripo3D API docs — the `type` field supports more than `image_to_model`); this directly reduces guessed/hallucinated geometry on the back and underside that a single photo can't see.
- **Request Tripo's higher-fidelity output flags.** `tripo.ts`'s `startImageTo3D()` currently sends only `{ type: "image_to_model", file: {...} }` — no `texture`, `pbr`, or `quad` options. Check Tripo3D's current API reference for available quality/texture/topology parameters and request the higher tier explicitly rather than accepting whatever the default is.
- **Species-aware skeletons.** Replace the single dog-shaped bone list (`front_leg_upper.L/R`, `tail_01-03`, etc., defined implicitly across `reason.ts` and `breed-anatomy.ts`) with distinct templates per `bodyType`: quadruped-mammal (current), biped/winged (birds — wing bones, 2 legs, no `front_leg_*`), and a "small pet" variant (hamster/rabbit — different proportion defaults, optional no-tail path already partially supported via `hasTail`). `agent/knowledge/breed-anatomy.ts` already has a `sections`/`animationModifiers` structure per breed — extend it with a `skeletonTemplate` field and branch `generateBuildPlan()` in `reason.ts` on it.
- **Make explicit vertex-group binding the primary path, not a supplement.** `act.ts:386-414` already contains logic to compute vertex groups by body-region proximity — but `parent_set(type='ARMATURE_AUTO')` (Blender's heat-diffusion auto-weight, prone to failure on thin geometry like ears/tail/whiskers) still runs as the actual bind step at `act.ts:406`. Flip the order: attempt the explicit region-based weights first, and only fall back to `ARMATURE_AUTO` if that fails validation (this is also what closes failing test #9).
- **Add a mesh-cleanup step before rigging.** Currently the "verify mesh import" step only counts vertices/faces and checks normals. Add non-manifold edge detection and removal of floating/interior geometry (common in single-image reconstructions) using `bpy.ops.mesh.select_non_manifold()` + cleanup, gated behind a vertex-count-safe timeout.

### 3.3 Textures, materials, and colors
- **Extract real coat color/pattern from the photo and drive the material from it.** Extend the `analyzePetImage()` prompt in `avatar-agent.ts`/`ollama-agent.ts` to also return `{ primaryColor: "#hex", secondaryColor: "#hex" | null, pattern: "solid" | "brindle" | "spotted" | "tabby" | "calico" | "patched" }`. Feed this into a new deterministic material-setup template (alongside the existing camera/lighting template in `act.ts`) that builds a `ColorRamp`/`Voronoi`-driven Principled BSDF using the sampled colors, instead of today's single generic noise bump applied identically to every pet regardless of what it actually looks like.
- **Coat-type-aware material presets**, keyed off `species`/`bodyType` (already available from `PetAnalysis`): short-hair fur (fine noise, low bump strength), long-hair fur (coarser noise, higher bump strength + optional light hair-particle pass for close-up model-viewer use, see below), feather (anisotropic shading, directional noise for birds), scale/smooth skin (reptiles/hairless breeds — near-zero bump, higher specular). Replace the current one-size-fits-all `Scale=150 / Strength=0.4 / Roughness=0.8` constants with a lookup table.
- **Add nose/eye/paw-pad detailing.** A small, cheap win: identify the material slot(s) nearest the head-front region (already computable — the same vertex-centroid logic used for bone placement) and add a localized higher-gloss/lower-roughness zone plus a touch of subsurface scattering, giving the classic "wet nose" highlight instead of a flat uniform material across the whole mesh.
- **Background matting before mesh generation.** Confirm whether the raw uploaded photo (including background) is sent to Tripo3D as-is; if so, background color can bleed into the reconstructed texture. Add a background-removal pass (Gemini can already do rough segmentation, or a dedicated matting library) before the image is handed to `startImageTo3D()`.
- **User color-correction fallback.** Add a simple 2-3 swatch color picker in the avatar review step so a user can manually correct the sampled palette when lighting fooled the AI — cheap to build, meaningfully improves trust in edge cases.
- **Evaluate real fur for the model-viewer path.** Since the sprite-sheet render is being demoted to a fallback tier (3.1), the GLB is now the primary viewing surface — it's worth prototyping Blender's hair particle/curves system baked into the export for close-range viewing, keeping the cheap procedural bump-only approach for whichever low-end fallback path remains.

### 3.4 Movement & animation
- **Extend deterministic coverage to all six animations.** `deterministicCodeForAction()` in `act.ts` already exists and is used for some steps (camera/lighting, sprite render) but the six action animations (eat/drink/run/play/sleep/photo) are still freeform LLM-authored bpy per build today, which is why quality/consistency varies run to run and occasionally crashes on hallucinated APIs. Write deterministic parametrized templates for each of the six, taking the existing `breed-anatomy.ts` `animationModifiers` (already computed: `eatingReach`, `runGaitType`, `spineFlexMultiplier`, `playBounce`, `tailWagAmplitude`) as numeric inputs, mirroring how the camera/lighting and sprite-render steps already work. This removes the LLM from the animation-authoring path entirely for the common case, using it only as a fallback if a deterministic template doesn't cover a given breed edge case.
- **Blend/transition frames between states.** Add a short (4-6 frame) crossfade when switching actions instead of the current hard cut — for the GLB path (3.1) this is a simple `<model-viewer>` crossfade on `animation-name` change; for any remaining sprite path, interpolate between the last frame of the outgoing loop and the first frame of the incoming one.
- **Foot-locking on the run cycle.** The current run/gallop animation only rotates leg bones without correcting for foot-plane contact, so paws can visibly slide or clip through the ground. Add a simple IK constraint (Blender's built-in `IK` bone constraint) on the paw bones for the run and play animations, target-locked to the ground plane during stance phases.
- **Secondary motion on every animation, not just sleep.** Add subtle chest-scale breathing to the idle/eating/drinking loops (currently only in `sleeping`), and ear/jowl follow-through lag on the run/play loops (a one-frame-delayed copy of the head rotation curve, damped, applied to the ear bones — cheap and very perceptible).
- **Variable frame counts and playback speed by breed pace.** Raise run/play from the fixed 24 frames to a range (24-36) driven by `animationModifiers`, and vary sprite/clip playback fps by breed size (a Great Dane's run cycle should read differently from a Chihuahua's) rather than the current fixed 12fps/6fps table in `Avatar3DPlaypen.tsx`'s animation metadata defaults.

### 3.5 Features (expressiveness & species range)
- **Tie facial rig to Tamagotchi state.** The rig already has `jaw`, `eye.L/R`, `ear.L/R` bones, but they're only driven for a single blink in the "photo" animation. Add 2-3 expression states (happy/neutral/tired) driven by the avatar's current `food_level`/`water_level` (already tracked in the `avatars` table) — subtle ear droop and slower blink rate when hungry/thirsty, perkier ears and faster tail wag when well-fed. This makes the avatar visibly communicate its state through the actual rig, not only through the emoji overlays `Avatar3DPlaypen.tsx` already does at the UI layer.
- **Species-specific rig features**, gated on the skeleton template from 3.2: wing bones + a hop/short-flight animation for birds, ear-type variants (floppy vs. erect) driven by the existing breed lookup rather than only proportion scaling, optional whisker bones for cats.
- **Idle micro-behaviors sourced from the rig, not just front-end sprite tricks.** The current "hop and flip direction" idle roaming is implemented as canvas/CSS logic in `Avatar3DPlaypen.tsx`, disconnected from the actual 3D animation set. Add 1-2 short idle-variation clips to the build pipeline (head-turn-to-camera, a stretch) that the frontend can randomly select between during idle periods, so long-session users see more variety than the current fixed 6-loop set.

### 3.6 Detail / fidelity tiers
- **Two-pass quality delivery.** Kick off avatar generation with a fast, lower-fidelity pass shown to the user immediately (smaller mesh budget, faster render), then silently upgrade to the full-fidelity pipeline (3.2-3.5 above) in the background and swap the model in-place when ready — better perceived performance than the current single fixed-latency pipeline, and gives you a natural place to gate the expensive texture/multi-view work behind a "still improving your pet's avatar..." state.
- **Explicit triangle budget tiers instead of reactive-only decimation.** Today decimation is only triggered reactively if a mesh exceeds 50k verts mid-build. Set explicit target budgets up front (e.g., mobile ~15k tris, desktop/model-viewer ~40k tris) and decimate proactively as a normal pipeline step, producing more consistent, predictable load times and file sizes across avatars instead of wide variance based on how detailed a given Tripo3D reconstruction happened to be.

---

## Phase 4 — Verification checklist

Before calling any of the above "done," re-run:
```bash
npm run lint    # tsc --noEmit — must stay at 0 errors
npm run build   # must succeed
npm test        # node --test — target 10/10 passing, especially #9 and #10
```
Then manually smoke-test against a real deployed environment (not just `localhost`) with devtools open:
1. Create a still image from an uploaded pet photo — confirm the actual photo is used (closes 1.2).
2. Generate a video and confirm it plays (closes 1.1 + 0.2).
3. Trigger a memory-request fulfillment and confirm the SMS actually arrives (closes 1.3).
4. Build a fresh avatar end-to-end and open the Playpen — confirm it's rendering the real GLB (closes 3.1), the pet's coat colors are reflected in the material (closes 3.3), and killing the sprite/model URL still shows the pet's static photo rather than a blank error card (closes 1.5).
5. Attempt an unauthenticated `POST` to the Blender worker's `/execute` from outside the app and confirm it's rejected (closes 0.1).

---

## Environment variables checklist (additions/changes only — full list is in the review §7)

```
# New — required
WORKER_SHARED_SECRET=            # Phase 0.1 — blender-worker auth
TWILIO_PHONE_NUMBER=             # Phase 1.3 — was missing entirely
HEYGEN_API_KEY=                  # already used in code, was undocumented
HEYGEN_DEFAULT_VOICE_ID=         # already used in code, was undocumented

# Confirm these still work after the CSP fix (Phase 0.2) — no new vars,
# but MEDIA_BUCKET_URL's exact origin must be correct and reachable:
MEDIA_BUCKET_URL=

# Remove from .env.example, or wire up for real (Phase 2) — currently dead:
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_HTTP_REFERER=
OPENAI_X_TITLE=
OLLAMA_API_URL=
OLLAMA_MODEL=
MESHY_API_KEY=
HUGGINGFACE_SPACE=
HUGGINGFACE_TOKEN=
```
