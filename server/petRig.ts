/**
 * server/petRig.ts — AR_PET_SIM_SPEC §3.1 / §8
 * POST /api/pets/:id/rig — kicks Tripo animate_rig then blender-worker bake-lod.
 *
 * TODO(AR3):
 *  - POST platform.tripo3d.ai /v2/openapi/task
 *      { type: "animate_rig", original_model_task_id, out_format: "glb", spec: "tripo" }
 *    (verify exact body + pricing in Tripo docs — spec §11).
 *  - Poll task → rigged GLB.
 *  - Enqueue blender-worker "bake-lod" (decimate ≤30k tris, atlas 1024², bone rename,
 *    validate 4 leg chains, retarget via bonemap.json) → upload B2.
 *  - Feature flag: avatars without a rig keep the current render path.
 *  - H5: timeouts, bounded retries, poll ceiling; on failure keep unrigged path.
 */

export interface RigRequest {
  petId: number;
  genTaskId: string;
}

export interface RigResult {
  riggedGlbUrl: string;
  lodGlbUrl: string;
  retargetConfidence: number;
}

export async function rigPet(_req: RigRequest): Promise<RigResult> {
  throw new Error("TODO(AR3): Tripo animate_rig → bake-lod → B2");
}
