import test from "node:test";
import assert from "node:assert";
import * as THREE from "three";
import { retargetClip } from "../src/animator/utils/retargetUtils.ts";

test("clip_retarget", async (t) => {
  await t.test("pads missing frames and respects SKELETON_CONTRACTS", () => {
    const srcBones = [new THREE.Bone()];
    srcBones[0].name = "front_leg_upper.L";
    const srcRig = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.Material());
    srcRig.add(srcBones[0]);
    srcRig.skeleton = new THREE.Skeleton(srcBones);

    const tgtBones = [new THREE.Bone()];
    tgtBones[0].name = "my_front_leg_upper.L"; // slightly different
    const tgtRig = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.Material());
    tgtRig.add(tgtBones[0]);
    tgtRig.skeleton = new THREE.Skeleton(tgtBones);

    // Create a clip with a track that ends at t=0.5
    const track1 = new THREE.VectorKeyframeTrack("front_leg_upper.L.position", [0, 0.5], [0,0,0, 1,1,1]);
    const track2 = new THREE.QuaternionKeyframeTrack("front_leg_upper.L.quaternion", [0, 0.4], [0,0,0,1, 0,1,0,0]); // shorter track
    const srcClip = new THREE.AnimationClip("run", 0.5, [track1, track2]);

    const retargeted = retargetClip(tgtRig, srcRig, srcClip, "quadruped");

    assert.strictEqual(retargeted.duration, 0.5);
    const quatTrack = retargeted.tracks.find(tr => tr.name.includes("quaternion"));
    assert.ok(quatTrack);
    // The quat track should be padded from 0.4 to 0.5
    const times = quatTrack.times;
    assert.strictEqual(times[times.length - 1], 0.5);
    
    // Check bone mapping: the track name should reflect the target bone name "my_front_leg_upper.L"
    assert.ok(quatTrack.name.includes("my_front_leg_upper.L"), "Track should map to target bone name");
  });
});
