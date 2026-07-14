/**
 * Express proxy: routes /api/studio/* → Python FastAPI on port 8001
 *
 * Register in server.ts:
 *   import { studioRouter } from './animator/studio_proxy';
 *   app.use('/api/studio', studioRouter);
 */

import { Router, Request, Response, NextFunction } from 'express';
import httpProxy from 'http-proxy';

const configuredStudioServiceUrl = process.env.STUDIO_SERVICE_URL?.trim() || '';

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname === '127.0.0.1'
      || hostname === '[::1]'
      || hostname === '::1';
  } catch {
    return false;
  }
}

// A production Hostinger process must never proxy paid requests to its own
// machine. Local development can opt in explicitly when a FastAPI service is
// running beside the Node process.
const STUDIO_SERVICE_URL = configuredStudioServiceUrl
  && (!isLoopbackUrl(configuredStudioServiceUrl)
    || process.env.ALLOW_LOCAL_STUDIO_PROXY === 'true')
  ? configuredStudioServiceUrl
  : '';

const proxy = STUDIO_SERVICE_URL
  ? httpProxy.createProxyServer({
      target: STUDIO_SERVICE_URL,
      changeOrigin: true,
      // Required for SSE (progress stream) — disable buffering
      selfHandleResponse: false,
    })
  : null;

if (proxy) {
  proxy.on('error', (err: Error, req: Request, res: Response) => {
    console.error('[studio-proxy] error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Studio service unavailable', detail: err.message });
    }
  });
}

export const studioRouter = Router();

/**
 * Rewrite /api/studio/* → /studio/*
 * e.g. POST /api/studio/productions → POST /studio/productions
 */
studioRouter.use('/', (req: Request, res: Response, next: NextFunction) => {
  if (!proxy) {
    return res.status(503).json({
      error: 'Studio service is not configured on this deployment.',
      code: 'STUDIO_SERVICE_NOT_CONFIGURED',
    });
  }

  // Preserve the /studio prefix that FastAPI expects
  req.url = `/studio${req.url}`;

  // For SSE endpoints, ensure no timeout and flushing
  if (req.headers.accept?.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
  }

  proxy.web(req, res);
});
