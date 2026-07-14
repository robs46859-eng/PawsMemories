/**
 * URL sanitizer and validator
 * 
 * Phase P2: Input/Upload/Remote-Fetch Security
 * Part P2.4: URL validation before fetch
 */

/**
 * Validate URL structure and protocol
 */
export function validateUrl(url: string): {
  valid: boolean;
  reason?: string;
  url?: URL;
} {
  if (!url || typeof url !== 'string') {
    return { valid: false, reason: 'URL is required' };
  }

  let parsedUrl: URL;
  
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Protocol check: HTTPS only
  if (parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      reason: 'Only HTTPS URLs are allowed'
    };
  }

  // Hostname check
  if (!parsedUrl.hostname || parsedUrl.hostname.length === 0) {
    return {
      valid: false,
      reason: 'Missing hostname'
    };
  }

  // Reject IPv6 loopback and link-local
  if (parsedUrl.hostname.startsWith('[')) {
    const ipv6 = parsedUrl.hostname.slice(1, -1);
    if (ipv6 === '::1' || ipv6.startsWith('fe80:')) {
      return {
        valid: false,
        reason: 'Loopback and link-local IPv6 addresses are not allowed'
      };
    }
  }

  // Reject IPv4 loopback and link-local
  if (/^\d+\.\d+\.\d+\.\d+$/.test(parsedUrl.hostname)) {
    const parts = parsedUrl.hostname.split('.').map(Number);
    if (parts[0] === 127) {
      return {
        valid: false,
        reason: 'Loopback addresses (127.x.x.x) are not allowed'
      };
    }
    if (parts[0] === 169 && parts[1] === 254) {
      return {
        valid: false,
        reason: 'Link-local addresses (169.254.x.x) are not allowed'
      };
    }
  }

  return {
    valid: true,
    url: parsedUrl
  };
}

/**
 * Domain allowlist validator
 */
export function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  const normalizedHostname = hostname.toLowerCase();
  
  return allowedDomains.some(allowed => {
    const normalizedAllowed = allowed.toLowerCase();
    // Exact match or subdomain match
    return (
      normalizedHostname === normalizedAllowed ||
      normalizedHostname.endsWith('.' + normalizedAllowed)
    );
  });
}

/**
 * Parse and validate data URL
 */
export function parseDataUrl(dataUrl: string): {
  valid: boolean;
  mimeType?: string;
  base64Data?: string;
  reason?: string;
} {
  if (!dataUrl.startsWith('data:')) {
    return {
      valid: false,
      reason: 'Must be a data URL starting with "data:"'
    };
  }

  const match = dataUrl.match(/^data:(?<mimeType>[^;]+);base64,(?<data>.+)$/s);
  if (!match) {
    return {
      valid: false,
      reason: 'Invalid data URL format. Expected: data:<mimeType>;base64,<data>'
    };
  }

  const mimeType = match.groups?.mimeType || '';
  const base64Data = match.groups?.data || '';

  // Validate base64
  const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Pattern.test(base64Data)) {
    return {
      valid: false,
      reason: 'Invalid base64 characters'
    };
  }

  return {
    valid: true,
    mimeType,
    base64Data
  };
}
