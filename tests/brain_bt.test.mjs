import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Sequence,
  Selector,
  Parallel,
  Inverter,
  Leaf,
  LeafRegistry,
  buildTree,
  defaultRegistry,
} from "../src/brain/index.ts";

const ok = () => "success";
const no = () => "failure";
const run = () => "running";
const baseCtx = { dt: 0.016, now: 0, blackboard: {} };

test("Sequence fails on first failure, else succeeds", () => {
  assert.equal(new Sequence([new Leaf("a", ok), new Leaf("b", ok)]).tick(baseCtx), "success");
  assert.equal(new Sequence([new Leaf("a", ok), new Leaf("b", no)]).tick(baseCtx), "failure");
});

test("Sequence propagates running (short-circuits)", () => {
  let bTicked = false;
  const s = new Sequence([new Leaf("a", run), new Leaf("b", () => ((bTicked = true), "success"))]);
  assert.equal(s.tick(baseCtx), "running");
  assert.equal(bTicked, false, "b should not tick after running a");
});

test("Selector returns first success, else failure", () => {
  assert.equal(new Selector([new Leaf("a", no), new Leaf("b", ok)]).tick(baseCtx), "success");
  assert.equal(new Selector([new Leaf("a", no), new Leaf("b", no)]).tick(baseCtx), "failure");
});

test("Parallel all-policy: succeeds only when all succeed", () => {
  assert.equal(new Parallel([new Leaf("a", ok), new Leaf("b", ok)], "all").tick(baseCtx), "success");
  assert.equal(new Parallel([new Leaf("a", ok), new Leaf("b", no)], "all").tick(baseCtx), "failure");
});

test("Parallel any-policy: succeeds when any succeeds", () => {
  assert.equal(new Parallel([new Leaf("a", no), new Leaf("b", ok)], "any").tick(baseCtx), "success");
  assert.equal(new Parallel([new Leaf("a", run), new Leaf("b", run)], "any").tick(baseCtx), "running");
});

test("Inverter flips success/failure, passes running", () => {
  assert.equal(new Inverter(new Leaf("a", ok)).tick(baseCtx), "failure");
  assert.equal(new Inverter(new Leaf("a", no)).tick(baseCtx), "success");
  assert.equal(new Inverter(new Leaf("a", run)).tick(baseCtx), "running");
});

test("LeafRegistry throws on unregistered leaf", () => {
  assert.throws(() => new LeafRegistry().leaf("nope"), /not registered/);
});

test("buildTree(bark) emits a vocalize event and succeeds", () => {
  const reg = defaultRegistry();
  const tree = buildTree("bark", reg);
  const events = [];
  const status = tree.tick({ ...baseCtx, emit: (e) => events.push(e) });
  assert.equal(status, "success");
  assert.ok(events.some((e) => e.type === "vocalize"), "bark tree vocalizes");
});

test("buildTree(eat) does not vocalize", () => {
  const reg = defaultRegistry();
  const tree = buildTree("eat", reg);
  const events = [];
  tree.tick({ ...baseCtx, emit: (e) => events.push(e) });
  assert.ok(!events.some((e) => e.type === "vocalize"), "eat tree is silent");
});
