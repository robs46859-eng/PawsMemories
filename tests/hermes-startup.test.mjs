import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("invalid enabled Hermes configuration exits instead of leaving an unbound process", async () => {
  const env = {
    ...process.env,
    JWT_SECRET: "fixture-hermes-startup-signing-material", // gitleaks:allow
    HERMES_ENABLED: "true",
    NODE_ENV: "production",
  };
  delete env.HERMES_EDGE_BRIDGE_URL;
  delete env.HERMES_EDGE_PRODUCER_SECRET;
  delete env.DB_NAME;
  delete env.DB_USER;
  delete env.DATABASE_URL;

  const tsxBin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const child = spawn(tsxBin, ["server.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Invalid Hermes startup did not exit within 10 seconds."));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });

  assert.equal(code, 1);
  assert.match(output, /\[FATAL\] Server startup failed:/);
  assert.equal(output.includes("Server running on port"), false);
});
