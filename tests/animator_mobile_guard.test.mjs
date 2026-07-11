import test from "node:test";
import assert from "node:assert";
import { isMobile, hasWebGL2, hasWebCodecs } from "../src/animator/utils/capabilities.ts";

test("animator_mobile_guard", async (t) => {
  await t.test("capabilities helpers handle missing globals cleanly", () => {
    // In node environment, navigator/document/window are undefined
    assert.strictEqual(isMobile(), false);
    assert.strictEqual(hasWebGL2(), false);
    assert.strictEqual(hasWebCodecs(), false);
  });

  await t.test("isMobile detects common mobile user agents", () => {
    const originalNavigator = global.navigator;
    
    const setUA = (ua) => {
      Object.defineProperty(global, "navigator", {
        value: { userAgent: ua },
        configurable: true
      });
    };

    setUA("Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)");
    assert.strictEqual(isMobile(), true);

    setUA("Mozilla/5.0 (Linux; Android 10; SM-G981B)");
    assert.strictEqual(isMobile(), true);

    setUA("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    assert.strictEqual(isMobile(), false);
    
    // cleanup
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true
    });
  });

  await t.test("hasWebCodecs detects VideoEncoder and MediaRecorder", () => {
    global.window = {};
    assert.strictEqual(hasWebCodecs(), false);

    global.window = { VideoEncoder: {}, MediaRecorder: {} };
    assert.strictEqual(hasWebCodecs(), true);
    
    // cleanup
    delete global.window;
  });

  await t.test("hasWebGL2 detects webgl2 context", () => {
    global.document = {
      createElement: () => ({
        getContext: (type) => type === "webgl2" ? {} : null
      })
    };
    global.window = { WebGL2RenderingContext: {} };
    
    assert.strictEqual(hasWebGL2(), true);
    
    // cleanup
    delete global.document;
    delete global.window;
  });
});
