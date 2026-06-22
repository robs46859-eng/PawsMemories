/**
 * Modular Sprite Animation Templates
 * 
 * Replaces the monolithic AI-generated sprite bake script with deterministic,
 * safe python templates. We use standard bone names provided during the rig phase:
 * hips, spine, chest, neck, head, front_leg_upper.L/R, front_leg_lower.L/R, 
 * front_paw.L/R, back_leg_upper.L/R, back_leg_lower.L/R, back_paw.L/R, tail_01/02/03
 */

function getPreamble(inputGlbPath, outputDir, framePrefix, frameCount) {
  return `
import bpy
import sys
import os
import math

# --- Setup Scene ---
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

print("[Anim] Importing rigged GLB...")
try:
    bpy.ops.import_scene.gltf(filepath=r"${inputGlbPath}")
except Exception as e:
    print(f"[Anim] Error importing GLB: {e}")
    sys.exit(1)

armature_obj = None
for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
        armature_obj = obj
        break

if not armature_obj:
    print("[Anim] ERROR: No armature found!")
    sys.exit(1)

bpy.context.view_layer.objects.active = armature_obj
bpy.ops.object.mode_set(mode='POSE')

# Ensure Workbench engine for speed
bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
try:
    bpy.context.scene.display.shading.light = 'STUDIO'
except Exception:
    pass

# Setup Camera (Orthographic)
cam_data = bpy.data.cameras.new("SpriteCam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 3.5
cam_obj = bpy.data.objects.new("SpriteCam", cam_data)
bpy.context.scene.collection.objects.link(cam_obj)
bpy.context.scene.camera = cam_obj

# Position camera for isometric-ish view
cam_obj.location = (2.5, -3.5, 2.5)
import mathutils
direction = mathutils.Vector((0, 0, 0.5)) - cam_obj.location
cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

# Render Settings
scene = bpy.context.scene
scene.render.resolution_x = 128
scene.render.resolution_y = 128
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'

# Helper to safely set bone rotation
def pose_bone(name, rot_x=0.0, rot_y=0.0, rot_z=0.0):
    bone = armature_obj.pose.bones.get(name)
    if bone:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (rot_x, rot_y, rot_z)

# Setup output directory
output_dir = r"${outputDir}"
os.makedirs(output_dir, exist_ok=True)
`;
}

function getPostamble(framePrefix, frameCount) {
    return `
# --- Render Loop ---
print("[Anim] Rendering frames...")
for f in range(${frameCount}):
    bpy.context.scene.frame_set(f)
    scene.render.filepath = os.path.join(output_dir, f"${framePrefix}_{f:04d}.png")
    bpy.ops.render.render(write_still=True)
print("[Anim] Action complete.")
`;
}

// 4 frames: Head dips down/up
function getEatingScript(inputGlbPath, outputDir, framePrefix) {
  return getPreamble(inputGlbPath, outputDir, framePrefix, 4) + `
for f in range(4):
    bpy.context.scene.frame_set(f)
    
    # Calculate dip (-0.5 to 0.5 radians roughly)
    dip = math.sin(f * math.pi / 2) * 0.5 - 0.2
    
    pose_bone('neck', rot_x=dip)
    pose_bone('head', rot_x=dip*0.5)
    pose_bone('spine', rot_x=dip*0.2)
    
    # Wag tail slightly
    wag = math.cos(f * math.pi) * 0.2
    pose_bone('tail_01', rot_z=wag)
    pose_bone('tail_02', rot_z=wag)

    # Insert keyframes
    for b in armature_obj.pose.bones:
        b.keyframe_insert(data_path="rotation_euler")
` + getPostamble(framePrefix, 4);
}

// 4 frames: Head stays low, small bobs
function getDrinkingScript(inputGlbPath, outputDir, framePrefix) {
  return getPreamble(inputGlbPath, outputDir, framePrefix, 4) + `
for f in range(4):
    bpy.context.scene.frame_set(f)
    
    # Base dip + small bob
    dip = -0.4 + (math.sin(f * math.pi) * 0.1)
    
    pose_bone('neck', rot_x=dip)
    pose_bone('head', rot_x=dip)
    
    # Insert keyframes
    for b in armature_obj.pose.bones:
        b.keyframe_insert(data_path="rotation_euler")
` + getPostamble(framePrefix, 4);
}

// 6 frames: Alternating leg cycle
function getRunningScript(inputGlbPath, outputDir, framePrefix) {
  return getPreamble(inputGlbPath, outputDir, framePrefix, 6) + `
for f in range(6):
    bpy.context.scene.frame_set(f)
    
    # Phase 0 to 2pi
    phase = f * (2 * math.pi / 6)
    
    # Leg swings (-0.6 to 0.6 radians)
    front_l = math.sin(phase) * 0.6
    front_r = math.sin(phase + math.pi) * 0.6
    back_l = math.sin(phase + math.pi) * 0.6
    back_r = math.sin(phase) * 0.6
    
    pose_bone('front_leg_upper.L', rot_x=front_l)
    pose_bone('front_leg_lower.L', rot_x=max(0, -front_l)) # Bend knee
    
    pose_bone('front_leg_upper.R', rot_x=front_r)
    pose_bone('front_leg_lower.R', rot_x=max(0, -front_r))
    
    pose_bone('back_leg_upper.L', rot_x=back_l)
    pose_bone('back_leg_lower.L', rot_x=max(0, back_l)) # Bend knee opposite
    
    pose_bone('back_leg_upper.R', rot_x=back_r)
    pose_bone('back_leg_lower.R', rot_x=max(0, back_r))

    # Spine arch
    pose_bone('spine', rot_x=math.cos(phase * 2) * 0.1)

    # Insert keyframes
    for b in armature_obj.pose.bones:
        b.keyframe_insert(data_path="rotation_euler")
` + getPostamble(framePrefix, 6);
}

// 4 frames: Bounce/jump, wagging tail
function getPlayingScript(inputGlbPath, outputDir, framePrefix) {
    return getPreamble(inputGlbPath, outputDir, framePrefix, 4) + `
for f in range(4):
    bpy.context.scene.frame_set(f)
    
    # Play bow / bounce
    bounce = math.sin(f * math.pi / 2) * 0.4
    
    pose_bone('front_leg_upper.L', rot_x=bounce)
    pose_bone('front_leg_upper.R', rot_x=bounce)
    pose_bone('spine', rot_x=-bounce * 0.5)
    pose_bone('head', rot_x=bounce * 0.5)
    
    # Big wag
    wag = math.cos(f * math.pi) * 0.5
    pose_bone('tail_01', rot_z=wag)
    pose_bone('tail_02', rot_z=wag)

    # Insert keyframes
    for b in armature_obj.pose.bones:
        b.keyframe_insert(data_path="rotation_euler")
` + getPostamble(framePrefix, 4);
}

// 3 frames: Slow breathing
function getSleepingScript(inputGlbPath, outputDir, framePrefix) {
    return getPreamble(inputGlbPath, outputDir, framePrefix, 3) + `
for f in range(3):
    bpy.context.scene.frame_set(f)
    
    # Lie down pose
    pose_bone('hips', rot_x=-1.5)
    pose_bone('front_leg_upper.L', rot_x=1.5)
    pose_bone('front_leg_upper.R', rot_x=1.5)
    pose_bone('back_leg_upper.L', rot_x=-1.5)
    pose_bone('back_leg_upper.R', rot_x=-1.5)
    
    # Breathing (-0.05 to 0.05)
    breath = math.sin(f * 2 * math.pi / 3) * 0.05
    pose_bone('chest', rot_x=breath)
    pose_bone('spine', rot_x=breath)
    
    # Insert keyframes
    for b in armature_obj.pose.bones:
        b.keyframe_insert(data_path="rotation_euler")
` + getPostamble(framePrefix, 3);
}

// 3 frames: Head tilts
function getPhotoScript(inputGlbPath, outputDir, framePrefix) {
    return getPreamble(inputGlbPath, outputDir, framePrefix, 3) + `
for f in range(3):
    bpy.context.scene.frame_set(f)
    
    # Head tilt side to side
    tilt = 0.0
    if f == 1: tilt = 0.2
    elif f == 2: tilt = -0.2
    
    pose_bone('head', rot_y=tilt)
    pose_bone('neck', rot_y=tilt*0.5)
    
    # Insert keyframes
    for b in armature_obj.pose.bones:
        b.keyframe_insert(data_path="rotation_euler")
` + getPostamble(framePrefix, 3);
}

export {
  getEatingScript,
  getDrinkingScript,
  getRunningScript,
  getPlayingScript,
  getSleepingScript,
  getPhotoScript
};
