#!/usr/bin/env node
/**
 * rhubarb-fake.mjs — a controlled, dependency-free stand-in for the Rhubarb
 * Lip Sync CLI. Used ONLY by the Phase 2 test-suite so we never download or
 * install a real binary. It records its argv (for argument-construction and
 * injection-resistance tests) and emits deterministic JSON, or simulates
 * failure modes via the RHUBARB_FAKE_MODE env var.
 *
 * Behavior is driven entirely by environment variables set by the tests:
 *   RHUBARB_FAKE_MODE = default | malformed | empty | crash | timeout
 *   RHUBARB_FAKE_ARGFILE = optional path to write the parsed argv JSON
 *
 * Invocation contract matches the real CLI flags the service passes:
 *   <audio> -o <out.json> -f json [-d <dialog>] [-r <recognizer>] --extendedShapes GHX
 */

import fs from "fs";
import path from "path";

const argv = process.argv.slice(2);

function getOpt(flag) {
  const idx = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (idx === -1) return null;
  const val = argv[idx];
  if (val === flag) return argv[idx + 1] ?? null;
  return val.slice(flag.length + 1);
}

// Record argv for inspection by the tests.
const argFile = process.env.RHUBARB_FAKE_ARGFILE;
if (argFile) {
  fs.writeFileSync(
    argFile,
    JSON.stringify(
      {
        argv,
        dialogFile: getOpt("-d"),
        output: getOpt("-o"),
        recognizer: getOpt("-r"),
        extendedShapes: getOpt("--extendedShapes"),
        format: getOpt("-f"),
      },
      null,
      2,
    ),
  );
}

const mode = process.env.RHUBARB_FAKE_MODE || "default";
const outPath = getOpt("-o");

function fail(code, msg) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

if (mode === "crash") {
  fail(1, "rhubarb-fake: simulated process failure");
}

if (mode === "timeout") {
  // Sleep far longer than any test timeout so the service kills us.
  const end = Date.now() + 60_000;
  // eslint-disable-next-line no-constant-condition
  while (Date.now() < end) {
    // busy wait
  }
  process.exit(0);
}

if (!outPath) {
  fail(2, "rhubarb-fake: no -o output path provided");
}

let mouthCues;
if (mode === "malformed") {
  fs.writeFileSync(outPath, "{ this is not valid json ");
  process.exit(0);
} else if (mode === "empty") {
  mouthCues = [];
} else {
  // Deterministic default track: a short English-like utterance.
  // A X A B C D C E F X pattern (demonstrates a wide range of shapes).
  mouthCues = [
    { start: 0.0, end: 0.12, value: "X" },
    { start: 0.12, end: 0.2, value: "A" },
    { start: 0.2, end: 0.32, value: "B" },
    { start: 0.32, end: 0.5, value: "C" },
    { start: 0.5, end: 0.68, value: "D" },
    { start: 0.68, end: 0.8, value: "C" },
    { start: 0.8, end: 0.92, value: "E" },
    { start: 0.92, end: 1.05, value: "F" },
    { start: 1.05, end: 1.2, value: "X" },
  ];
}

const json = { mouthCues };
fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
process.exit(0);
