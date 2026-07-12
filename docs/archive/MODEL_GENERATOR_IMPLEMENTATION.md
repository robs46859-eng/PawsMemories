# Model Generator — Implementation & Step-by-Step Review

**Scope:** the 3D model generator behind `pawsome3d.com` (the "Create 3D Model" dialog → `/api/avatars` → Tripo3D → rig/build pipeline).
**Reviewed against:** deployed commit `46742c7` ("Merge 3D Studio into Models tab, backend validation and credit deductions") — this matches current `HEAD` and the `pawsome3d-deploy.zip` shipped to Hostinger.
**Goal of this doc:** (1) describe exactly what the generator does today, step by step; (2) call out the gaps versus the desired flow; (3) specify the target implementation — **prompt → high-quality image → qualify the image → type-aware 3D generation (human / animal / static)**.

---

## 1. Desired flow (target)

```
User input (image OR text)
        │
        ▼
[1] Generate a high-quality reference image
        │
        ▼
[2] QUALIFY the image  ◄── (currently MISSING)
        │   pass?
        ├── no ──► regenerate (bounded retries) ──► still fail? ► stop, refund, clear error
        │   yes
        ▼
[3] Decide subject class:  HUMAN │ ANIMAL │ STATIC OBJECT   ◄── (currently PARTIAL / inconsistent)
        │
        ▼
[4] Start 3D generation (Tripo) with class-appropriate settings
        │
        ▼
[5] Post-process by class:
        HUMAN  → humanoid rig + brain + clips
        ANIMAL → quadruped rig + brain + clips
        STATIC → NO rig, NO brain — store the GLB as-is   ◄── (currently NOT enforced)
```

The two boxes marked "currently missing / not enforced" are the substance of the work below.

---

## 2. What the generator does TODAY (as deployed)

### 2.1 Entry points

- **Frontend:** `src/components/CreateAvatarDialog.tsx`
  - Two input modes: **Upload Photos** (`image`) and **Text Prompt** (`text`).
  - Three subject types via segmented control: **🐕 Dog**, **🧑 Human**, **🧊 Object** → `avatarType: 'dog' | 'human' | 'object'`.
  - Info banner already promises the intended behaviour:
    - `object` → *"Generate a static GLB 3D model. No rigging or animations will be applied."*
    - dog/human → *"Generate a fully rigged and animated 3D character…"*
  - Shared styling options (`style`, `framing`, `angle`, `lighting`, `geoDetail`, `geoTexture`) plus optional `palette`.
  - Submits to `POST /api/avatars` via `src/api.ts`.

- **Backend:** `server.ts` → `app.post("/api/avatars", …)` (approx. lines 816–948).

### 2.2 Step-by-step (backend)

**Step 0 — Guard & credits.** Requires `name`; non-admins must hold ≥ 400 credits. Credits are deducted (400) *after* the reference image is prepared but *before* the Tripo job starts.

**Step 1 — Produce the front reference image.** Two paths depending on `input_mode`:

- **Text mode** (`input_mode === "text"`):
  1. Validate `subject` (2–600 chars).
  2. `buildTextPrompt({ subject, style, lighting })` (`avatarPrompts.ts`) assembles a 3D-safe Gemini prompt from the dropdown ids (style/framing/angle/lighting clauses).
  3. `generateImageWithFallback([{text: prompt}], "text-to-reference")` → Gemini `gemini-2.5-flash-image`, falling back to `gemini-2.0-flash-exp`, 1:1 aspect.
  4. On success → `uploadBase64Image` → `finalImageUrl`. On failure → **502**, "Could not generate a reference image."

- **Image mode** (default):
  1. Collect `photos[]` (1–6; optional dedicated `face_photo` as slot 0).
  2. **Layer 1 — fuse to one front reference:** `generatePetReferenceImage(photoList, accent, avatarType, hasFacePhoto)` labels each photo (`[FACE CLOSE-UP]` / `[REFERENCE PHOTO n]`), builds a prompt via `buildReferencePrompt(type, …)`, and calls Gemini image models. Produces one Pixar-style, bilaterally-symmetric, A-pose front view.
  3. **If reference gen fails → silent fallback** to the first raw uploaded photo (`usedReferenceImage = false`). *(No quality gate — see §3.)*
  4. **Layer 1.5 — multiview turnaround (DOG ONLY):** if `avatarType === 'dog'` and we have a generated `data:image` reference:
     - `extractPalette()` → short comma-separated colour descriptor (Gemini vision).
     - `generateTurnaroundViews()` → left / back / right views, each with a **palette-lock clause** so colours don't drift (colour drift is the #1 multiview-to-3D failure).
     - Uploaded views become `viewSet`.
  5. Upload the front reference → `finalImageUrl`. Persist uploaded photos to the user's library (fire-and-forget).

**Step 2 — Geometry params.** `geometryToTripo(detail, texture)` maps dropdown ids → `{ faceLimit, texture, pbr }` (draft 10k / standard 25k / high 40k / ultra 60k; pbr_detailed / basic / none).

**Step 3 — Start Tripo 3D.** `startImageTo3D({ imageUrl, views, geometry })` (`tripo.ts`):
- If `viewSet` present → `multiview_to_model` with fixed slot order **[FRONT, LEFT, BACK, RIGHT]** (missing slots sent as `{}`).
- Else → `image_to_model` from the single front image.
- Shared flags: `texture_quality:"detailed"`, `texture_alignment:"original_image"`, `face_limit` (default 40k). Returns a `tripo:<task_id>` handle.

**Step 4 — Persist.** `createAvatar(...)` stores the row with the handle, `generation_status = 'pending'`; response returns `{ avatarId, status:"pending", referenceImageUrl, usedReferenceImage }`.

**Step 5 — Poll & build.** `GET /api/avatars/:id/status`:
- Polls Tripo (`pollImageTo3D`). While running → `pending`.
- On Tripo success → status flips to `rigging` and a background pipeline runs:
  - `analyzePetImage(originalImageBase64)` (`ollama-agent.ts`) → anatomy JSON for rigging.
  - If `avatar_type === 'human'` → force `{ species:'human', bodyType:'biped', legCount:2, hasTail:false }`.
  - `runBuildPipeline(...)` → auto-rig, sprite sheet, animation metadata; then Phase 5 best-effort Blender skeletal-clip baking (`bakeClipsAndWait({ avatarType })`).
  - Terminal states `done` / `failed`.
- Rig endpoint `startRig(taskId, { avatarType })` picks `spec:"humanoid"` for human, else `spec:"tripo"` (quadruped). Retarget confidence threshold differs (human 0.85 vs 0.7).

### 2.3 Where each type is (and isn't) handled today

| Concern | Dog (animal) | Human | Object (static) |
|---|---|---|---|
| Reference prompt | `REFERENCE_STYLE_DOG` | `REFERENCE_STYLE_HUMAN` | **falls through to dog prompt** (`buildReferencePrompt` only branches `human` vs else) |
| Multiview turnaround | ✅ yes | ❌ single-image (intentional, commit `7a380b4`) | ❌ none |
| `analyzePetImage` | ✅ | ✅ (then overridden to human) | ⚠️ **runs — treats the object as an animal** |
| Rig | quadruped | humanoid | ⚠️ **still rigged — UI promises "no rigging"** |
| Brain / clips | ✅ | ✅ | ⚠️ **applied anyway** |

---

## 3. Gaps vs. the desired flow

### G1 — No image-qualification gate (the "qualify the image" step is missing)
There is **no** QC anywhere between image generation and Tripo submission (confirmed: no `qualify` / quality-check / image-assessment code in `server.ts`, `avatarPrompts.ts`, or `server/`). Consequences:
- A failed reference generation **silently falls back to the raw uploaded photo** — often a casual, cluttered, non-A-pose shot that reconstructs into a poor mesh.
- Bad-but-non-empty Gemini outputs (wrong subject, cropped body, heavy baked shadows, multiple subjects, watermark) go straight to Tripo, **burning Tripo credits** on a doomed job.
- No feedback loop: we never regenerate on a weak image.

### G2 — `object` / static is not a first-class path
- Backend function signatures are typed `'dog' | 'human'`; `object` is passed as `avatar_type as any`.
- `buildReferencePrompt` has no `object` branch → objects get the **dog** styling prompt (adds fur, "panting expression", A-pose on "all four legs").
- The build/status pipeline **always rigs** — `object` is analyzed by `analyzePetImage` and sent through `runBuildPipeline`, contradicting the UI's "no rigging or animations."

### G3 — Type awareness is implicit and scattered
The human/animal/static decision is spread across `avatarType === 'dog'` checks, `=== 'human'` overrides, and a UI hint — there is no single routing function or persisted "class" that the whole pipeline reads.

### G4 — Qualification can't be type-blind
"A good image" differs by class: an **animal** wants full body + tail visible on 4 legs; a **human** wants a bipedal A-pose with separated arms; a **static object** wants the whole object, clean silhouette, no invented anatomy. The gate in G1 must know the class from G2/G3.

---

## 4. Target implementation

### 4.1 Establish a single subject class (fixes G2, G3)

Introduce one canonical type used end-to-end:

```ts
export type SubjectClass = 'animal' | 'human' | 'object';
```

- Map the existing UI value at the edge: `'dog' → 'animal'`, `'human' → 'human'`, `'object' → 'object'` (keep `dog` on the wire for backward-compat; normalize on entry to `/api/avatars`).
- Persist it on the avatar row (reuse/extend `avatar_type`) so the **status/build** stage reads the same class without re-guessing.
- Replace `'dog' | 'human'` signatures in `avatarPrompts.ts`, `tripo.ts` (`startRig`), and the build pipeline with `SubjectClass`, adding the `object` branch everywhere there's currently an `else`.

**Prompting per class** (`buildReferencePrompt` / `buildTextPrompt`):
- `animal` → existing `REFERENCE_STYLE_DOG`.
- `human` → existing `REFERENCE_STYLE_HUMAN`.
- `object` → **new** `REFERENCE_STYLE_OBJECT` (front) + **new** object turnaround set:
  - *Front:* "Render this single object as a clean, well-lit 3D-reconstruction-friendly image. Preserve the object's exact real colours, materials, and proportions. The whole object is visible, centered, upright in its natural resting orientation, with generous margin on all sides. Even soft studio lighting, no harsh shadows or baked highlights, plain neutral light-gray seamless background. **Do NOT anthropomorphise: add no face, eyes, limbs, tail, or expression. Invent no parts that aren't on the real object.** No other objects, no hands, no people, no props, no text, no watermark. Respond with only the generated image."
  - *Turnaround (left/back/right):* same object, same style/lighting/background, rotated to a perfect left-profile / rear / right-profile — **no invented back detail**; if the rear is genuinely featureless, keep it plausibly plain.
  - `paletteLockClause('object', …)` locks materials/colours across views (no fur/skin wording).

**Class-definition rubric (used by both the detector and the qualifier — see §8).** Giving the model an explicit positive/negative definition of each class is what makes object detection reliable (it stops "a plush dog toy" or "a statue of a person" from being mis-rigged):

- **HUMAN** — a real person or clearly human character: one head, two arms, two legs, hands, human face and skin/hair. *Not:* a doll, mannequin, action figure, statue, or costume of a person (those are **object**), and not an animal.
- **ANIMAL** — a living (or lifelike) creature with animal anatomy: a body on legs (usually four), a head with muzzle/snout or beak, fur/feathers/scales, typically a tail. Dogs, cats, birds, rabbits, etc. *Not:* a plush/toy/figurine/statue of an animal (those are **object**), and not a human.
- **OBJECT (static)** — anything that is not a live human or animal: props, furniture, vehicles, toys, food, plants, gadgets — **including toys/figurines/statues that depict a human or animal.** The test is "is this a living subject we should rig and animate, or an inanimate thing?" If inanimate → object, even if it's shaped like a dog.

The detector returns the class **and a short reason**; the qualifier applies the matching criteria set (full-body-on-legs for animal, bipedal A-pose for human, whole-object-visible for object).

### 4.2 Add the qualification gate (fixes G1, G4)

Insert **between Step 1 (image ready) and Step 3 (Tripo submit)**, before credits are irreversibly spent on Tripo.

**4.2.1 Cheap deterministic pre-checks (no LLM):**
- Non-empty, decodable image; min resolution (e.g. ≥ 512×512); aspect within tolerance of 1:1; not near-blank / not near-uniform (variance threshold).

**4.2.2 Vision-LLM qualification (Gemini, strict JSON — mirror the `petClassify.ts` pattern):**
Prompt the model to score the reference against class-specific criteria and return:

```json
{
  "subjectPresent": true,
  "subjectClassMatches": true,          // matches requested animal/human/object
  "singleSubject": true,                // exactly one subject
  "fullBodyVisible": true,              // for animal/human; "wholeObjectVisible" for object
  "poseOk": true,                       // A-pose/standing (animal/human); n/a → true for object
  "cleanBackground": true,
  "bakedShadowsOrHarshLight": false,
  "watermarkOrText": false,
  "score": 0.0                          // 0–1 overall reconstruction-suitability
}
```

- Reuse the injected-`GenerateFn` + zod-validate + retry-once-at-temp-0 approach from `petClassify.ts`.
- **Pass rule:** `score ≥ 0.75` AND all hard flags good (`subjectPresent`, `singleSubject`, class match, full-subject visible, no watermark). Thresholds live in one config block.

**4.2.3 Regeneration loop:**
- On fail, regenerate the reference (image mode: re-run Layer 1; text mode: re-run `buildTextPrompt`), appending a corrective clause derived from the failed flags (e.g. "ensure the full body including the tail is visible; remove the second subject; drop the baked shadow").
- **Budget: 2 regenerations** (initial attempt + 2 = 3 image attempts max). If all fail:
  - **Never silently ship the raw uploaded photo to Tripo.** Return a clear, actionable error ("We couldn't get a clean enough image for 3D — try a clearer, full-body, front-on photo on a plain background") and **fully refund** — no Tripo call, no net credit deduction.
- Only a **passing** image proceeds to `startImageTo3D`. Deduct the 400 credits **only after the gate passes**; on gate failure the user pays nothing (§7).

### 4.3 Class-appropriate 3D + post-processing

- **animal** → multiview turnaround (as today) → `image_to_model`/`multiview_to_model` → quadruped rig + brain + clips.
- **human** → single-image (as today, intentional) → humanoid rig + brain + clips.
- **object (static)** → single-image → `image_to_model` → **SKIP** `analyzePetImage`, `runBuildPipeline`, rig, brain, and clip baking. On Tripo success, mark `done` and store the GLB directly (`model_url`), no `sprite_sheet_url`. Add an explicit `if (subjectClass === 'object') { …store & done; return; }` branch in the status/build stage so static truly means static.

### 4.4 Multiview for objects
Object-specific turnaround prompts are now defined (§4.1), so objects **can** use `multiview_to_model`. Ship it **opt-in**: default static objects to single-image `image_to_model` (cheaper, no invented rear detail), and expose multiview as an advanced toggle for objects whose back matters. Symmetric/simple props reconstruct fine from one view; only enable multiview when the reference clearly has distinct sides.

### 4.5 Auto-detection (subject class)
Run a vision "triage" call on the reference image that returns `subjectClass` (`human | animal | object`) with a confidence and short reason, using the **class-definition rubric in §4.1**. Cross-check against the type the user picked:
- **Match** → proceed.
- **Mismatch, high confidence** (e.g. user picked "object" but it's clearly a live dog, or picked "human" for a statue) → **soft-switch** the class and surface a dismissible notice ("Detected an animal — generating a rigged pet instead. Switch back?"). Never silently rig something the user asked to keep static without telling them.
- **Low confidence** → keep the user's choice, log the disagreement.

This detection call is **merged into the same triage call as qualification** so it costs nothing extra — see §8.3 (S1). It also produces the species/breed the build stage needs, replacing the separate `analyzePetImage` pass.

---

## 5. File-by-file change map

| File | Change |
|---|---|
| `avatarPrompts.ts` | Add `SubjectClass`; add `REFERENCE_STYLE_OBJECT` + object turnaround + `object` branches in `buildReferencePrompt`, `turnaroundViewsForType`, `paletteLockClause`, `extractPaletteInstruction`; embed the §4.1 class-definition rubric; widen types from `'dog'\|'human'`. |
| `server/imageTriage.ts` *(new)* | The unified vision "brain" (§8.3 S1): deterministic pre-checks + `TriageSchema` (zod) + `triageReferenceImage(generate, {image, userType})` returning `{subjectClass, confidence, mismatch, species/breed/anatomy, qualify{score,flags}}`, with retry-once-at-temp-0, mirroring `petClassify.ts`. Replaces the standalone qualify + the second `analyzePetImage`. |
| `server.ts` `POST /api/avatars` | Normalize UI type → `SubjectClass`; run triage after Step 1 (detect + qualify in one call); **2-regen** loop with corrective clauses; auto-detect soft-switch/notice; deduct credits only after pass, **full refund** on failure; **persist the triage record** on the avatar. |
| `server.ts` status/build stage | Read the persisted triage record instead of re-analyzing. Branch on class: `object` skips rig/brain/clips and stores GLB as `done`. |
| `tripo.ts` | `startRig` (+ callers) accept `SubjectClass`; no rig path for `object`. |
| `ollama-agent.ts` | `analyzePetImage` no longer called in the build path (triage supplies anatomy); guard `runBuildPipeline` so it's never invoked for `object`. |
| `db.ts` | Add a `generation_analysis` JSON column on `avatars` (or extend `pet_profiles`) to persist the triage record + qualify decisions (§8.3 S2/S3). |
| `server/breedProfiles.ts` | Expand toward ~60 breeds + add non-dog species (§8.3 S5). |
| `src/components/CreateAvatarDialog.tsx` / `src/api.ts` | Send the selected type; surface qualify-fail errors and the auto-detect "detected X — switch?" notice. |
| `tests/` | Unit-test `triageReferenceImage` (mock `GenerateFn`, pass/fail/retry, class detection, mismatch); test `object` skips rigging; test full refund on gate failure. |

---

## 6. Rollout & verification

1. **Feature-flag** the qualify gate (e.g. `IMAGE_QUALIFY_ENABLED`, default off) so it can be enabled without a redeploy and rolled back fast.
2. `npm run lint` (`tsc --noEmit`) clean; `npm run test` + `npm run test:ar` green (per `DEPLOYMENT_NOTES.md` checklist).
3. Log every gate decision (`score`, flags, attempt #) to measure false-reject rate before tightening thresholds.
4. Deploy per `DEPLOYMENT_NOTES.md`: commit first (zip archives `HEAD`), `bash scripts/build-deploy-zip.sh`, host runs `npm install && npm run build` → confirm `dist/index.html` → `npm start`; verify `GEMINI_API_KEY` + `TRIPO_API_KEY` set.
5. Smoke test all three classes end-to-end: animal (multiview + rig), human (single + humanoid rig), object (single + **no rig**, static GLB), plus a deliberately bad image to confirm the gate rejects + refunds instead of shipping to Tripo.

---

## 7. Decisions (locked)

- **Credit policy on gate failure:** **full refund.** If the qualify gate fails after all retries, the user is charged nothing — no Tripo charge, and the 400 credits are never net-deducted (deduct only after a passing image, or refund on failure).
- **Attempt budget:** **2 regenerations** (i.e. up to 3 image attempts total: initial + 2 regens) before giving up with a clear error.
- **Object prompts:** **add object-specific prompts** — reference style *and* turnaround (see §4.1 and §8).
- **Class auto-detection:** **yes.** A single vision "triage" call detects `human | animal | object`, cross-checks the user's chosen type, and warns/soft-switches on mismatch (see §8).

---

## 8. Generator "memory" — how it works today, and how to make it smarter

### 8.1 What "memory" exists today

The generator is **mostly stateless / amnesiac**. What looks like memory is three separate, disconnected things:

1. **Static lookup table (`server/breedProfiles.ts`).** `BREED_PROFILES` (~24 breeds) + `SIZE_FALLBACK` map a breed → gameplay params (scale, decay, exerciseNeed, mouthHitbox, barkSet). This is hand-authored, dog-only, and never learns — the file's own TODO targets ~60 breeds and notes it isn't fully wired.

2. **Per-avatar persisted state (MySQL).**
   - `avatars`: `image_url` (reference), `meshy_handle`, `breed`, `avatar_type`, `multiview_json` (turnaround views — persisted so retry/resume can reuse them), `model_url`, `sprite_sheet_url`, `animation_metadata`.
   - `pet_profiles`: `breed`, `breed_confidence`, `size_class`, `build`, `temperament`, `personality_weights`, `hormones`, `drives` — the **classification result is persisted here and cached** (`/api/pets/classify` never re-classifies unless `force=true`, per hardening H7).

3. **Request-scoped caches.** Classify is cached per avatar; semantic scan is cached per anchor hash — these avoid *re-paying* for the same paid vision call.

### 8.2 Why it's not smart today (the real finding)

- **Two independent vision passes that don't share results.** `POST /api/pets/classify` produces and persists a rich `pet_profiles` record (breed, build, temperament, landmarks). But during the **build/rig** stage, `analyzePetImage()` (`ollama-agent.ts`) calls Gemini *again* from scratch to re-derive species/bodyType/legCount/coat — **it never reads the already-persisted classification.** Result: a duplicated paid call and two analyses that can disagree.
- **Detection, qualification, and classification are (or will be) three separate calls** looking at essentially the same image.
- **The qualify gate's signal is thrown away.** The scores/flags we're about to generate (§4.2) are exactly the data needed to tune prompts and thresholds — but nothing persists them.
- **No cross-generation or cross-avatar memory.** Nothing remembers a user's pet between avatars, reuses a prior good reference, or learns which prompt settings produced accepted meshes.
- **Palette/reference are recomputed** rather than treated as reusable memory for retries/variations (only `multiview_json` is persisted).

### 8.3 Making it smarter — the plan

**S1 — One "triage" call = the generator's front-door brain.** Replace the separate detect + qualify + (re-)analyze calls with **one strict-JSON vision call** run on the reference image that returns everything at once:

```json
{
  "subjectClass": "animal|human|object",   // §8 rubric — with a short "reason"
  "classConfidence": 0.0,
  "userTypeMismatch": false,               // vs the type the user picked
  "species": "dog", "breed": "Golden Retriever", "breedConfidence": 0.0,
  "bodyType": "quadruped", "legCount": 4, "hasTail": true,
  "coatColors": ["#..."], "coatPattern": "solid",
  "qualify": { "score": 0.0, "singleSubject": true, "fullSubjectVisible": true,
               "cleanBackground": true, "bakedShadows": false, "watermark": false }
}
```

This unifies §4.2 (qualify) and §4.5 (auto-detect) and *replaces* the second `analyzePetImage` pass. **Persist it** as a single `generation_analysis` record on the avatar (new JSON column or reuse/extend `pet_profiles`).

**S2 — Read, don't re-derive.** The build/rig stage consumes the persisted triage record instead of calling `analyzePetImage` again. One paid vision call per generation instead of two-to-three; no more disagreement between passes.

**S3 — Remember the qualify signal.** Persist every gate decision (`score`, flags, attempt #, final pass/fail, chosen prompt settings). This is cheap and turns into (a) a tuning dataset for thresholds/prompts and (b) analytics on false-reject rate before we tighten anything.

**S4 — Reusable reference memory.** Persist the accepted reference image + extracted palette per avatar so retries and future "make a variation" reuse them instead of regenerating (extends the existing `multiview_json` reuse pattern to the front view + palette).

**S5 — Grow the knowledge table.** Expand `BREED_PROFILES` toward the ~60 target and add non-dog species so `resolveBreedProfile` degrades less often to the size fallback. Longer term, this table could be *back-filled* from accumulated triage records (observed breed → tuned params) — the first genuinely "learned" memory.

**S6 (later) — Per-user subject memory.** Optionally remember a user's real pets/people (with consent) so repeat generations stay visually consistent and detection is pre-seeded.

**Order of value:** S1+S2 first (removes the duplicate call and makes detection/qualification one coherent brain), then S3 (start collecting signal immediately — it costs almost nothing), then S4/S5/S6 as follow-ons.
