/**
 * Humanoid skeletal clip authoring (Phase 5 automation).
 * Authors clips against standard biped bones:
 * hips, spine, chest, neck, head, shoulder.L/R, upperarm.L/R, forearm.L/R, hand.L/R, thigh.L/R, shin.L/R, foot.L/R
 */

const FPS = 24;

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
  { name: "tail_wag", loop: true, durationSec: 32 / FPS },
  { name: "stretch", loop: false, durationSec: 48 / FPS },
  { name: "shake_off", loop: false, durationSec: 30 / FPS },
  { name: "dig_hole", loop: true, durationSec: 32 / FPS },
];

function buildSkeletalClipScript(inputGlbPath, outputGlbPath) {
  return `
import bpy, sys, math

FPS = ${FPS}
bpy.context.scene.render.fps = FPS

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
print("[Clips] Importing rigged humanoid GLB...")
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
    return arm.pose.bones.get(name)

def key(name, frame, rot=None, loc=None):
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
    for b in arm.pose.bones:
        b.rotation_euler = (0.0, 0.0, 0.0)
        b.keyframe_insert(data_path='rotation_euler', frame=frame)

def new_action(name):
    act = bpy.data.actions.new(name=name)
    arm.animation_data.action = act
    return act

def stash(act):
    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, int(act.frame_range[0]), act)

# --- Human animations ---

def clip_idle():
    a = new_action("idle")
    for f, amt in [(1, 0), (24, 1.8), (48, 0)]:
        key("chest", f, rot=(amt, 0, 0))
        key("spine", f, rot=(amt * 0.5, 0, 0))
    for f, amt in [(1, 0), (24, -1), (48, 0)]:
        key("head", f, rot=(amt, 0, 0))
        key("upperarm.L", f, rot=(0, 0, 2 + amt))
        key("upperarm.R", f, rot=(0, 0, -2 - amt))
    stash(a)

def clip_walk():
    a = new_action("walk")
    for f, s in [(1, 1), (12, -1), (24, 1)]:
        # Thighs
        key("thigh.L", f, rot=(20 * s, 0, 0))
        key("thigh.R", f, rot=(-20 * s, 0, 0))
        # Shin (knee)
        key("shin.L", f + 2, rot=(20 if s > 0 else 5, 0, 0))
        key("shin.R", f + 2, rot=(20 if s < 0 else 5, 0, 0))
        # Feet
        key("foot.L", f, rot=(5 * s, 0, 0))
        key("foot.R", f, rot=(-5 * s, 0, 0))
        # Arms in opposition
        key("upperarm.L", f, rot=(-15 * s, 0, 5))
        key("upperarm.R", f, rot=(15 * s, 0, -5))
        key("forearm.L", f + 2, rot=(10 if s < 0 else 2, 0, 0))
        key("forearm.R", f + 2, rot=(10 if s > 0 else 2, 0, 0))
        # Hip movement
        key("hips", f, loc=(0, 0, 0.01 * s))
    stash(a)

def clip_run():
    a = new_action("run")
    for f, s in [(1, 1), (8, -1), (16, 1)]:
        key("thigh.L", f, rot=(35 * s, 0, 0))
        key("thigh.R", f, rot=(-35 * s, 0, 0))
        key("shin.L", f + 2, rot=(40 if s > 0 else 10, 0, 0))
        key("shin.R", f + 2, rot=(40 if s < 0 else 10, 0, 0))
        key("upperarm.L", f, rot=(-25 * s, 0, 8))
        key("upperarm.R", f, rot=(25 * s, 0, -8))
        key("forearm.L", f + 1, rot=(25 if s < 0 else 5, 0, 0))
        key("forearm.R", f + 1, rot=(25 if s > 0 else 5, 0, 0))
        key("chest", f, rot=(5, 0, 0))
    stash(a)

def clip_sit():
    a = new_action("sit")
    rest_all(1)
    for f in (1, 20):
        key("hips", f, loc=(0, 0, -0.45))
        key("thigh.L", f, rot=(70, 0, 0))
        key("thigh.R", f, rot=(70, 0, 0))
        key("shin.L", f, rot=(75, 0, 0))
        key("shin.R", f, rot=(75, 0, 0))
    stash(a)

def clip_sleep():
    a = new_action("sleep")
    for f in (1, 72):
        key("hips", f, rot=(0, 0, 90), loc=(0, 0, -0.65))
        key("thigh.L", f, rot=(15, 0, 0))
        key("thigh.R", f, rot=(5, 0, 0))
    stash(a)

def clip_eat():
    a = new_action("eat")
    rest_all(1)
    for f, amt in [(1, 0), (12, -45), (24, 0)]:
        key("upperarm.R", f, rot=(amt, 0, -20))
        key("forearm.R", f, rot=(0, -amt, 0))
        key("head", f, rot=(-amt * 0.2, 0, 0))
    stash(a)

def clip_drink():
    a = new_action("drink")
    rest_all(1)
    for f, amt in [(1, 0), (12, -45), (24, 0)]:
        key("upperarm.R", f, rot=(amt, 0, -20))
        key("forearm.R", f, rot=(0, -amt, 0))
        key("head", f, rot=(-amt * 0.2, 0, 0))
    stash(a)

def clip_play():
    a = new_action("play")
    rest_all(1)
    for f, amt in [(1, 0), (6, 30), (12, -10), (18, 30), (24, 0)]:
        key("upperarm.R", f, rot=(0, 0, -60))
        key("forearm.R", f, rot=(0, amt, 0))
    stash(a)

def clip_pee():
    a = new_action("pee_legLift")
    rest_all(1)
    # Simple weight shift
    for f, amt in [(1, 0), (12, 5), (24, 0)]:
        key("hips", f, rot=(0, amt, 0))
    stash(a)

def clip_poop():
    a = new_action("poop_squat")
    rest_all(1)
    for f in (1, 30):
        key("hips", f, loc=(0, 0, -0.2))
        key("thigh.L", f, rot=(30, 0, 0))
        key("thigh.R", f, rot=(30, 0, 0))
    stash(a)

def clip_bark():
    a = new_action("bark_speak")
    rest_all(1)
    for f, amt in [(1, 0), (4, 10), (8, -5), (12, 10), (16, 0)]:
        key("head", f, rot=(amt, 0, 0))
        key("neck", f, rot=(amt * 0.5, 0, 0))
    stash(a)

def clip_tail_wag():
    a = new_action("tail_wag")
    rest_all(1)
    # Simple weight shift side to side
    for f, s in [(1, 1), (8, -1), (16, 1), (24, -1), (32, 1)]:
        key("hips", f, rot=(0, 0, 5 * s))
    stash(a)

def clip_stretch():
    a = new_action("stretch")
    rest_all(1)
    for f, amt in [(1, 0), (24, -120), (48, 0)]:
        key("upperarm.L", f, rot=(amt, 0, 0))
        key("upperarm.R", f, rot=(amt, 0, 0))
    stash(a)

def clip_shake_off():
    a = new_action("shake_off")
    rest_all(1)
    for f, s in [(1, 1), (7, -1), (15, 1), (22, -1), (30, 1)]:
        key("chest", f, rot=(0, 15 * s, 0))
        key("spine", f, rot=(0, 10 * s, 0))
        key("head", f, rot=(0, 20 * s, 0))
    stash(a)

def clip_dig_hole():
    a = new_action("dig_hole")
    rest_all(1)
    for f, s in [(1, 1), (8, -1), (16, 1), (24, -1), (32, 1)]:
        key("upperarm.L", f, rot=(20 * s, 0, 0))
        key("upperarm.R", f, rot=(-20 * s, 0, 0))
    stash(a)

CLIPS = (
    clip_idle, clip_walk, clip_run, clip_sit, clip_sleep, clip_eat,
    clip_drink, clip_play, clip_pee, clip_poop, clip_bark,
    clip_tail_wag, clip_stretch, clip_shake_off, clip_dig_hole,
)

for fn in CLIPS:
    try:
        fn()
    except Exception as e:
        print(f"[Clips] WARN {fn.__name__} failed: {e}")

bpy.ops.object.mode_set(mode='OBJECT')

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
    try:
        bpy.ops.export_scene.gltf(export_animations=True, **export_kwargs)
    except TypeError:
        bpy.ops.export_scene.gltf(export_animation=True, **export_kwargs)

print("[Clips] CLIPS_EXPORT_COMPLETE")
`;
}

export { buildSkeletalClipScript, SKELETAL_CLIP_MANIFEST, FPS };
