export interface BoneChain {
  name: string;
  bones: string[];
}

export interface SkeletonDefinition {
  bodyType: 'quadruped' | 'biped' | 'winged';
  chains: {
    spine: string[];
    neckHead: string[];
    limbs: BoneChain[];
    tail?: string[];
  };
  allBones: string[];
}

export const SKELETON_CONTRACTS: Record<'quadruped' | 'biped' | 'winged', SkeletonDefinition> = {
  quadruped: {
    bodyType: 'quadruped',
    chains: {
      spine: ["hips", "spine", "chest"],
      neckHead: ["neck", "head"],
      limbs: [
        { name: "Front left leg", bones: ["front_leg_upper.L", "front_leg_lower.L", "front_paw.L"] },
        { name: "Front right leg", bones: ["front_leg_upper.R", "front_leg_lower.R", "front_paw.R"] },
        { name: "Back left leg", bones: ["back_leg_upper.L", "back_leg_lower.L", "back_paw.L"] },
        { name: "Back right leg", bones: ["back_leg_upper.R", "back_leg_lower.R", "back_paw.R"] }
      ],
      tail: ["tail_01", "tail_02", "tail_03"]
    },
    allBones: [
      "hips", "spine", "chest", "neck", "head",
      "front_leg_upper.L", "front_leg_lower.L", "front_paw.L",
      "front_leg_upper.R", "front_leg_lower.R", "front_paw.R",
      "back_leg_upper.L", "back_leg_lower.L", "back_paw.L",
      "back_leg_upper.R", "back_leg_lower.R", "back_paw.R",
      "tail_01", "tail_02", "tail_03"
    ]
  },
  biped: {
    bodyType: 'biped',
    chains: {
      spine: ["hips", "spine", "chest"],
      neckHead: ["neck", "head"],
      limbs: [
        { name: "Left Arm", bones: ["shoulder.L", "upperarm.L", "forearm.L", "hand.L"] },
        { name: "Right Arm", bones: ["shoulder.R", "upperarm.R", "forearm.R", "hand.R"] },
        { name: "Left Leg", bones: ["thigh.L", "shin.L", "foot.L"] },
        { name: "Right Leg", bones: ["thigh.R", "shin.R", "foot.R"] }
      ]
    },
    allBones: [
      "hips", "spine", "chest", "neck", "head",
      "shoulder.L", "upperarm.L", "forearm.L", "hand.L",
      "shoulder.R", "upperarm.R", "forearm.R", "hand.R",
      "thigh.L", "shin.L", "foot.L",
      "thigh.R", "shin.R", "foot.R"
    ]
  },
  winged: {
    bodyType: 'winged',
    chains: {
      spine: ["hips", "spine", "chest"],
      neckHead: ["neck", "head"],
      limbs: []
    },
    allBones: ["hips", "spine", "chest", "neck", "head"]
  }
};
