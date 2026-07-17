import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("all shipped animator environment presets resolve to public deployment files", () => {
  const directory = join(process.cwd(), "server", "animator", "environments");
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
    const preset = JSON.parse(readFileSync(join(directory, file), "utf8"));
    const url = preset.backdrop?.url;
    if (!url || !url.startsWith("/animator/")) continue;
    assert.ok(existsSync(join(process.cwd(), "public", url.slice(1))), `${file} points at a shipped backdrop`);
  }
});
