"""
Blender headless render script.
Called via: blender --background --python blender_render_script.py -- [args]

Reads EDL + manifest JSONs, sets up scene from GLB assets,
applies cue-based animation, renders frames to output path.
"""

import sys
import os
import json
import argparse

# Parse CLI args after "--"
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--edl", required=True)
parser.add_argument("--manifest", required=True)
parser.add_argument("--lipsync", default=None)
parser.add_argument("--output", required=True)
parser.add_argument("--width", type=int, default=1920)
parser.add_argument("--height", type=int, default=1080)
parser.add_argument("--fps", type=int, default=30)
parser.add_argument("--preview", action="store_true")
args = parser.parse_args(argv)

import bpy

# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
with open(args.edl) as f:
    edl = json.load(f)
with open(args.manifest) as f:
    manifest = json.load(f)
lipsync_data = {}
if args.lipsync and os.path.exists(args.lipsync):
    with open(args.lipsync) as f:
        lipsync_data = json.load(f)

# ---------------------------------------------------------------------------
# Scene setup
# ---------------------------------------------------------------------------
scene = bpy.context.scene
scene.render.resolution_x = args.width
scene.render.resolution_y = args.height
scene.render.fps = args.fps
scene.render.image_settings.file_format = "FFMPEG" if args.preview else "PNG"

total_duration_ms = manifest.get("total_duration_ms", 30_000)
total_frames = int((total_duration_ms / 1000.0) * args.fps)
scene.frame_start = 1
scene.frame_end = total_frames

if args.preview:
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.audio_codec = "AAC"
    scene.render.filepath = args.output
else:
    os.makedirs(args.output, exist_ok=True)
    scene.render.filepath = os.path.join(args.output, "frame_")

# Clear defaults
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

# ---------------------------------------------------------------------------
# Load GLB assets for each scene
# ---------------------------------------------------------------------------
loaded_objects = {}  # scene_id -> list of objects

for scene_def in manifest.get("scenes", []):
    scene_id = scene_def.get("scene_id", "")
    glb_path = scene_def.get("environment_asset")
    avatar_assets = scene_def.get("avatar_assets", [])

    if glb_path and os.path.exists(glb_path):
        bpy.ops.import_scene.gltf(filepath=glb_path)
        for obj in bpy.context.selected_objects:
            obj["studio_scene_id"] = scene_id

    for avatar_info in avatar_assets:
        avatar_path = avatar_info.get("glb_path") or avatar_info.get("url")
        if avatar_path and os.path.exists(avatar_path):
            bpy.ops.import_scene.gltf(filepath=avatar_path)
            for obj in bpy.context.selected_objects:
                obj["studio_avatar_id"] = avatar_info.get("avatar_id", "")
                obj["studio_scene_id"] = scene_id

# ---------------------------------------------------------------------------
# Apply visual cues (camera moves, lighting, transitions)
# ---------------------------------------------------------------------------
visual_cues = edl.get("visual_track", [])
for cue in visual_cues:
    track = cue.get("track")
    start_ms = cue.get("start_ms", 0)
    end_ms = cue.get("end_ms", start_ms + 1000)
    params = cue.get("parameters", {})
    start_frame = max(1, int((start_ms / 1000.0) * args.fps))
    end_frame = max(start_frame + 1, int((end_ms / 1000.0) * args.fps))
    instruction = cue.get("instruction", "")

    if "camera" in instruction.lower() or params.get("camera_movement"):
        cam = bpy.context.scene.camera
        if not cam:
            bpy.ops.object.camera_add()
            cam = bpy.context.active_object
            bpy.context.scene.camera = cam

        move = params.get("camera_movement", "static")
        shot_type = params.get("shot_type", "medium")

        # Set camera position based on shot type
        z_heights = {"wide": 5.0, "medium": 2.0, "close": 0.8, "extreme_close": 0.4}
        cam.location.z = z_heights.get(shot_type, 2.0)
        cam.keyframe_insert(data_path="location", frame=start_frame)

        if move == "pan":
            cam.location.x += params.get("pan_amount", 2.0)
            cam.keyframe_insert(data_path="location", frame=end_frame)
        elif move == "zoom":
            cam.data.lens = 50.0
            cam.data.keyframe_insert(data_path="lens", frame=start_frame)
            cam.data.lens = 85.0
            cam.data.keyframe_insert(data_path="lens", frame=end_frame)

    if "lighting" in instruction.lower() or params.get("lighting_mood"):
        mood = params.get("lighting_mood", "neutral")
        energy_map = {"warm": 800, "cool": 500, "dramatic": 1200, "neutral": 700}
        energy = energy_map.get(mood, 700)

        # Add/update sun lamp
        sun_name = "StudioSun"
        if sun_name not in bpy.data.objects:
            bpy.ops.object.light_add(type="SUN")
            bpy.context.active_object.name = sun_name
        sun = bpy.data.objects[sun_name]
        sun.data.energy = energy
        sun.keyframe_insert(data_path="data.energy", frame=start_frame)

# ---------------------------------------------------------------------------
# Apply lipsync visemes as shape key actions
# ---------------------------------------------------------------------------
updated_voice_cues = lipsync_data.get("updated_voice_cues", [])
for cue in updated_voice_cues:
    phoneme_timings = cue.get("parameters", {}).get("phoneme_timing", [])
    avatar_id = cue.get("parameters", {}).get("avatar_id")

    # Find avatar object
    avatar_obj = None
    for obj in bpy.data.objects:
        if obj.get("studio_avatar_id") == avatar_id:
            avatar_obj = obj
            break

    if not avatar_obj or not avatar_obj.data.shape_keys:
        continue

    shape_keys = avatar_obj.data.shape_keys.key_blocks

    for pt in phoneme_timings:
        viseme = pt.get("viseme", "sil")
        start_ms = pt.get("start_ms", 0)
        end_ms = pt.get("end_ms", start_ms + 80)
        sf = max(1, int((start_ms / 1000.0) * args.fps))
        ef = max(sf + 1, int((end_ms / 1000.0) * args.fps))

        key_name = f"viseme_{viseme}"
        if key_name in shape_keys:
            key = shape_keys[key_name]
            # Close before
            key.value = 0.0
            key.keyframe_insert(data_path="value", frame=max(1, sf - 1))
            # Open at start
            key.value = 1.0
            key.keyframe_insert(data_path="value", frame=sf)
            # Close after
            key.value = 0.0
            key.keyframe_insert(data_path="value", frame=ef)

# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
bpy.ops.render.render(animation=True)
print(f"[blender_render_script] Done. Output: {args.output}")
