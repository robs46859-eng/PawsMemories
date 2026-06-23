"""
Blender TCP Bridge Server
=========================
Runs INSIDE Blender's Python environment (via `blender --background --python tcp_server.py`).
Listens on TCP port 9876 for JSON-RPC commands from the Node.js agent relay.

Protocol: newline-delimited JSON-RPC over TCP.
  Request:  {"id": 1, "method": "execute_code", "params": {"code": "import bpy; ..."}}
  Response: {"id": 1, "result": {...}} or {"id": 1, "error": {"message": "..."}}

Supported methods:
  - execute_code(code)           → Run arbitrary bpy Python, return stdout/stderr/success
  - get_viewport(azimuth?, elevation?) → Render viewport to PNG, return base64
  - read_scene()                 → Return JSON scene graph
  - set_viewport_angle(azimuth, elevation) → Rotate the viewport camera
  - undo()                       → bpy.ops.ed.undo()
  - save_checkpoint(name)        → Save .blend to /tmp/checkpoints/{name}.blend
  - restore_checkpoint(name)     → Load .blend from /tmp/checkpoints/{name}.blend
  - export_glb(output_path?)     → Export scene as GLB, return base64
  - ping()                       → Health check
"""

import bpy
import json
import socket
import threading
import traceback
import io
import sys
import os
import tempfile
import base64
import math
import queue

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TCP_HOST = "0.0.0.0"
TCP_PORT = int(os.environ.get("BLENDER_BRIDGE_PORT", "9876"))
CHECKPOINT_DIR = "/tmp/blender_checkpoints"
VIEWPORT_DIR = "/tmp/blender_viewports"
REQUEST_QUEUE = queue.Queue()

os.makedirs(CHECKPOINT_DIR, exist_ok=True)
os.makedirs(VIEWPORT_DIR, exist_ok=True)

print(f"[Bridge] Blender TCP Bridge starting on {TCP_HOST}:{TCP_PORT}")
print(f"[Bridge] Blender version: {bpy.app.version_string}")


# ---------------------------------------------------------------------------
# Command Handlers
# ---------------------------------------------------------------------------

def handle_execute_code(params: dict) -> dict:
    """Execute arbitrary Python code in Blender's context."""
    code = params.get("code", "")
    if not code:
        return {"success": False, "error": "No code provided"}

    # Capture stdout and stderr
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    captured_stdout = io.StringIO()
    captured_stderr = io.StringIO()
    sys.stdout = captured_stdout
    sys.stderr = captured_stderr

    success = True
    error_msg = None
    try:
        exec(code, {"__builtins__": __builtins__, "bpy": bpy})
    except Exception as e:
        success = False
        error_msg = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    stdout_str = captured_stdout.getvalue()
    stderr_str = captured_stderr.getvalue()

    # Print to real stdout for Docker logs
    if stdout_str:
        print(f"[Bridge/exec] stdout: {stdout_str[:500]}")
    if stderr_str:
        print(f"[Bridge/exec] stderr: {stderr_str[:500]}")
    if error_msg:
        print(f"[Bridge/exec] ERROR: {error_msg[:500]}")

    return {
        "success": success,
        "stdout": stdout_str,
        "stderr": stderr_str,
        "error": error_msg,
    }


def handle_get_viewport(params: dict) -> dict:
    """Render current viewport to PNG and return as base64."""
    azimuth = params.get("azimuth")
    elevation = params.get("elevation")

    # Optionally reposition camera before rendering
    if azimuth is not None or elevation is not None:
        _set_camera_angle(
            azimuth if azimuth is not None else 45.0,
            elevation if elevation is not None else 30.0,
        )

    scene = bpy.context.scene

    # Ensure we have a camera
    if not scene.camera:
        _create_default_camera()

    # Save current render settings
    prev_engine = scene.render.engine
    prev_res_x = scene.render.resolution_x
    prev_res_y = scene.render.resolution_y
    prev_filepath = scene.render.filepath
    prev_format = scene.render.image_settings.file_format
    prev_color_mode = scene.render.image_settings.color_mode

    # Set viewport render settings (fast, low-res for verification)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True

    # Configure workbench for clarity
    try:
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "MATERIAL"
        scene.display.shading.show_object_outline = True
    except Exception:
        pass

    output_path = os.path.join(VIEWPORT_DIR, "viewport_capture.png")
    scene.render.filepath = output_path

    try:
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        return {"success": False, "error": f"Render failed: {e}"}

    # Read and encode
    if not os.path.exists(output_path):
        return {"success": False, "error": "Render produced no output file"}

    with open(output_path, "rb") as f:
        image_base64 = base64.b64encode(f.read()).decode("utf-8")

    # Restore render settings
    scene.render.engine = prev_engine
    scene.render.resolution_x = prev_res_x
    scene.render.resolution_y = prev_res_y
    scene.render.filepath = prev_filepath
    scene.render.image_settings.file_format = prev_format
    scene.render.image_settings.color_mode = prev_color_mode

    os.remove(output_path)

    return {"success": True, "image_base64": image_base64, "width": 512, "height": 512}


def handle_read_scene(params: dict) -> dict:
    """Return a JSON scene graph of all objects."""
    objects = []
    for obj in bpy.context.scene.objects:
        obj_data = {
            "name": obj.name,
            "type": obj.type,
            "location": list(obj.location),
            "rotation_euler": list(obj.rotation_euler),
            "scale": list(obj.scale),
            "visible": obj.visible_get(),
            "parent": obj.parent.name if obj.parent else None,
            "modifiers": [{"name": m.name, "type": m.type} for m in obj.modifiers],
        }

        # Add mesh-specific info
        if obj.type == "MESH" and obj.data:
            obj_data["vertex_count"] = len(obj.data.vertices)
            obj_data["face_count"] = len(obj.data.polygons)
            obj_data["edge_count"] = len(obj.data.edges)
            obj_data["vertex_groups"] = [vg.name for vg in obj.vertex_groups]
            # Bounding box in world space
            try:
                from mathutils import Vector
                bbox = [obj.matrix_world @ Vector(v) for v in obj.bound_box]
                obj_data["world_bbox"] = [[v.x, v.y, v.z] for v in bbox]
            except Exception:
                pass

        # Add armature-specific info
        if obj.type == "ARMATURE" and obj.data:
            bones = []
            for bone in obj.data.bones:
                bones.append({
                    "name": bone.name,
                    "parent": bone.parent.name if bone.parent else None,
                    "head": list(bone.head_local),
                    "tail": list(bone.tail_local),
                    "length": bone.length,
                    "connected": bone.use_connect,
                })
            obj_data["bones"] = bones

        # Add light info
        if obj.type == "LIGHT" and obj.data:
            obj_data["light_type"] = obj.data.type
            obj_data["energy"] = obj.data.energy

        # Add camera info
        if obj.type == "CAMERA" and obj.data:
            obj_data["camera_type"] = obj.data.type
            if obj.data.type == "ORTHO":
                obj_data["ortho_scale"] = obj.data.ortho_scale
            else:
                obj_data["lens"] = obj.data.lens

        objects.append(obj_data)

    return {
        "success": True,
        "object_count": len(objects),
        "objects": objects,
        "active_object": bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None,
        "frame_current": bpy.context.scene.frame_current,
        "frame_start": bpy.context.scene.frame_start,
        "frame_end": bpy.context.scene.frame_end,
        "render_engine": bpy.context.scene.render.engine,
    }


def handle_set_viewport_angle(params: dict) -> dict:
    """Rotate the camera to a specified angle around the scene center."""
    azimuth = float(params.get("azimuth", 45.0))
    elevation = float(params.get("elevation", 30.0))
    _set_camera_angle(azimuth, elevation)
    return {"success": True, "azimuth": azimuth, "elevation": elevation}


def handle_undo(params: dict) -> dict:
    """Undo the last Blender operation."""
    try:
        bpy.ops.ed.undo()
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


def handle_save_checkpoint(params: dict) -> dict:
    """Save the current scene as a named checkpoint."""
    name = params.get("name", "default")
    filepath = os.path.join(CHECKPOINT_DIR, f"{name}.blend")
    try:
        bpy.ops.wm.save_as_mainfile(filepath=filepath, copy=True)
        return {"success": True, "filepath": filepath}
    except Exception as e:
        return {"success": False, "error": str(e)}


def handle_restore_checkpoint(params: dict) -> dict:
    """Restore from a named checkpoint."""
    name = params.get("name", "default")
    filepath = os.path.join(CHECKPOINT_DIR, f"{name}.blend")
    if not os.path.exists(filepath):
        return {"success": False, "error": f"Checkpoint '{name}' not found at {filepath}"}
    try:
        bpy.ops.wm.open_mainfile(filepath=filepath)
        return {"success": True, "filepath": filepath}
    except Exception as e:
        return {"success": False, "error": str(e)}


def handle_export_glb(params: dict) -> dict:
    """Export the scene as GLB and return base64."""
    output_path = params.get("output_path") or os.path.join(
        tempfile.gettempdir(), "blender_export.glb"
    )
    try:
        exportable_objects = [
            obj for obj in bpy.context.scene.objects
            if obj.type in {"MESH", "ARMATURE", "EMPTY", "CAMERA", "LIGHT"}
        ]
        if not exportable_objects:
            return {"success": False, "error": "No exportable Blender objects found"}

        for obj in bpy.context.scene.objects:
            obj.select_set(obj in exportable_objects)
        bpy.context.view_layer.objects.active = exportable_objects[0]

        export_kwargs = filter_operator_kwargs(
            bpy.ops.export_scene.gltf,
            {
                "filepath": output_path,
                "export_format": "GLB",
                "use_selection": True,
                "export_animations": True,
                "export_skins": True,
                "export_def_bones": True,
                "export_apply": False,
            },
        )
        bpy.ops.export_scene.gltf(**export_kwargs)

        with open(output_path, "rb") as f:
            glb_base64 = base64.b64encode(f.read()).decode("utf-8")

        size_bytes = os.path.getsize(output_path)
        os.remove(output_path)

        return {"success": True, "glb_base64": glb_base64, "size_bytes": size_bytes}
    except Exception as e:
        return {"success": False, "error": str(e)}


def handle_import_glb(params: dict) -> dict:
    """Import a base64 GLB payload into the current scene."""
    glb_base64 = params.get("glb_base64") or ""
    if not glb_base64:
        return {"success": False, "error": "No glb_base64 provided"}

    if glb_base64.startswith("data:"):
        glb_base64 = glb_base64.split(",", 1)[1]

    input_path = os.path.join(tempfile.gettempdir(), "blender_agent_input.glb")
    try:
        with open(input_path, "wb") as f:
            f.write(base64.b64decode(glb_base64))

        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)

        before = set(bpy.context.scene.objects)
        import_kwargs = filter_operator_kwargs(
            bpy.ops.import_scene.gltf,
            {"filepath": input_path},
        )
        bpy.ops.import_scene.gltf(**import_kwargs)

        imported = [obj for obj in bpy.context.scene.objects if obj not in before]
        mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        if mesh_objects:
            for obj in bpy.context.scene.objects:
                obj.select_set(obj in mesh_objects)
            bpy.context.view_layer.objects.active = mesh_objects[0]

        return {
            "success": True,
            "imported_count": len(imported),
            "mesh_count": len(mesh_objects),
            "objects": [{"name": obj.name, "type": obj.type} for obj in imported],
        }
    except Exception as e:
        return {"success": False, "error": f"GLB import failed: {e}"}
    finally:
        try:
            os.remove(input_path)
        except FileNotFoundError:
            pass


def handle_ping(params: dict) -> dict:
    """Health check."""
    return {
        "success": True,
        "blender_version": bpy.app.version_string,
        "scene_objects": len(bpy.context.scene.objects),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_default_camera():
    """Create a default orthographic camera if none exists."""
    cam_data = bpy.data.cameras.new("AgentCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.5
    cam_obj = bpy.data.objects.new("AgentCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj
    _set_camera_angle(45.0, 30.0)


def _set_camera_angle(azimuth_deg: float, elevation_deg: float, distance: float = 5.0):
    """Position the scene camera at given azimuth/elevation, looking at scene center."""
    camera = bpy.context.scene.camera
    if not camera:
        _create_default_camera()
        camera = bpy.context.scene.camera

    # Calculate target (center of all mesh objects' bounding boxes)
    target = _scene_center()

    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)

    x = target[0] + distance * math.cos(el) * math.sin(az)
    y = target[1] - distance * math.cos(el) * math.cos(az)
    z = target[2] + distance * math.sin(el)

    camera.location = (x, y, z)

    # Point camera at target using track constraint or manual rotation
    from mathutils import Vector
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _scene_center():
    """Calculate the approximate center of all mesh objects."""
    from mathutils import Vector
    mesh_objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not mesh_objects:
        return (0.0, 0.0, 0.0)

    all_corners = []
    for obj in mesh_objects:
        for v in obj.bound_box:
            all_corners.append(obj.matrix_world @ Vector(v))

    if not all_corners:
        return (0.0, 0.0, 0.0)

    center = sum(all_corners, Vector()) / len(all_corners)
    return (center.x, center.y, center.z)


def filter_operator_kwargs(operator, kwargs: dict) -> dict:
    """Keep only kwargs supported by the active Blender operator API."""
    try:
        supported = set(operator.get_rna_type().properties.keys())
    except Exception:
        return kwargs
    return {key: value for key, value in kwargs.items() if key in supported}


# ---------------------------------------------------------------------------
# Method Dispatch
# ---------------------------------------------------------------------------

METHODS = {
    "execute_code": handle_execute_code,
    "get_viewport": handle_get_viewport,
    "read_scene": handle_read_scene,
    "set_viewport_angle": handle_set_viewport_angle,
    "undo": handle_undo,
    "save_checkpoint": handle_save_checkpoint,
    "restore_checkpoint": handle_restore_checkpoint,
    "export_glb": handle_export_glb,
    "import_glb": handle_import_glb,
    "ping": handle_ping,
}


def dispatch_request(data: dict) -> dict:
    """Route a JSON-RPC request to the appropriate handler."""
    request_id = data.get("id")
    method = data.get("method", "")
    params = data.get("params", {})

    handler = METHODS.get(method)
    if not handler:
        return {
            "id": request_id,
            "error": {"message": f"Unknown method: {method}", "code": -32601},
        }

    try:
        result = handler(params)
        return {"id": request_id, "result": result}
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[Bridge] Handler error for {method}: {tb}")
        return {
            "id": request_id,
            "error": {"message": str(e), "traceback": tb},
        }


def handle_request(data: dict) -> dict:
    """Queue Blender work for execution on Blender's main thread."""
    response_queue = queue.Queue(maxsize=1)
    REQUEST_QUEUE.put((data, response_queue))
    try:
        return response_queue.get(timeout=240)
    except queue.Empty:
        return {
            "id": data.get("id"),
            "error": {"message": "Timed out waiting for Blender main-thread dispatch", "code": -32000},
        }


def process_request_queue():
    """Run all queued JSON-RPC requests on Blender's main thread."""
    while True:
        try:
            data, response_queue = REQUEST_QUEUE.get_nowait()
        except queue.Empty:
            break

        try:
            response_queue.put(dispatch_request(data))
        except Exception as e:
            tb = traceback.format_exc()
            response_queue.put({
                "id": data.get("id"),
                "error": {"message": str(e), "traceback": tb},
            })
        finally:
            REQUEST_QUEUE.task_done()


# ---------------------------------------------------------------------------
# TCP Server
# ---------------------------------------------------------------------------

def handle_client(conn, addr):
    """Handle a single TCP client connection."""
    buffer = b""
    try:
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                break
            buffer += chunk

            # Process complete messages (newline-delimited)
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue

                try:
                    request = json.loads(line.decode("utf-8"))
                except json.JSONDecodeError as e:
                    response = {
                        "id": None,
                        "error": {"message": f"Invalid JSON: {e}", "code": -32700},
                    }
                    conn.sendall((json.dumps(response) + "\n").encode("utf-8"))
                    continue

                method = request.get("method")
                if method != "ping":
                    print(f"[Bridge] Request: method={method} id={request.get('id')}")
                    
                response = handle_request(request)
                response_json = json.dumps(response) + "\n"
                conn.sendall(response_json.encode("utf-8"))

    except (ConnectionResetError, BrokenPipeError):
        pass  # Ignore abrupt disconnects (likely health checks)
    except Exception as e:
        print(f"[Bridge] Client error: {e}")
    finally:
        conn.close()


def start_server():
    """Start the TCP server in a background thread."""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((TCP_HOST, TCP_PORT))
    server.listen(5)
    print(f"[Bridge] ✅ TCP Bridge listening on {TCP_HOST}:{TCP_PORT}")

    while True:
        conn, addr = server.accept()
        client_thread = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
        client_thread.start()


# Start in a background thread so Blender's main loop remains available
server_thread = threading.Thread(target=start_server, daemon=True)
server_thread.start()

# Keep Blender alive — the main thread needs to stay running
# In --background mode, Blender will exit unless we block
print("[Bridge] Blender bridge is running. Waiting for connections...")

# Use a simple infinite loop with sleep to keep the process alive
import time
try:
    while True:
        process_request_queue()
        time.sleep(0.01)
except KeyboardInterrupt:
    print("[Bridge] Shutting down...")
