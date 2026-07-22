import { CREDIT_PRICES } from "../../src/pricing";

export const RANDY_REGISTRY_VERSION = "2026-07-22.1";

export type RandyModuleId = "create" | "furbin" | "pawprints" | "animator" | "ar" | "bim" | "wags" | "credits";

export interface RandyModuleEntry {
  id: RandyModuleId;
  name: string;
  capability: string;
  prerequisites: string[];
  prices: Record<string, number>;
  screens: string[];
  actions: string[];
  limitations: string[];
}

export interface RandyLiveContext {
  credits: number;
  isAdmin: boolean;
  activeBuildStates?: string[];
  entitlements?: string[];
}

export function getRandyModuleRegistry(): RandyModuleEntry[] {
  return [
    { id: "create", name: "Create 3D Pet", capability: "Approved multiview references and verified GLB builds", prerequisites: ["signed-in user", "approved references"], prices: { photoModel: CREDIT_PRICES.STATIC_3D_PHOTO, textModel: CREDIT_PRICES.STATIC_3D_TEXT }, screens: ["AVATAR_DASHBOARD"], actions: ["navigate", "start_tour"], limitations: ["Generation is not instant", "Rig and facial capability require separate measured validation"] },
    { id: "furbin", name: "Fur Bin", capability: "Private model and media library", prerequisites: ["signed-in user"], prices: {}, screens: ["FURBIN"], actions: ["navigate", "start_tour"], limitations: ["Public showcase and marketplace availability depend on moderation and rights"] },
    { id: "pawprints", name: "Pawprints", capability: "Digital stationery and print products", prerequisites: ["signed-in user"], prices: { pawprint: CREDIT_PRICES.PAWPRINT }, screens: ["PAWPRINTS"], actions: ["navigate", "start_tour"], limitations: ["Physical products require separate fulfillment confirmation"] },
    { id: "animator", name: "Animator", capability: "Animation, voice, and lip sync tools", prerequisites: ["compatible accepted model"], prices: { lipSync30Seconds: CREDIT_PRICES.LIP_SYNC_30_SECONDS, video: CREDIT_PRICES.ANIMATED_VIDEO }, screens: ["PAWLISHER"], actions: ["navigate", "start_tour"], limitations: ["Availability depends on measured rig and facial capability"] },
    { id: "ar", name: "Augmented Reality", capability: "Place compatible models in a mobile AR scene", prerequisites: ["compatible model", "supported device/browser"], prices: {}, screens: ["AVATAR_DASHBOARD"], actions: ["navigate", "launch_ar"], limitations: ["Device support and model performance budgets apply"] },
    { id: "bim", name: "Scaled Building and IFC", capability: "Calibrated shell or semantic IFC4 model", prerequisites: ["trusted measurement", "pre-build verification"], prices: { shell: CREDIT_PRICES.BIM_SHELL_MODEL, ifc: CREDIT_PRICES.BIM_IFC_MODEL }, screens: ["AVATAR_DASHBOARD"], actions: ["navigate"], limitations: ["Images alone are not survey-grade", "Concealed construction and code compliance are never inferred as fact"] },
    { id: "wags", name: "Wags", capability: "Subscription packs and owned digital items", prerequisites: ["active entitlement"], prices: {}, screens: ["WAGS_INBOX"], actions: ["navigate"], limitations: ["Entitlement status must come from the live account"] },
    { id: "credits", name: "Credits", capability: "Wallet used for paid product actions", prerequisites: ["signed-in user"], prices: {}, screens: ["STORE"], actions: ["navigate", "open_credit_store", "start_tour"], limitations: ["Randy cannot change balances or promise refunds"] },
  ];
}

export function buildRandyGrounding(context: RandyLiveContext): string {
  const registry = getRandyModuleRegistry();
  return JSON.stringify({ registryVersion: RANDY_REGISTRY_VERSION, modules: registry, liveContext: context });
}
