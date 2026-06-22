/**
 * Blender TCP Bridge Client
 * =========================
 * Connects to the Blender TCP bridge (tcp_server.py) running inside the
 * Blender Docker container and sends JSON-RPC commands.
 *
 * Used by the MCP tool interface and the LangGraph orchestrator.
 */

import net from "net";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface ViewportResult {
  success: boolean;
  image_base64: string;
  width: number;
  height: number;
}

export interface SceneObject {
  name: string;
  type: string;
  location: [number, number, number];
  rotation_euler: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
  parent: string | null;
  modifiers: { name: string; type: string }[];
  // Mesh-specific
  vertex_count?: number;
  face_count?: number;
  edge_count?: number;
  vertex_groups?: string[];
  world_bbox?: [number, number, number][];
  // Armature-specific
  bones?: {
    name: string;
    parent: string | null;
    head: [number, number, number];
    tail: [number, number, number];
    length: number;
    connected: boolean;
  }[];
  // Light-specific
  light_type?: string;
  energy?: number;
  // Camera-specific
  camera_type?: string;
  ortho_scale?: number;
  lens?: number;
}

export interface SceneGraph {
  success: boolean;
  object_count: number;
  objects: SceneObject[];
  active_object: string | null;
  frame_current: number;
  frame_start: number;
  frame_end: number;
  render_engine: string;
}

export interface ExportResult {
  success: boolean;
  glb_base64: string;
  size_bytes: number;
}

export interface CheckpointResult {
  success: boolean;
  filepath?: string;
  error?: string;
}

export interface PingResult {
  success: boolean;
  blender_version: string;
  scene_objects: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class BlenderTCPClient {
  private host: string;
  private port: number;
  private requestId: number = 0;
  private timeoutMs: number;

  constructor(
    host: string = process.env.BLENDER_BRIDGE_HOST || "127.0.0.1",
    port: number = parseInt(process.env.BLENDER_BRIDGE_PORT || "9876", 10),
    timeoutMs: number = 120000
  ) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Send a JSON-RPC request to the Blender TCP bridge.
   * Creates a fresh TCP connection per request for simplicity.
   */
  private async send<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const socket = new net.Socket();
      let buffer = "";

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Bridge request timed out after ${this.timeoutMs / 1000}s: ${method}`));
      }, this.timeoutMs);

      socket.connect(this.port, this.host, () => {
        const request = JSON.stringify({ id, method, params }) + "\n";
        socket.write(request);
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString();
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex !== -1) {
          clearTimeout(timeout);
          const line = buffer.slice(0, newlineIndex);
          try {
            const response = JSON.parse(line);
            if (response.error) {
              reject(new Error(response.error.message || JSON.stringify(response.error)));
            } else {
              resolve(response.result as T);
            }
          } catch (e) {
            reject(new Error(`Invalid JSON from bridge: ${line.slice(0, 200)}`));
          }
          socket.end();
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Bridge connection error: ${err.message}`));
      });

      socket.on("close", () => {
        clearTimeout(timeout);
      });
    });
  }

  // ---- Public API ----

  /** Execute arbitrary Python code in Blender's context. */
  async executeCode(code: string): Promise<ExecuteResult> {
    return this.send<ExecuteResult>("execute_code", { code });
  }

  /** Capture a viewport screenshot from a given camera angle. */
  async getViewport(azimuth?: number, elevation?: number): Promise<ViewportResult> {
    return this.send<ViewportResult>("get_viewport", { azimuth, elevation });
  }

  /** Get the current scene graph (all objects, transforms, bones, etc). */
  async readScene(): Promise<SceneGraph> {
    return this.send<SceneGraph>("read_scene");
  }

  /** Rotate the viewport camera to see from a different angle. */
  async setViewportAngle(azimuth: number, elevation: number): Promise<{ success: boolean }> {
    return this.send("set_viewport_angle", { azimuth, elevation });
  }

  /** Undo the last Blender operation. */
  async undo(): Promise<{ success: boolean; error?: string }> {
    return this.send("undo");
  }

  /** Save the current scene as a named checkpoint. */
  async saveCheckpoint(name: string): Promise<CheckpointResult> {
    return this.send<CheckpointResult>("save_checkpoint", { name });
  }

  /** Restore the scene from a named checkpoint. */
  async restoreCheckpoint(name: string): Promise<CheckpointResult> {
    return this.send<CheckpointResult>("restore_checkpoint", { name });
  }

  /** Export the scene as GLB and return base64. */
  async exportGlb(): Promise<ExportResult> {
    return this.send<ExportResult>("export_glb");
  }

  /** Health check — verify the bridge is responsive. */
  async ping(): Promise<PingResult> {
    return this.send<PingResult>("ping");
  }

  /** Test connectivity — returns true if bridge is reachable. */
  async isConnected(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton for convenience
let _defaultClient: BlenderTCPClient | null = null;

export function getBlenderClient(): BlenderTCPClient {
  if (!_defaultClient) {
    _defaultClient = new BlenderTCPClient();
  }
  return _defaultClient;
}
