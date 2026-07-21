import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Facial rig add-on — disclosure contract.
 *
 * The facial pass only canonicalizes viseme morph targets the model provider
 * actually returned (agent/graph/nodes/facialVisemes.ts explicitly refuses to
 * fabricate mouth shapes by deforming the head mesh). Providers often return
 * none — Tripo's observed output keys are `pbr_model` and `rendered_image`,
 * with no morphs — in which case the model falls back to jaw-only motion.
 *
 * Product decision: the add-on is charged and NOT refunded in that case.
 *
 * That makes disclosure the only thing standing between "priced feature with a
 * known failure mode" and "charging for something that silently didn't happen".
 * These tests exist so the warning can't be dropped in a future cleanup without
 * someone deliberately deleting a test that says why it's there.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");

test("the facial add-on is disclosed BEFORE the user is charged", () => {
  const screen = read("src/components/create-flow/CreateCustomizeScreen.tsx");

  assert.match(screen, /early development/i, "must say the feature is early-development");
  assert.match(screen, /isn&apos;t guaranteed|isn't guaranteed|not guaranteed/i, "must say it is not guaranteed");
  assert.match(screen, /isn&apos;t refunded|isn't refunded|no refund/i, "must state there is no refund");

  // Ordering is the whole point: the customize step is where the add-on is
  // chosen, and it precedes CreateCheckoutScreen. A warning shown after payment
  // is not disclosure.
  const warningAt = screen.search(/early development/i);
  assert.ok(warningAt > -1, "expected the warning in the customize step");

  // The warning must appear before the control that advances to checkout.
  // (An earlier version of this test compared warningAt against screen.length,
  // which is trivially true and asserted nothing.)
  const advanceAt = screen.search(/onNext|CreateCheckout|Screen\.CREATE_CHECKOUT/);
  if (advanceAt > -1) {
    assert.ok(
      warningAt < advanceAt,
      `warning at ${warningAt} must precede the advance-to-checkout control at ${advanceAt}`,
    );
  }
});

test("the warning is tied to the facial checkbox, not buried elsewhere", () => {
  const screen = read("src/components/create-flow/CreateCustomizeScreen.tsx");
  // It should only appear once the user has actually opted in — otherwise it is
  // noise on every render and gets tuned out.
  assert.match(
    screen,
    /rigEnabled && rigFacial\s*&&/,
    "warning should be conditional on the facial add-on being selected",
  );
});

test("every surface showing the price also shows the caveat", () => {
  const pricing = read("src/pricing.ts");
  const line = pricing.split("\n").find((l) => l.includes("Facial Rig Add-on"));
  assert.ok(line, "expected a Facial Rig Add-on catalog entry");
  assert.match(line, /early access/i, "catalog entry must carry the early-access caveat");
  assert.match(line, /not guaranteed|no refund/i, "catalog entry must state the risk");
});

test("a job that charged for facial rigging reports honestly when it did not land", () => {
  const server = read("server.ts");
  assert.match(
    server,
    /facialRequested/,
    "the rig stage must distinguish 'facial was paid for' from 'facial worked'",
  );
  assert.match(
    server,
    /Facial rig unavailable/,
    "the job status must say so when visemes could not be applied",
  );
  // The success SMS must not claim an unqualified win in that branch.
  const branch = server.slice(server.indexOf("facialRequested"), server.indexOf("} else {", server.indexOf("facialRequested")));
  assert.match(branch, /couldn&apos;t be applied|couldn't be applied/i, "the SMS must be honest too");
});

test("the viseme pass still refuses to fabricate mouth shapes", () => {
  // This is the property that makes the feature trustworthy when it DOES work.
  // If someone "fixes" the availability rate by synthesising shapes from the
  // head mesh, the output becomes a guess wearing the label of a real rig.
  const visemes = read("agent/graph/nodes/facialVisemes.ts");
  assert.match(visemes, /Never fabricate a mouth shape/i);
  assert.match(visemes, /available/, "must report availability rather than assume success");
});
