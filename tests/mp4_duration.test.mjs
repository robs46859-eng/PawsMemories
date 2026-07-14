import assert from "node:assert/strict";
import test from "node:test";
import { readMp4DurationSeconds } from "../server/mp4Duration.ts";

function mvhdV0(timescale, duration) {
  const box = Buffer.alloc(32);
  box.writeUInt32BE(box.length, 0);
  box.write("mvhd", 4, "ascii");
  box.writeUInt8(0, 8);
  box.writeUInt32BE(timescale, 20);
  box.writeUInt32BE(duration, 24);
  return box;
}

function mvhdV1(timescale, duration) {
  const box = Buffer.alloc(44);
  box.writeUInt32BE(box.length, 0);
  box.write("mvhd", 4, "ascii");
  box.writeUInt8(1, 8);
  box.writeUInt32BE(timescale, 28);
  box.writeBigUInt64BE(BigInt(duration), 32);
  return box;
}

test("reads version-zero MP4 duration", () => {
  assert.equal(readMp4DurationSeconds(mvhdV0(1_000, 8_000)), 8);
});

test("reads version-one MP4 duration", () => {
  assert.equal(readMp4DurationSeconds(mvhdV1(48_000, 288_000)), 6);
});

test("fails closed for missing, truncated, or zero-timescale headers", () => {
  assert.equal(readMp4DurationSeconds(Buffer.from("not an mp4")), null);
  assert.equal(readMp4DurationSeconds(mvhdV0(0, 8_000)), null);
  assert.equal(readMp4DurationSeconds(mvhdV0(1_000, 8_000).subarray(0, 12)), null);
});
