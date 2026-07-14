export const CREDIT_PRICES = {
  PAWPRINT: 75,
  HD_IMAGE: 10,
  ULTRA_HD_IMAGE: 15,
  FIRST_REGENERATION: 0,
  ADDITIONAL_REGENERATION: 5,
  REMOVE_BACKGROUND: 3,
  UPSCALE_IMAGE: 5,
  TEXTURE_GENERATION: 8,
  STATIC_3D_TEXT: 40,
  STATIC_3D_PHOTO: 45,
  RIGGED_3D_AVATAR: 80,
  BIM_SHELL_MODEL: 60,
  BIM_IFC_MODEL: 300,
  AVATAR_CLOTHING_VARIANT: 15,
  AVATAR_POSE_PACK: 10,
  AI_VOICE_30_SECONDS: 25,
  VOICE_CLONE: 100,
  LIP_SYNC_30_SECONDS: 25,
  ANIMATED_VIDEO: 100,
  ADDITIONAL_ANIMATION_10_SECONDS: 30,
  EXPORT_FBX_USDZ: 10,
  COMMERCIAL_LICENSE: 35,
  STORAGE_GB_MONTH: 4,
} as const;

/** Discount applied when a user reuses a previously generated image of the same
 *  subject (skips the fresh image-generation step). 0.2 = 20% off. */
export const REUSE_DISCOUNT = 0.2;

export const CREDIT_PACKS = [
  { id: "pack_100", credits: 100, price: 10, label: "Starter", bonusPercent: 0, comingSoon: false },
  { id: "pack_275", credits: 275, price: 25, label: "Creator", bonusPercent: 10, comingSoon: false },
  { id: "pack_600", credits: 600, price: 50, label: "Pro", bonusPercent: 20, comingSoon: false },
  { id: "pack_1300", credits: 1300, price: 100, label: "Studio", bonusPercent: 30, comingSoon: false },
  { id: "pack_3500", credits: 3500, price: 250, label: "Enterprise", bonusPercent: 40, comingSoon: false },
  { id: "bundle_marketplace_200", credits: 200, price: 20, label: "Marketplace-Ready Creator Bundle", bonusPercent: 0, comingSoon: true },
] as const;

export interface ServicePrice {
  label: string;
  credits: number | null;
  detail?: string;
  comingSoon?: boolean;
}

export const SERVICE_PRICES: readonly ServicePrice[] = [
  { label: "Pawprint", credits: CREDIT_PRICES.PAWPRINT },
  { label: "HD Image Generation", credits: CREDIT_PRICES.HD_IMAGE },
  { label: "Ultra HD Image Generation", credits: CREDIT_PRICES.ULTRA_HD_IMAGE },
  { label: "Image Regeneration", credits: CREDIT_PRICES.FIRST_REGENERATION, detail: "First retry" },
  { label: "Additional Regeneration", credits: CREDIT_PRICES.ADDITIONAL_REGENERATION },
  { label: "Remove Background", credits: CREDIT_PRICES.REMOVE_BACKGROUND },
  { label: "Upscale Image", credits: CREDIT_PRICES.UPSCALE_IMAGE },
  { label: "Texture Generation", credits: CREDIT_PRICES.TEXTURE_GENERATION },
  { label: "Static 3D Object", credits: CREDIT_PRICES.STATIC_3D_TEXT, detail: "Text to GLB" },
  { label: "Static 3D Object", credits: CREDIT_PRICES.STATIC_3D_PHOTO, detail: "Photo to GLB" },
  { label: "Rigged 3D Avatar", credits: CREDIT_PRICES.RIGGED_3D_AVATAR },
  { label: "Scaled Building Shell", credits: CREDIT_PRICES.BIM_SHELL_MODEL, detail: "GLB geometry without BIM semantics" },
  { label: "IFC Building Information Model", credits: CREDIT_PRICES.BIM_IFC_MODEL, detail: "IFC4 + semantic GLB + verification" },
  { label: "Avatar Clothing Variant", credits: CREDIT_PRICES.AVATAR_CLOTHING_VARIANT, comingSoon: true },
  { label: "Avatar Pose Pack", credits: CREDIT_PRICES.AVATAR_POSE_PACK, comingSoon: true },
  { label: "AI Voice Generation", credits: CREDIT_PRICES.AI_VOICE_30_SECONDS, detail: "Up to 30 seconds" },
  { label: "Voice Clone", credits: CREDIT_PRICES.VOICE_CLONE, detail: "One-time" },
  { label: "Lip Sync", credits: CREDIT_PRICES.LIP_SYNC_30_SECONDS, detail: "Up to 30 seconds" },
  { label: "Animated Video", credits: CREDIT_PRICES.ANIMATED_VIDEO, detail: "8-second landscape or portrait clip" },
  { label: "Additional Animation", credits: CREDIT_PRICES.ADDITIONAL_ANIMATION_10_SECONDS, detail: "Additional Animator segment" },
  { label: "Export FBX or USDZ", credits: CREDIT_PRICES.EXPORT_FBX_USDZ },
  { label: "Commercial License Upgrade", credits: CREDIT_PRICES.COMMERCIAL_LICENSE },
  { label: "Additional Storage", credits: CREDIT_PRICES.STORAGE_GB_MONTH, detail: "1 GB per month" },
  { label: "Marketplace Listing", credits: null, detail: "7.5% commission; $10 or 100-credit wallet minimum", comingSoon: true },
];

export function avatarGenerationCost(avatarType: "dog" | "human" | "object", inputMode: "image" | "text"): number {
  if (avatarType !== "object") return CREDIT_PRICES.RIGGED_3D_AVATAR;
  return inputMode === "text" ? CREDIT_PRICES.STATIC_3D_TEXT : CREDIT_PRICES.STATIC_3D_PHOTO;
}

export type BimBuildMode = "shell" | "ifc";
export function bimModelCost(mode: BimBuildMode): number {
  return mode === "ifc" ? CREDIT_PRICES.BIM_IFC_MODEL : CREDIT_PRICES.BIM_SHELL_MODEL;
}
