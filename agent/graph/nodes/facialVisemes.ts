/**
 * Deterministic Blender payload run immediately before a generated organic
 * avatar is exported. It preserves provider morphs and canonicalizes their
 * names without ever moving generated avatar geometry.
 */
export const FACIAL_VISEME_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H", "X"] as const;

export function facialVisemeBpyScript(): string {
  return `
import bpy
import json

VIS = ("A", "B", "C", "D", "E", "F", "G", "H", "X")
ALIASES = {
    "A": ("viseme_A", "viseme_MBP", "mouthClose"), "B": ("viseme_B", "viseme_EE"),
    "C": ("viseme_C", "viseme_EH"), "D": ("viseme_D", "viseme_AA", "jawOpen", "mouthOpen"),
    "E": ("viseme_E", "viseme_OH"), "F": ("viseme_F", "viseme_OO", "mouthPucker"),
    "G": ("viseme_G", "viseme_FV"), "H": ("viseme_H", "viseme_L"), "X": ("viseme_X",),
}

def _norm(value):
    return "".join(ch.lower() for ch in value if ch.isalnum())

def _find_face_mesh():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and len(obj.data.vertices) >= 16]
    named = [obj for obj in meshes if any(token in obj.name.lower() for token in ("face", "head", "mouth", "snout"))]
    if named:
        return max(named, key=lambda obj: len(obj.data.vertices))
    weighted = [obj for obj in meshes if obj.vertex_groups.get("head")]
    return max(weighted, key=lambda obj: len(obj.data.vertices)) if weighted else None

mesh = _find_face_mesh()
if mesh is None:
    print("VISEME_RESULT:" + json.dumps({"available": False, "detail": "No face mesh found; jaw fallback remains active."}))
else:
    if not mesh.data.shape_keys or not mesh.data.shape_keys.key_blocks.get("Basis"):
        mesh.shape_key_add(name="Basis", from_mix=False)
    keys = mesh.data.shape_keys.key_blocks
    existing = {_norm(key.name): key for key in keys}
    canonical = []
    for shape in VIS:
        name = "viseme_" + shape
        target = keys.get(name)
        source = next((existing.get(_norm(alias)) for alias in ALIASES[shape] if existing.get(_norm(alias))), None)
        # Never fabricate a mouth shape by reshaping the head/neck mesh. Only
        # copy an authored provider target into our stable A–X contract.
        if target or source:
            if not target:
                target = mesh.shape_key_add(name=name, from_mix=False)
                for index, point in enumerate(source.data):
                    target.data[index].co = point.co.copy()
            canonical.append(name)
    print("VISEME_RESULT:" + json.dumps({
        "available": bool(canonical),
        "shapes": canonical,
        "detail": "Provider targets preserved; otherwise jaw fallback.",
    }))
`;
}
