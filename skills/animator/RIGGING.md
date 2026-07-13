# RIGGING — Animator Build-Out Skill

## Purpose
Canonical rig conventions, BoneDefinitionProfile schema, validation rules, and worker API.

## Scope
Maps to ANIM-RIG-01..08 and ANIM-MESH-01/02 in SKILLS.md. This skill documents the standards; the actual implementation is done by later phases (Phase 3+).

---

## 1. Canonical Bone Names

| Bone | Description |
|------|-------------|
| `spine` | Torso chain root |
| `hip` | Hips center |
| `chest` | Upper torso |
| `neck` | Neck base |
| `head` | Head center |
| `jaw` | Jaw pivot |
| `tongue` | Tongue chain |
| `eye.L` / `eye.R` | Eye sockets |
| `brow.L` / `brow.R` | Brow joints |
| `ear.L` / `ear.R` | Ear tips |
| `shoulder.L` / `shoulder.R` | Shoulder pivot |
| `leg_front.L` / `leg_front.R` | Front upper leg |
| `leg_back.L` / `leg_back.R` | Back upper leg |
| `tail.01`..`tail.N` | Tail chain |

Digitigrade legs: optional `metatarsal.L`/`metatarsal.R` on the leg chains.

**Never rename bones without migrating every BoneDefinitionProfile and clip.**

---

## 2. BoneDefinitionProfile v1 Schema

```jsonc
{
  "id": "quadruped.dog.medium",
  "skeleton": "quadruped",
  "version": 1,
  "joints": { "hip": [0.5, 0.62, 0.18], "head": [0.5, 0.78, 0.92] },
  "twistBones": { "leg_front.L": 1, "leg_front.R": 1 },
  "boneMask": [],
  "rigidAttachments": [],
  "physics": [{ "bones": ["tail.*"], "type": "spring", "stiffness": 0.35, "damping": 0.8 }]
}
```

**Zod schema:** `server/animator/schemas.ts` — `BoneDefinitionProfileV1`.

**Profile loading:** `blender-worker/profiles/*.json`, served via `GET /api/animator/rig-profiles`.

---

## 3. Validation Rules (ANIM-RIG-04)

Each rule emits `{ rule, pass, detail }` in the job manifest.

| # | Rule | Description |
|---|------|-------------|
| 1 | `twist_bones_present` | Twist bones present on limb chains flagged in profile |
| 2 | `neck_jawline_parallel` | Neck joints parallel to jawline for protruding silhouettes |
| 3 | `silhouette_preservation` | Probe pose silhouette deviation < tolerance |
| 4 | `purlicue_biped` | Thumb base joint at index/thumb web intersection (biped only) |
| 5 | `weight_sanity` | No vertex > 4 influences; no island with zero weights |

---

## 4. Worker API (spec §4.8)

| Method | Path | Input | Output |
|--------|------|-------|--------|
| POST | `/rig` | `{ meshGlbUrl|base64, profileId?, options }` | `{ rigJobId }` |
| POST | `/retarget` | `{ riggedGlb, clipSet, boneMask? }` | `{ glbBase64, clips[] }` |
| POST | `/repurpose` | `{ riggedGlb, targetProfileId }` | `{ glbBase64, preserved: {facial:true} }` |
| GET | `/rig/:id` | — | `{ state, validation[], manifest }` |

**Phase 0 status:** Stubs return `501 NOT_IMPLEMENTED` (see `server/animator/routes.ts`).

---

## 5. Selective Rigging (ANIM-RIG-03)

- **Soft meshes:** body, cloth → auto skin weights
- **Rigid attachments:** collars, tags, armor → parent-attach to nearest bone, zero skinning
- Classifier: material-name globs + probe-pose deformation variance test

---

## 6. Constraints

- Octree depth ≤ 10 (Poisson reconstruction)
- Never rename canonical bones without migrating every profile and clip
- Output accepted only if all validation rules pass (ANIM-RIG-04)
- ML rigger fallback (UniRig/RigNet) gated by validation pass
