export type SkeletonType = 'quadruped' | 'biped' | 'winged';

export interface AnimationSet {
  type: SkeletonType;
  expectedClips: string[];
}

export const ANIMATION_SETS: Record<SkeletonType, AnimationSet> = {
  quadruped: {
    type: 'quadruped',
    expectedClips: [
      'idle', 'walk', 'run', 'sit', 'lie', 'tail_wave', 'head_tilt', 'eat', 'play-bow'
    ]
  },
  biped: {
    type: 'biped',
    expectedClips: [
      'idle', 'walk', 'wave', 'sit', 'talk', 'celebrate'
    ]
  },
  winged: {
    type: 'winged',
    expectedClips: [
      'idle', 'fly', 'land', 'peck'
    ]
  }
};
