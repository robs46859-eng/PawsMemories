# Blender Rig & Clip Pipeline (Phase 5)

Status: SPEC — the consumer side (app) is built and waiting for rigged models.
Goal: produce, for each generated pet, a **rigged GLB with named skeletal
animation clips** that the 3D/AR scene plays. The app already:

- reads `avatar.rigged_model_url` (preferred over `model_url`) and plays clips by name,
- resolves behavior → clip via fuzzy name matching (`src/three/clipMap.ts`),
- has DB columns `rigged_model_url` + `clips_json`, a helper `updateAvatarRiggedModel(id, phone, url, clips)`, and pipeline statuses `retargeting` / `baking_clips`.

So once the worker writes a rigged GLB + clip manifest and calls
`updateAvatarRiggedModel`, animations light up with **no further app changes**.

## The remaining (manual/Blender) work

### 1. Author a canonical quadruped rig — ONCE
Build one standard armature in Blender (`assets/rigs/quadruped.blend`):
- Consistent bone names (e.g. `spine`, `hip`, `shoulder.L/R`, `leg_front.L/R`,
  `leg_back.L/R`, `neck`, `head`, `jaw`, `tail.01..`, `ear.L/R`).
- Author every clip against THIS rig so they retarget to any pet:
  `idle`, `walk`, `run`, `sit`, `sleep`, `eat`, `drink`, `play`, `pee`
  (leg-lift), `poop` (squat), `bark`/`speak`, `sniff`/`interact`.
- Clip names should contain the fragments in `clipMap.ts` (e.g. a clip named
  `pee_legLift` matches `peeing`).

### 2. Retarget the Tripo mesh onto the canonical rig — per avatar
In `blender-worker` (extends the existing GLB import/export that already guards
the data-URL prefix and avoids `quad`):
1. Import the generated mesh GLB.
2. Fit/scale the canonical armature to the mesh (align by bounding box + a few
   landmark heuristics, or a stored per-breed preset).
3. Auto-weight (`ARMATURE_AUTO` / heat map) or transfer weights.
4. Copy the authored actions onto the mesh's armature (NLA / action retarget).
5. Export ONE `.glb` with all actions as glTF animation tracks
   (`export_animations=True`, `export_nla_strips=True`). Draco-compress.

### 3. Wire the worker → app
- Add worker endpoint `POST /retarget-and-export` returning `{ glbBase64, clips: [{name,loop,durationSec}] }`.
- In the server generation flow: set status `retargeting` → `baking_clips`, upload
  the GLB (object storage or data URL), then call
  `updateAvatarRiggedModel(avatarId, phone, riggedUrl, clips)` and finish `done`.

> Not automated here because it needs a running Blender instance, the authored
> `.blend` clip library, and per-species tuning — art + offline compute, not app
> code. A connected Blender MCP could drive steps 1–2 interactively later.

## Bridge (already live)
Until rigged models exist, the scene animates **procedurally**
(`src/three/AvatarModel.tsx → applyProcedural`), so commands and autonomous
behaviors already look alive. Each clip you ship replaces its procedural stand-in
automatically via the name resolver.
