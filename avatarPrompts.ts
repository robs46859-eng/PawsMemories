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
  `Full body visible with generous margin on all sides. Sharp focus, even soft studio lighting, plain neutral ` +
  `light-gray seamless background, no shadow on walls, no props, no people, no text, no watermark.`;

export const REFERENCE_STYLE_HUMAN =
  `Render the person as a premium Pixar-style stylized 3D character: soft appealing proportions, slightly enlarged ` +
  `expressive eyes, subsurface-scattered skin, and beautifully textured hair — like a frame from a modern animated ` +
  `feature film. ` +
  `Faithfully preserve the person's exact skin tone, hair color and style, facial structure, and clothing colors and patterns ` +
  `as seen across ALL reference photos. ` +
  `Pay EXTREME attention to FACIAL FEATURES: eye shape, color and spacing, nose shape and size, lip shape, ` +
  `jawline, cheekbones, eyebrow shape, forehead size, and any facial hair, wrinkles or distinguishing marks. ` +
  `The person is standing squarely on two legs in a neutral bipedal A-pose stance, arms slightly out to the sides, clearly separated from the torso, ` +
  `legs clearly separated, front-facing. ` +
  `The generated image must be BILATERALLY SYMMETRIC from the viewer's perspective — the left and right sides of ` +
  `the face and body should mirror each other for clean 3D reconstruction. ` +
  `Do NOT invent or add features not visible in the reference photos. If a detail is unclear, err on the side ` +
  `of the most common/neutral interpretation rather than adding something creative. ` +
  `Full body visible with generous margin on all sides. Sharp focus, even soft studio lighting, plain neutral ` +
  `light-gray seamless background, no shadow on walls, no props, no other people, no text, no watermark.`;

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

export function buildReferencePrompt(type: 'dog' | 'human', accent?: string | null, hasFacePhoto?: boolean, photoCount?: number): string {
  const accentClause = (accent && ACCENT_PROMPTS[accent]) || "";

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
      REFERENCE_STYLE_HUMAN + accentClause + ` Respond with only the generated image.`
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

export function turnaroundViewsForType(type: 'dog' | 'human'): { view: "left" | "back" | "right"; prompt: string }[] {
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

export function paletteLockClause(type: 'dog' | 'human', palette: string | null): string {
  const subject = type === 'human' ? 'human' : 'pet';
  const detail = type === 'human' ? 'skin, hair, clothing colours' : 'fur colours, markings';
  return (
    ` Character turnaround sheet consistency: IDENTICAL ${detail}, proportions and texture across every view.` +
    (palette
      ? ` The ${subject}'s colours MUST match this exact palette: ${palette}. Do not shift, desaturate or recolour anything.`
      : ``)
  );
}

export function extractPaletteInstruction(type: 'dog' | 'human'): string {
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
  { id: "auto",       label: "Auto (let AI decide)", recommended: true, hint: "Best for arbitrary images — the generator picks the most fitting style" },
  { id: "pixar",      label: "Pixar / animated feature" },
  { id: "realistic",  label: "Photorealistic" },
  { id: "claymation", label: "Claymation / clay" },
  { id: "plush",      label: "Plush / stuffed toy" },
  { id: "vinyl",      label: "Vinyl / designer figure" },
  { id: "lowpoly",    label: "Low-poly / retro" },
  { id: "celshaded",  label: "Cel-shaded / anime" },
  { id: "voxel",      label: "Voxel / blocky" },
  { id: "papercraft", label: "Papercraft / origami" },
  { id: "wood",       label: "Carved wood toy" },
  { id: "chibi",      label: "Chibi / super-deformed" },
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

const STYLE_CLAUSES: Record<string, string> = {
  auto:       `a clean, well-lit 3D-reconstruction-friendly render with clear surface details and accurate proportions`,
  pixar:      `a premium Pixar-style stylized 3D character — soft appealing proportions, slightly enlarged expressive eyes, subsurface-scattered skin, richly textured surfaces, like a frame from a modern animated feature film`,
  realistic:  `a photorealistic, highly detailed 3D render with physically accurate materials, natural proportions and lifelike surface detail`,
  claymation: `a claymation / stop-motion clay figure with soft matte modeling-clay surfaces, gentle fingerprints and hand-sculpted charm`,
  plush:      `a soft plush stuffed toy with visible fabric texture, stitched seams, button-style eyes and rounded cuddly proportions`,
  vinyl:      `a glossy vinyl designer collectible figure with smooth clean surfaces, bold simplified forms and a subtle sheen`,
  lowpoly:    `a stylized low-poly model with clean flat-shaded faceted surfaces and bold simplified geometry`,
  celshaded:  `a cel-shaded anime-style character with clean flat colours, crisp ink outlines and simple hard-edged shading`,
  voxel:      `a blocky voxel-art character built from cubic blocks, like a high-resolution 3D pixel sculpture`,
  papercraft: `a papercraft / low-poly origami figure made of folded flat paper panels with visible fold creases`,
  wood:       `a hand-carved wooden toy figure with visible wood grain, smooth rounded whittled forms and a warm matte finish`,
  chibi:      `a chibi / super-deformed character with an oversized head, tiny body, big eyes and adorable exaggerated proportions`,
};

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

  return (
    `Generate ONE image of ${subject}, rendered as ${STYLE_CLAUSES[style]}. ` +
    `The subject is ${ANGLE_CLAUSES[angle]}. ` +
    `${FRAMING_CLAUSES[framing]} ` +
    `Use ${LIGHTING_CLAUSES[lighting]}. ` +
    `A single subject only, centered, on a plain neutral light-gray seamless background — ` +
    `no other objects, no people, no props, no ground shadow on walls, no text, no watermark. ` +
    `Sharp focus, full subject clearly visible. Respond with only the generated image.`
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
