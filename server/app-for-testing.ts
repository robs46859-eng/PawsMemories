/**
 * server.ts export - for contract testing
 * 
 * This file exports the Express app instance for use in contract tests.
 * It does NOT start the server, connect to database, or bind to a port.
 */

import express from 'express';
import { initDb } from './db';

const app = express();

// ============================================================================
// Middleware
// ============================================================================

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health check endpoints (for load balancers)
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/readyz', (req, res) => {
  // Check database connection (optional, can fail gracefully)
  res.status(200).json({ status: 'ready' });
});

// ============================================================================
// Routes (simplified - in production, all routes are defined in server.ts)
// ============================================================================

// Example: /api/pets/classify (will be fully implemented in production)
app.post('/api/pets/classify', async (req, res) => {
  // In production, this would:
  // 1. Require auth
  // 2. Validate input
  // 3. Call Gemini API
  // 4. Store results
  
  res.status(200).json({ 
    error: "Contract test stub - implement in production",
    featureFlag: "PETSIM_CLASSIFY_ENABLED"
  });
});

// Example: /api/ar/semantic-scan (will be fully implemented in production)
app.post('/api/ar/semantic-scan', async (req, res) => {
  res.status(200).json({
    error: "Contract test stub - implement in production",
    featureFlag: "PETSIM_SEMANTIC_SCAN_ENABLED"
  });
});

// Example: /api/pets/:id/rig (will be fully implemented in production)
app.post('/api/pets/:id/rig', async (req, res) => {
  res.status(501).json({
    error: "Rig pipeline disabled",
    featureFlag: "PETSIM_RIG_ENABLED"
  });
});

// ============================================================================
// Export for testing
// ============================================================================

export default app;
export { initDb };
