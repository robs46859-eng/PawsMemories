import type {
  FurBinItem,
  FurBinShowcase,
  FurBinV5Api,
  LibraryFilters,
  LibraryPage,
  PublishShowcaseInput,
} from "./types";

export function normalizeLibraryFilters(filters: LibraryFilters): LibraryFilters {
  return {
    query: filters.query?.trim() || undefined,
    tag: filters.tag?.trim().toLowerCase() || undefined,
    collectionUuid: filters.collectionUuid || undefined,
    hasRig: filters.hasRig,
    hasFacial: filters.hasFacial,
    hasAnimations: filters.hasAnimations,
    page: Math.max(1, filters.page || 1),
    limit: Math.min(100, Math.max(1, filters.limit || 40)),
  };
}

export async function loadPrivateLibrary(api: FurBinV5Api, filters: LibraryFilters): Promise<LibraryPage> {
  return api.searchItems(normalizeLibraryFilters(filters));
}

export async function refreshSignedView(api: FurBinV5Api, itemUuid: string): Promise<FurBinItem> {
  return api.getItem(itemUuid);
}

export async function rollbackToVersion(
  api: FurBinV5Api,
  itemUuid: string,
  versionNumber: number,
): Promise<FurBinItem> {
  if (!api.capabilities.rollbackByVersionNumber) {
    return api.rollbackVersion(itemUuid, versionNumber);
  }
  if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new Error("Invalid version number.");
  return api.rollbackVersion(itemUuid, versionNumber);
}

export async function archivePrivateItem(api: FurBinV5Api, itemUuid: string): Promise<FurBinItem> {
  return api.archiveItem(itemUuid);
}

export async function publishPublicDerivative(
  api: FurBinV5Api,
  input: PublishShowcaseInput,
): Promise<FurBinShowcase> {
  if (!input.publicDerivativeUuid || input.publicDerivativeVersionNumber < 1) {
    throw new Error("A validated public derivative is required.");
  }
  return api.publishShowcase(input);
}

export function mergeItem(items: FurBinItem[], updated: FurBinItem): FurBinItem[] {
  return items.map((item) => item.itemUuid === updated.itemUuid ? updated : item);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDimensions(item: FurBinItem): string {
  const value = item.dimensions;
  if (!value) return "Dimensions not measured";
  return `${value.width} × ${value.height} × ${value.depth} ${value.unit}`;
}
