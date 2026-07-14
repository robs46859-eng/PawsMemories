import { GenerateVideosOperation } from "@google/genai";

export const LEGACY_VEO_OPERATION_RECONSTRUCTION_ERROR =
  "operation._fromAPIResponse is not a function";

export interface VeoOperationsClient {
  getVideosOperation(parameters: {
    operation: GenerateVideosOperation;
  }): Promise<GenerateVideosOperation>;
}

/** Rehydrate the SDK operation type after only its name was persisted. */
export async function getPersistedVeoOperation(
  operations: VeoOperationsClient,
  operationName: string,
): Promise<GenerateVideosOperation> {
  const name = operationName.trim();
  if (!name) throw new Error("Veo operation name is required.");

  const operation = new GenerateVideosOperation();
  operation.name = name;
  return operations.getVideosOperation({ operation });
}
