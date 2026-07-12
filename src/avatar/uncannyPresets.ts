export interface UncannyPreset {
  id: string;
  name: string;
  hint: string;
  material: {
    roughness: number;
    metalness: number;
    normalStrength: number;
    eyeBoost: number;
  };
}

export const uncannyPresets: UncannyPreset[] = [
  { id: "pixar_soft", name: "Pixar-soft", hint: "friendlier rounded features, softer eyes, less realism", material: { roughness: 0.86, metalness: 0.02, normalStrength: 0.35, eyeBoost: 1.2 } },
  { id: "clay", name: "Clay", hint: "warm clay texture, handmade, gentle surface detail", material: { roughness: 0.94, metalness: 0, normalStrength: 0.18, eyeBoost: 0.9 } },
  { id: "watercolor", name: "Watercolor", hint: "soft watercolor wash, lower contrast, tender expression", material: { roughness: 0.9, metalness: 0, normalStrength: 0.22, eyeBoost: 1 } },
  { id: "cartoon_eyes", name: "Cartoon eyes", hint: "larger brighter eyes, cute highlights, less uncanny gaze", material: { roughness: 0.82, metalness: 0.01, normalStrength: 0.28, eyeBoost: 1.5 } },
  { id: "fur_fluff", name: "Fur-fluff", hint: "fluffier fur silhouette, soft face mask, cozy styling", material: { roughness: 0.88, metalness: 0, normalStrength: 0.4, eyeBoost: 1.15 } },
  { id: "soft_focus", name: "Soft-focus", hint: "gentle focus, reduced shine, calmer face proportions", material: { roughness: 0.96, metalness: 0, normalStrength: 0.12, eyeBoost: 0.85 } },
];

export function buildUncannyRegenerationHint(presetId: string): string {
  const preset = uncannyPresets.find((item) => item.id === presetId);
  return preset ? `Uncanny rescue preset: ${preset.name}. Bias the next restyle toward ${preset.hint}.` : "";
}
