export const REFERENCE_STYLE_DOG =
  `Render the pet as a premium Pixar-style stylized 3D character: soft appealing proportions, slightly enlarged ` +
  `expressive eyes, subsurface-scattered skin/nose, and RICHLY TEXTURED groomed fur with visible individual strand ` +
  `clumps, whiskers, and natural sheen — like a frame from a modern animated feature film. ` +
  `Faithfully preserve the pet's exact fur colors, markings, patterns, eye color, ear shape, and breed ` +
  `characteristics as seen across ALL reference photos. ` +
  `The pet is standing squarely on all four legs in a neutral A-pose stance, legs clearly separated, tail clearly ` +
  `visible and separated from the body, mouth slightly open in a gentle relaxed panting expression. ` +
  `Full body visible with generous margin on all sides. Sharp focus, even soft studio lighting, plain neutral ` +
  `light-gray seamless background, no shadow on walls, no props, no people, no text, no watermark.`;

export const REFERENCE_STYLE_HUMAN =
  `Render the person as a premium Pixar-style stylized 3D character: soft appealing proportions, slightly enlarged ` +
  `expressive eyes, subsurface-scattered skin, and beautifully textured hair — like a frame from a modern animated ` +
  `feature film. ` +
  `Faithfully preserve the person's exact skin tone, hair color and style, facial structure, and clothing colors and patterns ` +
  `as seen across ALL reference photos. ` +
  `The person is standing squarely on two legs in a neutral bipedal A-pose stance, arms slightly out to the sides, ` +
  `legs clearly separated, front-facing. ` +
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

export function buildReferencePrompt(type: 'dog' | 'human', accent?: string | null): string {
  const accentClause = (accent && ACCENT_PROMPTS[accent]) || "";
  if (type === 'human') {
    return (
      `You are given one or more reference photos, all of the SAME person. ` +
      `Generate ONE image of this exact person seen DIRECTLY FROM THE FRONT (head and body facing straight toward the camera). ` +
      REFERENCE_STYLE_HUMAN + accentClause + ` Respond with only the generated image.`
    );
  } else {
    return (
      `You are given one or more reference photos, all of the SAME pet. ` +
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
