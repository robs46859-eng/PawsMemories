/**
 * Single source of truth for pet photo backgrounds.
 *
 * Used by both the frontend (src/components/EditMemory.tsx renders the picker)
 * and the backend (server.ts builds the AI prompt). Each background carries:
 *   - value:    stable id sent to the API and stored on creations
 *   - label:    display name
 *   - category: grouping for the picker UI
 *   - emoji:    icon shown on the card (no external images = nothing to break)
 *   - gradient: Tailwind classes for the card background
 *   - prompt:   the sentence appended to the AI image prompt on the server
 *
 * To add a background, add one entry here — the UI and the server pick it up
 * automatically.
 */

export type BackgroundCategory =
  | "Landmarks"
  | "Nature"
  | "Cozy & Seasonal"
  | "Fantasy & Fun"
  | "For Business";

export interface Background {
  value: string;
  label: string;
  category: BackgroundCategory;
  emoji: string;
  gradient: string; // tailwind gradient utility classes
  prompt: string;
}

export const BACKGROUNDS: Background[] = [
  // ---------------------------------------------------------------- Landmarks
  {
    value: "Paris",
    label: "Paris",
    category: "Landmarks",
    emoji: "🗼",
    gradient: "from-rose-300 to-indigo-300",
    prompt:
      "The pet is sitting in a Paris park with the beautiful Eiffel Tower visible in the background, surrounded by blossoming pink cherry blossoms with delicate petals falling.",
  },
  {
    value: "London",
    label: "London",
    category: "Landmarks",
    emoji: "🇬🇧",
    gradient: "from-slate-300 to-red-300",
    prompt:
      "The pet is sitting by the River Thames in London with Big Ben and the Houses of Parliament rising behind it, a classic red double-decker bus passing by under a soft overcast sky.",
  },
  {
    value: "NewYork",
    label: "New York",
    category: "Landmarks",
    emoji: "🗽",
    gradient: "from-sky-300 to-emerald-300",
    prompt:
      "The pet is posed in front of the Statue of Liberty in New York harbor, the Manhattan skyline glittering across the water at golden hour.",
  },
  {
    value: "Rome",
    label: "Rome",
    category: "Landmarks",
    emoji: "🏛️",
    gradient: "from-amber-300 to-orange-300",
    prompt:
      "The pet is sitting in front of the ancient Roman Colosseum in Rome, warm Mediterranean sunlight on weathered stone and cypress trees.",
  },
  {
    value: "Tokyo",
    label: "Tokyo",
    category: "Landmarks",
    emoji: "🏯",
    gradient: "from-fuchsia-300 to-rose-300",
    prompt:
      "The pet is on a Tokyo street glowing with colorful neon signs at night, cherry blossoms and a distant pagoda adding a magical Japanese atmosphere.",
  },
  {
    value: "Egypt",
    label: "Egypt",
    category: "Landmarks",
    emoji: "🐪",
    gradient: "from-yellow-300 to-amber-400",
    prompt:
      "The pet is standing on golden desert sand in front of the Great Pyramids of Giza and the Sphinx in Egypt, under a vast warm sunset sky.",
  },
  {
    value: "GoldenGate",
    label: "Golden Gate",
    category: "Landmarks",
    emoji: "🌉",
    gradient: "from-orange-300 to-red-400",
    prompt:
      "The pet is posed on a green overlook with the iconic red-orange Golden Gate Bridge in San Francisco behind it, soft coastal fog rolling through the hills.",
  },
  {
    value: "Rocky",
    label: "Philly Steps",
    category: "Landmarks",
    emoji: "🥊",
    gradient: "from-stone-300 to-amber-300",
    prompt:
      "The pet is standing triumphantly at the top of the grand steps of the Philadelphia Museum of Art beside the famous Rocky Balboa statue, heroic and proud.",
  },
  {
    value: "TajMahal",
    label: "Taj Mahal",
    category: "Landmarks",
    emoji: "🕌",
    gradient: "from-pink-200 to-amber-200",
    prompt:
      "The pet is sitting in the symmetrical gardens before the gleaming white marble Taj Mahal in India, reflecting pools and soft dawn light all around.",
  },

  // ------------------------------------------------------------------- Nature
  {
    value: "Canyon",
    label: "Grand Canyon",
    category: "Nature",
    emoji: "🏜️",
    gradient: "from-orange-400 to-red-400",
    prompt:
      "The pet is sitting in front of the majestic Grand Canyon National Park with its vast layered reddish-orange cliffs, dramatic canyon valley, and a flowing green river far below under a glowing warm morning sun.",
  },
  {
    value: "Meadow",
    label: "Flower Meadow",
    category: "Nature",
    emoji: "🌼",
    gradient: "from-lime-300 to-emerald-300",
    prompt:
      "The setting is a lush sun-drenched green flower garden during golden hour with sparkling wildflowers and beautiful bokeh effects.",
  },
  {
    value: "Beach",
    label: "Tropical Beach",
    category: "Nature",
    emoji: "🏖️",
    gradient: "from-cyan-300 to-amber-200",
    prompt:
      "The pet is on a tropical white-sand beach with turquoise waves, swaying palm trees, and a warm golden sunset over the ocean.",
  },
  {
    value: "Mountains",
    label: "Snowy Peaks",
    category: "Nature",
    emoji: "🏔️",
    gradient: "from-sky-200 to-slate-300",
    prompt:
      "The pet is sitting in fresh snow before a backdrop of dramatic snow-capped mountain peaks and crisp blue alpine sky.",
  },
  {
    value: "Autumn",
    label: "Autumn Forest",
    category: "Nature",
    emoji: "🍂",
    gradient: "from-orange-300 to-amber-400",
    prompt:
      "The pet is in a cozy autumn forest with golden, orange, and red falling leaves, warm dappled afternoon light filtering through the trees.",
  },
  {
    value: "Waterfall",
    label: "Waterfall",
    category: "Nature",
    emoji: "💦",
    gradient: "from-teal-300 to-green-300",
    prompt:
      "The pet is beside a lush tropical waterfall cascading into a clear emerald pool, surrounded by ferns and mist with rays of sunlight.",
  },
  {
    value: "Lavender",
    label: "Lavender Field",
    category: "Nature",
    emoji: "💜",
    gradient: "from-purple-300 to-violet-300",
    prompt:
      "The pet is sitting in endless rows of blooming purple lavender fields in Provence at golden hour, soft warm light and a dreamy haze.",
  },
  {
    value: "CherryBlossom",
    label: "Cherry Blossoms",
    category: "Nature",
    emoji: "🌸",
    gradient: "from-pink-200 to-rose-300",
    prompt:
      "The pet is beneath blooming cherry blossom trees with soft pink petals gently drifting through the air on a bright spring day.",
  },

  // -------------------------------------------------------- Cozy & Seasonal
  {
    value: "Cabin",
    label: "Cozy Cabin",
    category: "Cozy & Seasonal",
    emoji: "🛖",
    gradient: "from-emerald-300 to-teal-400",
    prompt:
      "The pet is in front of a cozy warm-lit rustic wooden log cabin in a snowy evergreen pine forest, with a brilliant magical aurora borealis glowing in the night sky.",
  },
  {
    value: "Christmas",
    label: "Christmas",
    category: "Cozy & Seasonal",
    emoji: "🎄",
    gradient: "from-red-300 to-green-400",
    prompt:
      "The pet is beside a glowing Christmas tree and a warm crackling fireplace with stockings, twinkling fairy lights, and wrapped presents all around.",
  },
  {
    value: "Halloween",
    label: "Halloween",
    category: "Cozy & Seasonal",
    emoji: "🎃",
    gradient: "from-orange-400 to-purple-500",
    prompt:
      "The pet is in a spooky-but-cute Halloween scene with carved glowing jack-o'-lanterns, autumn leaves, and a misty full-moon night sky.",
  },
  {
    value: "SpringGarden",
    label: "Spring Garden",
    category: "Cozy & Seasonal",
    emoji: "🌷",
    gradient: "from-pink-200 to-lime-200",
    prompt:
      "The pet is in a charming blooming spring garden full of tulips, daffodils, and butterflies under a bright cheerful blue sky.",
  },
  {
    value: "Bookshop",
    label: "Cozy Bookshop",
    category: "Cozy & Seasonal",
    emoji: "📚",
    gradient: "from-amber-300 to-orange-300",
    prompt:
      "The pet is curled up in a cozy vintage bookshop with tall warm-lit wooden shelves of books, a soft armchair, and a gentle reading-lamp glow.",
  },
  {
    value: "Birthday",
    label: "Birthday Party",
    category: "Cozy & Seasonal",
    emoji: "🎂",
    gradient: "from-fuchsia-300 to-yellow-300",
    prompt:
      "The pet is at a festive birthday party with colorful balloons, streamers, confetti, and a decorated cake, joyful and celebratory.",
  },

  // ---------------------------------------------------------- Fantasy & Fun
  {
    value: "Space",
    label: "Outer Space",
    category: "Fantasy & Fun",
    emoji: "🚀",
    gradient: "from-indigo-500 to-purple-600",
    prompt:
      "The pet is floating in outer space among glowing stars, colorful nebulae, and distant planets, wearing a whimsical astronaut vibe.",
  },
  {
    value: "Underwater",
    label: "Underwater",
    category: "Fantasy & Fun",
    emoji: "🐠",
    gradient: "from-cyan-400 to-blue-500",
    prompt:
      "The pet is in a magical underwater coral reef scene with colorful fish, swaying sea plants, and shimmering rays of sunlight through turquoise water.",
  },
  {
    value: "Castle",
    label: "Fairytale Castle",
    category: "Fantasy & Fun",
    emoji: "🏰",
    gradient: "from-violet-300 to-sky-300",
    prompt:
      "The pet is before a majestic fairytale castle with soaring turrets on a hill, surrounded by a dreamy storybook landscape and soft magical light.",
  },
  {
    value: "Rainbow",
    label: "Rainbow Clouds",
    category: "Fantasy & Fun",
    emoji: "🌈",
    gradient: "from-pink-300 via-yellow-200 to-sky-300",
    prompt:
      "The pet is floating on fluffy pastel clouds with a vivid rainbow arcing across a dreamy candy-colored sky.",
  },
  {
    value: "Enchanted",
    label: "Enchanted Forest",
    category: "Fantasy & Fun",
    emoji: "🍄",
    gradient: "from-emerald-400 to-purple-400",
    prompt:
      "The pet is in a glowing enchanted forest with bioluminescent mushrooms, sparkling fireflies, twisting ancient trees, and soft magical mist.",
  },
  {
    value: "Superhero",
    label: "Superhero City",
    category: "Fantasy & Fun",
    emoji: "🦸",
    gradient: "from-blue-400 to-red-400",
    prompt:
      "The pet is posed heroically on a rooftop above a dramatic comic-book city skyline at dusk, cape-worthy and bold, with dynamic superhero lighting.",
  },

  // ------------------------------------------------------------ For Business
  {
    value: "DogDaycare",
    label: "Dog Daycare",
    category: "For Business",
    emoji: "🐾",
    gradient: "from-sky-300 to-lime-300",
    prompt:
      "The pet is in a bright, clean, modern dog daycare play area with colorful toys, soft play mats, a sunny fenced yard visible through large windows, and a cheerful welcoming atmosphere.",
  },
  {
    value: "VetClinic",
    label: "Vet Clinic",
    category: "For Business",
    emoji: "🩺",
    gradient: "from-teal-200 to-sky-300",
    prompt:
      "The pet is in a friendly, spotless modern veterinary clinic exam room with soft lighting, calm pastel walls, and a reassuring caring atmosphere.",
  },
  {
    value: "Grooming",
    label: "Grooming Salon",
    category: "For Business",
    emoji: "✂️",
    gradient: "from-pink-200 to-fuchsia-300",
    prompt:
      "The pet looks freshly pampered in a chic pet grooming salon with a tidy grooming station, soft towels, bubbles, and a stylish boutique feel.",
  },
  {
    value: "PetStore",
    label: "Pet Store",
    category: "For Business",
    emoji: "🛍️",
    gradient: "from-amber-200 to-orange-300",
    prompt:
      "The pet is in a welcoming modern pet store aisle with neatly stocked shelves of toys, treats, and supplies, bright friendly retail lighting.",
  },
  {
    value: "DogPark",
    label: "Dog Park",
    category: "For Business",
    emoji: "🌳",
    gradient: "from-green-300 to-emerald-400",
    prompt:
      "The pet is in a sunny green community dog park with open grass, agility equipment, a blue sky, and other happy dogs playing in the background.",
  },
];

/** Ordered list of categories for the picker UI. */
export const BACKGROUND_CATEGORIES: BackgroundCategory[] = [
  "Landmarks",
  "Nature",
  "Cozy & Seasonal",
  "Fantasy & Fun",
  "For Business",
];

/** Map of background value -> AI prompt sentence (used by the server). */
export const BACKGROUND_PROMPTS: Record<string, string> = Object.fromEntries(
  BACKGROUNDS.map((b) => [b.value, b.prompt])
);

/** Default fallback when an unknown background value is received. */
export const DEFAULT_BACKGROUND_PROMPT = BACKGROUND_PROMPTS["Meadow"];

/** Look up a background definition by its value. */
export function getBackground(value: string): Background | undefined {
  return BACKGROUNDS.find((b) => b.value === value);
}
