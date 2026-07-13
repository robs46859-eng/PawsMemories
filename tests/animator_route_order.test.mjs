/**
 * Phase 0.1: Route resolution order test.
 *
 * Proves that POST /rig and GET /rig/:id resolve correctly to their respective
 * handlers regardless of definition order in the router. This is important
 * because Express matches routes in definition order, and a route param like
 * ":id" can accidentally match a static route if defined too early.
 */
import test from "node:test";
import assert from "node:assert";
import http from "http";
import express from "express";
import { animatorRouter } from "../server/animator/routes.ts";

test("POST /rig and GET /rig/:id resolve correctly regardless of order", async (t) => {
  await t.test("rig stub endpoints resolve to 501", async (t2) => {
    await t2.test("POST /animator/rig resolves to rig stub (501)", async () => {
      const app = express();
      app.use(express.json());
      app.use("/animator", animatorRouter);

      return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, async () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            server.close();
            reject(new Error("Failed to get server address"));
            return;
          }
          const baseUrl = `http://localhost:${addr.port}/animator`;

          try {
            const res = await fetch(`${baseUrl}/rig`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ meshGlbUrl: "test.glb" }),
            });

            assert.strictEqual(
              res.status,
              501,
              "POST /animator/rig should resolve to rig stub (501), got " + res.status
            );
            const body = await res.json();
            assert.strictEqual(body.code, "NOT_IMPLEMENTED");
            assert.strictEqual(body.service, "rig");
          } catch (err) {
            reject(err);
          } finally {
            server.close();
            resolve(undefined);
          }
        });
      });
    });

    await t2.test("GET /animator/rig/:id resolves to rig stub (501)", async () => {
      const app = express();
      app.use(express.json());
      app.use("/animator", animatorRouter);

      return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, async () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            server.close();
            reject(new Error("Failed to get server address"));
            return;
          }
          const baseUrl = `http://localhost:${addr.port}/animator`;

          try {
            const testId = "550e8400-e29b-41d4-a716-446655440000";
            const res = await fetch(`${baseUrl}/rig/${testId}`);

            assert.strictEqual(
              res.status,
              501,
              "GET /animator/rig/:id should resolve to rig stub (501), got " + res.status
            );
            const body = await res.json();
            assert.strictEqual(body.code, "NOT_IMPLEMENTED");
            assert.strictEqual(body.service, "rig");
          } catch (err) {
            reject(err);
          } finally {
            server.close();
            resolve(undefined);
          }
        });
      });
    });
  });

  await t.test("all stub endpoints return 501", async (t2) => {
    const stubEndpoints = [
      { method: "POST", path: "/animator/retarget" },
      { method: "POST", path: "/animator/repurpose" },
      // NOTE: /animator/lipsync is no longer a 501 stub — Phase 2 implemented it
      // (POST → job, GET → validated track / typed failure). See tests/animator_phase2.test.mjs.
      { method: "POST", path: "/animator/reconstruct" },
      { method: "GET", path: "/animator/reconstruct/550e8400-e29b-41d4-a716-446655440000" },
      { method: "POST", path: "/animator/bake" },
      { method: "GET", path: "/animator/bake/550e8400-e29b-41d4-a716-446655440000" },
    ];

    for (const { method, path: p } of stubEndpoints) {
      await t2.test(`${method} ${p} -> 501`, async () => {
        const app = express();
        app.use(express.json());
        app.use("/animator", animatorRouter);

        return new Promise((resolve, reject) => {
          const server = http.createServer(app);
          server.listen(0, async () => {
            const addr = server.address();
            if (!addr || typeof addr === "string") {
              server.close();
              reject(new Error("Failed to get server address"));
              return;
            }
            try {
              const res = await fetch(`http://localhost:${addr.port}${p}`, { method });
              assert.strictEqual(
                res.status,
                501,
                `${method} ${p} should resolve to stub (501), got ${res.status}`
              );
            } catch (err) {
              reject(err);
            } finally {
              server.close();
              resolve(undefined);
            }
          });
        });
      });
    }
  });

  await t.test("GET /animator/rig-profiles returns 200/[]", async (t2) => {
    await t2.test("rig-profiles returns empty array (200)", async () => {
      const app = express();
      app.use(express.json());
      app.use("/animator", animatorRouter);

      return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, async () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            server.close();
            reject(new Error("Failed to get server address"));
            return;
          }
          try {
            const res = await fetch(`http://localhost:${addr.port}/animator/rig-profiles`);
            assert.strictEqual(
              res.status,
              200,
              "GET /animator/rig-profiles should return 200, got " + res.status
            );
            const body = await res.json();
            assert.ok(Array.isArray(body), "rig-profiles should return an array");
          } catch (err) {
            reject(err);
          } finally {
            server.close();
            resolve(undefined);
          }
        });
      });
    });
  });
});
