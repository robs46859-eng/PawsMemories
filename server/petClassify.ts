/**
 * server/petClassify.ts — AR_PET_SIM_SPEC §3.2
 * POST /api/pets/classify — one vision-LLM call → strict-JSON breed/build/temperament.
 *
 * TODO(AR2):
 *  - Call OpenRouter with LLM_MODEL (must be a VISION model; Nemotron Nano VL free to start).
 *  - System prompt: the exact strict-JSON schema in §3.2.
 *  - Validate with zod; on parse failure retry once at temperature 0.
 *  - Persist result onto pet_profiles (H7: never re-classify the same photo).
 *  - Mount behind JWT in server.ts using existing route patterns.
 */

export interface ClassifyRequest {
  imageUrl: string; // or base64
  avatarId: number;
}

export interface ClassifyResult {
  breed: string;
  breed_confidence: number;
  breed_top3: string[];
  size_class: "toy" | "small" | "medium" | "large" | "giant";
  build: {
    legLengthRatio: number;
    snoutLengthRatio: number;
    earType: "erect" | "floppy" | "semi";
    tailType: "curly" | "straight" | "docked" | "plume";
    coat: "short" | "medium" | "long" | "double";
  };
  temperament: {
    energy: number;
    sociability: number;
    stubbornness: number;
    foodMotivation: number;
    vocality: number;
  };
  faceLandmarks: { leftEye: [number, number]; rightEye: [number, number]; nose: [number, number] };
}

export async function classifyPet(_req: ClassifyRequest): Promise<ClassifyResult> {
  throw new Error("TODO(AR2): implement vision-LLM classify with zod validation");
}
