/**
 * src/brain/index.ts
 * Public barrel for the Pawsome3D behavior engine (AR_PET_SIM_SPEC §4).
 * Framework-agnostic — safe to import from the stage (AR5) or a future C# port.
 */

export * from "./types";
export * from "./considerations";
export * from "./drives";
export * from "./hormones";
export * from "./utility";
export * from "./actions";
export * from "./behaviorTree";
export * from "./reinforcement";
export * from "./pacing";
export * from "./bodyLanguage";
export * from "./brain";
export { buildTree, defaultRegistry, registerDefaultLeaves } from "./trees";
