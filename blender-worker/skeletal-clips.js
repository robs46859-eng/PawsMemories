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
 * MOTION PHILOSOPHY (overhaul):
 *   - The tail is a 3-segment chain (tail_01 root → tail_02 → tail_03 tip).
 *     `tail_wave` drives all three as a phase-offset sine so motion travels
 *     from root to tip with the tip whipping widest — a real follow-through
 *     wave, not a rigid two-bone swing.
 *   - Limbs and spine are DESYNCHRONISED: lower legs lag their upper legs,
 *     paws flex, and the head/spine add small out-of-phase secondary motion so
 *     nothing moves in stiff lockstep.
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
  // --- New abilities (overhaul) ---
  { name: "tail_wag", loop: true, durationSec: 32 / FPS },
  { name: "stretch", loop: false, durationSec: 48 / FPS },
  { name: "shake_off", loop: false, durationSec: 30 / FPS },
  { name: "dig_hole", loop: true, durationSec: 32 / FPS },
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

FRONT_UP = ["front_leg_upper.L", "front_leg_upper.R"]
FRONT_LO = ["front_leg_lower.L", "front_leg_lower.R"]
BACK_UP = ["back_leg_upper.L", "back_leg_upper.R"]
BACK_LO = ["back_leg_lower.L", "back_leg_lower.R"]
FRONT = FRONT_UP + FRONT_LO
BACK = BACK_UP + BACK_LO
TAIL = ["tail_01", "tail_02", "tail_03"]

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

# --- Motion helpers ---------------------------------------------------------

def tail_wave(f0, n_frames, cycles=1.0, base=8.0, axis=2, seg_phase=0.9,
              tip_gain=0.65, samples=8, offset=0.0):
    """
    Author a travelling wave across tail_01/02/03 as a phase-offset sine.

    Motion starts at the root and lags toward the tip (seg_phase radians per
    segment) with the tip swinging widest (tip_gain per segment). Because the
    sine spans a whole number of 'cycles' the first and last keys match, so the
    clip loops seamlessly. axis: 0=X (up/down), 1=Y (roll), 2=Z (side-to-side).
    """
    for i, seg in enumerate(TAIL):
        amp = base * (1.0 + tip_gain * i)
        for k in range(samples + 1):
            f = f0 + int(round(k * (n_frames - 1) / samples))
            theta = 2.0 * math.pi * cycles * (k / samples) - i * seg_phase
            val = offset + amp * math.sin(theta)
            rot = [0.0, 0.0, 0.0]
            rot[axis] = val
            key(seg, f, rot=tuple(rot))

def tail_hold(frame, lift=0.0, curl=0.0):
    """Static tail pose: lift = raise/lower (X), curl = extra tip curl."""
    key("tail_01", frame, rot=(lift, 0, 0))
    key("tail_02", frame, rot=(lift * 0.8 + curl * 0.4, 0, 0))
    key("tail_03", frame, rot=(lift * 0.6 + curl, 0, 0))

def leg_swing(name_up, name_lo, f, phase_sign, up_amp, knee_amp, knee_lag_frames=3):
    """
    Swing an upper leg and let the lower leg (knee) follow through a few frames
    later, so the limb reads as fluid rather than a rigid pendulum.
    """
    key(name_up, f, rot=(up_amp * phase_sign, 0, 0))
    key(name_lo, f + knee_lag_frames, rot=(max(0.0, knee_amp) * (1 if phase_sign > 0 else 0.3), 0, 0))

# --- Clip authoring ---------------------------------------------------------

def clip_idle():
    a = new_action("idle")
    # Slow breathing through chest/spine + subtle weight shift.
    for f, amt in [(1, 0), (24, 2.2), (48, 0)]:
        key("chest", f, rot=(amt, 0, 0))
        key("spine", f, rot=(amt * 0.5, 0, 0))
    for f, amt in [(1, 0), (24, 1.2), (48, 0)]:
        key("head", f, rot=(amt, 0, 0))
    # Gentle full-tail sway (one lazy cycle, side to side).
    tail_wave(1, 48, cycles=1.0, base=6.0, axis=2, seg_phase=0.8)
    stash(a)

def clip_walk():
    a = new_action("walk")
    # Alternating diagonal gait over 24 frames with knee follow-through.
    for f, s in [(1, 1), (12, -1), (24, 1)]:
        leg_swing("front_leg_upper.L", "front_leg_lower.L", f, s, 20, 16)
        leg_swing("back_leg_upper.R", "back_leg_lower.R", f, s, 20, 16)
        leg_swing("front_leg_upper.R", "front_leg_lower.R", f, -s, 20, 16)
        leg_swing("back_leg_upper.L", "back_leg_lower.L", f, -s, 20, 16)
        key("hips", f, loc=(0, 0, 0.01 * (1 if s > 0 else -1)))
        # Spine + head counter-bob, slightly out of phase with the stride.
        key("spine", f, rot=(0, 0, 3 * s))
        key("head", f + 2, rot=(2 * s, 0, 1.5 * s))
    # Tail sways with the gait (1.5 cycles so it feels lively, still loops).
    tail_wave(1, 24, cycles=1.5, base=9.0, axis=2, seg_phase=0.9)
    stash(a)

def clip_run():
    a = new_action("run")
    for f, s in [(1, 1), (8, -1), (16, 1)]:
        leg_swing("front_leg_upper.L", "front_leg_lower.L", f, s, 38, 34, knee_lag_frames=2)
        leg_swing("back_leg_upper.R", "back_leg_lower.R", f, s, 38, 34, knee_lag_frames=2)
        leg_swing("front_leg_upper.R", "front_leg_lower.R", f, -s, 38, 34, knee_lag_frames=2)
        leg_swing("back_leg_upper.L", "back_leg_lower.L", f, -s, 38, 34, knee_lag_frames=2)
        key("spine", f, rot=(9 * s, 0, 0))
        key("chest", f, rot=(5 * s, 0, 0))
        key("neck", f + 1, rot=(-4 * s, 0, 0))
        key("hips", f, loc=(0, 0, 0.03 * (1 if s > 0 else -1)))
    # Tail streams out behind, lifted, with a fast whip.
    tail_wave(1, 16, cycles=1.0, base=12.0, axis=2, seg_phase=1.1, offset=0.0)
    for f in (1, 16):
        key("tail_01", f, rot=(-18, 0, 0))
    stash(a)

def clip_sit():
    a = new_action("sit")
    rest_all(1)
    for name in BACK_UP:
        key(name, 20, rot=(55, 0, 0))
    for name in BACK_LO:
        key(name, 20, rot=(40, 0, 0))
    key("hips", 20, loc=(0, 0, -0.06))
    key("spine", 20, rot=(-20, 0, 0))
    key("neck", 20, rot=(25, 0, 0))
    key("head", 20, rot=(10, 0, 0))
    tail_hold(20, lift=8.0, curl=6.0)
    stash(a)

def clip_sleep():
    a = new_action("sleep")
    # Lie on side (roll) and breathe slowly; tail curled in.
    for f in (1, 72):
        key("hips", f, rot=(0, 90, 0), loc=(0, 0, -0.12))
        key("spine", f, rot=(0, 90, 0))
    for f, amt in [(1, 0), (36, 4), (72, 0)]:
        key("chest", f, rot=(amt, 90, 0))
    for f in (1, 72):
        tail_hold(f, lift=4.0, curl=18.0)
    stash(a)

def clip_eat():
    a = new_action("eat")
    key("neck", 1, rot=(40, 0, 0)); key("head", 1, rot=(20, 0, 0))
    for f, amt in [(1, 20), (12, 30), (24, 20)]:
        key("head", f, rot=(amt, 0, 0))
    # Content little tail sway while eating.
    tail_wave(1, 24, cycles=1.0, base=5.0, axis=2, seg_phase=0.7)
    stash(a)

def clip_drink():
    a = new_action("drink")
    key("neck", 1, rot=(50, 0, 0))
    for f, amt in [(1, 25), (12, 32), (24, 25)]:
        key("head", f, rot=(amt, 0, 0))
    tail_wave(1, 24, cycles=1.0, base=4.0, axis=2, seg_phase=0.7)
    stash(a)

def clip_play():
    a = new_action("play")
    # Play-bow: front down, hindquarters up, bouncing + excited tail.
    for f, s in [(1, 1), (12, -1), (24, 1)]:
        key("spine", f, rot=(-25 if s > 0 else -5, 0, 0))
        for name in FRONT_UP:
            key(name, f, rot=(25 if s > 0 else 5, 0, 0))
        for name in FRONT_LO:
            key(name, f + 2, rot=(20 if s > 0 else 4, 0, 0))
        key("hips", f, loc=(0, 0, 0.04 * s))
        key("head", f, rot=(-8 * s, 0, 0))
    # Fast excited wag (2 cycles over the 24-frame loop).
    tail_wave(1, 24, cycles=2.0, base=16.0, axis=2, seg_phase=1.0, offset=0.0)
    for f in (1, 24):
        key("tail_01", f, rot=(-20, 0, 0))
    stash(a)

def clip_pee():
    a = new_action("pee_legLift")
    rest_all(1)
    # Lift one back leg outward and hold, knee tucked.
    key("back_leg_upper.R", 12, rot=(0, 0, -70))
    key("back_leg_lower.R", 12, rot=(0, 0, -30))
    key("back_leg_upper.R", 24, rot=(0, 0, -70))
    key("back_leg_lower.R", 24, rot=(0, 0, -30))
    key("hips", 24, rot=(0, 0, -8))
    tail_hold(24, lift=10.0)
    stash(a)

def clip_poop():
    a = new_action("poop_squat")
    rest_all(1)
    for name in BACK_UP:
        key(name, 15, rot=(60, 0, 0)); key(name, 30, rot=(60, 0, 0))
    for name in BACK_LO:
        key(name, 15, rot=(45, 0, 0)); key(name, 30, rot=(45, 0, 0))
    key("hips", 30, loc=(0, 0, -0.08), rot=(-15, 0, 0))
    tail_hold(30, lift=22.0)
    stash(a)

def clip_bark():
    a = new_action("bark_speak")
    key("neck", 1, rot=(0, 0, 0)); key("head", 1, rot=(0, 0, 0))
    for f, amt in [(1, 0), (5, -15), (10, 5), (16, 0)]:
        key("head", f, rot=(amt, 0, 0))
        key("neck", f, rot=(amt * 0.5, 0, 0))
    stash(a)

# --- New abilities ----------------------------------------------------------

def clip_tail_wag():
    """Fast, happy whole-tail wag with a little body wiggle. Loops (32f)."""
    a = new_action("tail_wag")
    # Base tail lifted up, then a fast 3-cycle side wave over the loop.
    tail_wave(1, 32, cycles=3.0, base=22.0, axis=2, seg_phase=1.15)
    for f in (1, 32):
        key("tail_01", f, rot=(-22, 0, 0))  # raised base, keeps loop matched
    # Happy hip wiggle + alert head, out of phase with the tail.
    for f, s in [(1, 1), (8, -1), (16, 1), (24, -1), (32, 1)]:
        key("hips", f, rot=(0, 0, 4 * s))
        key("head", f, rot=(-6, 0, 3 * s))
    stash(a)

def clip_stretch():
    """Downward-dog stretch: front legs forward, chest low, hips high (48f, once)."""
    a = new_action("stretch")
    rest_all(1)
    # Ease into the stretch by ~frame 24, hold, then relax by 48.
    for name in FRONT_UP:
        key(name, 24, rot=(40, 0, 0))
    for name in FRONT_LO:
        key(name, 24, rot=(15, 0, 0))
    key("spine", 24, rot=(-30, 0, 0))
    key("chest", 24, rot=(-20, 0, 0))
    key("neck", 24, rot=(-25, 0, 0))
    key("head", 24, rot=(-15, 0, 0))
    key("hips", 24, loc=(0, 0, 0.05), rot=(20, 0, 0))
    for name in BACK_UP:
        key(name, 24, rot=(-10, 0, 0))
    tail_hold(24, lift=-25.0)  # tail up and back
    # Relax back to rest.
    rest_all(48)
    stash(a)

def clip_shake_off():
    """Whole-body shake travelling head→tail (roll oscillation). 30f, once."""
    a = new_action("shake_off")
    rest_all(1)
    # A high-frequency roll (Y) that ramps up then settles, phase-lagged down
    # the spine so the wobble travels from the shoulders to the hips.
    chain = [("neck", 0), ("chest", 1), ("spine", 2), ("hips", 3), ("head", 0)]
    amp = {"neck": 16, "chest": 14, "spine": 12, "hips": 10, "head": 20}
    for f in range(1, 31):
        env = math.sin(math.pi * (f - 1) / 29.0)  # 0..1..0 envelope
        for name, lag in chain:
            theta = 2.0 * math.pi * 5.0 * (f - 1) / 29.0 - lag * 0.9
            if f in (1, 8, 15, 22, 30):  # keyframe at samples, let Blender interp
                key(name, f, rot=(0, amp[name] * env * math.sin(theta), 0))
    # Tail whips hard along with the shake.
    tail_wave(1, 30, cycles=5.0, base=26.0, axis=2, seg_phase=1.2)
    rest_all(30)
    stash(a)

def clip_dig_hole():
    """Alternating front-paw dig scoops, head low, hindquarters up. Loops (32f)."""
    a = new_action("dig_hole")
    # Head down toward the ground, hips slightly raised for the whole clip.
    for f in (1, 32):
        key("neck", f, rot=(35, 0, 0))
        key("head", f, rot=(20, 0, 0))
        key("hips", f, rot=(10, 0, 0))
        key("spine", f, rot=(-8, 0, 0))
    # Left/right front legs alternate a fast scoop (down-back then recover).
    for f, s in [(1, 1), (8, -1), (16, 1), (24, -1), (32, 1)]:
        key("front_leg_upper.L", f, rot=(35 if s > 0 else -20, 0, 0))
        key("front_leg_lower.L", f + 2, rot=(45 if s > 0 else 5, 0, 0))
        key("front_leg_upper.R", f, rot=(35 if s < 0 else -20, 0, 0))
        key("front_leg_lower.R", f + 2, rot=(45 if s < 0 else 5, 0, 0))
    # Balancing tail counter-sway.
    tail_wave(1, 32, cycles=2.0, base=10.0, axis=2, seg_phase=0.9)
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
