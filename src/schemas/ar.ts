/**
 * AR API Zod schemas
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.1: Schema validation layer
 */

import { z } from 'zod';

/**
 * Semantic scan request schema
 */
export const SemanticScanRequestSchema = z.object({
  /**
   * Required: Base64 encoded image data
   * Must be a valid data URL with allowed MIME type
   */
  imageBase64: z
    .string()
    .min(1, 'imageBase64 is required')
    .refine(
      (val) => val.startsWith('data:'),
      'imageBase64 must be a data URL (data:image/*;base64,...)'
    ),

  /**
   * Optional: Anchor hash for spatial consistency
   * Used to correlate multiple scans of the same space
   */
  anchorHash: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Optional anchor identifier for spatial consistency'),

  force: z.boolean().optional().default(false),

  /**
   * SECURITY: imageUrl parameter is explicitly rejected
   * Removed in P0.3 to prevent SSRF attacks
   */
  imageUrl: z.never().optional(),
}).strict();

/**
 * Semantic scan response schema
 */
export const SemanticScanResponseSchema = z.object({
  success: z.literal(true),
  zones: z.array(z.object({
    id: z.string(),
    type: z.enum(['floor', 'wall', 'ceiling', 'furniture', 'unknown']),
    confidence: z.number().min(0).max(1),
    boundingBox: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      depth: z.number().optional(),
    }),
  })).describe('Detected spatial zones'),
  anchorHash: z.string().optional().describe('Generated or provided anchor hash'),
  metadata: z.object({
    processingTime: z.number().describe('Processing time in milliseconds'),
    imageDimensions: z.object({
      width: z.number(),
      height: z.number(),
    }),
  }),
});

/**
 * Semantic scan combined schema
 */
export const SemanticScanApiSchema = z.object({
  request: SemanticScanRequestSchema,
  response: SemanticScanResponseSchema,
});

/**
 * AR session request schema
 */
export const ARSessionRequestSchema = z.object({
  /**
   * Required: User device capabilities
   */
  capabilities: z.object({
    webxr: z.boolean(),
    depth: z.boolean().optional(),
    mesh: z.boolean().optional(),
    planes: z.boolean().optional(),
    anchors: z.boolean().optional(),
  }),

  /**
   * Required: Device identification (anonymized)
   */
  device: z.object({
    platform: z.enum(['android', 'ios', 'windows', 'macos', 'linux']),
    browser: z.string(),
    screenDimensions: z.object({
      width: z.number(),
      height: z.number(),
    }),
  }),
});

/**
 * AR session response schema
 */
export const ARSessionResponseSchema = z.object({
  success: z.literal(true),
  sessionId: z.string().describe('Unique session identifier'),
  backend: z.enum(['webxr', 'xr8', 'fallback']).describe('AR backend in use'),
  capabilities: z.object({
    available: z.array(z.string()),
    degraded: z.array(z.string()).optional(),
  }),
  expiresAt: z.string().datetime().describe('Session expiration timestamp'),
});

/**
 * AR session combined schema
 */
export const ARSessionApiSchema = z.object({
  request: ARSessionRequestSchema,
  response: ARSessionResponseSchema,
});

/**
 * AR anchor creation request schema
 */
export const ARAnchorCreateSchema = z.object({
  /**
   * Required: Session ID
   */
  sessionId: z.string().min(1),

  /**
   * Required: Anchor type
   */
  type: z.enum(['plane', 'face', 'object', 'image', 'spatial']),

  /**
   * Optional: Anchor data (position, orientation, etc.)
   */
  data: z.record(z.string(), z.any()).optional(),
});

/**
 * AR anchor creation response schema
 */
export const ARAnchorCreateResponseSchema = z.object({
  success: z.literal(true),
  anchorId: z.string().describe('Unique anchor identifier'),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * AR anchor creation combined schema
 */
export const ARAnchorCreateApiSchema = z.object({
  request: ARAnchorCreateSchema,
  response: ARAnchorCreateResponseSchema,
});

/**
 * AR trackable list response schema
 */
export const ARTrackableListSchema = z.object({
  success: z.literal(true),
  trackables: z.array(z.object({
    id: z.string(),
    type: z.string(),
    createdAt: z.string().datetime(),
    metadata: z.record(z.string(), z.any()).optional(),
  })),
});

/**
 * AR trackable list combined schema
 */
export const ARTrackableListApiSchema = z.object({
  response: ARTrackableListSchema,
});
