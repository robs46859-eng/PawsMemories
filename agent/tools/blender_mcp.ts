/**
 * Blender MCP Tool Interface
 * ==========================
 * Exposes Blender operations as MCP (Model Context Protocol) tools
 * that LangGraph agent nodes can call declaratively.
 *
 * Each tool wraps a BlenderTCPClient method with proper schema validation,
 * error handling, and structured responses suitable for LLM consumption.
 */

import { getBlenderClient } from "./blender_client";
import type {
  ExecuteResult,
  ViewportResult,
  SceneGraph,
  ExportResult,
  ImportGlbResult,
  PhysicsValidationResult,
} from "./blender_client";

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export const BLENDER_TOOLS: ToolDefinition[] = [
  {
    name: "import_glb",
    description:
      "Import the input base64 GLB into the persistent Blender scene. This is a deterministic " +
      "pipeline operation; generated bpy code must not attempt to import files from /tmp or C: paths.",
    parameters: {
      glb_base64: {
        type: "string",
        description: "Base64 GLB payload, optionally with a data URL prefix.",
        required: true,
      },
    },
  },
  {
    name: "execute_bpy",
    description:
      "Execute Python code in Blender's bpy context. Use this to create objects, " +
      "add modifiers, set transforms, create armatures, keyframe animations, etc. " +
      "Returns stdout, stderr, and success status. Code runs in Blender 5.1.",
    parameters: {
      code: {
        type: "string",
        description: "Python code to execute. Must be valid Blender 5.1 bpy code. Import bpy at the top.",
        required: true,
      },
    },
  },
  {
    name: "get_viewport",
    description:
      "Capture a viewport screenshot of the current Blender scene. Returns a base64 PNG image. " +
      "Optionally specify azimuth (0-360°) and elevation (-90 to 90°) to view from a specific angle. " +
      "Use this to verify the visual state of the model after code execution.",
    parameters: {
      azimuth: {
        type: "number",
        description: "Horizontal rotation angle in degrees (0=front, 90=right, 180=back, 270=left). Default: 45.",
      },
      elevation: {
        type: "number",
        description: "Vertical elevation angle in degrees (-90=below, 0=level, 90=above). Default: 30.",
      },
    },
  },
  {
    name: "read_scene",
    description:
      "Read the current Blender scene graph. Returns all objects with their types, transforms, " +
      "modifiers, bone structures (for armatures), vertex/face counts (for meshes), etc. " +
      "Use this to understand the current state before planning the next action.",
    parameters: {},
  },
  {
    name: "rotate_viewport",
    description:
      "Change the viewport camera angle to inspect the model from a different direction. " +
      "Useful when you need to see what's behind the model (e.g., check if the tail rigging is correct).",
    parameters: {
      azimuth: {
        type: "number",
        description: "Horizontal rotation angle in degrees.",
        required: true,
      },
      elevation: {
        type: "number",
        description: "Vertical elevation angle in degrees.",
        required: true,
      },
    },
  },
  {
    name: "undo_last",
    description:
      "Undo the last Blender operation. Use this when the verify step detects that " +
      "the previous code execution produced bad results (geometry distortion, wrong bone placement, etc).",
    parameters: {},
  },
  {
    name: "save_checkpoint",
    description:
      "Save the current Blender scene state as a named checkpoint. " +
      "Use this before risky operations so you can restore if something goes wrong.",
    parameters: {
      name: {
        type: "string",
        description: "Name for the checkpoint (e.g., 'after_rigging', 'before_animation').",
        required: true,
      },
    },
  },
  {
    name: "restore_checkpoint",
    description:
      "Restore the Blender scene from a previously saved checkpoint. " +
      "Use this to rollback to a known-good state when recovery from errors fails.",
    parameters: {
      name: {
        type: "string",
        description: "Name of the checkpoint to restore.",
        required: true,
      },
    },
  },
  {
    name: "export_glb",
    description:
      "Export the current Blender scene as a GLB file. Returns base64-encoded GLB data. " +
      "Use this at the end of the build pipeline to get the final rigged model.",
    parameters: {},
  },
  {
    name: "physics_validate",
    description:
      "Run deterministic anatomy, weight, symmetry, gravity, and optional facial-rig quality gates " +
      "against the currently imported scene.",
    parameters: {
      profile: {
        type: "string",
        description: "Rig profile such as biped, quadruped, or winged.",
        required: true,
      },
      facial: {
        type: "boolean",
        description: "Whether facial viseme targets are required.",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Executor
// ---------------------------------------------------------------------------

export interface ToolCallResult {
  success: boolean;
  data: any;
  error?: string;
}

/**
 * Execute a named Blender MCP tool with the given arguments.
 * This is the main entry point for agent nodes to interact with Blender.
 */
export async function executeBlenderTool(
  toolName: string,
  args: Record<string, any>
): Promise<ToolCallResult> {
  const client = getBlenderClient();

  try {
    switch (toolName) {
      case "import_glb": {
        const glbBase64 = args.glb_base64 as string;
        if (!glbBase64) return { success: false, data: null, error: "Missing required parameter: glb_base64" };
        const result: ImportGlbResult = await client.importGlb(glbBase64);
        return { success: result.success, data: result, error: result.error };
      }

      case "execute_bpy": {
        const code = args.code as string;
        if (!code) return { success: false, data: null, error: "Missing required parameter: code" };
        const result: ExecuteResult = await client.executeCode(code);
        return {
          success: result.success,
          data: {
            success: result.success,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
          },
          error: result.error || undefined,
        };
      }

      case "get_viewport": {
        const result: ViewportResult = await client.getViewport(
          args.azimuth as number | undefined,
          args.elevation as number | undefined
        );
        return {
          success: result.success,
          data: {
            image_base64: result.image_base64,
            width: result.width,
            height: result.height,
          },
        };
      }

      case "read_scene": {
        const result: SceneGraph = await client.readScene();
        return {
          success: result.success,
          data: result,
        };
      }

      case "rotate_viewport": {
        const azimuth = args.azimuth as number;
        const elevation = args.elevation as number;
        if (azimuth === undefined || elevation === undefined) {
          return { success: false, data: null, error: "Missing azimuth or elevation" };
        }
        const result = await client.setViewportAngle(azimuth, elevation);
        return { success: result.success, data: result };
      }

      case "undo_last": {
        const result = await client.undo();
        return { success: result.success, data: result, error: result.error };
      }

      case "save_checkpoint": {
        const name = args.name as string;
        if (!name) return { success: false, data: null, error: "Missing checkpoint name" };
        const result = await client.saveCheckpoint(name);
        return { success: result.success, data: result, error: result.error };
      }

      case "restore_checkpoint": {
        const name = args.name as string;
        if (!name) return { success: false, data: null, error: "Missing checkpoint name" };
        const result = await client.restoreCheckpoint(name);
        return { success: result.success, data: result, error: result.error };
      }

      case "export_glb": {
        const result: ExportResult = await client.exportGlb();
        return {
          success: result.success,
          data: {
            success: result.success,
            glb_base64: result.glb_base64,
            size_bytes: result.size_bytes,
            error: result.error,
          },
          error: result.error || undefined,
        };
      }

      case "physics_validate": {
        const profile = String(args.profile || "").trim();
        if (!profile) return { success: false, data: null, error: "Missing rig profile" };
        const result: PhysicsValidationResult = await client.physicsValidate(profile, Boolean(args.facial));
        return { success: result.success, data: result, error: result.error };
      }

      default:
        return { success: false, data: null, error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    return {
      success: false,
      data: null,
      error: `Tool execution failed: ${err.message}`,
    };
  }
}

/**
 * Get tool definitions formatted for LLM function calling schemas.
 */
export function getToolSchemas() {
  return BLENDER_TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (() => {
        const entries = Object.entries(tool.parameters) as Array<[string, { type: string; description: string; required?: boolean }]>;
        return {
          type: "object",
          properties: Object.fromEntries(
            entries.map(([key, val]) => [key, { type: val.type, description: val.description }])
          ),
          required: entries.filter(([, val]) => val.required).map(([key]) => key),
        };
      })(),
    },
  }));
}
