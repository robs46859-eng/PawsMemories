/**
 * Pet API Zod schemas
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.1: Schema validation layer
 */

import { z } from 'zod';

/**
 * Pet classification request schema
 */
export const ClassifyRequestSchema = z.object({
  /**
   * Required: Base64 encoded image data
   * Must be a valid data URL with allowed MIME type
   * Example: data:image/jpeg;base64,/9j/4AAQSkZJRg...
   */
  imageBase64: z
    .string()
    .min(1, 'imageBase64 is required')
    .refine(
      (val) => val.startsWith('data:'),
      'imageBase64 must be a data URL (data:image/*;base64,...)'
    ),

  /**
   * Optional: Metadata about the image
   * Currently unused, reserved for future features
   */
  metadata: z.record(z.string(), z.any()).optional(),

  /**
   * SECURITY: imageUrl parameter is explicitly rejected
   * Removed in P0.3 to prevent SSRF attacks
   * This field exists in the schema to capture and reject attempts to use it
   */
  imageUrl: z
    .never()
    .optional()
    .catch(undefined)
    .refine(
      () => false,
      'imageUrl parameter is not allowed for security reasons. Use imageBase64 instead.'
    ),
});

/**
 * Pet classification response schema
 */
export const ClassifyResponseSchema = z.object({
  success: z.literal(true),
  pet: z.string().describe('Detected pet type (e.g., "dog", "cat", "bird")'),
  breed: z.string().optional().describe('Detected breed if available'),
  confidence: z.number().min(0).max(1).describe('Classification confidence score'),
  attributes: z.record(z.string(), z.any()).optional().describe('Additional detected attributes'),
});

/**
 * Pet classification combined schema
 */
export const ClassifyApiSchema = z.object({
  request: ClassifyRequestSchema,
  response: ClassifyResponseSchema,
});

/**
 * Pet retrieval request schema
 */
export const GetPetRequestSchema = z.object({
  /**
   * Pet ID from path parameter
   */
  id: z
    .string()
    .regex(/^\d+$/, 'Pet ID must be a positive integer')
    .refine((val) => parseInt(val, 10) > 0, 'Pet ID must be positive'),
});

/**
 * Pet retrieval response schema
 */
export const GetPetResponseSchema = z.object({
  success: z.literal(true),
  pet: z.object({
    id: z.number(),
    name: z.string(),
    species: z.string(),
    breed: z.string().optional(),
    modelUrl: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
});

/**
 * Pet retrieval combined schema
 */
export const GetPetApiSchema = z.object({
  request: GetPetRequestSchema,
  response: GetPetResponseSchema,
});

/**
 * Rig generation request schema
 */
export const RigRequestSchema = z.object({
  /**
   * Pet ID from path parameter
   */
  id: z
    .string()
    .regex(/^\d+$/, 'Pet ID must be a positive integer')
    .refine((val) => parseInt(val, 10) > 0, 'Pet ID must be positive'),

  /**
   * Optional: Force regeneration even if cached result exists
   * Requires higher quota usage
   */
  force: z.boolean().optional().default(false),

  /**
   * Optional: Additional processing options
   * Currently reserved for future features
   */
  options: z.record(z.string(), z.any()).optional(),
});

/**
 * Rig generation response schema
 */
export const RigResponseSchema = z.object({
  success: z.literal(true),
  jobId: z.string().describe('Rig job identifier'),
  status: z.enum(['queued', 'processing', 'completed', 'failed']).describe('Job status'),
  estimatedCompletion: z.string().optional().describe('ISO timestamp for estimated completion'),
});

/**
 * Rig generation combined schema
 */
export const RigApiSchema = z.object({
  request: RigRequestSchema,
  response: RigResponseSchema,
});

/**
 * Pet commands request schema
 */
export const PetCommandSchema = z.object({
  /**
   * Pet ID
   */
  petId: z
    .string()
    .regex(/^\d+$/, 'Pet ID must be a positive integer'),

  /**
   * Command name
   */
  command: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z_]+$/, 'Command must be lowercase with underscores only'),

  /**
   * Optional: Command parameters
   */
  parameters: z.record(z.string(), z.any()).optional(),
});

/**
 * Pet commands response schema
 */
export const PetCommandResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  executedAt: z.string().datetime(),
});

/**
 * Pet commands combined schema
 */
export const PetCommandApiSchema = z.object({
  request: PetCommandSchema,
  response: PetCommandResponseSchema,
});
