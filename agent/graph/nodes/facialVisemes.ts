/**
 * Deterministic Blender payload run immediately before a generated organic
 * avatar is exported. It preserves provider morphs and fills missing canonical
 * A–X targets with restrained lower-face deformations around the head rig.
 */
export const FACIAL_VISEME_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H", "X"] as const;

export function facialVisemeBpyScript(): string {
  return `
import bpy

VIS = ("A", "B", "C", "D", "E", "F", "G", "H", "X")
OPEN = {"A": 0.0, "B": 0.15, "C": 0.55, "D": 1.0, "E": 0.35, "F": 0.3, "G": 0.25, "H": 0.65, "X": 0.0}

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
arm = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
if mesh is None:
    print("VISEME_RESULT:{\\"available\\":false,\\"detail\\":\\"No face mesh found; jaw fallback remains active.\\"}")
else:
    if not mesh.data.shape_keys or not mesh.data.shape_keys.key_blocks.get("Basis"):
        mesh.shape_key_add(name="Basis", from_mix=False)
    keys = mesh.data.shape_keys.key_blocks
    existing = {_norm(key.name) for key in keys}
    for shape in VIS:
        name = "viseme_" + shape
        if not keys.get(name):
            mesh.shape_key_add(name=name, from_mix=False)
    # Shape-key synthesis is intentionally conservative: only a head-weighted
    # organic mesh receives visible lower-face deformation. A jaw bone remains
    # the safe runtime fallback if a provider did not expose suitable geometry.
    if arm and arm.pose.bones.get("head"):
        head_world = arm.matrix_world @ arm.pose.bones["head"].head
        head = mesh.matrix_world.inverted() @ head_world
        verts = [vertex.co.copy() for vertex in mesh.data.vertices]
        radius = max((vertex - head).length for vertex in verts) * 0.28
        region = [index for index, vertex in enumerate(verts) if (vertex - head).length <= radius]
        if len(region) >= 12:
            min_z = min(verts[index].z for index in region)
            max_z = max(verts[index].z for index in region)
            height = max(0.001, max_z - min_z)
            for shape in VIS:
                target = keys["viseme_" + shape]
                if _norm(target.name) in existing:
                    continue
                for index in region:
                    base = keys["Basis"].data[index].co
                    lower = max(0.0, min(1.0, (head.z - base.z + height * 0.5) / height))
                    if not lower:
                        continue
                    point = target.data[index].co
                    point.z = base.z - height * 0.16 * OPEN[shape] * lower
                    if shape in ("A", "E", "F"):
                        point.x = head.x + (base.x - head.x) * (0.97 if shape == "A" else 0.94)
    print("VISEME_RESULT:{\\"available\\":true,\\"shapes\\":[\\"viseme_A\\",\\"viseme_B\\",\\"viseme_C\\",\\"viseme_D\\",\\"viseme_E\\",\\"viseme_F\\",\\"viseme_G\\",\\"viseme_H\\",\\"viseme_X\\"]}")
`;
}
