/**
 * Single source of truth for Veo video motion presets.
 *
 * Each preset maps to a `motionPrompt` string sent to the Veo model.
 * The prompts are written to produce authentic, naturalistic animal
 * behaviour — running, playing, vocalising — with matching camera work.
 *
 * To add a preset: add one entry here. The picker in EditMemory picks it up automatically.
 */

export interface MotionPreset {
  value: string;
  label: string;
  emoji: string;
  description: string; // Short hint shown under the card
  prompt: string;      // Full text sent to Veo
}

export const MOTION_PRESETS: MotionPreset[] = [
  // ── Active / Playful ─────────────────────────────────────────────────────
  {
    value: "zoomies",
    label: "Zoomies!",
    emoji: "💨",
    description: "Full-speed laps, ears back",
    prompt:
      "The animal bursts into full-speed zoomies — sprinting in joyful wide circles, ears pinned back, paws a blur, tail whipping, kicking up dust and blades of grass. Camera tracks the action with a wide dynamic follow-shot, then cuts to a slow-motion close-up of the ecstatic, tongue-out face mid-run. High energy, pure joy.",
  },
  {
    value: "fetch_run",
    label: "Fetch Run",
    emoji: "🎾",
    description: "Chasing and retrieving a ball",
    prompt:
      "A ball or toy is thrown and the animal launches into a powerful, athletic run — leaping, paws stretching, body fully extended mid-air — then scoops it up in its mouth and bounds back proudly. Dynamic follow-camera, slow-motion freeze at peak jump. Playful and triumphant.",
  },
  {
    value: "tug_of_war",
    label: "Tug-of-War",
    emoji: "🦴",
    description: "Wrestling and tugging at a toy",
    prompt:
      "The animal grabs a rope toy or bone and plays intense tug-of-war — planting all four paws, shaking its head side to side vigorously, growling playfully with deep rumbling vocalisations, eyes bright with excitement. Tight close-up on its determined face and paws, then a wide shot showing the full playful struggle.",
  },
  {
    value: "pounce_play",
    label: "Pounce & Play",
    emoji: "🐾",
    description: "Stalks then pounces on a toy",
    prompt:
      "The animal crouches in a low stalking stance, ears forward, eyes locked on a toy. It wiggles its haunches with anticipation then explodes into a perfect pounce — landing on the toy with both paws, rolling playfully. Camera starts with a dramatic low-angle stalk perspective, then cuts to overhead slow-mo of the pounce.",
  },

  // ── Vocal ─────────────────────────────────────────────────────────────────
  {
    value: "big_bark",
    label: "Big Bark",
    emoji: "📣",
    description: "Loud, proud barking performance",
    prompt:
      "The animal stands proudly and delivers a series of big, booming barks — chest puffed, whole body vibrating with each bark, jowls rippling, ears perked. The sound waves seem to radiate outward. Camera circles dramatically from a low angle, cutting to an extreme close-up of the barking muzzle with visible breath on a crisp morning.",
  },
  {
    value: "howl",
    label: "Howl",
    emoji: "🌕",
    description: "Head-back dramatic howl",
    prompt:
      "The animal tilts its head back slowly, eyes half-closing, then opens into a long, soulful howl — neck stretched, throat vibrating, sound waves visible in the air. The howl trails off into silence. Cinematic wide shot with moonlight or golden-hour rim lighting. Slow, dramatic, majestic.",
  },
  {
    value: "growl_guard",
    label: "Guard Growl",
    emoji: "😤",
    description: "Protective low growl stance",
    prompt:
      "The animal lowers its head, hackles subtly rising, and emits a deep protective growl — lips peeling back just slightly to reveal teeth, weight shifting forward onto its front paws. Intense and dramatic low-angle camera. Then it relaxes and wags its tail, revealing the playful guardian personality. Moody cinematic lighting.",
  },
  {
    value: "chatty_whine",
    label: "Chatty & Whining",
    emoji: "💬",
    description: "Talking back with wiggles",
    prompt:
      "The animal is being extra communicative — whining, yipping, tilting its head side to side with one ear up and one down, tail wagging, front paws dancing. It seems to be trying to say something important. Warm, funny, endearing close-up with a slight dolly push-in. Soft natural lighting, cozy tone.",
  },

  // ── Calm / Signature ─────────────────────────────────────────────────────
  {
    value: "nose_sniff",
    label: "Explorer Sniff",
    emoji: "👃",
    description: "Investigating every smell",
    prompt:
      "The animal moves with nose glued to the ground, sniffing in rapid intense bursts, tail held high, following an invisible scent trail. It pauses, looks up alertly, then dives back into sniffing. Tracking camera follows at ground level, giving an immersive dog's-eye-view perspective. Light breeze, lush environment.",
  },
  {
    value: "happy_tail",
    label: "Happy Tail Spin",
    emoji: "🌀",
    description: "Tail wagging so hard the body wiggles",
    prompt:
      "The animal's tail wags so furiously its whole rear end sways rhythmically from side to side in a full-body wiggle. It trots toward the camera with pure elation, then does a full spin and sits down looking up with bright eyes and a lolling smile. Warm golden-hour light, slow-motion tail close-up.",
  },
  {
    value: "leap_jump",
    label: "Big Leap",
    emoji: "🏃",
    description: "Flying leap over grass or water",
    prompt:
      "The animal gallops at full speed toward a ditch, puddle, or low log and launches into a soaring leap — body fully extended, ears flying, a perfect athletic arc through the air — then lands with a soft thud and immediately spins back with a proud look. Ultra-slow-motion capture of the airborne moment, then real-time playback.",
  },
  {
    value: "shake_off",
    label: "Shake It Off",
    emoji: "💦",
    description: "Full-body water shake in slow-mo",
    prompt:
      "Fresh from a splash or bath, the animal plants its paws and erupts into a vigorous full-body shake — water droplets flying outward in a dramatic halo of slow-motion droplets catching the light like diamonds. Then it looks up, ears flapping, satisfied. Ultra-slow-motion droplet close-up, cinematic.",
  },
];

/** Default motion preset used when none is selected. */
export const DEFAULT_MOTION_PRESET = MOTION_PRESETS[0]; // Zoomies

/** Look up a preset by value. */
export function getMotionPreset(value: string): MotionPreset | undefined {
  return MOTION_PRESETS.find((p) => p.value === value);
}
