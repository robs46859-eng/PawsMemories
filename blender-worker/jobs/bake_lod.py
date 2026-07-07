"""
blender-worker/jobs/bake_lod.py — AR_PET_SIM_SPEC §3.1 / §3.3

New blender-worker job "bake-lod": takes a Tripo-rigged GLB and produces a
mobile-budget GLB.

TODO(AR3):
  1. Import rigged GLB.
  2. Decimate to <= 30k triangles (reject-and-retry at higher decimation if over).
  3. Bake/atlas textures to a single 1024x1024.
  4. Rename bones to the canonical map (bonemap.json); validate 4 leg chains exist.
  5. Retarget the 15 existing clips onto the new skeleton (Rokoko-style mapping).
     If retarget confidence < bonemap.confidenceThreshold, fall back to Tripo's own
     walk/run/idle presets and log for manual review.
  6. Resample clips to 24 fps.
  7. Enforce hard budget: <= 30k tris, <= 40 bones, 1x1024^2 texture, <= 4 MB GLB.
  8. Export GLB and upload to Backblaze B2.

Budget constants (spec §3.3):
"""

MAX_TRIS = 30_000
MAX_BONES = 40
TEXTURE_SIZE = 1024
MAX_GLB_BYTES = 4 * 1024 * 1024
CLIP_FPS = 24


def bake_lod(input_glb_path: str, output_glb_path: str, bonemap_path: str) -> dict:
    """Return {tris, bones, bytes, retarget_confidence}. Raises if over budget after retry."""
    raise NotImplementedError("TODO(AR3): implement bake-lod pipeline")
