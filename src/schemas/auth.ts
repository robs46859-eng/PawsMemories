/**
 * Authentication schemas
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.1: Schema validation layer
 */

import { z } from 'zod';

/**
 * Login request schema
 */
export const LoginRequestSchema = z.object({
  /**
   * Required: User email
   */
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(255, 'Email must be under 255 characters'),

  /**
   * Required: User password
   */
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long'),
});

/**
 * Login response schema
 */
export const LoginResponseSchema = z.object({
  success: z.literal(true),
  token: z.string().describe('Authentication JWT token'),
  user: z.object({
    phone: z.string(),
    email: z.string(),
    is_admin: z.boolean(),
  }),
  expiresAt: z.string().datetime().describe('Token expiration time'),
});

/**
 * Login combined schema
 */
export const LoginApiSchema = z.object({
  request: LoginRequestSchema,
  response: LoginResponseSchema,
});

/**
 * Registration request schema
 */
export const RegisterRequestSchema = z.object({
  /**
   * Required: User email
   */
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(255, 'Email must be under 255 characters'),

  /**
   * Required: User password
   */
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[a-z]/, 'Password must contain lowercase letter')
    .regex(/[0-9]/, 'Password must contain number'),

  /**
   * Required: Password confirmation
   */
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

/**
 * Registration response schema
 */
export const RegisterResponseSchema = z.object({
  success: z.literal(true),
  token: z.string(),
  user: z.object({
    phone: z.string(),
    email: z.string(),
    is_admin: z.boolean(),
  }),
});

/**
 * Registration combined schema
 */
export const RegisterApiSchema = z.object({
  request: RegisterRequestSchema,
  response: RegisterResponseSchema,
});

/**
 * Token refresh request schema
 */
export const RefreshTokenRequestSchema = z.object({
  /**
   * Required: Refresh token
   */
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Token refresh response schema
 */
export const RefreshTokenResponseSchema = z.object({
  success: z.literal(true),
  token: z.string(),
  expiresAt: z.string().datetime(),
});

/**
 * Token refresh combined schema
 */
export const RefreshTokenApiSchema = z.object({
  request: RefreshTokenRequestSchema,
  response: RefreshTokenResponseSchema,
});

/**
 * API key request schema
 */
export const ApiKeyCreateSchema = z.object({
  /**
   * Optional: Key name for identification
   */
  name: z.string().min(1).max(100).optional(),

  /**
   * Optional: Expiration in days (default: 90)
   */
  expiresInDays: z.number().min(1).max(365).optional().default(90),
});

/**
 * API key response schema
 */
export const ApiKeyCreateResponseSchema = z.object({
  success: z.literal(true),
  apiKey: z.string().describe('API key (shown only once)'),
  keyId: z.string(),
  name: z.string().optional(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

/**
 * API key combined schema
 */
export const ApiKeyCreateApiSchema = z.object({
  request: ApiKeyCreateSchema,
  response: ApiKeyCreateResponseSchema,
});
