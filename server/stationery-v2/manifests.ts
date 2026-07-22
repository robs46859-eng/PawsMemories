import {
  PrintManifestInputSchema,
  RenderManifestInputSchema,
  SealedPrintManifestSchema,
  SealedRenderManifestSchema,
  TemplateVersionSpecSchema,
  type PrintManifestInput,
  type RenderManifestInput,
  type SealedPrintManifest,
  type SealedRenderManifest,
} from "./contracts.ts";
import { sha256Canonical } from "./canonical.ts";

export function hashTemplateSpec(spec: unknown): string {
  return sha256Canonical(TemplateVersionSpecSchema.parse(spec));
}

export function sealRenderManifest(rawInput: RenderManifestInput): SealedRenderManifest {
  const input = RenderManifestInputSchema.parse(rawInput);
  return SealedRenderManifestSchema.parse({ ...input, manifestHash: sha256Canonical(input) });
}

export function verifyRenderManifest(rawManifest: SealedRenderManifest): boolean {
  const manifest = SealedRenderManifestSchema.parse(rawManifest);
  const { manifestHash, ...input } = manifest;
  return sha256Canonical(input) === manifestHash;
}

export function sealPrintManifest(rawInput: PrintManifestInput): SealedPrintManifest {
  const input = PrintManifestInputSchema.parse(rawInput);
  return SealedPrintManifestSchema.parse({ ...input, manifestHash: sha256Canonical(input) });
}

export function verifyPrintManifest(rawManifest: SealedPrintManifest): boolean {
  const manifest = SealedPrintManifestSchema.parse(rawManifest);
  const { manifestHash, ...input } = manifest;
  return sha256Canonical(input) === manifestHash;
}
