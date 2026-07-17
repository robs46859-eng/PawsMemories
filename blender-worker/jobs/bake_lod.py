"""
blender-worker/jobs/bake_lod.py — AR_PET_SIM_SPEC §3.1 / §3.3

"bake-lod" job: take a Tripo-rigged quadruped GLB (already imported into the
current Blender scene by the worker) and produce a mobile-budget LOD:

  - decimate to <= 30k triangles (reject-and-retry at higher decimation if over)
  - downscale textures to <= 1024 px (single-atlas merge is a future refinement)
  - rename bones to the CANONICAL clip skeleton (skeletal-clips.js) via bonemap
  - validate the 4 leg chains exist
  - enforce budget: <= 30k tris, <= 40 bones, <= 4 MB GLB, clips resampled to 24 fps

Entry point: run_bake_lod(params) -> stats dict. The worker sends this file to the
Blender bridge, then calls run_bake_lod(...) and parses the `BAKE_RESULT:{json}`
line from stdout.

Runs inside Blender's Python (bpy). Not importable in Node/CI — the pure-JS budget
interpreter in server/rigBudget.ts is what the app unit-tests.
"""

import bpy  # type: ignore
import json
import os

# --- Hard budget (spec §3.3) ------------------------------------------------
MAX_TRIS = 30_000
MAX_BONES = 40
TEXTURE_SIZE = 1024
MAX_GLB_BYTES = 4 * 1024 * 1024
CLIP_FPS = 24
VISEME_NAMES = ("A", "B", "C", "D", "E", "F", "G", "H", "X")
VISEME_ALIASES = {
    "A": ("viseme_A", "viseme_MBP", "mouthClose"),
    "B": ("viseme_B", "viseme_EE"),
    "C": ("viseme_C", "viseme_EH"),
    "D": ("viseme_D", "viseme_AA", "jawOpen", "mouthOpen"),
    "E": ("viseme_E", "viseme_OH"),
    "F": ("viseme_F", "viseme_OO", "mouthPucker"),
    "G": ("viseme_G", "viseme_FV"),
    "H": ("viseme_H", "viseme_L"),
    "X": ("viseme_X",),
}


def _meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _armature():
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            return o
    return None


def _tri_count():
    total = 0
    for o in _meshes():
        me = o.data
        for poly in me.polygons:
            n = len(poly.vertices)
            total += max(0, n - 2)  # fan triangulation count
    return total


def decimate_to(max_tris=MAX_TRIS):
    """Add+apply a Decimate modifier per mesh, scaling ratio to hit the budget."""
    current = _tri_count()
    if current <= max_tris or current == 0:
        return current
    ratio = max(0.02, min(1.0, max_tris / float(current)))
    for o in _meshes():
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new(name="LOD_Decimate", type="DECIMATE")
        mod.ratio = ratio
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception:
            # If apply fails (e.g. context), leave the modifier; export still bakes it.
            pass
    return _tri_count()


def downscale_textures(max_size=TEXTURE_SIZE):
    """Scale every image down so its longest side is <= max_size."""
    for img in bpy.data.images:
        if not img.has_data:
            continue
        w, h = img.size[0], img.size[1]
        if w <= max_size and h <= max_size:
            continue
        scale = max_size / float(max(w, h))
        try:
            img.scale(int(w * scale), int(h * scale))
        except Exception:
            pass


def _match_bone(bone_names_lower, candidates):
    """Return the first source bone name whose lowercase contains a candidate fragment."""
    for frag in candidates:
        f = frag.lower()
        for raw_lower, raw in bone_names_lower:
            if f in raw_lower:
                return raw
    return None


def rename_bones(bonemap):
    """
    Rename armature bones to canonical names using bonemap['canonical'] candidates.
    Also renames the matching mesh vertex groups so skinning follows the rename.
    Returns (matched, total, missing[]).
    """
    arm = _armature()
    canonical = (bonemap or {}).get("canonical", {})
    total = len(canonical)
    if arm is None or total == 0:
        return 0, total, list(canonical.keys())

    # Build source->canonical, resolving on the *current* bone names.
    src_names = [(b.name.lower(), b.name) for b in arm.data.bones]
    resolved = {}  # canonical -> source raw name
    used_src = set()
    for canon, candidates in canonical.items():
        src = _match_bone([p for p in src_names if p[1] not in used_src], candidates)
        if src is not None:
            resolved[canon] = src
            used_src.add(src)

    missing = [c for c in canonical if c not in resolved]

    # Rename in edit mode for bones, and matching vertex groups on meshes.
    bpy.context.view_layer.objects.active = arm
    prev_mode = arm.mode
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        ebones = arm.data.edit_bones
        for canon, src in resolved.items():
            if src in ebones and canon not in ebones:
                ebones[src].name = canon
        bpy.ops.object.mode_set(mode=prev_mode if prev_mode != "EDIT" else "OBJECT")
    except Exception:
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass

    for o in _meshes():
        for canon, src in resolved.items():
            vg = o.vertex_groups.get(src)
            if vg is not None and o.vertex_groups.get(canon) is None:
                vg.name = canon

    return len(resolved), total, missing


def validate_leg_chains(bonemap):
    """True if all 4 canonical leg chains are present on the armature after rename."""
    arm = _armature()
    if arm is None:
        return False, ["<no armature>"]
    present = {b.name for b in arm.data.bones}
    missing = []
    for chain in (bonemap or {}).get("legChains", []):
        for bone in chain:
            if bone not in present:
                missing.append(bone)
    return (len(missing) == 0), missing


def bone_count():
    arm = _armature()
    return len(arm.data.bones) if arm else 0


def resample_actions(fps=CLIP_FPS):
    """glTF exports animation at scene fps; set it so clips bake to 24 fps."""
    bpy.context.scene.render.fps = fps
    bpy.context.scene.render.fps_base = 1.0


def _normalise_name(value):
    return "".join(ch.lower() for ch in value if ch.isalnum())


def _face_mesh(arm):
    """Prefer a named face mesh, then a mesh weighted to the canonical head."""
    meshes = _meshes()
    by_name = [mesh for mesh in meshes if any(term in mesh.name.lower() for term in ("face", "head", "mouth", "snout"))]
    if by_name:
        return max(by_name, key=lambda mesh: len(mesh.data.vertices))
    head_weighted = []
    for mesh in meshes:
        group = mesh.vertex_groups.get("head")
        if group is None:
            continue
        weighted = sum(1 for vertex in mesh.data.vertices if any(weight.group == group.index and weight.weight > 0.1 for weight in vertex.groups))
        if weighted:
            head_weighted.append((weighted, mesh))
    return max(head_weighted, default=(0, None), key=lambda pair: pair[0])[1]


def _copy_shape_key(source, target):
    for index, point in enumerate(source.data):
        target.data[index].co = point.co.copy()


def ensure_viseme_blendshapes(avatar_type):
    """
    Preserve high-quality provider morphs when they exist and canonicalize their
    names. Never synthesize geometry from a generated mesh: that can deform the
    neck, torso, or arms when the provider's head weights are imperfect.
    """
    if avatar_type == "object":
        return {"available": False, "mode": "not_applicable", "shapes": [], "detail": "Static objects do not receive a synthetic face."}
    arm = _armature()
    mesh = _face_mesh(arm)
    if mesh is None or len(mesh.data.vertices) < 16:
        return {"available": False, "mode": "bone_fallback", "shapes": [], "detail": "No face mesh or head-weighted geometry was found; jaw-bone lip sync remains available."}

    if not mesh.data.shape_keys or not mesh.data.shape_keys.key_blocks.get("Basis"):
        mesh.shape_key_add(name="Basis", from_mix=False)
    keys = mesh.data.shape_keys.key_blocks
    existing = {_normalise_name(key.name): key for key in keys}
    canonical = {}
    for shape in VISEME_NAMES:
        key_name = "viseme_" + shape
        target = keys.get(key_name)
        source = next((existing.get(_normalise_name(alias)) for alias in VISEME_ALIASES[shape] if existing.get(_normalise_name(alias))), None)
        if target is None and source is not None:
            target = mesh.shape_key_add(name=key_name, from_mix=False)
            _copy_shape_key(source, target)
        if target is not None:
            canonical[shape] = target

    shapes = ["viseme_" + shape for shape in canonical]
    if shapes:
        return {"available": True, "mode": "provider", "shapes": shapes, "mesh": mesh.name, "detail": "Preserved and canonicalized provider facial morphs."}
    return {"available": False, "mode": "bone_fallback", "shapes": [], "mesh": mesh.name, "detail": "No authored facial morphs were found; jaw-bone lip sync is used without changing mesh geometry."}


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_animations=True,
        export_apply=True,
    )
    return os.path.getsize(path) if os.path.exists(path) else 0


def run_bake_lod(params):
    """
    params: { "out_path": str, "bonemap": {...} }
    Returns a stats dict and also prints `BAKE_RESULT:{json}` for the worker.
    """
    out_path = params.get("out_path", os.path.join("/tmp", "lod.glb"))
    bonemap = params.get("bonemap", {})

    downscale_textures(TEXTURE_SIZE)
    tris = decimate_to(MAX_TRIS)
    matched, total, missing_map = rename_bones(bonemap)
    legs_ok, missing_legs = validate_leg_chains(bonemap)
    resample_actions(CLIP_FPS)
    viseme = ensure_viseme_blendshapes(params.get("avatar_type"))

    size = export_glb(out_path)

    # Reject-and-retry once at higher decimation if over the size or tri budget.
    if (size > MAX_GLB_BYTES or tris > MAX_TRIS) and tris > 0:
        decimate_to(int(MAX_TRIS * 0.75))
        tris = _tri_count()
        size = export_glb(out_path)

    confidence = (matched / total) if total else 0.0
    stats = {
        "tris": tris,
        "bones": bone_count(),
        "bytes": size,
        "retarget_confidence": round(confidence, 3),
        "leg_chains_ok": legs_ok,
        "missing_bones": missing_map,
        "missing_leg_bones": missing_legs,
        "within_budget": (tris <= MAX_TRIS and bone_count() <= MAX_BONES and size <= MAX_GLB_BYTES),
        "out_path": out_path,
        "viseme": viseme,
        "validation": [{
            "rule": "ANIM-LIP-03-viseme-contract",
            "pass": bool(viseme.get("available")),
            "detail": viseme.get("detail", "No facial-viseme result."),
        }],
    }
    print("BAKE_RESULT:" + json.dumps(stats))
    return stats
