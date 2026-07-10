/**
 * Canonical subject class used across the generator pipeline. 'dog' is the
 * animal value kept on the wire for backward-compat (DB default, existing rows);
 * treat it as "animal" everywhere. 'object' is a static, non-living subject that
 * is NOT rigged or animated.
 */
export type SubjectClass = 'dog' | 'human' | 'object';

/**
 * Positive/negative definitions of each class. Shared by the auto-detection +
 * qualification triage call so it can reliably tell a live subject (rig it) from
 * an inanimate thing shaped like one (keep it static). Single source of truth.
 */
export const CLASS_DEFINITIONS =
  `Definitions:\n` +
  `- "human": a real living person or clearly human character. Canonical human anatomy: exactly ONE head; TWO eyes; TWO ears; ONE nose with TWO nostrils; ONE mouth; TWO arms ending in TWO hands, each hand with FIVE fingers (four fingers + one thumb); TWO legs ending in TWO feet; a human face, skin and hair. ` +
  `Missing, extra or duplicated features (e.g. one eye, three arms, six fingers, no nose) are ANATOMY ANOMALIES to be flagged, not new classes. ` +
  `NOT a doll, mannequin, action figure, statue, or costume of a person, and NOT an animal.\n` +
  `- "dog": a living (or lifelike) animal with animal anatomy — a body on legs (usually four), a head with a muzzle/snout or beak, fur/feathers/scales, usually a tail. Dogs, cats, birds, rabbits, etc. ` +
  `NOT a plush toy, figurine, statue or drawing of an animal, and NOT a human.\n` +
  `- "object": anything that is NOT a live human or animal — props, furniture, vehicles, toys, food, plants, gadgets, buildings — INCLUDING toys, figurines and statues that merely depict a human or animal. ` +
  `The test is: is this a living subject we should rig and animate, or an inanimate thing? If inanimate, it is "object" even if it is shaped like a dog or person.\n\n` +
  `When the subject is an "object", ALSO pick the single best objectCategory using these definitions:\n` +
  `  - "structure": a HABITABLE or enterable built structure — something a character could go inside, occupy, or shelter in. It has interior volume and an opening (door/entrance). Examples: house, barn, tent, doghouse, castle, shed, cabin, birdhouse. Test: could a character fit INSIDE it? If yes → structure.\n` +
  `  - "prop": a USABLE, discrete, self-contained item that is handled, carried, sat on, ridden or placed — but NOT entered. It has no habitable interior. Examples: ball, bowl, chair, toy, tool, lamp, book, vehicle, backpack. Test: is it used/held rather than inhabited? If yes → prop.\n` +
  `  - "plant": LIVING flora grown rather than eaten as-is — trees, flowers, bushes, grass, potted houseplants, cactus. Roots/stems/leaves/branches. NOT harvested produce ready to eat.\n` +
  `  - "food": an EDIBLE item or prepared dish meant to be consumed — fruit, vegetable, treat, meal, drink, baked good. Test: is the primary purpose to be eaten/drunk? If yes → food, even if it grew on a plant (a picked apple is food; an apple tree is a plant).\n` +
  `  - "part": a COMPONENT, fragment or sub-assembly of a larger object, not a complete standalone item — a wheel, door, gear, table leg, engine block, handle, bracket. Test: is this a piece OF something rather than a whole thing? If yes → part.\n` +
  `  - "blueprint": a 2D PLAN, schematic, diagram, blueprint, technical drawing or instruction sheet DESCRIBING how to build something — NOT a real 3D object itself. Flat, drawn/printed, with lines, measurements, or exploded views. A blueprint is never reconstructed as the thing it depicts; it is a drawing. Test: is this a drawing/plan OF an object rather than the object? If yes → blueprint.\n` +
  `  - "none": use only when the subject is not an object (human or dog).`;

/**
 * REFERENCE STYLE for a static OBJECT. Deliberately anti-anthropomorphic: no
 * invented face/limbs/tail, true materials and colours, clean even lighting for
 * a good single-image (or multiview) reconstruction.
 */
export const REFERENCE_STYLE_OBJECT =
  `Render this single object as a clean, well-lit, 3D-reconstruction-friendly image. ` +
  `Faithfully preserve the object's exact real colours, materials, surface finish and proportions as seen across ALL reference photos. ` +
  `The WHOLE object is visible, centered, upright in its natural resting orientation, with generous margin on all sides. ` +
  `Do NOT anthropomorphise: add no face, eyes, mouth, limbs, tail or expression, and invent no parts that are not on the real object. ` +
  `If a detail is unclear, err toward the most neutral plausible interpretation rather than inventing something. ` +
  `Render as a high-quality 3D CGI product render with physically-based materials, soft even studio lighting, ` +
  `subtle ambient occlusion and a gentle SOFT contact shadow on the floor directly beneath the object for ` +
  `dimensional depth — but NO harsh or hard-edged directional cast shadows and no shadows on the background. ` +
  `Plain neutral light-gray seamless studio background, no other objects, no hands, no people, no props, no text, no watermark.`;

export const REFERENCE_STYLE_DOG =
  `Render the pet as a premium Pixar-style stylized 3D character: soft appealing proportions, slightly enlarged ` +
  `expressive eyes, subsurface-scattered skin/nose, and RICHLY TEXTURED groomed fur with visible individual strand ` +
  `clumps, whiskers, and natural sheen — like a frame from a modern animated feature film. ` +
  `Faithfully preserve the pet's exact fur colors, markings, patterns, eye color, ear shape, and breed ` +
  `characteristics as seen across ALL reference photos. ` +
  `Pay EXTREME attention to FACIAL FEATURES: eye shape and color, nose/snout shape and color, ear position, shape ` +
  `and size, facial markings, whisker placement, and jaw structure. ` +
  `The pet is standing squarely on all four legs in a neutral A-pose stance, legs clearly separated, tail clearly ` +
  `visible and separated from the body, mouth slightly open in a gentle relaxed panting expression. ` +
  `The generated image must be BILATERALLY SYMMETRIC from the viewer's perspective — the left and right sides of ` +
  `the face and body should mirror each other for clean 3D reconstruction. ` +
  `Do NOT invent or add features not visible in the reference photos. If a detail is unclear, err on the side ` +
  `of the most common/neutral interpretation rather than adding something creative. ` +
  `Full body visible with generous margin on all sides, seen DIRECTLY FROM THE FRONT. ` +
  `Render as a high-quality 3D CGI character with physically-based materials, soft three-point studio lighting, ` +
  `subtle ambient occlusion and a gentle SOFT contact shadow on the floor directly beneath the subject for ` +
  `dimensional depth — but NO harsh or hard-edged directional cast shadows and no shadows on the background. ` +
  `Sharp focus, plain neutral light-gray seamless studio background, no props, no people, no text, no watermark.`;

/**
 * Canonical human anatomy the generator must render — exact counts so the model
 * never produces a missing/extra eye, nostril, limb, finger or toe. Shared by the
 * human render style and available for anomaly-correction clauses.
 */
export const HUMAN_ANATOMY_SPEC =
  `ANATOMY (render EXACTLY, no more and no fewer): ONE head; TWO forward-facing eyes; TWO ears (one per side); ` +
  `ONE nose with TWO nostrils; ONE mouth; ONE torso; TWO arms; TWO hands, each with FIVE distinct fingers (four fingers plus one opposable thumb); ` +
  `TWO legs; TWO feet, each foot with FIVE distinct toes. ` +
  `Never merge, omit or duplicate these features; hands must show five separated fingers (not mittens or fused shapes) and feet must show five toes.`;

/**
 * Standard human proportion ranges expressed in HEAD-HEIGHTS (the artist's
 * canon), lightly stylized for an appealing animated look. Keeps head/torso/
 * leg/limb sizing inside a believable band so the reconstructed mesh is stable.
 */
export const HUMAN_PROPORTION_SPEC =
  `PROPORTIONS (measured in head-heights, where 1 head = the height of the character's own head): ` +
  `total standing height about 6.5 to 7.5 heads for an adult (use ~5 to 6 heads for a child or a more stylized look, keeping the head slightly larger). ` +
  `Vertical breakdown: head = 1 head-height; neck-to-crotch torso span ≈ 2.5 to 3 head-heights; legs (hip to floor) ≈ 3.5 to 4 head-heights, ` +
  `so legs are roughly half of total height. Shoulders ≈ 2 to 3 head-widths wide; hips slightly narrower than or equal to shoulders. ` +
  `Arms hang so the fingertips reach about mid-thigh; each arm ≈ 3 to 3.5 head-heights long; a hand ≈ the size of the face; a foot ≈ 1 head-height long. ` +
  `Keep all of these within the stated ranges — do not render stunted limbs, an oversized torso, or dwarfed/giant heads outside this band.`;

/**
 * Enforces a COMPLETE, FULL-LENGTH standing figure regardless of the chosen
 * render style. Prevents cropped/bust/floating results — the whole body from the
 * top of the head to the soles of both feet must be inside the frame.
 */
export const HUMAN_FULLBODY_SPEC =
  `COMPLETE FULL-BODY FIGURE: render the ENTIRE person from the top of the head down to the soles of BOTH feet, ` +
  `standing upright and grounded, with both feet flat on the floor and clearly visible. ` +
  `This is NOT a bust, portrait, half-body or floating figure — head, torso, both arms, both hands, both legs and both feet ` +
  `must all be fully inside the frame with generous margin above the head and below the feet. Nothing is cropped by the frame edge.`;

const STYLE_CLAUSES: Record<string, string> = {
  auto:            `a clean, well-lit 3D-reconstruction-friendly render with clear surface details and accurate proportions`,
  hyperrealistic:  `a HYPER-REALISTIC, photoreal 3D human render — true-to-life skin with visible pores and subsurface scattering, realistic hair strands, accurate eye moisture and catchlights, physically-based clothing fabric, natural human proportions and lifelike micro-detail, indistinguishable from a high-end 3D scan`,
  pixar:           `a premium Pixar-style stylized 3D character — soft appealing proportions, slightly enlarged expressive eyes, subsurface-scattered skin, richly textured surfaces, like a frame from a modern animated feature film`,
  realistic:       `a photorealistic, highly detailed 3D render with physically accurate materials, natural human proportions and lifelike skin, hair and clothing detail`,
  claymation:      `a claymation / stop-motion clay figure with soft matte modeling-clay surfaces, gentle fingerprints and hand-sculpted charm`,
  plush:           `a soft plush stuffed toy with visible fabric texture, stitched seams, button-style eyes and rounded cuddly proportions`,
  vinyl:           `a glossy vinyl designer collectible figure with smooth clean surfaces, bold simplified forms and a subtle sheen`,
  lowpoly:         `a stylized low-poly model with clean flat-shaded faceted surfaces and bold simplified geometry`,
  celshaded:       `a cel-shaded anime-style character with clean flat colours, crisp ink outlines and simple hard-edged shading`,
  voxel:           `a blocky voxel-art character built from cubic blocks, like a high-resolution 3D pixel sculpture`,
  papercraft:      `a papercraft / low-poly origami figure made of folded flat paper panels with visible fold creases`,
  wood:            `a hand-carved wooden toy figure with visible wood grain, smooth rounded whittled forms and a warm matte finish`,
  chibi:           `a chibi / super-deformed character with an oversized head, tiny body, big eyes and adorable exaggerated proportions`,
};

/**
 * The style "look" clause for a HUMAN reference image. Defaults to hyper-realistic
 * (auto or unknown id ⇒ hyperrealistic) but honours any TEXT_STYLE_OPTIONS id.
 * Anatomy/proportions/full-body are applied separately and are NOT style-dependent.
 */
export function humanStyleClause(styleId?: string | null): string {
  const id = (styleId && styleId !== "auto") ? styleId : "hyperrealistic";
  return STYLE_CLAUSES[id] || STYLE_CLAUSES["hyperrealistic"];
}

/**
 * Build the human REFERENCE-IMAGE style block for a given render style.
 * The look/finish varies by style; anatomy, proportions and full-body framing
 * are always enforced so every style yields a complete standing figure.
 */
export function buildHumanReferenceStyle(styleId?: string | null): string {
  return (
    `Render the person as ${humanStyleClause(styleId)}. ` +
    `Faithfully preserve the person's exact skin tone, hair color and style, facial structure, and clothing colors and patterns ` +
    `as seen across ALL reference photos. ` +
    HUMAN_ANATOMY_SPEC + ` ` +
    HUMAN_PROPORTION_SPEC + ` ` +
    HUMAN_FULLBODY_SPEC + ` ` +
    `Pay EXTREME attention to FACIAL FEATURES: eye shape, color and spacing, nose shape and size, lip shape, ` +
    `jawline, cheekbones, eyebrow shape, forehead size, and any facial hair, wrinkles or distinguishing marks. ` +
    `The person is standing squarely on two legs in a neutral bipedal A-pose stance, arms slightly out to the sides, clearly separated from the torso, ` +
    `legs clearly separated, front-facing. ` +
    `The generated image must be BILATERALLY SYMMETRIC from the viewer's perspective — the left and right sides of ` +
    `the face and body should mirror each other for clean 3D reconstruction. ` +
    `Do NOT invent or add features not visible in the reference photos. If a detail is unclear, err on the side ` +
    `of the most common/neutral interpretation rather than adding something creative. ` +
    `Full body visible with generous margin on all sides, seen DIRECTLY FROM THE FRONT. ` +
    `Render with physically-based materials, soft three-point studio lighting, ` +
    `subtle ambient occlusion and a gentle SOFT contact shadow on the floor directly beneath the subject for ` +
    `dimensional depth — but NO harsh or hard-edged directional cast shadows and no shadows on the background. ` +
    `Sharp focus, plain neutral light-gray seamless studio background, no props, no other people, no text, no watermark.`
  );
}

/** Back-compat: the default human style block (hyper-realistic). */
export const REFERENCE_STYLE_HUMAN = buildHumanReferenceStyle();

export const ACCENT_PROMPTS: Record<string, string> = {
  warm:
    ` Give the scene a coordinated WARM accent palette — soft golden-hour key light and, if a collar/clothing is present, ` +
    `warm amber/terracotta tones — WITHOUT altering the pet or person's natural fur, skin, nose or eye colours.`,
  cool:
    ` Give the scene a coordinated COOL accent palette — soft blue-hour rim light and cool teal/slate accents ` +
    `if present — WITHOUT altering the pet or person's natural fur, skin, nose or eye colours.`,
  vibrant:
    ` Give the scene a coordinated VIBRANT accent palette — punchy saturated studio accent lighting and a bright ` +
    `accent if present — WITHOUT altering the pet or person's natural fur, skin, nose or eye colours.`,
  pastel:
    ` Give the scene a coordinated soft PASTEL accent palette — gentle low-contrast lighting and pale accents ` +
    `if present — WITHOUT altering the pet or person's natural fur, skin, nose or eye colours.`,
  monochrome:
    ` Give the scene a coordinated NEUTRAL monochrome accent palette — clean balanced greyscale studio lighting and a ` +
    `neutral accent if present — WITHOUT altering the pet or person's natural fur, skin, nose or eye colours.`,
};

export function buildReferencePrompt(
  type: SubjectClass,
  accent?: string | null,
  hasFacePhoto?: boolean,
  photoCount?: number,
  style?: string | null,
): string {
  const accentClause = (accent && ACCENT_PROMPTS[accent]) || "";

  if (type === 'object') {
    const multi = (photoCount && photoCount > 1)
      ? `Cross-reference ALL ${photoCount} provided photos to resolve ambiguity about shape, colour and proportions. `
      : ``;
    return (
      `You are given one or more reference photos, all of the SAME object. ` + multi +
      `Generate ONE image of this exact object seen DIRECTLY FROM THE FRONT (standard front-facing view), showing its overall shape clearly. ` +
      REFERENCE_STYLE_OBJECT + ` Respond with only the generated image.`
    );
  }

  // Face-photo labeling clause
  const faceClause = hasFacePhoto
    ? `The FIRST image is a dedicated CLOSE-UP of the subject's face — use it as the PRIMARY reference ` +
      `for all facial features, eye color, nose shape, skin tone, and expression. ` +
      `The remaining images show the subject from other angles for body proportions, clothing, and overall shape. `
    : ``;

  // Multi-photo cross-referencing clause
  const multiPhotoClause = (photoCount && photoCount > 1)
    ? `Cross-reference ALL ${photoCount} provided photos to resolve ambiguity — if one photo shows an unclear ` +
      `angle, use the others to confirm the correct shape, color, and proportions. `
    : ``;

  if (type === 'human') {
    return (
      `You are given one or more reference photos, all of the SAME person. ` +
      faceClause + multiPhotoClause +
      `Generate ONE image of this exact person seen DIRECTLY FROM THE FRONT (head and body facing straight toward the camera). ` +
      buildHumanReferenceStyle(style) + accentClause + ` Respond with only the generated image.`
    );
  } else {
    return (
      `You are given one or more reference photos, all of the SAME pet. ` +
      faceClause + multiPhotoClause +
      `Generate ONE image of this exact pet seen DIRECTLY FROM THE FRONT (head and body facing straight toward the camera). ` +
      REFERENCE_STYLE_DOG + accentClause + ` Respond with only the generated image.`
    );
  }
}

export function turnaroundViewsForType(type: SubjectClass): { view: "left" | "back" | "right"; prompt: string }[] {
  if (type === 'object') {
    return [
      {
        view: "left",
        prompt:
          `This image is the front view of a stylized 3D object. Generate the EXACT SAME object, same style, same ` +
          `lighting and background, but seen in a PERFECT LEFT SIDE PROFILE (rotated 90° to its left). Preserve all ` +
          `real materials and colours; invent no new detail — if a side is plain, keep it plausibly plain.`,
      },
      {
        view: "back",
        prompt:
          `This image is the front view of a stylized 3D object. Generate the EXACT SAME object, same style, same ` +
          `lighting and background, but seen DIRECTLY FROM BEHIND (rotated 180°). Preserve all real materials and ` +
          `colours; do NOT invent rear detail — if the back is featureless, keep it plausibly plain.`,
      },
      {
        view: "right",
        prompt:
          `This image is the front view of a stylized 3D object. Generate the EXACT SAME object, same style, same ` +
          `lighting and background, but seen in a PERFECT RIGHT SIDE PROFILE (rotated 90° to its right). Preserve all ` +
          `real materials and colours; invent no new detail — if a side is plain, keep it plausibly plain.`,
      },
    ];
  }
  if (type === 'human') {
    return [
      {
        view: "left",
        prompt:
          `This image is the FRONT view of a stylized 3D human character. Generate the EXACT SAME character, same pose, ` +
          `same style, same lighting and background, but seen in a PERFECT LEFT SIDE PROFILE (camera at the person's left, ` +
          `person's nose pointing to the left edge of the frame, full body visible, arms slightly out).`,
      },
      {
        view: "back",
        prompt:
          `This image is the FRONT view of a stylized 3D human character. Generate the EXACT SAME character, same pose, ` +
          `same style, same lighting and background, but seen DIRECTLY FROM BEHIND (camera behind the person, head facing away, ` +
          `back of body and hair clearly visible).`,
      },
      {
        view: "right",
        prompt:
          `This image is the FRONT view of a stylized 3D human character. Generate the EXACT SAME character, same pose, ` +
          `same style, same lighting and background, but seen in a PERFECT RIGHT SIDE PROFILE (camera at the person's right, ` +
          `person's nose pointing to the right edge of the frame, full body visible, arms slightly out).`,
      },
    ];
  } else {
    return [
      {
        view: "left",
        prompt:
          `This image is the FRONT view of a stylized 3D pet character. Generate the EXACT SAME character, same pose, ` +
          `same style, same lighting and background, but seen in a PERFECT LEFT SIDE PROFILE (camera at the pet's left, ` +
          `pet's nose pointing to the left edge of the frame, full body and tail visible).`,
      },
      {
        view: "back",
        prompt:
          `This image is the FRONT view of a stylized 3D pet character. Generate the EXACT SAME character, same pose, ` +
          `same style, same lighting and background, but seen DIRECTLY FROM BEHIND (camera behind the pet, tail toward ` +
          `the camera and clearly visible, head facing away).`,
      },
      {
        view: "right",
        prompt:
          `This image is the FRONT view of a stylized 3D pet character. Generate the EXACT SAME character, same pose, ` +
          `same style, same lighting and background, but seen in a PERFECT RIGHT SIDE PROFILE (camera at the pet's right, ` +
          `pet's nose pointing to the right edge of the frame, full body and tail visible).`,
      },
    ];
  }
}

export function paletteLockClause(type: SubjectClass, palette: string | null): string {
  const subject = type === 'human' ? 'human' : type === 'object' ? 'object' : 'pet';
  const detail = type === 'human' ? 'skin, hair, clothing colours'
    : type === 'object' ? 'materials and colours'
    : 'fur colours, markings';
  return (
    ` Character turnaround sheet consistency: IDENTICAL ${detail}, proportions and texture across every view.` +
    (palette
      ? ` The ${subject}'s colours MUST match this exact palette: ${palette}. Do not shift, desaturate or recolour anything.`
      : ``)
  );
}

export function extractPaletteInstruction(type: SubjectClass): string {
  if (type === 'object') {
    return (
      `Describe this object's exact colours and materials as a short, comma-separated palette an artist could match precisely: ` +
      `primary colour and material, secondary colour and material, and any distinct accents and where they are. ` +
      `Reply with ONLY the palette phrase, no preamble, under 40 words.`
    );
  }
  if (type === 'human') {
    return (
      `Describe this person's exact colors as a short, comma-separated palette an artist could match precisely: ` +
      `skin tone, hair color, eye color, and clothing colors. ` +
      `Reply with ONLY the palette phrase, no preamble, under 40 words.`
    );
  } else {
    return (
      `Describe this pet's exact colours as a short, comma-separated palette an artist could match precisely: ` +
      `primary fur colour, secondary/undercoat colour, distinct markings and where they are, eye colour, and nose colour. ` +
      `Reply with ONLY the palette phrase, no preamble, under 40 words.`
    );
  }
}

// ===========================================================================
// TEXT-TO-3D prompt builder
// ---------------------------------------------------------------------------
// Assembles a reference-image prompt from structured dropdown choices, then
// that image feeds the SAME Tripo image_to_model pipeline used everywhere else.
//
// These option lists are 3D-SAFE: every choice is tuned to produce a clean,
// single-subject, evenly-lit reference that reconstructs into a good mesh.
// Fields that fight reconstruction (camera *movement*, arbitrary view angles,
// dramatic shadow-baking light) are deliberately excluded or constrained.
//
// The `id` values are the contract with the frontend dropdowns — keep in sync.
// ===========================================================================

export interface TextOption {
  id: string;
  label: string;
  /** Short helper shown under the dropdown; also used for "recommended" hints. */
  hint?: string;
  recommended?: boolean;
}

/** Visual style of the generated character. */
export const TEXT_STYLE_OPTIONS: TextOption[] = [
  { id: "auto",           label: "Auto (let AI decide)", recommended: true, hint: "Best for arbitrary images — the generator picks the most fitting style" },
  { id: "hyperrealistic", label: "Hyper-realistic", hint: "Photoreal, scan-like detail — best for people" },
  { id: "realistic",      label: "Photorealistic" },
  { id: "pixar",          label: "Pixar / animated feature" },
  { id: "claymation",     label: "Claymation / clay" },
  { id: "plush",          label: "Plush / stuffed toy" },
  { id: "vinyl",          label: "Vinyl / designer figure" },
  { id: "lowpoly",        label: "Low-poly / retro" },
  { id: "celshaded",      label: "Cel-shaded / anime" },
  { id: "voxel",          label: "Voxel / blocky" },
  { id: "papercraft",     label: "Papercraft / origami" },
  { id: "wood",           label: "Carved wood toy" },
  { id: "chibi",          label: "Chibi / super-deformed" },
];

/** Body framing (replaces the invalid "camera movement" field). */
export const TEXT_FRAMING_OPTIONS: TextOption[] = [
  { id: "auto",           label: "Auto (let AI decide)", recommended: true, hint: "Best for arbitrary images" },
  { id: "fullbody_apose", label: "Full body — A-pose standing", hint: "Best for a complete, riggable mesh" },
  { id: "fullbody_sit",   label: "Full body — sitting" },
  { id: "fullbody_lie",   label: "Full body — lying down" },
  { id: "bust",           label: "Head & shoulders bust", hint: "No legs/body — portrait busts only" },
];

/** View angle. Single-image reconstruction wants a clean front. */
export const TEXT_ANGLE_OPTIONS: TextOption[] = [
  { id: "auto",          label: "Auto (let AI decide)", recommended: true, hint: "Best for arbitrary images" },
  { id: "front",         label: "Front view", hint: "Required for best single-image reconstruction" },
  { id: "three_quarter", label: "Slight 3/4 front", hint: "Slightly turned — acceptable, marginally lower fidelity" },
];

/**
 * Lighting. The first group is texture-safe (even light → clean bakes). The
 * "dramatic" group bakes real shadows/highlights into the texture — great for a
 * stylised look, but reduces reconstruction fidelity, so each carries a hint.
 */
export const TEXT_LIGHTING_OPTIONS: TextOption[] = [
  { id: "auto",         label: "Auto (let AI decide)", recommended: true, hint: "Best for arbitrary images" },
  { id: "studio_even",  label: "Even soft studio", hint: "Cleanest textures for 3D" },
  { id: "flat_ambient", label: "Flat ambient" },
  { id: "softbox",      label: "Softbox key + fill" },
  { id: "warm_golden",  label: "Warm golden" },
  { id: "cool_blue",    label: "Cool blue" },
  { id: "high_key",     label: "High-key bright" },
  { id: "dramatic_rim", label: "Dramatic rim light", hint: "Bakes shadows — stylised, lower 3D fidelity" },
  { id: "rembrandt",    label: "Rembrandt / moody", hint: "Bakes shadows — stylised, lower 3D fidelity" },
  { id: "low_key",      label: "Low-key / dark", hint: "Bakes shadows — stylised, lower 3D fidelity" },
  { id: "neon",         label: "Neon / cyberpunk", hint: "Bakes coloured light — stylised, lower 3D fidelity" },
  { id: "backlit",      label: "Backlit / silhouette", hint: "Strong shadows — stylised, lowest 3D fidelity" },
];

/** Geometry detail → Tripo face_limit. */
export const GEOMETRY_DETAIL_OPTIONS: TextOption[] = [
  { id: "draft",    label: "Draft (~10k faces)" },
  { id: "standard", label: "Standard (~25k faces)" },
  { id: "high",     label: "High (~40k faces)", recommended: true },
  { id: "ultra",    label: "Ultra (~60k faces)", hint: "Slower, larger file" },
];

/** Geometry texturing → Tripo texture/pbr flags. */
export const GEOMETRY_TEXTURE_OPTIONS: TextOption[] = [
  { id: "pbr_detailed", label: "PBR detailed", recommended: true },
  { id: "basic",        label: "Basic texture" },
  { id: "none",         label: "Untextured mesh" },
];

const FRAMING_CLAUSES: Record<string, string> = {
  auto:           `The full subject is visible, centered with generous margin on all sides.`,
  fullbody_apose: `The full body is visible head-to-toe, standing squarely in a neutral A-pose with limbs clearly separated from the torso and from each other, generous margin on all sides.`,
  fullbody_sit:   `The full body is visible, sitting upright in a calm neutral pose, all limbs clearly readable, generous margin on all sides.`,
  fullbody_lie:   `The full body is visible, lying down relaxed with limbs clearly separated and readable, generous margin on all sides.`,
  bust:           `Show only a head-and-shoulders bust, centered, with generous margin around the head.`,
};

const ANGLE_CLAUSES: Record<string, string> = {
  auto:          `centered in the frame with a clear, reconstruction-friendly view`,
  front:         `seen DIRECTLY FROM THE FRONT, facing straight toward the camera`,
  three_quarter: `seen from a slight three-quarter front angle, turned only slightly so both the front and one side are visible`,
};

const LIGHTING_CLAUSES: Record<string, string> = {
  auto:         `clean, even lighting optimised for 3D reconstruction with no harsh shadows`,
  studio_even:  `even soft studio lighting with no harsh shadows`,
  flat_ambient: `flat even ambient lighting with minimal shadowing`,
  softbox:      `soft diffused softbox key light with gentle fill and no hard shadows`,
  warm_golden:  `soft warm golden lighting, evenly diffused with no hard shadows`,
  cool_blue:    `soft cool blue-toned lighting, evenly diffused with no hard shadows`,
  high_key:     `bright high-key lighting, clean and evenly lit with no hard shadows`,
  dramatic_rim: `dramatic rim lighting with a bright edge glow separating the subject from the background and deep contrast`,
  rembrandt:    `moody Rembrandt-style directional side lighting with a soft shadow falloff across the subject`,
  low_key:      `low-key, high-contrast dark lighting with the subject emerging from shadow`,
  neon:         `vibrant neon / cyberpunk lighting with saturated magenta and cyan coloured accents`,
  backlit:      `strong backlighting that rims the subject's silhouette with a glowing outline`,
};

function pick<T extends TextOption>(opts: T[], id: string | undefined): T {
  return opts.find((o) => o.id === id) || opts.find((o) => o.recommended) || opts[0];
}

export interface TextPromptFields {
  subject: string;
  style?: string;
  framing?: string;
  angle?: string;
  lighting?: string;
  /** Optional corrective guidance appended on a qualification-driven regeneration. */
  corrective?: string;
}

/**
 * Build a Gemini text→image prompt that yields a clean, reconstruction-friendly
 * reference image for the Tripo pipeline. The subject is free text; everything
 * else is constrained to the 3D-safe option ids above.
 */
export function buildTextPrompt(fields: TextPromptFields): string {
  const subject = (fields.subject || "").trim();
  const style = pick(TEXT_STYLE_OPTIONS, fields.style).id;
  const framing = pick(TEXT_FRAMING_OPTIONS, fields.framing).id;
  const angle = pick(TEXT_ANGLE_OPTIONS, fields.angle).id;
  const lighting = pick(TEXT_LIGHTING_OPTIONS, fields.lighting).id;

  const corrective = (fields.corrective || "").trim();
  const correctiveClause = corrective ? ` IMPORTANT — fix these issues from the previous attempt: ${corrective}` : ``;

  return (
    `Generate ONE image of ${subject}, rendered as ${STYLE_CLAUSES[style]}. ` +
    `The subject is ${ANGLE_CLAUSES[angle]}. ` +
    `${FRAMING_CLAUSES[framing]} ` +
    `Use ${LIGHTING_CLAUSES[lighting]}. ` +
    `A single subject only, centered, on a plain neutral light-gray seamless background — ` +
    `no other objects, no people, no props, no ground shadow on walls, no text, no watermark. ` +
    `Sharp focus, full subject clearly visible.` + correctiveClause +
    ` Respond with only the generated image.`
  );
}

/** Map geometry dropdown ids to Tripo task parameters. */
export function geometryToTripo(
  detailId?: string,
  textureId?: string
): { faceLimit: number; texture: boolean; pbr: boolean } {
  const faceLimit =
    detailId === "draft" ? 10000 :
    detailId === "standard" ? 25000 :
    detailId === "ultra" ? 60000 :
    40000; // high (default)

  if (textureId === "none") return { faceLimit, texture: false, pbr: false };
  if (textureId === "basic") return { faceLimit, texture: true, pbr: false };
  return { faceLimit, texture: true, pbr: true }; // pbr_detailed (default)
}
