import { PetObjectKind, BehaviorAction } from "../../types";

export interface ObjectDef {
  kind: PetObjectKind;
  label: string;
  emoji: string;
  /** Uniform scale multiplier applied on top of a placed object's own scale. */
  baseScale: number;
  /**
   * Target size in meters for the GLB's LONGEST edge. Any downloaded model is
   * auto-normalized to this and dropped onto the ground, so you don't have to
   * match scales by hand.
   */
  fitSize: number;
  /** Behavior the avatar performs when it reaches and uses this object. */
  interaction?: BehaviorAction;
  /**
   * GLB asset URL served from Vite's public/ dir. Drop a real CC0/CC-BY model
   * at public/objects/<kind>.glb and it renders automatically; if the file is
   * missing, the procedural placeholder is used instead (no crash).
   */
  glbUrl?: string;
}

/**
 * Object catalog. Set `glbUrl` -> public/objects/<kind>.glb and the model
 * renders in place of the procedural placeholder. Record source/author/license
 * for each real asset in public/objects/manifest.json (CC-BY needs visible
 * credit; avoid GPL). All glbUrls point at public/ paths by default; missing
 * files silently fall back to placeholders.
 */
export const OBJECT_CATALOG: Record<PetObjectKind, ObjectDef> = {
  food_bowl: { kind: "food_bowl", label: "Food Bowl", emoji: "🍖", baseScale: 1, fitSize: 0.35, interaction: "eating", glbUrl: "/objects/food_bowl.glb" },
  water_bowl: { kind: "water_bowl", label: "Water Bowl", emoji: "💧", baseScale: 1, fitSize: 0.35, interaction: "drinking", glbUrl: "/objects/water_bowl.glb" },
  ball: { kind: "ball", label: "Ball", emoji: "🎾", baseScale: 1, fitSize: 0.25, interaction: "playing", glbUrl: "/objects/ball.glb" },
  bone: { kind: "bone", label: "Bone", emoji: "🦴", baseScale: 1, fitSize: 0.28, interaction: "playing", glbUrl: "/objects/bone.glb" },
  chew_toy: { kind: "chew_toy", label: "Chew Toy", emoji: "🧸", baseScale: 1, fitSize: 0.24, interaction: "playing", glbUrl: "/objects/chew_toy.glb" },
  bed: { kind: "bed", label: "Bed", emoji: "🛏️", baseScale: 1, fitSize: 0.85, interaction: "sleeping", glbUrl: "/objects/bed.glb" },
  dog_house: { kind: "dog_house", label: "Dog House", emoji: "🏠", baseScale: 1, fitSize: 1.0, interaction: "sleeping", glbUrl: "/objects/dog_house.glb" },
  hydrant: { kind: "hydrant", label: "Hydrant", emoji: "🚒", baseScale: 1, fitSize: 0.5, interaction: "peeing", glbUrl: "/objects/hydrant.glb" },
};

export const ALL_OBJECT_KINDS: PetObjectKind[] = Object.keys(OBJECT_CATALOG) as PetObjectKind[];
