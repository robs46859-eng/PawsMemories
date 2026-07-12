# Session Error Log — 2026-07-10

Fixes made during architect-review of the PawsMemories / Pawsome3D app. All three
code fixes are in the working tree and were bundled into `pawsome3d-deploy-fix2.zip`.
`tsc --noEmit` passes clean after every fix.

Commit staging the fixes:
`server.ts`, `src/animator/components/AnimatorScreen.tsx`,
`src/animator/controller/useSceneController.ts`.

---

## 1. Admin login rejected with 401 (BLOCKER)

**Symptom.** Correct admin credentials returned `POST /api/auth/login → 401
{"error":"Unauthorized. Please sign in to continue."}`. Signup was silently broken
by the same cause. The password matched on both sides, so it looked like a
hash/env problem — it was not.

**Root cause.** `server.ts` registered a blanket auth guard on the whole `/api`
prefix *before* the public auth routes:

```ts
app.use("/api", requireAuth, animatorRouter);   // gated ALL /api/*
```

A router mounted at `/api` runs its guard for every `/api/*` request. Registered
ahead of `/api/auth/login` (356) and `/api/auth/signup` (287), `requireAuth` fired
on login, found no Bearer token, and returned 401 before the login handler — and
`verifyPassword` — ever ran. Any other public `/api` route was gated too.

**Fix.** Scope the guard to only the namespaces the animator router actually serves
(`/animator/*`, `/scenes/*`), letting public routes through:

```ts
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/animator") || req.path.startsWith("/scenes")) {
    return requireAuth(req as AuthedRequest, res, next);
  }
  return next();
}, animatorRouter);
```

**File.** `server.ts` (~line 240).
**Verified.** `tsc --noEmit` clean. Animator/scenes routes stay auth-protected;
login/signup reachable.

---

## 2. React-three-fiber crash — "Hooks can only be used within the Canvas component!" (BLOCKER)

**Symptom.** Opening the Studio Animator threw
`R3F: Hooks can only be used within the Canvas component!` and the error boundary
(`componentDidCatch`) killed the view.

**Root cause.** `useSceneController()` calls `useFrame` (a react-three-fiber hook),
but it was invoked at the top of `AnimatorScreen` — a plain DOM component whose
`<Canvas>` is a *child* element. `useFrame` only works inside the Canvas render
tree, so the hook threw on mount.

**Fix.** Removed the illegal `useFrame` call from the hook (leaving it Canvas-free
so the UI panels can still use it) and extracted the per-frame tick into a
null-rendering `SceneTicker` component rendered *inside* `<Canvas>` (via
`Viewport`).

```tsx
export function SceneTicker({ controller }: { controller: { update: (d: number) => void } }) {
  useFrame((_, delta) => controller.update(delta));
  return null;
}
```

**Files.** `src/animator/controller/useSceneController.ts`,
`src/animator/components/AnimatorScreen.tsx`.
**Verified.** `tsc --noEmit` clean. Same runtime behavior, legal hook placement.

---

## 3. Generated GLB models 404 on load (PARTIAL — code fix + data-state issue)

**Symptom.** `<model-viewer>` on the dashboard/gallery threw repeated 404s, e.g.
`pawsmemories-media.s3.us-east-005.backblazeb2.com/models/<ts>-<uuid>.glb → 404`.

**Root cause (code).** `/api/image-to-3d/:jobId/status` stored and returned the raw
provider (Tripo) GLB URL as `model_url`, unlike every sibling poller
(`/api/jobs`, AR bake path) which mirrors the file into Backblaze via
`uploadBinaryFromUrl` first. Provider URLs are temporary, so those models 404 once
the provider expires the link.

**Fix.** Mirror the provider URL into Backblaze before storing/returning, matching
the existing convention:

```ts
let durableUrl = poll.glbUrl;
try { durableUrl = await uploadBinaryFromUrl(poll.glbUrl, "model/gltf-binary"); }
catch (e) { console.error(`[image-to-3d] Failed to mirror GLB for job ${jobId}:`, e); }
await setCreationModelUrl(job.creation_id!, req.user!.phone, durableUrl).catch(() => {});
return res.json({ status: "done", model_url: durableUrl, progress: 100 });
```

**File.** `server.ts` (~line 3150).
**Verified.** `tsc --noEmit` clean. Stops this class of 404 going forward.

**Not code-fixable from here (data-state).** The 404 URLs already in the DB point to
Backblaze `models/` keys whose objects are missing from the bucket (correct URL
format, absent bytes). Likely a bucket lifecycle/retention rule, a migration gap
from the reused mypets.cc bucket, or uploads recorded despite failing. Existing
broken rows will not self-heal — those models need regenerating. See Phase 6 for the
audit + backfill task.

---

## Identified but NOT yet fixed (carried into Phase 6)

- **Audio uploads mis-filed as `.bin`.** `storage.ts` `getExtensionFromMime` has no
  audio entry and `getFolderFromMime` is not audio-aware, so `audio/webm` voiceover
  uploads land as `creations/<ts>.bin`. Add audio MIME + folder mapping.
- **No per-feature B2 folders.** Storage routes everything into a fixed 3-folder
  scheme (`videos/ models/ creations/`); no per-feature prefixes.

---

## Environment note (not an app error)

`git commit` and zip-overwrite could not complete from the sandbox: the working
folder is a macOS→Linux mount that blocks file `unlink`, so git cannot clear its
lock files (`.git/index.lock`) and `zip` cannot finalize its rename. Workaround
used: build the deploy zip from `git ls-files` in `/tmp` (sandbox-native fs), then
copy it into the project folder under a new name. Commits must be run on the local
machine.
