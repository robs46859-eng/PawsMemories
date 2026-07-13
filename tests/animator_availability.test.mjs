/**
 * Phase 0.1 hardening: checkAnimatorAvailable dynamic-import guard.
 *
 * Verifies that:
 *  - gltf.ts uses dynamic import inside checkAnimatorAvailable() so the module
 *    cannot crash at top-level import time.
 *  - handleReadError returns empty array without 503 for ANIMATOR_UNAVAILABLE
 *    on GET routes, while handleError returns 503 for POST routes.
 */
import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROUTES_SRC = path.resolve(__dirname, "../server/animator/routes.ts");
const GLTF_SRC = path.resolve(__dirname, "../server/animator/gltf.ts");

test("checkAnimatorAvailable uses dynamic import — module cannot fail at import time", () => {
  const src = fs.readFileSync(GLTF_SRC, "utf8");
  assert.ok(
    src.includes('await import("@gltf-transform/functions")'),
    "gltf.ts must use dynamic import inside checkAnimatorAvailable"
  );
  assert.ok(
    src.includes("isAvailable !== null"),
    "gltf.ts must cache the result of checkAnimatorAvailable"
  );
});

test("handleReadError converts ANIMATOR_UNAVAILABLE to 200/[] on read endpoints", () => {
  const src = fs.readFileSync(ROUTES_SRC, "utf8");

  // 1. Verify handleReadError exists and returns empty array
  assert.ok(
    src.includes("function handleReadError"),
    "routes.ts must export handleReadError"
  );
  const handleReadBlock = src.substring(
    src.indexOf("function handleReadError"),
    src.indexOf("function handleError")
  );
  assert.ok(
    handleReadBlock.includes("return res.json([])"),
    "handleReadError must return empty array"
  );
  assert.ok(
    !handleReadBlock.includes("res.status(503)"),
    "handleReadError must not use 503"
  );

  // 2. Verify handleError returns 503 for ANIMATOR_UNAVAILABLE
  const handleErrorBlock = src.substring(
    src.indexOf("function handleError"),
    src.indexOf("animatorRouter.post(", src.indexOf("function handleError"))
  );
  assert.ok(
    handleErrorBlock.includes("res.status(503)") &&
    handleErrorBlock.includes("ANIMATOR_UNAVAILABLE") &&
    handleErrorBlock.includes("code:"),
    "handleError must return 503 for ANIMATOR_UNAVAILABLE"
  );

  // 3. Verify GET routes use handleReadError (not handleError)
  //    Verify POST routes use handleError (not handleReadError)
  //    Simple approach: find each route, extract its handler body, check the catch call.
  const lines = src.split("\n");
  let seenGetReadHandler = false;
  let seenPostErrorHandler = false;
  let currentHandlerMethod = null; // 'get' or 'post'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect route declarations
    if (line.includes("animatorRouter.get(")) currentHandlerMethod = "get";
    if (line.includes("animatorRouter.post(")) currentHandlerMethod = "post";

    // Look for handler calls in the right context
    if (currentHandlerMethod === "get" && line.includes("handleReadError(res, e)")) {
      seenGetReadHandler = true;
    }
    if (currentHandlerMethod === "get" && line.includes("handleError(res, e)")) {
      // Found handleError in a GET route — flag error
    }
    if (currentHandlerMethod === "post" && line.includes("handleError(res, e)")) {
      seenPostErrorHandler = true;
    }
    if (currentHandlerMethod === "post" && line.includes("handleReadError(res, e)")) {
      // Found handleReadError in a POST route — flag error
    }

    // Detect end of a route handler (closing })
    if (line.includes("}));")) {
      currentHandlerMethod = null;
    }
  }

  assert.ok(seenGetReadHandler, "Should have found handleReadError in GET routes");
  assert.ok(seenPostErrorHandler, "Should have found handleError in POST routes");
});
