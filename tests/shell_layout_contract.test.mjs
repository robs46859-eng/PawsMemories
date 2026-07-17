import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("global shell keeps stable desktop dimensions", () => {
  assert.match(source, /h-16/);
  assert.match(source, /hidden w-64[^\n]+md:flex/);
  assert.match(source, /md:ml-64/);
  assert.match(source, /md:w-\[calc\(100%-16rem\)\]/);
  assert.match(source, /min-w-0/);
  assert.doesNotMatch(source, /md:ml-64 w-full/);
});

test("signed-out shell does not expose product navigation", () => {
  assert.match(source, /\{isAuthed && \(/);
  assert.match(source, /TOP_PRIMARY_NAV\.map/);
});

test("mobile shell reserves five fixed columns", () => {
  assert.match(source, /grid-cols-5/);
  assert.match(source, /MOBILE_NAV\.map/);
});
