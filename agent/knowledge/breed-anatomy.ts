/**
 * Breed-Specific Anatomy Knowledge Base
 * =======================================
 * Teaches the 3D model generator what various body sections look like for
 * each breed. Used by the act node to produce breed-accurate armatures,
 * vertex group assignments, and animation keyframes.
 *
 * Each entry defines:
 *  - Body section proportions (ratios relative to overall bounding box)
 *  - Mesh region boundaries for vertex-group assignment
 *  - Joint angle limits per bone chain
 *  - Animation modifiers (gait type, eating reach, play bounce height)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Defines a region of the mesh in normalised bounding-box coordinates.
 * All values are 0.0 – 1.0 along the relevant axis.
 *   - length axis = the longest horizontal axis (head-to-tail)
 *   - height axis = ground to top of head
 */
export interface MeshRegion {
  /** Start along the body-length axis (0 = rear, 1 = nose). */
  lengthStart: number;
  /** End along the body-length axis. */
  lengthEnd: number;
  /** Start along the height axis (0 = ground). */
  heightStart: number;
  /** End along the height axis. */
  heightEnd: number;
}

export interface BreedSections {
  head: {
    /** Head length as a fraction of total body length. */
    lengthRatio: number;
    /** Head width relative to body width (1 = same width). */
    widthRatio: number;
    /** Head height relative to total height. */
    heightRatio: number;
    meshRegion: MeshRegion;
  };
  neck: {
    lengthRatio: number;
    meshRegion: MeshRegion;
  };
  torso: {
    lengthRatio: number;
    widthRatio: number;
    meshRegion: MeshRegion;
  };
  frontLegs: {
    /** Leg length as a fraction of total height. */
    lengthRatio: number;
    /** Maximum rotation (degrees) for upper-leg bones. */
    jointAngleMax: number;
    meshRegion: MeshRegion;
  };
  rearLegs: {
    lengthRatio: number;
    jointAngleMax: number;
    meshRegion: MeshRegion;
  };
  tail: {
    /** Tail length as a fraction of total body length. */
    lengthRatio: number;
    jointAngleMax: number;
    meshRegion: MeshRegion;
  } | null;
}

export interface AnimationModifiers {
  /** Gait style used for the "running" animation. */
  runGaitType: "gallop" | "trot" | "waddle" | "hop";
  /** How far the head dips during eating (multiplier of head height). */
  eatingReach: number;
  /** Bounce height multiplier for the "playing" animation. */
  playBounce: number;
  /** Tail wag amplitude multiplier (1 = default 12°). */
  tailWagAmplitude: number;
  /** Spine flex multiplier for running (1 = default). */
  spineFlexMultiplier: number;
}

export interface BreedAnatomy {
  species: string;
  breed: string;
  /** Breed family for fuzzy matching. */
  family: string;
  sections: BreedSections;
  animationModifiers: AnimationModifiers;
}

// ---------------------------------------------------------------------------
// Default section templates (building blocks)
// ---------------------------------------------------------------------------

const DEFAULT_DOG_SECTIONS: BreedSections = {
  head: {
    lengthRatio: 0.18,
    widthRatio: 0.7,
    heightRatio: 0.25,
    meshRegion: { lengthStart: 0.78, lengthEnd: 1.0, heightStart: 0.55, heightEnd: 1.0 },
  },
  neck: {
    lengthRatio: 0.10,
    meshRegion: { lengthStart: 0.70, lengthEnd: 0.78, heightStart: 0.50, heightEnd: 0.90 },
  },
  torso: {
    lengthRatio: 0.45,
    widthRatio: 1.0,
    meshRegion: { lengthStart: 0.25, lengthEnd: 0.70, heightStart: 0.28, heightEnd: 0.85 },
  },
  frontLegs: {
    lengthRatio: 0.45,
    jointAngleMax: 45,
    meshRegion: { lengthStart: 0.55, lengthEnd: 0.72, heightStart: 0.0, heightEnd: 0.45 },
  },
  rearLegs: {
    lengthRatio: 0.45,
    jointAngleMax: 45,
    meshRegion: { lengthStart: 0.22, lengthEnd: 0.40, heightStart: 0.0, heightEnd: 0.45 },
  },
  tail: {
    lengthRatio: 0.20,
    jointAngleMax: 30,
    meshRegion: { lengthStart: 0.0, lengthEnd: 0.22, heightStart: 0.40, heightEnd: 0.65 },
  },
};

const DEFAULT_DOG_ANIM: AnimationModifiers = {
  runGaitType: "trot",
  eatingReach: 1.0,
  playBounce: 1.0,
  tailWagAmplitude: 1.0,
  spineFlexMultiplier: 1.0,
};

const DEFAULT_CAT_SECTIONS: BreedSections = {
  head: {
    lengthRatio: 0.20,
    widthRatio: 0.75,
    heightRatio: 0.28,
    meshRegion: { lengthStart: 0.80, lengthEnd: 1.0, heightStart: 0.55, heightEnd: 1.0 },
  },
  neck: {
    lengthRatio: 0.08,
    meshRegion: { lengthStart: 0.73, lengthEnd: 0.80, heightStart: 0.55, heightEnd: 0.90 },
  },
  torso: {
    lengthRatio: 0.42,
    widthRatio: 0.85,
    meshRegion: { lengthStart: 0.28, lengthEnd: 0.73, heightStart: 0.28, heightEnd: 0.80 },
  },
  frontLegs: {
    lengthRatio: 0.42,
    jointAngleMax: 50,
    meshRegion: { lengthStart: 0.58, lengthEnd: 0.75, heightStart: 0.0, heightEnd: 0.45 },
  },
  rearLegs: {
    lengthRatio: 0.48,
    jointAngleMax: 55,
    meshRegion: { lengthStart: 0.25, lengthEnd: 0.42, heightStart: 0.0, heightEnd: 0.50 },
  },
  tail: {
    lengthRatio: 0.30,
    jointAngleMax: 40,
    meshRegion: { lengthStart: 0.0, lengthEnd: 0.25, heightStart: 0.35, heightEnd: 0.60 },
  },
};

const DEFAULT_CAT_ANIM: AnimationModifiers = {
  runGaitType: "gallop",
  eatingReach: 0.9,
  playBounce: 1.3,
  tailWagAmplitude: 1.4,
  spineFlexMultiplier: 1.2,
};

// ---------------------------------------------------------------------------
// Helper to derive a breed entry from defaults with overrides
// ---------------------------------------------------------------------------

function dogBreed(
  breed: string,
  family: string,
  sectionOverrides: Partial<{
    head: Partial<BreedSections["head"]>;
    neck: Partial<BreedSections["neck"]>;
    torso: Partial<BreedSections["torso"]>;
    frontLegs: Partial<BreedSections["frontLegs"]>;
    rearLegs: Partial<BreedSections["rearLegs"]>;
    tail: Partial<NonNullable<BreedSections["tail"]>> | null;
  }>,
  animOverrides: Partial<AnimationModifiers> = {},
): BreedAnatomy {
  const sections: BreedSections = {
    head: { ...DEFAULT_DOG_SECTIONS.head, ...sectionOverrides.head } as BreedSections["head"],
    neck: { ...DEFAULT_DOG_SECTIONS.neck, ...sectionOverrides.neck } as BreedSections["neck"],
    torso: { ...DEFAULT_DOG_SECTIONS.torso, ...sectionOverrides.torso } as BreedSections["torso"],
    frontLegs: { ...DEFAULT_DOG_SECTIONS.frontLegs, ...sectionOverrides.frontLegs } as BreedSections["frontLegs"],
    rearLegs: { ...DEFAULT_DOG_SECTIONS.rearLegs, ...sectionOverrides.rearLegs } as BreedSections["rearLegs"],
    tail: sectionOverrides.tail === null
      ? null
      : { ...(DEFAULT_DOG_SECTIONS.tail!), ...sectionOverrides.tail } as NonNullable<BreedSections["tail"]>,
  };
  return {
    species: "dog",
    breed,
    family,
    sections,
    animationModifiers: { ...DEFAULT_DOG_ANIM, ...animOverrides },
  };
}

function catBreed(
  breed: string,
  family: string,
  sectionOverrides: Partial<{
    head: Partial<BreedSections["head"]>;
    neck: Partial<BreedSections["neck"]>;
    torso: Partial<BreedSections["torso"]>;
    frontLegs: Partial<BreedSections["frontLegs"]>;
    rearLegs: Partial<BreedSections["rearLegs"]>;
    tail: Partial<NonNullable<BreedSections["tail"]>> | null;
  }>,
  animOverrides: Partial<AnimationModifiers> = {},
): BreedAnatomy {
  const sections: BreedSections = {
    head: { ...DEFAULT_CAT_SECTIONS.head, ...sectionOverrides.head } as BreedSections["head"],
    neck: { ...DEFAULT_CAT_SECTIONS.neck, ...sectionOverrides.neck } as BreedSections["neck"],
    torso: { ...DEFAULT_CAT_SECTIONS.torso, ...sectionOverrides.torso } as BreedSections["torso"],
    frontLegs: { ...DEFAULT_CAT_SECTIONS.frontLegs, ...sectionOverrides.frontLegs } as BreedSections["frontLegs"],
    rearLegs: { ...DEFAULT_CAT_SECTIONS.rearLegs, ...sectionOverrides.rearLegs } as BreedSections["rearLegs"],
    tail: sectionOverrides.tail === null
      ? null
      : { ...(DEFAULT_CAT_SECTIONS.tail!), ...sectionOverrides.tail } as NonNullable<BreedSections["tail"]>,
  };
  return {
    species: "cat",
    breed,
    family,
    sections,
    animationModifiers: { ...DEFAULT_CAT_ANIM, ...animOverrides },
  };
}

// ---------------------------------------------------------------------------
// Breed Registry
// ---------------------------------------------------------------------------

const BREED_REGISTRY: BreedAnatomy[] = [
  // ===== DOGS =====

  // --- Small / Toy ---
  dogBreed("Chihuahua", "toy", {
    head: { lengthRatio: 0.24, widthRatio: 0.85, heightRatio: 0.32 },
    torso: { lengthRatio: 0.38 },
    frontLegs: { lengthRatio: 0.35, jointAngleMax: 35 },
    rearLegs: { lengthRatio: 0.35, jointAngleMax: 35 },
    tail: { lengthRatio: 0.18, jointAngleMax: 35 },
  }, { playBounce: 1.4, runGaitType: "trot" }),

  dogBreed("Pomeranian", "spitz", {
    head: { lengthRatio: 0.22, widthRatio: 0.80, heightRatio: 0.30 },
    torso: { lengthRatio: 0.40, widthRatio: 1.1 },
    frontLegs: { lengthRatio: 0.32, jointAngleMax: 35 },
    rearLegs: { lengthRatio: 0.32, jointAngleMax: 35 },
    tail: { lengthRatio: 0.22, jointAngleMax: 25 },
  }, { playBounce: 1.3, tailWagAmplitude: 0.8 }),

  dogBreed("Yorkshire Terrier", "terrier", {
    head: { lengthRatio: 0.20, widthRatio: 0.72, heightRatio: 0.28 },
    torso: { lengthRatio: 0.42 },
    frontLegs: { lengthRatio: 0.36, jointAngleMax: 38 },
    rearLegs: { lengthRatio: 0.36, jointAngleMax: 38 },
  }, { runGaitType: "trot", playBounce: 1.2 }),

  dogBreed("Pug", "brachycephalic", {
    head: { lengthRatio: 0.22, widthRatio: 0.90, heightRatio: 0.30 },
    neck: { lengthRatio: 0.06 },
    torso: { lengthRatio: 0.42, widthRatio: 1.15 },
    frontLegs: { lengthRatio: 0.34, jointAngleMax: 32 },
    rearLegs: { lengthRatio: 0.34, jointAngleMax: 32 },
    tail: { lengthRatio: 0.08, jointAngleMax: 15 },
  }, { runGaitType: "waddle", eatingReach: 0.8, spineFlexMultiplier: 0.7 }),

  dogBreed("French Bulldog", "brachycephalic", {
    head: { lengthRatio: 0.23, widthRatio: 0.95, heightRatio: 0.30 },
    neck: { lengthRatio: 0.07 },
    torso: { lengthRatio: 0.42, widthRatio: 1.2 },
    frontLegs: { lengthRatio: 0.36, jointAngleMax: 33 },
    rearLegs: { lengthRatio: 0.36, jointAngleMax: 33 },
    tail: { lengthRatio: 0.06, jointAngleMax: 10 },
  }, { runGaitType: "waddle", eatingReach: 0.75, spineFlexMultiplier: 0.6 }),

  dogBreed("Shih Tzu", "brachycephalic", {
    head: { lengthRatio: 0.22, widthRatio: 0.85, heightRatio: 0.30 },
    neck: { lengthRatio: 0.07 },
    torso: { lengthRatio: 0.40 },
    frontLegs: { lengthRatio: 0.30, jointAngleMax: 30 },
    rearLegs: { lengthRatio: 0.30, jointAngleMax: 30 },
    tail: { lengthRatio: 0.22, jointAngleMax: 25 },
  }, { runGaitType: "trot", playBounce: 1.1 }),

  // --- Medium ---
  dogBreed("Beagle", "hound", {
    head: { lengthRatio: 0.19, widthRatio: 0.72, heightRatio: 0.26 },
    torso: { lengthRatio: 0.44 },
    frontLegs: { lengthRatio: 0.42, jointAngleMax: 42 },
    rearLegs: { lengthRatio: 0.42, jointAngleMax: 42 },
    tail: { lengthRatio: 0.22, jointAngleMax: 35 },
  }, { runGaitType: "trot", tailWagAmplitude: 1.3 }),

  dogBreed("Cocker Spaniel", "sporting", {
    head: { lengthRatio: 0.19, widthRatio: 0.70, heightRatio: 0.26 },
    torso: { lengthRatio: 0.44 },
    frontLegs: { lengthRatio: 0.42, jointAngleMax: 42 },
    rearLegs: { lengthRatio: 0.42, jointAngleMax: 42 },
    tail: { lengthRatio: 0.15, jointAngleMax: 28 },
  }, { tailWagAmplitude: 1.5 }),

  dogBreed("Border Collie", "herding", {
    head: { lengthRatio: 0.17, widthRatio: 0.65, heightRatio: 0.24 },
    torso: { lengthRatio: 0.46 },
    frontLegs: { lengthRatio: 0.48, jointAngleMax: 48 },
    rearLegs: { lengthRatio: 0.48, jointAngleMax: 48 },
    tail: { lengthRatio: 0.25, jointAngleMax: 30 },
  }, { runGaitType: "gallop", spineFlexMultiplier: 1.2, playBounce: 1.3 }),

  dogBreed("Australian Shepherd", "herding", {
    head: { lengthRatio: 0.17, widthRatio: 0.68, heightRatio: 0.24 },
    torso: { lengthRatio: 0.46 },
    frontLegs: { lengthRatio: 0.47, jointAngleMax: 47 },
    rearLegs: { lengthRatio: 0.47, jointAngleMax: 47 },
    tail: { lengthRatio: 0.10, jointAngleMax: 20 },
  }, { runGaitType: "gallop", spineFlexMultiplier: 1.1 }),

  dogBreed("Bulldog", "brachycephalic", {
    head: { lengthRatio: 0.22, widthRatio: 0.95, heightRatio: 0.28 },
    neck: { lengthRatio: 0.06 },
    torso: { lengthRatio: 0.44, widthRatio: 1.25 },
    frontLegs: { lengthRatio: 0.34, jointAngleMax: 30 },
    rearLegs: { lengthRatio: 0.34, jointAngleMax: 30 },
    tail: { lengthRatio: 0.08, jointAngleMax: 10 },
  }, { runGaitType: "waddle", eatingReach: 0.7, spineFlexMultiplier: 0.5 }),

  dogBreed("Corgi", "herding", {
    head: { lengthRatio: 0.18, widthRatio: 0.72, heightRatio: 0.30 },
    torso: { lengthRatio: 0.50, widthRatio: 1.05 },
    frontLegs: { lengthRatio: 0.28, jointAngleMax: 30 },
    rearLegs: { lengthRatio: 0.28, jointAngleMax: 30 },
    tail: { lengthRatio: 0.08, jointAngleMax: 12 },
  }, { runGaitType: "waddle", playBounce: 0.8, spineFlexMultiplier: 0.8 }),

  dogBreed("Dachshund", "hound", {
    head: { lengthRatio: 0.16, widthRatio: 0.60, heightRatio: 0.28 },
    neck: { lengthRatio: 0.10 },
    torso: { lengthRatio: 0.55, widthRatio: 0.85 },
    frontLegs: { lengthRatio: 0.25, jointAngleMax: 25 },
    rearLegs: { lengthRatio: 0.25, jointAngleMax: 25 },
    tail: { lengthRatio: 0.20, jointAngleMax: 25 },
  }, { runGaitType: "waddle", eatingReach: 1.1, spineFlexMultiplier: 0.6 }),

  // --- Large ---
  dogBreed("Golden Retriever", "sporting", {
    head: { lengthRatio: 0.17, widthRatio: 0.68, heightRatio: 0.24 },
    torso: { lengthRatio: 0.46 },
    frontLegs: { lengthRatio: 0.48, jointAngleMax: 45 },
    rearLegs: { lengthRatio: 0.48, jointAngleMax: 45 },
    tail: { lengthRatio: 0.25, jointAngleMax: 30 },
  }, { runGaitType: "trot", tailWagAmplitude: 1.4 }),

  dogBreed("Labrador Retriever", "sporting", {
    head: { lengthRatio: 0.18, widthRatio: 0.72, heightRatio: 0.25 },
    torso: { lengthRatio: 0.45, widthRatio: 1.05 },
    frontLegs: { lengthRatio: 0.47, jointAngleMax: 45 },
    rearLegs: { lengthRatio: 0.47, jointAngleMax: 45 },
    tail: { lengthRatio: 0.22, jointAngleMax: 28 },
  }, { runGaitType: "trot", tailWagAmplitude: 1.5 }),

  dogBreed("German Shepherd", "herding", {
    head: { lengthRatio: 0.18, widthRatio: 0.68, heightRatio: 0.25 },
    torso: { lengthRatio: 0.46 },
    frontLegs: { lengthRatio: 0.50, jointAngleMax: 48 },
    rearLegs: { lengthRatio: 0.48, jointAngleMax: 48 },
    tail: { lengthRatio: 0.28, jointAngleMax: 30 },
  }, { runGaitType: "trot", spineFlexMultiplier: 1.1 }),

  dogBreed("Rottweiler", "working", {
    head: { lengthRatio: 0.20, widthRatio: 0.80, heightRatio: 0.27 },
    neck: { lengthRatio: 0.08 },
    torso: { lengthRatio: 0.45, widthRatio: 1.15 },
    frontLegs: { lengthRatio: 0.46, jointAngleMax: 42 },
    rearLegs: { lengthRatio: 0.46, jointAngleMax: 42 },
    tail: { lengthRatio: 0.10, jointAngleMax: 15 },
  }, { runGaitType: "trot", playBounce: 0.8 }),

  dogBreed("Siberian Husky", "spitz", {
    head: { lengthRatio: 0.17, widthRatio: 0.68, heightRatio: 0.24 },
    torso: { lengthRatio: 0.46 },
    frontLegs: { lengthRatio: 0.50, jointAngleMax: 48 },
    rearLegs: { lengthRatio: 0.50, jointAngleMax: 48 },
    tail: { lengthRatio: 0.24, jointAngleMax: 28 },
  }, { runGaitType: "gallop", spineFlexMultiplier: 1.2, tailWagAmplitude: 0.8 }),

  dogBreed("Boxer", "working", {
    head: { lengthRatio: 0.20, widthRatio: 0.82, heightRatio: 0.27 },
    neck: { lengthRatio: 0.08 },
    torso: { lengthRatio: 0.44, widthRatio: 1.10 },
    frontLegs: { lengthRatio: 0.48, jointAngleMax: 45 },
    rearLegs: { lengthRatio: 0.48, jointAngleMax: 45 },
    tail: { lengthRatio: 0.08, jointAngleMax: 12 },
  }, { runGaitType: "trot", playBounce: 1.2, spineFlexMultiplier: 1.0 }),

  // --- Giant ---
  dogBreed("Great Dane", "working", {
    head: { lengthRatio: 0.16, widthRatio: 0.60, heightRatio: 0.22 },
    neck: { lengthRatio: 0.14 },
    torso: { lengthRatio: 0.42 },
    frontLegs: { lengthRatio: 0.58, jointAngleMax: 45 },
    rearLegs: { lengthRatio: 0.58, jointAngleMax: 45 },
    tail: { lengthRatio: 0.28, jointAngleMax: 25 },
  }, { runGaitType: "gallop", playBounce: 0.7, spineFlexMultiplier: 0.9 }),

  dogBreed("Saint Bernard", "working", {
    head: { lengthRatio: 0.20, widthRatio: 0.85, heightRatio: 0.28 },
    neck: { lengthRatio: 0.08 },
    torso: { lengthRatio: 0.46, widthRatio: 1.20 },
    frontLegs: { lengthRatio: 0.48, jointAngleMax: 40 },
    rearLegs: { lengthRatio: 0.48, jointAngleMax: 40 },
    tail: { lengthRatio: 0.24, jointAngleMax: 25 },
  }, { runGaitType: "trot", playBounce: 0.6, eatingReach: 0.85 }),

  // --- Greyhound / Sighthound ---
  dogBreed("Greyhound", "sighthound", {
    head: { lengthRatio: 0.16, widthRatio: 0.50, heightRatio: 0.22 },
    neck: { lengthRatio: 0.14 },
    torso: { lengthRatio: 0.42, widthRatio: 0.75 },
    frontLegs: { lengthRatio: 0.58, jointAngleMax: 55 },
    rearLegs: { lengthRatio: 0.60, jointAngleMax: 55 },
    tail: { lengthRatio: 0.30, jointAngleMax: 28 },
  }, { runGaitType: "gallop", spineFlexMultiplier: 1.5, playBounce: 1.1 }),

  dogBreed("Whippet", "sighthound", {
    head: { lengthRatio: 0.16, widthRatio: 0.52, heightRatio: 0.22 },
    neck: { lengthRatio: 0.13 },
    torso: { lengthRatio: 0.42, widthRatio: 0.78 },
    frontLegs: { lengthRatio: 0.55, jointAngleMax: 52 },
    rearLegs: { lengthRatio: 0.57, jointAngleMax: 52 },
    tail: { lengthRatio: 0.28, jointAngleMax: 28 },
  }, { runGaitType: "gallop", spineFlexMultiplier: 1.4 }),

  // --- Terriers ---
  dogBreed("Jack Russell Terrier", "terrier", {
    head: { lengthRatio: 0.20, widthRatio: 0.70, heightRatio: 0.26 },
    torso: { lengthRatio: 0.42 },
    frontLegs: { lengthRatio: 0.40, jointAngleMax: 42 },
    rearLegs: { lengthRatio: 0.42, jointAngleMax: 42 },
    tail: { lengthRatio: 0.15, jointAngleMax: 28 },
  }, { runGaitType: "trot", playBounce: 1.4, tailWagAmplitude: 1.3 }),

  dogBreed("Scottish Terrier", "terrier", {
    head: { lengthRatio: 0.20, widthRatio: 0.72, heightRatio: 0.28 },
    torso: { lengthRatio: 0.46 },
    frontLegs: { lengthRatio: 0.30, jointAngleMax: 30 },
    rearLegs: { lengthRatio: 0.30, jointAngleMax: 30 },
    tail: { lengthRatio: 0.14, jointAngleMax: 22 },
  }, { runGaitType: "trot", playBounce: 1.0 }),

  // --- Standard Poodle ---
  dogBreed("Poodle", "non-sporting", {
    head: { lengthRatio: 0.18, widthRatio: 0.65, heightRatio: 0.26 },
    neck: { lengthRatio: 0.12 },
    torso: { lengthRatio: 0.42 },
    frontLegs: { lengthRatio: 0.50, jointAngleMax: 48 },
    rearLegs: { lengthRatio: 0.50, jointAngleMax: 48 },
    tail: { lengthRatio: 0.18, jointAngleMax: 25 },
  }, { runGaitType: "trot", playBounce: 1.2, spineFlexMultiplier: 1.1 }),

  // ===== CATS =====

  catBreed("Persian", "brachycephalic", {
    head: { lengthRatio: 0.24, widthRatio: 0.90, heightRatio: 0.32 },
    neck: { lengthRatio: 0.06 },
    torso: { lengthRatio: 0.40, widthRatio: 1.0 },
    frontLegs: { lengthRatio: 0.35, jointAngleMax: 42 },
    rearLegs: { lengthRatio: 0.38, jointAngleMax: 45 },
    tail: { lengthRatio: 0.25, jointAngleMax: 35 },
  }, { runGaitType: "trot", playBounce: 1.0, eatingReach: 0.8 }),

  catBreed("Siamese", "oriental", {
    head: { lengthRatio: 0.18, widthRatio: 0.65, heightRatio: 0.26 },
    neck: { lengthRatio: 0.10 },
    torso: { lengthRatio: 0.42, widthRatio: 0.80 },
    frontLegs: { lengthRatio: 0.48, jointAngleMax: 55 },
    rearLegs: { lengthRatio: 0.52, jointAngleMax: 58 },
    tail: { lengthRatio: 0.35, jointAngleMax: 45 },
  }, { runGaitType: "gallop", playBounce: 1.4, spineFlexMultiplier: 1.3 }),

  catBreed("Maine Coon", "longhair", {
    head: { lengthRatio: 0.18, widthRatio: 0.72, heightRatio: 0.26 },
    neck: { lengthRatio: 0.08 },
    torso: { lengthRatio: 0.46, widthRatio: 0.95 },
    frontLegs: { lengthRatio: 0.45, jointAngleMax: 52 },
    rearLegs: { lengthRatio: 0.48, jointAngleMax: 55 },
    tail: { lengthRatio: 0.35, jointAngleMax: 40 },
  }, { runGaitType: "gallop", playBounce: 1.2, tailWagAmplitude: 1.2 }),

  catBreed("British Shorthair", "cobby", {
    head: { lengthRatio: 0.22, widthRatio: 0.85, heightRatio: 0.30 },
    neck: { lengthRatio: 0.06 },
    torso: { lengthRatio: 0.42, widthRatio: 1.0 },
    frontLegs: { lengthRatio: 0.38, jointAngleMax: 45 },
    rearLegs: { lengthRatio: 0.40, jointAngleMax: 48 },
    tail: { lengthRatio: 0.25, jointAngleMax: 32 },
  }, { runGaitType: "trot", playBounce: 1.0 }),

  catBreed("Bengal", "athletic", {
    head: { lengthRatio: 0.18, widthRatio: 0.68, heightRatio: 0.26 },
    neck: { lengthRatio: 0.09 },
    torso: { lengthRatio: 0.44, widthRatio: 0.88 },
    frontLegs: { lengthRatio: 0.47, jointAngleMax: 55 },
    rearLegs: { lengthRatio: 0.52, jointAngleMax: 58 },
    tail: { lengthRatio: 0.30, jointAngleMax: 42 },
  }, { runGaitType: "gallop", playBounce: 1.5, spineFlexMultiplier: 1.4 }),

  catBreed("Ragdoll", "semi-longhair", {
    head: { lengthRatio: 0.19, widthRatio: 0.74, heightRatio: 0.27 },
    neck: { lengthRatio: 0.08 },
    torso: { lengthRatio: 0.45, widthRatio: 0.95 },
    frontLegs: { lengthRatio: 0.44, jointAngleMax: 48 },
    rearLegs: { lengthRatio: 0.46, jointAngleMax: 50 },
    tail: { lengthRatio: 0.30, jointAngleMax: 35 },
  }, { runGaitType: "trot", playBounce: 0.9, eatingReach: 0.9 }),

  catBreed("Sphynx", "hairless", {
    head: { lengthRatio: 0.20, widthRatio: 0.78, heightRatio: 0.28 },
    neck: { lengthRatio: 0.10 },
    torso: { lengthRatio: 0.40, widthRatio: 0.82 },
    frontLegs: { lengthRatio: 0.46, jointAngleMax: 54 },
    rearLegs: { lengthRatio: 0.50, jointAngleMax: 56 },
    tail: { lengthRatio: 0.30, jointAngleMax: 42 },
  }, { runGaitType: "gallop", playBounce: 1.3, spineFlexMultiplier: 1.3 }),
];

// ---------------------------------------------------------------------------
// Species-level defaults (for breeds not in the registry)
// ---------------------------------------------------------------------------

const SPECIES_DEFAULTS: Record<string, BreedAnatomy> = {
  dog: {
    species: "dog",
    breed: "Mixed Breed",
    family: "mixed",
    sections: DEFAULT_DOG_SECTIONS,
    animationModifiers: DEFAULT_DOG_ANIM,
  },
  cat: {
    species: "cat",
    breed: "Domestic Shorthair",
    family: "mixed",
    sections: DEFAULT_CAT_SECTIONS,
    animationModifiers: DEFAULT_CAT_ANIM,
  },
  bird: {
    species: "bird",
    breed: "Generic Bird",
    family: "avian",
    sections: {
      head: {
        lengthRatio: 0.18, widthRatio: 0.60, heightRatio: 0.25,
        meshRegion: { lengthStart: 0.82, lengthEnd: 1.0, heightStart: 0.65, heightEnd: 1.0 },
      },
      neck: {
        lengthRatio: 0.12,
        meshRegion: { lengthStart: 0.72, lengthEnd: 0.82, heightStart: 0.55, heightEnd: 0.90 },
      },
      torso: {
        lengthRatio: 0.45, widthRatio: 1.0,
        meshRegion: { lengthStart: 0.25, lengthEnd: 0.72, heightStart: 0.20, heightEnd: 0.80 },
      },
      frontLegs: {
        lengthRatio: 0.30, jointAngleMax: 30,
        meshRegion: { lengthStart: 0.55, lengthEnd: 0.72, heightStart: 0.0, heightEnd: 0.30 },
      },
      rearLegs: {
        lengthRatio: 0.30, jointAngleMax: 30,
        meshRegion: { lengthStart: 0.30, lengthEnd: 0.50, heightStart: 0.0, heightEnd: 0.30 },
      },
      tail: {
        lengthRatio: 0.20, jointAngleMax: 25,
        meshRegion: { lengthStart: 0.0, lengthEnd: 0.22, heightStart: 0.25, heightEnd: 0.50 },
      },
    },
    animationModifiers: {
      runGaitType: "hop",
      eatingReach: 1.2,
      playBounce: 1.5,
      tailWagAmplitude: 0.5,
      spineFlexMultiplier: 0.6,
    },
  },
  rabbit: {
    species: "rabbit",
    breed: "Generic Rabbit",
    family: "lagomorph",
    sections: {
      head: {
        lengthRatio: 0.20, widthRatio: 0.70, heightRatio: 0.28,
        meshRegion: { lengthStart: 0.80, lengthEnd: 1.0, heightStart: 0.50, heightEnd: 1.0 },
      },
      neck: {
        lengthRatio: 0.05,
        meshRegion: { lengthStart: 0.76, lengthEnd: 0.80, heightStart: 0.50, heightEnd: 0.80 },
      },
      torso: {
        lengthRatio: 0.45, widthRatio: 0.90,
        meshRegion: { lengthStart: 0.28, lengthEnd: 0.76, heightStart: 0.25, heightEnd: 0.75 },
      },
      frontLegs: {
        lengthRatio: 0.28, jointAngleMax: 35,
        meshRegion: { lengthStart: 0.60, lengthEnd: 0.78, heightStart: 0.0, heightEnd: 0.35 },
      },
      rearLegs: {
        lengthRatio: 0.40, jointAngleMax: 55,
        meshRegion: { lengthStart: 0.22, lengthEnd: 0.45, heightStart: 0.0, heightEnd: 0.50 },
      },
      tail: {
        lengthRatio: 0.06, jointAngleMax: 12,
        meshRegion: { lengthStart: 0.0, lengthEnd: 0.15, heightStart: 0.30, heightEnd: 0.50 },
      },
    },
    animationModifiers: {
      runGaitType: "hop",
      eatingReach: 0.7,
      playBounce: 1.8,
      tailWagAmplitude: 0.3,
      spineFlexMultiplier: 1.0,
    },
  },
  hamster: {
    species: "hamster",
    breed: "Generic Hamster",
    family: "rodent",
    sections: {
      head: {
        lengthRatio: 0.25, widthRatio: 0.80, heightRatio: 0.35,
        meshRegion: { lengthStart: 0.75, lengthEnd: 1.0, heightStart: 0.40, heightEnd: 1.0 },
      },
      neck: {
        lengthRatio: 0.04,
        meshRegion: { lengthStart: 0.72, lengthEnd: 0.75, heightStart: 0.40, heightEnd: 0.75 },
      },
      torso: {
        lengthRatio: 0.50, widthRatio: 1.1,
        meshRegion: { lengthStart: 0.20, lengthEnd: 0.72, heightStart: 0.15, heightEnd: 0.70 },
      },
      frontLegs: {
        lengthRatio: 0.18, jointAngleMax: 25,
        meshRegion: { lengthStart: 0.55, lengthEnd: 0.72, heightStart: 0.0, heightEnd: 0.25 },
      },
      rearLegs: {
        lengthRatio: 0.22, jointAngleMax: 30,
        meshRegion: { lengthStart: 0.20, lengthEnd: 0.40, heightStart: 0.0, heightEnd: 0.30 },
      },
      tail: {
        lengthRatio: 0.05, jointAngleMax: 10,
        meshRegion: { lengthStart: 0.0, lengthEnd: 0.12, heightStart: 0.25, heightEnd: 0.40 },
      },
    },
    animationModifiers: {
      runGaitType: "waddle",
      eatingReach: 0.6,
      playBounce: 1.2,
      tailWagAmplitude: 0.2,
      spineFlexMultiplier: 0.5,
    },
  },
};

// ---------------------------------------------------------------------------
// Lookup API
// ---------------------------------------------------------------------------

/**
 * Look up breed-specific anatomy. Uses fuzzy matching:
 *  1. Exact breed match (case-insensitive)
 *  2. Breed substring match (e.g. "Lab" matches "Labrador Retriever")
 *  3. Family match (e.g. "terrier" in breed string → first terrier entry)
 *  4. Species-level default
 */
export function lookupBreedAnatomy(species: string, breed: string): BreedAnatomy {
  const speciesLower = species.toLowerCase();
  const breedLower = breed.toLowerCase();

  // 1. Exact match
  const exact = BREED_REGISTRY.find(
    (b) => b.species === speciesLower && b.breed.toLowerCase() === breedLower,
  );
  if (exact) return exact;

  // 2. Substring match (either direction)
  const substring = BREED_REGISTRY.find(
    (b) =>
      b.species === speciesLower &&
      (b.breed.toLowerCase().includes(breedLower) || breedLower.includes(b.breed.toLowerCase())),
  );
  if (substring) return substring;

  // 3. Family match — check if the breed string contains a known family name
  const familyMatch = BREED_REGISTRY.find(
    (b) =>
      b.species === speciesLower &&
      (breedLower.includes(b.family) || b.family.includes(breedLower)),
  );
  if (familyMatch) return familyMatch;

  // 4. Species default
  if (SPECIES_DEFAULTS[speciesLower]) {
    return { ...SPECIES_DEFAULTS[speciesLower], breed };
  }

  // 5. Ultimate fallback: generic dog
  return { ...SPECIES_DEFAULTS.dog, species, breed };
}

/**
 * Get the Python code literal for a breed's mesh-region-based vertex group
 * assignment function. This replaces the generic `choose_group()` in act.ts
 * with breed-specific bounding box percentages.
 */
export function generateVertexGroupCode(anatomy: BreedAnatomy): string {
  const s = anatomy.sections;
  const lines: string[] = [
    `def choose_group(world):`,
    `    """Breed-aware vertex group assignment for ${anatomy.breed} (${anatomy.species})"""`,
    `    rel_len = ((world.x - min_v.x) / span.x) if length_axis == 0 and span.x else ((world.y - min_v.y) / span.y) if span.y else 0.5`,
    `    rel_z = (world.z - min_v.z) / span.z if span.z else 0.5`,
  ];

  // Head region
  lines.push(`    # Head: length ${s.head.meshRegion.lengthStart}-${s.head.meshRegion.lengthEnd}, height ${s.head.meshRegion.heightStart}-${s.head.meshRegion.heightEnd}`);
  lines.push(`    if rel_len >= ${s.head.meshRegion.lengthStart} and rel_z >= ${s.head.meshRegion.heightStart}:`);
  lines.push(`        return "head"`);

  // Neck region
  lines.push(`    if rel_len >= ${s.neck.meshRegion.lengthStart} and rel_len < ${s.neck.meshRegion.lengthEnd} and rel_z >= ${s.neck.meshRegion.heightStart}:`);
  lines.push(`        return "neck"`);

  // Front legs
  lines.push(`    if rel_len >= ${s.frontLegs.meshRegion.lengthStart} and rel_len < ${s.frontLegs.meshRegion.lengthEnd} and rel_z < ${s.frontLegs.meshRegion.heightEnd}:`);
  lines.push(`        return "front_leg_lower.L" if rel_z < ${s.frontLegs.meshRegion.heightEnd * 0.5} else "front_leg_upper.L"`);

  // Rear legs
  lines.push(`    if rel_len >= ${s.rearLegs.meshRegion.lengthStart} and rel_len < ${s.rearLegs.meshRegion.lengthEnd} and rel_z < ${s.rearLegs.meshRegion.heightEnd}:`);
  lines.push(`        return "back_leg_lower.L" if rel_z < ${s.rearLegs.meshRegion.heightEnd * 0.5} else "back_leg_upper.L"`);

  // Tail region
  if (s.tail) {
    lines.push(`    if rel_len < ${s.tail.meshRegion.lengthEnd} and rel_z >= ${s.tail.meshRegion.heightStart} and rel_z < ${s.tail.meshRegion.heightEnd}:`);
    lines.push(`        return "tail_01"`);
  }

  // Torso fallback (by sub-region)
  lines.push(`    # Torso sub-regions`);
  lines.push(`    if rel_len < ${s.torso.meshRegion.lengthStart + (s.torso.meshRegion.lengthEnd - s.torso.meshRegion.lengthStart) * 0.33}:`);
  lines.push(`        return "hips"`);
  lines.push(`    if rel_len < ${s.torso.meshRegion.lengthStart + (s.torso.meshRegion.lengthEnd - s.torso.meshRegion.lengthStart) * 0.66}:`);
  lines.push(`        return "spine"`);
  lines.push(`    return "chest"`);

  return lines.join("\n");
}

/**
 * Get breed-specific bone proportion multipliers for the armature creation code.
 * Returns multipliers that modify the default bone positioning from bounding box.
 */
export function getBoneProportions(anatomy: BreedAnatomy): {
  headForwardExtent: number;
  neckLength: number;
  legHeightFront: number;
  legHeightRear: number;
  torsoLength: number;
  tailLength: number;
  hipHeight: number;
} {
  const s = anatomy.sections;
  return {
    headForwardExtent: s.head.lengthRatio / 0.18,  // normalised to default dog
    neckLength: s.neck.lengthRatio / 0.10,
    legHeightFront: s.frontLegs.lengthRatio / 0.45,
    legHeightRear: s.rearLegs.lengthRatio / 0.45,
    torsoLength: s.torso.lengthRatio / 0.45,
    tailLength: s.tail ? s.tail.lengthRatio / 0.20 : 0,
    hipHeight: (s.frontLegs.meshRegion.heightEnd + s.rearLegs.meshRegion.heightEnd) / 2,
  };
}
