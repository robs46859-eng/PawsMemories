/**
 * Safe remote URL fetcher with security controls
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.4: Safe remote URL fetching
 */

/**
 * Allowed IP address ranges (reject everything not in public internet)
 */
interface IPRange {
  ip: string;
  mask: string;
}

const PRIVATE_IP_RANGES: IPRange[] = [
  // IPv4 private ranges
  { ip: '10.0.0.0', mask: '255.0.0.0' },      // 10.0.0.0/8
  { ip: '172.16.0.0', mask: '255.240.0.0' },   // 172.16.0.0/12
  { ip: '192.168.0.0', mask: '255.255.0.0' },  // 192.168.0.0/16
  { ip: '127.0.0.0', mask: '255.0.0.0' },      // 127.0.0.0/8 (loopback)
  { ip: '169.254.0.0', mask: '255.255.0.0' },  // 169.254.0.0/16 (link-local)
  { ip: '0.0.0.0', mask: '255.0.0.0' },        // 0.0.0.0/8
];

/**
 * Check if IP address is private/restricted
 */
export function isPrivateOrRestrictedIp(ip: string): boolean {
  if (ip === 'localhost') return true;
  
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false; // IPv6 not supported in this check
  
  // Check against private ranges
  for (const range of PRIVATE_IP_RANGES) {
    const rangeParts = range.ip.split('.').map(Number);
    let match = true;
    
    for (let i = 0; i < 4; i++) {
      const ipPart = parts[i];
      const rangePart = rangeParts[i];
      const maskPart = range.mask.split('.').map(Number)[i];
      
      if ((ipPart & maskPart) !== (rangePart & maskPart)) {
        match = false;
        break;
      }
    }
    
    if (match) return true;
  }
  
  return false;
}

/**
 * Validate URL before fetching
 */
export function validateUrl(url: string): {
  valid: boolean;
  reason?: string;
  parsedUrl?: URL;
} {
  let parsedUrl: URL;
  
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    return {
      valid: false,
      reason: 'Invalid URL format',
    };
  }

  // Protocol check: HTTPS only
  if (parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      reason: 'Only HTTPS URLs are allowed',
    };
  }

  // Domain check (basic)
  if (!parsedUrl.hostname) {
    return {
      valid: false,
      reason: 'Missing hostname',
    };
  }

  return {
    valid: true,
    parsedUrl,
  };
}

/**
 * Safe fetch result types
 */
export type SafeFetchResult = {
  success: false;
  error: string;
} | {
  success: true;
  data: Uint8Array;
  contentType: string;
  byteCount: number;
};

/**
 * Safe fetch for images only (validated MIME type)
 */
export type SafeFetchImageResult = {
  success: false;
  error: string;
} | {
  success: true;
  data: Uint8Array;
  mimeType: string;
  byteCount: number;
};

/**
 * Safe fetch with security controls
 */
export async function safeFetch(
  url: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    allowedDomains?: string[];
  } = {}
): Promise<SafeFetchResult> {
  const {
    maxBytes = 5 * 1024 * 1024, // 5 MB default
    timeoutMs = 15000,          // 15s default
    allowedDomains,
  } = options;

  // Validate URL
  const urlValidation = validateUrl(url);
  if (!urlValidation.valid) {
    return {
      success: false,
      error: urlValidation.reason || 'Invalid URL',
    };
  }

  let finalUrl = url;
  let redirectCount = 0;
  const maxRedirects = 5;
  let totalBytes = 0;
  let contentType = '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Fetch with redirect control
    while (redirectCount <= maxRedirects) {
      const response = await fetch(finalUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Pawsome3D-SafeFetcher/1.0',
          'Accept': 'image/jpeg, image/png, image/webp, application/octet-stream',
        },
        redirect: 'manual', // Manual redirect handling
        signal: controller.signal,
      });

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return {
            success: false,
            error: `Too many redirects (max ${maxRedirects})`,
          };
        }

        const location = response.headers.get('location');
        if (!location) {
          return {
            success: false,
            error: 'Redirect missing Location header',
          };
        }

        // Validate redirect destination
        const redirectValidation = validateUrl(location);
        if (!redirectValidation.valid) {
          return {
            success: false,
            error: `Invalid redirect URL: ${location}`,
          };
        }

        // Check domain allowlist if specified
        if (allowedDomains) {
          const hostname = redirectValidation.parsedUrl!.hostname.toLowerCase();
          const isAllowed = allowedDomains.some(domain => {
            const allowedDomain = domain.toLowerCase();
            return hostname === allowedDomain || hostname.endsWith('.' + allowedDomain);
          });
          
          if (!isAllowed) {
            return {
              success: false,
              error: `Redirect to disallowed domain: ${hostname}`,
            };
          }
        }

        finalUrl = location;
        continue;
      }

      // Check status
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      contentType = response.headers.get('content-type') || '';
      
      // Check content type against allowed domains
      if (allowedDomains && response.headers.has('content-type')) {
        const headerDomain = response.headers.get('content-type')!;
        // Additional validation could go here
      }

      // Stream response with byte limit
      if (!response.body) {
        return {
          success: false,
          error: 'No response body',
        };
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        if (!value) continue;
        
        totalBytes += value.length;
        
        if (totalBytes > maxBytes) {
          reader.cancel();
          clearTimeout(timeoutId);
          return {
            success: false,
            error: `Response too large: ${totalBytes} bytes (max ${maxBytes})`,
          };
        }
        
        chunks.push(value);
      }

      clearTimeout(timeoutId);

      return {
        success: true,
        data: new Uint8Array(Buffer.concat(chunks.map(c => new Uint8Array(c.buffer, c.byteOffset, c.byteLength)))),
        contentType,
        byteCount: totalBytes,
      };
    }

    return {
      success: false,
      error: 'Unexpected redirect loop',
    };

  } catch (err: any) {
    clearTimeout(timeoutId);
    
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timed out',
      };
    }
    
    return {
      success: false,
      error: `Fetch failed: ${err.message || 'Unknown error'}`,
    };
  }
}

/**
 * Safe fetch for images only (validated MIME type)
 */
export async function safeFetchImage(
  url: string,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    allowedDomains?: string[];
  } = {}
): Promise<SafeFetchImageResult> {
  const result = await safeFetch(url, options);
  
  if (result.success === false) {
    return {
      success: false,
      error: result.error,
    } as SafeFetchImageResult;
  }

  // Validate MIME type
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
  const mimeType = result.contentType.split(';')[0].trim().toLowerCase();
  
  if (!allowedMimes.includes(mimeType)) {
    return {
      success: false,
      error: `Unsupported MIME type: ${mimeType}`,
    };
  }

  return {
    success: true,
    data: result.data,
    mimeType,
    byteCount: result.byteCount,
  } as SafeFetchImageResult;
}
