import test from "node:test";
import assert from "node:assert/strict";

import { readJsonResponse } from "../src/apiResponse.ts";

test("readJsonResponse reports an HTML fallback without throwing JSON syntax", async () => {
  const response = new Response("<!doctype html><title>Not found</title>", {
    status: 404,
    headers: { "content-type": "text/html" },
  });
  await assert.rejects(
    () => readJsonResponse(response, "Wags is unavailable."),
    /Wags is unavailable.*HTTP 404/,
  );
});

test("readJsonResponse preserves a JSON API error", async () => {
  const response = Response.json({ error: "Token scope is invalid." }, { status: 403 });
  await assert.rejects(
    () => readJsonResponse(response, "Printful failed."),
    /Token scope is invalid/,
  );
});
