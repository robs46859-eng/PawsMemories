/**
 * Shared Zod schemas for Pawsome3D API
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.1: Schema validation layer
 */

import { z } from 'zod';

// ============================================================================
// RESPONSE SHAPES
// ============================================================================

/**
 * Standard success response
 */
export const SuccessResponseSchema = z.object({
  success: z.boolean(),
});

/**
 * Standard error response
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  validation: z.array(z.string()).optional(),
  details: z.record(z.string(), z.any()).optional(),
});

/**
 * Standard response wrapper
 */
export const ApiResponseSchema = z.union([
  SuccessResponseSchema.extend({ success: z.literal(true) }),
  z.object({ success: z.literal(false) }).extend(ErrorResponseSchema.shape),
]);

// ============================================================================
// VALIDATION CONSTANTS
// ============================================================================

/**
 * Maximum base64 encoded size (5 MB)
 */
export const MAX_BASE64_ENCODED_SIZE = 5 * 1024 * 1024;

/**
 * Maximum decoded image size (10 MB)
 */
export const MAX_IMAGE_DECODED_SIZE = 10 * 1024 * 1024;

/**
 * Maximum image dimensions (4096x4096)
 */
export const MAX_IMAGE_DIMENSION = 4096;

/**
 * Maximum pixel count (decompression bomb protection)
 */
export const MAX_PIXEL_COUNT = 100 * 1000 * 1000; // 100 MPix

/**
 * Maximum aspect ratio (1:10 to 10:1)
 */
export const MAX_ASPECT_RATIO = 10;

/**
 * Allowed image MIME types
 */
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Base64 character pattern (strict, no whitespace)
 */
export const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

// ============================================================================
// FILE SIGNATURE HELPERS
// ============================================================================

/**
 * Magic numbers for supported image formats
 */
export const FILE_SIGNATURES = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  webp: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]),
};

/**
 * Validate file signature
 * @param buffer - Image data buffer
 * @returns Detected MIME type or null
 */
export function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // Check JPEG
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // Check PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // Check WebP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Calculate decoded size from base64 string
 */
export function calculateBase64Size(base64: string): {
  encodedSize: number;
  decodedSize: number;
} {
  const encodedSize = Buffer.byteLength(base64, 'utf8');
  // Approximate decoded size (base64 is ~1.33x compression)
  const decodedSize = Math.floor((encodedSize * 3) / 4);
  
  return { encodedSize, decodedSize };
}

/**
 * Validate base64 string
 */
export function validateBase64String(input: string): {
  valid: boolean;
  reason?: string;
} {
  // Check for valid base64 pattern (strict, no whitespace)
  if (!BASE64_PATTERN.test(input)) {
    return {
      valid: false,
      reason: 'Invalid base64 characters',
    };
  }

  // Try to decode
  try {
    const buffer = Buffer.from(input, 'base64');
    
    // Check decoded size
    if (buffer.length > MAX_IMAGE_DECODED_SIZE) {
      return {
        valid: false,
        reason: `Image too large: ${buffer.length} bytes (max ${MAX_IMAGE_DECODED_SIZE})`,
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: 'Failed to decode base64',
    };
  }
}

/**
 * Validate data URL format
 */
export function parseDataUrl(input: string): {
  valid: boolean;
  mimeType?: string;
  base64Data?: string;
  reason?: string;
} {
  if (!input.startsWith('data:')) {
    return {
      valid: false,
      reason: 'Must be a data URL (data:image/*;base64,...)',
    };
  }

  const match = input.match(/^data:(?<mime>[^;]+);base64,(?<data>.+)$/s);
  if (!match) {
    return {
      valid: false,
      reason: 'Invalid data URL format',
    };
  }

  const mime = match.groups?.mime || '';
  const data = match.groups?.data || '';

  // Check for valid MIME type
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(mime)) {
    return {
      valid: false,
      reason: `Unsupported MIME type: ${mime}`,
    };
  }

  // Check base64 validity
  const validation = validateBase64String(data);
  if (!validation.valid) {
    return {
      valid: false,
      reason: validation.reason,
    };
  }

  // Check encoded size
  const { encodedSize } = calculateBase64Size(data);
  if (encodedSize > MAX_BASE64_ENCODED_SIZE) {
    return {
      valid: false,
      reason: `Encoded size too large: ${encodedSize} bytes (max ${MAX_BASE64_ENCODED_SIZE})`,
    };
  }

  return {
    valid: true,
    mimeType: mime,
    base64Data: data,
  };
}
