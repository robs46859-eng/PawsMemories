import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { spawn } from "node:child_process";
import jwt from "jsonwebtoken";

const PORT = 3011; // Use a distinct port to avoid conflicts
const API_URL = `http://127.0.0.1:${PORT}`;

let serverProcess;
const MOCK_JWT_SECRET = "test-secret-1234567890"; // Must be >= 16 chars for server.ts

// Create a valid token for testing authed routes
const validToken = jwt.sign(
  { phone: "test", userId: 1 },
  MOCK_JWT_SECRET,
  { expiresIn: "1h" }
);

before(async () => {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), JWT_SECRET: MOCK_JWT_SECRET };
    // Clear DB vars so initDb() gracefully skips rather than crashing on connection refused
    delete env.DB_NAME;
    delete env.DB_USER;
    
    serverProcess = spawn("npx", ["tsx", "server.ts"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let booted = false;
    serverProcess.stdout.on("data", (data) => {
      if (!booted && data.toString().includes(`Server running on port ${PORT}`)) {
        booted = true;
        resolve();
      }
    });

    serverProcess.stderr.on("data", (data) => {
      // Some DB connection errors might log here since we gave an invalid host,
      // but the server still boots Express before trying to query.
      if (!booted && data.toString().includes(`Server running on port ${PORT}`)) {
        booted = true;
        resolve();
      }
    });

    serverProcess.on("error", (err) => {
      if (!booted) reject(err);
    });
    
    serverProcess.on("exit", (code) => {
      if (!booted) reject(new Error(`Server exited early with code ${code}`));
    });

    // Timeout if it takes too long
    setTimeout(() => {
      if (!booted) reject(new Error("Server boot timeout"));
    }, 10000);
  });
});

after(() => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});

test("Public routes are reachable without a token", async () => {
  // Login route should not return 401 Unauthorized (it might return 400 for bad input, 
  // or 500 for DB error, but NOT the auth middleware's 401)
  const loginRes = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "x", password: "y" })
  });
  
  assert.notEqual(
    loginRes.status,
    401,
    "POST /api/auth/login should not be blocked by requireAuth (should not return 401)"
  );
  
  // Same for signup
  const signupRes = await fetch(`${API_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "123", password: "y", name: "test", email: "test@test.com" })
  });
  
  assert.notEqual(
    signupRes.status,
    401,
    "POST /api/auth/signup should not be blocked by requireAuth (should not return 401)"
  );
});

test("Protected animator and scenes routes return 401 without a token", async () => {
  const animatorRes = await fetch(`${API_URL}/api/animator/jobs`);
  assert.equal(animatorRes.status, 401, "GET /api/animator/jobs without token MUST return 401");
  
  const scenesRes = await fetch(`${API_URL}/api/scenes/backgrounds`);
  assert.equal(scenesRes.status, 401, "GET /api/scenes/backgrounds without token MUST return 401");
});

test("Protected animator and scenes routes accept a valid token", async () => {
  const animatorRes = await fetch(`${API_URL}/api/animator/jobs`, {
    headers: { Authorization: `Bearer ${validToken}` }
  });
  // Since DB is broken in this test environment, we expect a 500, NOT a 401.
  assert.notEqual(animatorRes.status, 401, "GET /api/animator/jobs WITH token should pass auth (no 401)");
  
  const scenesRes = await fetch(`${API_URL}/api/scenes/backgrounds`, {
    headers: { Authorization: `Bearer ${validToken}` }
  });
  // The backgrounds endpoint might be mocked or hit DB, but it shouldn't 401
  assert.notEqual(scenesRes.status, 401, "GET /api/scenes/backgrounds WITH token should pass auth (no 401)");
});
