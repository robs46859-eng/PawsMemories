# Text→3D + Geometry Options — Build Plan & Status

_Last updated: 2026-07-08_

Covers the text-prompt generator, dramatic lighting ("shadows"), and quad topology.
Written so work can resume from any point.

---

## 1. Already built and verified (in the tree now)

**Text → 3D generator** — a "Describe it" mode on the 3D Studio (`ImageTo3DPanel`)
that assembles a structured prompt from dropdowns, renders a reference image via
Gemini, previews it, then feeds the existing Tripo `image_to_model` pipeline.

- `avatarPrompts.ts` — option lists (single source of truth for dropdowns),
  clause maps, `buildTextPrompt()`, `geometryToTripo()`.
- `tripo.ts` — `TripoJobInput.geometry` threads `faceLimit` / `texture` / `pbr`
  into the Tripo task (defaults unchanged, so all existing callers behave the same).
- `server.ts` — `POST /api/text-to-reference` (text → reference image);
  `/api/image-to-3d` now accepts an optional `geometry` object.
- `src/api.ts` — `generateTextReference()` + `geometry` arg on `submitImageTo3D()`.
- `src/components/ImageTo3DPanel.tsx` — Upload / Describe toggle, subject field,
  Style / Framing / View-angle / Lighting / Detail / Texture dropdowns, preview flow.

**Dramatic lighting ("shadows")** — DONE. Added 5 shadow-baking lighting options
(`dramatic_rim`, `rembrandt`, `low_key`, `neon`, `backlit`) to
`TEXT_LIGHTING_OPTIONS` with matching prompt clauses. Each carries a hint that it
bakes shadows and lowers 3D-reconstruction fidelity, but they now work end to end.

Status: `tsc --noEmit` passes; full `vite build` passed on the earlier pass.

---

## 2. Quad topology — the hard truths first

Two facts drive the whole design:

1. **glTF/GLB cannot store quads.** The format only has triangle primitives. So a
   genuine quad deliverable must be exported as **FBX or OBJ**. Quads are for the
   user's downstream tools (Blender / Maya / ZBrush), not for the browser.
2. **Your in-app viewer is GLB-only** (`<model-viewer>` in `PetModelViewer`). It
   cannot render FBX. So for a quad job the plan is: **keep a triangulated GLB for
   the in-app preview, and offer the quad FBX/OBJ as a download.**

Net UX: quad option → preview shows the (triangulated) GLB as usual, plus a
"Download quad FBX" button. No behaviour change for the default triangle path.

---

## 3. AutoRemesher — findings from looking it up

You pointed me at AutoRemesher (huxingyi/autoremesher). What I found matters:

- **License is GPL-3.0, not MIT.** The 80.lv article says MIT; the GitHub repo
  itself states **GPL-3.0**. Invoking it as a separate CLI binary (not linking it
  into our code) generally keeps our app's license clean, but it's a real
  consideration and the article is simply wrong on this point.
- **It's a Qt GUI application, shipped on Linux as an AppImage.** The README's only
  documented usage is "run the exe / run the AppImage" — a desktop GUI. There is
  **no documented headless CLI / batch mode.** Automating it on a headless Render
  server would mean an `xvfb` virtual-display hack, and it may not expose a
  non-interactive "load mesh → remesh → save" path at all.
- **Last release is 1.0.0-beta.3 from Sep 2020.** The "now at 1.0" framing is
  generous; upstream has been quiet for years.

**Assessment:** AutoRemesher is a strong *desktop* tool but a poor fit for an
automated server pipeline (GUI-only, GPL, stale). Wiring it into the Render worker
is high-effort and high-risk, for output quality that's comparable to the
alternative below.

---

## 4. Recommended quad engine — Blender QuadriFlow (already in your stack)

Your `blender-worker` already runs **Blender headless (bpy)** and processes meshes
(`jobs/bake_lod.py` decimates, renames bones, exports). Blender ships a built-in
quad retopology operator, **QuadriFlow** (`bpy.ops.object.quadriflow_remesh`),
same class of algorithm as AutoRemesher.

Why it wins here:
- **Zero new infra** — Blender is already installed and running headless on Render.
- **No GPL entanglement** beyond Blender itself, which you already ship.
- **Headless-native** — no GUI / xvfb hacks.
- **Exports FBX and OBJ with quads directly** via `bpy.ops.export_scene.fbx` /
  `wm.obj_export`, reusing the worker's existing export plumbing.

(If quality is ever insufficient, the Blender **Remesh modifier** or an
AutoRemesher AppImage-via-xvfb spike are fallbacks — but start with QuadriFlow.)

---

## 5. Build plan for the quad option (NOT yet built — resume here)

Estimated ~1 day, most of it in the worker. Steps, in order:

1. **UI (`ImageTo3DPanel.tsx`)** — add a "Topology" dropdown: `Triangles (GLB)`
   *(default)* / `Quads (FBX download)`. Add a `TEXT_TOPOLOGY_OPTIONS` list to
   `avatarPrompts.ts` so it stays a single source of truth. When Quads is selected,
   show the shadow-style "download-only, no live preview of the quad file" hint.

2. **Client + endpoint plumbing** — add `topology` to `ImageTo3DGeometry`
   (`src/api.ts`) and pass it through `submitImageTo3D` → `/api/image-to-3d`.

3. **Worker job (`blender-worker/jobs/remesh_quad.py`)** — new bpy script:
   import the Tripo GLB, select the mesh, run
   `bpy.ops.object.quadriflow_remesh(target_faces=N)`, transfer the texture/UVs,
   export **FBX** (quads preserved). Return the FBX path/bytes like `bake_lod.py`
   returns `BAKE_RESULT:{json}`. Wire a `remesh-quad` route in
   `blender-worker/server.js` (mirror the bake-lod handler).

4. **Server orchestration (`server.ts`)** — when a job requests quad topology,
   after Tripo returns the GLB, POST it to the worker's `remesh-quad` endpoint,
   rehost the returned FBX (see step 5), store it as a second URL
   (`model_fbx_url`) alongside the triangulated GLB preview URL.

5. **Storage (`storage.ts`)** — add FBX MIME support: map `model/fbx` (or
   `application/octet-stream` for `.fbx`) → extension `fbx`, folder `models`, in
   `getExtensionFromMime`. Currently only glb/gltf are mapped.

6. **Job status shape** — extend `/api/jobs/:id` + `pollJob()` to return
   `model_format` and an optional `download_url` (the FBX) so the panel can show
   the GLB preview and a "Download quad FBX" button.

7. **Verify** — one end-to-end quad run: text → GLB preview renders → FBX
   downloads and opens in Blender with quad faces. Then `tsc` + `vite build`, and
   rebuild the worker image on Render.

### Files touched (quad)
- `avatarPrompts.ts` (topology option list)
- `src/api.ts`, `src/components/ImageTo3DPanel.tsx`
- `server.ts` (orchestration), `storage.ts` (FBX MIME)
- `blender-worker/jobs/remesh_quad.py` (new), `blender-worker/server.js` (route)

---

## 6. Deploy notes (both features)

- Main app: manual prebuilt-zip flow — `vite build`, repackage
  `pawsome3d-deploy.zip`, deploy to Hostinger. Needs `TRIPO_API_KEY` + Gemini key
  (already set).
- Quad feature additionally requires **rebuilding the blender-worker image on
  Render** so the new `remesh_quad.py` / route ship. `WORKER_SHARED_SECRET` must
  still match across app and worker.

---

## 7. Open decision before quad build

Confirm the quad engine:
- **QuadriFlow in the existing worker (recommended)** — no new infra, no GPL, headless.
- **Insist on AutoRemesher** — accept the GUI/AppImage + xvfb spike and GPL review.
