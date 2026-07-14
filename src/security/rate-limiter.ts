/**
 * Rate limiter middleware and utilities
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.6: Rate limiting
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Rate limit entry
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limiter storage (in-memory for dev/staging, Redis for production)
 */
class RateLimitStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private readonly defaultResetTime: number = 3600000; // 1 hour in ms

  /**
   * Get rate limit entry for a key
   */
  get(key: string): RateLimitEntry | null {
    const entry = this.store.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.resetTime) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Increment rate limit for a key
   */
  increment(key: string, resetTime: number = this.defaultResetTime): number {
    let entry = this.store.get(key);

    if (!entry || Date.now() > entry.resetTime) {
      entry = {
        count: 1,
        resetTime: Date.now() + resetTime
      };
    } else {
      entry.count++;
    }

    this.store.set(key, entry);
    return entry.count;
  }

  /**
   * Check if key is rate limited
   */
  isLimited(key: string, limit: number): {
    limited: boolean;
    retryAfter?: number;
    remaining?: number;
  } {
    const entry = this.get(key);

    if (!entry) {
      return { limited: false };
    }

    if (entry.count >= limit) {
      const retryAfter = Math.max(0, entry.resetTime - Date.now());
      return {
        limited: true,
        retryAfter: Math.ceil(retryAfter / 1000),
        remaining: 0
      };
    }

    return {
      limited: false,
      remaining: limit - entry.count
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

// Global rate limiter store
const rateLimitStore = new RateLimitStore();

// Auto-cleanup every 5 minutes. Unref'd so this timer can NEVER keep the
// Node event loop (and therefore a test runner or CLI) alive. Without this,
// importing the module in a test would leave a live timer and hang `tsx --test`.
const cleanupTimer = setInterval(() => rateLimitStore.cleanup(), 5 * 60 * 1000);
// `unref` exists in Node; guard for non-Node/edge runtimes.
if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();

/**
 * Trusted proxy configuration
 */
export interface TrustedProxyConfig {
  enabled: boolean;
  trustedHeaders: string[]; // ['X-Forwarded-For', 'X-Real-IP']
}

/**
 * Get client IP from request (with trusted proxy support)
 */
export function getClientIp(
  req: Request,
  proxyConfig: TrustedProxyConfig = { enabled: false, trustedHeaders: ['X-Forwarded-For'] }
): string {
  if (proxyConfig.enabled) {
    for (const header of proxyConfig.trustedHeaders) {
      const forwarded = req.headers[header.toLowerCase()];
      if (forwarded && typeof forwarded === 'string') {
        // X-Forwarded-For can have multiple IPs: client, proxy1, proxy2
        const ips = forwarded.split(',').map(ip => ip.trim());
        if (ips.length > 0) {
          return ips[0]; // First IP is the client
        }
      }
    }
  }

  // Fallback to socket address
  return (req.socket?.remoteAddress || '127.0.0.1')
    .replace('^::ffff:', '') // Remove IPv6-mapped IPv4 prefix
    .split(':')[0]; // Remove port if present
}

/**
 * Create hashed IP for rate limiting (to protect privacy)
 */
export function hashIp(ip: string): string {
  // Simple hash (not cryptographic - just for rate limiting deduplication)
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `ip_${Math.abs(hash)}`;
}

/**
 * Rate limit middleware factory
 */
export function createRateLimiter(
  options: {
    windowMs: number;
    max: number;
    keyGenerator: (req: Request) => string;
    skip?: (req: Request) => boolean;
  }
) {
  const { windowMs, max, keyGenerator, skip } = options;

  return function rateLimiterMiddleware(req: Request, res: Response, next: NextFunction) {
    // Skip if configured
    if (skip && skip(req)) {
      return next();
    }

    // Generate rate limit key
    const key = keyGenerator(req);
    
    // Check rate limit
    const { limited, retryAfter, remaining } = rateLimitStore.isLimited(key, max);

    if (limited) {
      // Set headers
      res.set({
        'X-RateLimit-Limit': max.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.ceil((Date.now() + retryAfter!) / 1000).toString(),
        'Retry-After': retryAfter!.toString(),
      });

      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        details: ['Rate limit exceeded. Please try again later.'],
      });
    }

    // Set rate limit headers (for informational purposes)
    res.set({
      'X-RateLimit-Limit': max.toString(),
      'X-RateLimit-Remaining': remaining!.toString(),
      'X-RateLimit-Reset': Math.ceil((Date.now() + windowMs) / 1000).toString(),
    });

    // Increment counter
    rateLimitStore.increment(key, windowMs);

    next();
  };
}

/**
 * Pre-configured rate limiters
 */

/**
 * Per-user rate limiter
 */
export function perUserRateLimiter(
  endpoint: string,
  maxPerHour: number
) {
  return createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: maxPerHour,
    keyGenerator: (req) => `user_${(req as any).user?.phone || 'unknown'}:${endpoint}`,
  });
}

/**
 * Per-IP rate limiter (hashed for privacy)
 */
export function perIpRateLimiter(
  endpoint: string,
  maxPerHour: number,
  proxyConfig: TrustedProxyConfig = { enabled: false, trustedHeaders: ['X-Forwarded-For'] }
) {
  return createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: maxPerHour,
    keyGenerator: (req) => `ip_${hashIp(getClientIp(req, proxyConfig))}:${endpoint}`,
  });
}

/**
 * Global rate limiter (all endpoints combined)
 */
export function globalRateLimiter(
  maxPerHour: number,
  proxyConfig: TrustedProxyConfig = { enabled: false, trustedHeaders: ['X-Forwarded-For'] }
) {
  return createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: maxPerHour,
    keyGenerator: (req) => `ip_${hashIp(getClientIp(req, proxyConfig))}`,
  });
}
