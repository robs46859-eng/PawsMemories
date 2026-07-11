# Blender Rigging Pipeline

The worker uses Blender scripts to apply skeletons and animations.

## Adding or Adjusting Clips
Quality of generated motions depends on the worker's Blender clip retargeting. If clips look stiff, the Blender bone mapping (`.py` script) must be adjusted, not the web app.

To add or adjust a clip:
- Keep the keyframe count optimized.
- Handle root-motion by keeping the main bone mapped correctly.
- Name the action exactly as the `SKELETON_CONTRACTS` test expects it (e.g. `idle`, `run`).
- The owner adds accuracy by editing the worker's bake list, not the frontend.
