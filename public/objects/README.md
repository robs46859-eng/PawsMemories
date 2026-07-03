# Pet object 3D assets

Drop GLB models here and they render in the Live 3D scene and AR automatically.
No code or build step needed — Vite serves `public/` at the web root, so a file
at `public/objects/food_bowl.glb` is fetched from `/objects/food_bowl.glb`.

## Exact filenames (must match)

| File                       | Object     | Avatar interaction |
| -------------------------- | ---------- | ------------------ |
| `public/objects/food_bowl.glb`  | Food bowl  | walks over & eats  |
| `public/objects/water_bowl.glb` | Water bowl | walks over & drinks |
| `public/objects/ball.glb`       | Ball       | plays / fetch      |
| `public/objects/bone.glb`       | Bone       | plays / chews      |
| `public/objects/chew_toy.glb`   | Chew toy   | plays              |
| `public/objects/bed.glb`        | Dog bed    | sleeps on it       |
| `public/objects/dog_house.glb`  | Dog house  | sleeps in it       |
| `public/objects/hydrant.glb`    | Fire hydrant | pees on it       |

Any file you haven't added yet automatically falls back to a built-in
low-poly placeholder — so you can add them one at a time.

## Format requirements

- **Format:** `.glb` (binary glTF). If you download `.obj`, `.fbx`, or `.blend`,
  convert to GLB first (Blender: File → Export → glTF 2.0 `.glb`; or CLI
  `obj2gltf -i model.obj -o model.glb`).
- **Scale/orientation:** don't worry about exact size — each model is
  auto-normalized to a sensible size and dropped onto the ground. Just make sure
  it's roughly upright (Y-up) and the "front" faces +Z if it matters.
- **Keep them light:** aim for < 2 MB each; Draco/meshopt compression is fine.

## Where to get free assets

- OpenGameArt.org — filter license to **CC0** (no attribution) or **CC-BY**
  (attribution required — record it below).
- Other CC0 sources: Poly Pizza, Quaternius, Kenney.nl (great low-poly packs).

## Licensing — fill this in

For every real asset you add, record its source and license in
`manifest.json` (next to this file). CC-BY assets must be credited in-app;
do **not** use GPL-licensed models in the app.
