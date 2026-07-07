/**
 * server/petState.ts — AR_PET_SIM_SPEC §8
 * GET/PATCH /api/pets/:id/state — offline-aware drive/hormone sync, mirroring the
 * existing needs.ts sync pattern.
 *
 * TODO(AR2):
 *  - GET: return persisted drives/hormones/weights; run offline decay from updated_at.
 *  - PATCH: accept client state, validate with zod, clamp, persist.
 *  - H3: verify JWT subject owns avatar_id behind pet_id before any read/write.
 */

export interface PetStateDTO {
  drives: Record<string, number>;
  hormones: Record<string, number>;
  weights: Record<string, number>;
  trainer_score: number;
}

export async function getPetState(_petId: number, _userId: number): Promise<PetStateDTO> {
  throw new Error("TODO(AR2): load + offline-decay pet state");
}

export async function patchPetState(
  _petId: number,
  _userId: number,
  _patch: Partial<PetStateDTO>
): Promise<PetStateDTO> {
  throw new Error("TODO(AR2): validate + persist pet state");
}
