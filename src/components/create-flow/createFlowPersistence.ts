export interface CreateFlowStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface InitialCreateFlowState {
  species: string;
  inputMode: "image" | "text";
  activeJobUuid?: string;
}

function normalizedOwner(ownerKey: string | null | undefined): string {
  return encodeURIComponent((ownerKey || "signed-out").trim().toLowerCase());
}

export function activeModelJobStorageKey(ownerKey: string | null | undefined): string {
  return `pawsome3d:active-model-build:${normalizedOwner(ownerKey)}:v1`;
}

export function createInitialCreateFlowState(
  ownerKey: string | null | undefined,
  storage?: CreateFlowStorage,
): InitialCreateFlowState {
  const savedJob = ownerKey && storage
    ? storage.getItem(activeModelJobStorageKey(ownerKey))
    : null;
  return {
    species: "dog",
    inputMode: "image",
    activeJobUuid: savedJob || undefined,
  };
}
