/**
 * Skeletal clip authoring (Phase 5 automation).
 *
 * Takes a RIGGED GLB (canonical armature produced by /rig-model, bone names:
 * hips, spine, chest, neck, head, front_leg_upper.L/R, front_leg_lower.L/R,
 * front_paw.L/R, back_leg_upper.L/R, back_leg_lower.L/R, back_paw.L/R,
 * tail_01/02/03) and bakes named skeletal Action clips onto it, then exports a
 * single GLB containing all clips as glTF animation tracks.
 *
 * Every bone lookup is guarded, so missing bones are skipped rather than
 * crashing — the script animates whatever the rig actually has.
 *
 * The clip set / names / loop flags here MUST stay in sync with the frontend
 * behavior resolver (src/three/clipMap.ts).
 */

const FPS = 24;

/** Deterministic manifest describing the clips this script produces. */
const SKELETAL_CLIP_MANIFEST = [
  { name: "idle", loop: true, durationSec: 48 / FPS },
  { name: "walk", loop: true, durationSec: 24 / FPS },
  { name: "run", loop: true, durationSec: 16 / FPS },
  { name: "sit", loop: false, durationSec: 20 / FPS },
  { name: "sleep", loop: true, durationSec: 72 / FPS },
  { name: "eat", loop: true, durationSec: 24 / FPS },
  { name: "drink", loop: true, durationSec: 24 / FPS },
  { name: "play", loop: true, durationSec: 24 / FPS },
  { name: "pee_legLift", loop: false, durationSec: 24 / FPS },
  { name: "poop_squat", loop: false, durationSec: 30 / FPS },
  { name: "bark_speak", loop: false, durationSec: 16 / FPS },
];

/**
 * Build the full Blender python script that imports `inputGlbPath`, authors the
 * clips on the armature, and exports the multi-animation GLB to `outputGlbPath`.
 */
function buildSkeletalClipScript(inputGlbPath, outputGlbPath) {
  return `
import bpy, sys, math

FPS = ${FPS}
bpy.context.scene.render.fps = FPS

# --- Clear scene & import the rigged GLB -----------------------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
print("[Clips] Importing rigged GLB...")
bpy.ops.import_scene.gltf(filepath=r"${inputGlbPath}")

arm = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
if not arm:
    print("[Clips] ERROR: no armature in rigged GLB")
    sys.exit(1)

bpy.context.view_layer.objects.active = arm
arm.select_set(True)
if arm.animation_data is None:
    arm.animation_data_create()

bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'

def pb(name):
    """Guarded pose-bone lookup: returns the bone or None."""
    return arm.pose.bones.get(name)

def key(name, frame, rot=None, loc=None):
    """Keyframe a bone's rotation (degrees) and/or location, if it exists."""
    b = pb(name)
    if b is None:
        return
    if rot is not None:
        b.rotation_euler = (math.radians(rot[0]), math.radians(rot[1]), math.radians(rot[2]))
        b.keyframe_insert(data_path='rotation_euler', frame=frame)
    if loc is not None:
        b.location = loc
        b.keyframe_insert(data_path='location', frame=frame)

def rest_all(frame):
    """Key every bone to its rest pose at a frame (clean loop boundaries)."""
    for b in arm.pose.bones:
        b.rotation_euler = (0.0, 0.0, 0.0)
        b.keyframe_insert(data_path='rotation_euler', frame=frame)

FRONT = ["front_leg_upper.L", "front_leg_upper.R", "front_leg_lower.L", "front_leg_lower.R"]
BACK = ["back_leg_upper.L", "back_leg_upper.R", "back_leg_lower.L", "back_leg_lower.R"]

def new_action(name):
    act = bpy.data.actions.new(name=name)
    arm.animation_data.action = act
    return act

def stash(act):
    """Push the finished action into its own NLA track so the glTF exporter keeps it."""
    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, int(act.frame_range[0]), act)

# --- Clip authoring ---------------------------------------------------------

def clip_idle():
    a = new_action("idle")
    for f, amt in [(1, 0), (24, 2), (48, 0)]:
        key("chest", f, rot=(amt, 0, 0))
        key("spine", f, rot=(amt * 0.5, 0, 0))
    for f, t in [(1, -6), (24, 6), (48, -6)]:
        key("tail_01", f, rot=(0, 0, t))
        key("tail_02", f, rot=(0, 0, t))
    stash(a)

def clip_walk():
    a = new_action("walk")
    # Alternating diagonal gait over 24 frames.
    for f, s in [(1, 1), (12, -1), (24, 1)]:
        key("front_leg_upper.L", f, rot=(20 * s, 0, 0))
        key("back_leg_upper.R", f, rot=(20 * s, 0, 0))
        key("front_leg_upper.R", f, rot=(-20 * s, 0, 0))
        key("back_leg_upper.L", f, rot=(-20 * s, 0, 0))
        key("hips", f, loc=(0, 0, 0.01 * (1 if s > 0 else -1)))
        key("tail_01", f, rot=(0, 0, 10 * s))
    stash(a)

def clip_run():
    a = new_action("run")
    for f, s in [(1, 1), (8, -1), (16, 1)]:
        key("front_leg_upper.L", f, rot=(38 * s, 0, 0))
        key("back_leg_upper.R", f, rot=(38 * s, 0, 0))
        key("front_leg_upper.R", f, rot=(-38 * s, 0, 0))
        key("back_leg_upper.L", f, rot=(-38 * s, 0, 0))
        key("spine", f, rot=(8 * s, 0, 0))
        key("hips", f, loc=(0, 0, 0.03 * (1 if s > 0 else -1)))
    stash(a)

def clip_sit():
    a = new_action("sit")
    rest_all(1)
    for name in BACK:
        key(name, 20, rot=(55, 0, 0))
    key("hips", 20, loc=(0, 0, -0.06))
    key("spine", 20, rot=(-20, 0, 0))
    key("neck", 20, rot=(25, 0, 0))
    key("head", 20, rot=(10, 0, 0))
    stash(a)

def clip_sleep():
    a = new_action("sleep")
    # Lie on side (roll) and breathe slowly.
    for f in (1, 72):
        key("hips", f, rot=(0, 90, 0), loc=(0, 0, -0.12))
        key("spine", f, rot=(0, 90, 0))
    for f, amt in [(1, 0), (36, 4), (72, 0)]:
        key("chest", f, rot=(amt, 90, 0))
    stash(a)

def clip_eat():
    a = new_action("eat")
    key("neck", 1, rot=(40, 0, 0)); key("head", 1, rot=(20, 0, 0))
    for f, amt in [(1, 20), (12, 30), (24, 20)]:
        key("head", f, rot=(amt, 0, 0))
    stash(a)

def clip_drink():
    a = new_action("drink")
    key("neck", 1, rot=(50, 0, 0))
    for f, amt in [(1, 25), (12, 32), (24, 25)]:
        key("head", f, rot=(amt, 0, 0))
    stash(a)

def clip_play():
    a = new_action("play")
    # Play-bow: front down, hindquarters up, bouncing.
    for f, s in [(1, 1), (12, -1), (24, 1)]:
        key("spine", f, rot=(-25 if s > 0 else -5, 0, 0))
        for name in FRONT:
            key(name, f, rot=(25 if s > 0 else 5, 0, 0))
        key("hips", f, loc=(0, 0, 0.04 * s))
        key("tail_01", f, rot=(0, 0, 18 * s))
    stash(a)

def clip_pee():
    a = new_action("pee_legLift")
    rest_all(1)
    # Lift one back leg outward and hold.
    key("back_leg_upper.R", 12, rot=(0, 0, -70))
    key("back_leg_lower.R", 12, rot=(0, 0, -30))
    key("back_leg_upper.R", 24, rot=(0, 0, -70))
    key("back_leg_lower.R", 24, rot=(0, 0, -30))
    key("hips", 24, rot=(0, 0, -8))
    stash(a)

def clip_poop():
    a = new_action("poop_squat")
    rest_all(1)
    for name in BACK:
        key(name, 15, rot=(60, 0, 0)); key(name, 30, rot=(60, 0, 0))
    key("hips", 30, loc=(0, 0, -0.08), rot=(-15, 0, 0))
    key("tail_01", 30, rot=(20, 0, 0))
    stash(a)

def clip_bark():
    a = new_action("bark_speak")
    key("neck", 1, rot=(0, 0, 0)); key("head", 1, rot=(0, 0, 0))
    for f, amt in [(1, 0), (5, -15), (10, 5), (16, 0)]:
        key("head", f, rot=(amt, 0, 0))
        key("neck", f, rot=(amt * 0.5, 0, 0))
    stash(a)

for fn in (clip_idle, clip_walk, clip_run, clip_sit, clip_sleep, clip_eat,
           clip_drink, clip_play, clip_pee, clip_poop, clip_bark):
    try:
        fn()
    except Exception as e:
        print(f"[Clips] WARN {fn.__name__} failed: {e}")

bpy.ops.object.mode_set(mode='OBJECT')

# --- Export multi-animation GLB (ACTIONS mode = one glTF anim per action) ----
print("[Clips] Exporting GLB with skeletal clips...")
export_kwargs = dict(
    filepath=r"${outputGlbPath}",
    export_format='GLB',
    export_skins=True,
    export_def_bones=True,
)
try:
    bpy.ops.export_scene.gltf(export_animations=True, export_animation_mode='ACTIONS', **export_kwargs)
except TypeError:
    # Older Blender without export_animation_mode.
    try:
        bpy.ops.export_scene.gltf(export_animations=True, **export_kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(export_animation=True, **export_kwargs)

print("[Clips] CLIPS_EXPORT_COMPLETE")
`;
}

export { buildSkeletalClipScript, SKELETAL_CLIP_MANIFEST, FPS };
