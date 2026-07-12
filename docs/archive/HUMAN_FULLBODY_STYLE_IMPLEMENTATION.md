# Human Avatar: Full Standing Body + Selectable Style (Hyper-Realistic + Tripo styles)

**Status:** Ready for implementation
**Owner:** coding agent
**Scope:** Change the AI reference-image generation for the **human photo-upload** path so it
(a) **always** produces a complete, full standing human with correct anatomy, and
(b) supports a **selectable render style** — defaulting to **hyper-realistic**, and also offering all of Tripo's other style choices — instead of being locked to Pixar.

---

## 1. Problem statement

When a user uploads a human photo, the pipeline generates an AI reference image and feeds it to Tripo
(`image_to_model`). Today that reference image is **always rendered in a hardcoded "premium Pixar-style"** and
the user's selected `style` is silently ignored on the photo path. We need two things:

1. **Anatomical completeness, always.** The generated human must be a **full standing figure** with:
   - head with **2 eyes, 2 ears, 1 nose, 1 mouth**
   - torso with **2 arms**, each ending in **1 hand with 5 fingers**
   - **2 legs**, each ending in **1 foot with 5 toes**
   - standing upright, full body head-to-toe in frame, both feet flat on the ground.
2. **Selectable style.** The user must be able to pick **hyper-realistic** (new default for humans) **or** any of
   Tripo's other styles (Pixar, claymation, plush, vinyl, low-poly, cel-shaded, voxel, papercraft, wood, chibi).

---

## 2. Root cause (exact code references)

The reference-image style for a human photo upload is produced by this chain:

| Step | File / symbol | What it does |
| --- | --- | --- |
| HTTP handler | `server.ts` → `app.post("/api/avatars", …)` (~line 841) | Destructures `style` from `req.body` (line 843) but only passes it to the **text** path. |
| Photo path | `server.ts` → `generatePetReferenceImage(...)` call (~line 907) | Does **not** pass `style`. |
| Prompt builder | `server.ts` → `generatePetReferenceImage()` (~line 808) → `buildReferencePrompt(type, accent, hasFacePhoto, photos.length)` (~line 834) | Never receives a style. |
| Human style string | `avatarPrompts.ts` → `REFERENCE_STYLE_HUMAN` (line 91) | **Hardcoded** `"premium Pixar-style stylized 3D character…"`. |
| Anatomy | `avatarPrompts.ts` → `HUMAN_ANATOMY_SPEC` (line 73) | Lists eyes/ears/nose/mouth/arms/hands/fingers/legs/feet — **no toes**, no "full standing / feet flat" enforcement. |

Two style vocabularies already exist and should be reused, **not** duplicated:
- `STYLE_CLAUSES` (`avatarPrompts.ts` line 377) — the phrase for each style id.
- `TEXT_STYLE_OPTIONS` (`avatarPrompts.ts` line 311) — the dropdown option list (already includes `auto`, `pixar`, `realistic`, …).

The frontend **already** renders a Style dropdown for image mode and **already** sends `style` in the payload
(`CreateAvatarDialog.tsx` line 378 renders it unconditionally inside `showStyling`; line 181 sends it). So the
frontend needs only a wording tweak — the real fix is backend prompt-building.

---

## 3. Design

- Keep **anatomy/proportion/full-standing enforcement style-independent**: it must apply to *every* style
  (a hyper-realistic human and a chibi human both need the correct counts and a full standing pose).
- Make **only the "look/finish" clause** vary by style, driven by the existing `STYLE_CLAUSES`.
- Add a **hyper-realistic** style option and make it the **default for the human photo path**
  (`auto`/undefined on a human ⇒ hyper-realistic).
- Preserve backward compatibility: `buildReferencePrompt(type)` with no style arg must still return a valid prompt
  (existing tests call it with one arg).

---

## 4. Implementation

### 4.1 `avatarPrompts.ts` — strengthen the anatomy spec (toes + full standing)

Replace `HUMAN_ANATOMY_SPEC` (currently lines 73–76) with a version that adds **toes** and an explicit
**full standing** requirement:

```ts
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
```

Add a new **pose/completeness** constant right after `HUMAN_PROPORTION_SPEC` (after line 89):

```ts
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
```

### 4.2 `avatarPrompts.ts` — make the human style a parameter

Replace the hardcoded `REFERENCE_STYLE_HUMAN` constant (lines 91–111) with a **builder function** so the
"look" clause can vary while anatomy/proportions/full-body stay fixed. Keep a backward-compatible
`REFERENCE_STYLE_HUMAN` export (defaulting to hyper-realistic) so existing imports/tests don't break.

First, add a hyper-realistic entry to `STYLE_CLAUSES` (object starting line 377). Update the `realistic`
line and add `hyperrealistic`:

```ts
  realistic:      `a photorealistic, highly detailed 3D render with physically accurate materials, natural human proportions and lifelike skin, hair and clothing detail`,
  hyperrealistic: `a HYPER-REALISTIC, photoreal 3D human render — true-to-life skin with visible pores and subsurface scattering, realistic hair strands, accurate eye moisture and catchlights, physically-based clothing fabric, natural human proportions and lifelike micro-detail, indistinguishable from a high-end 3D scan`,
```

Add a helper that returns the correct "look" clause for a human, treating `auto`/unknown as hyper-realistic:

```ts
/**
 * The style "look" clause for a HUMAN reference image. Defaults to hyper-realistic
 * (auto or unknown id ⇒ hyperrealistic) but honours any TEXT_STYLE_OPTIONS id.
 * Anatomy/proportions/full-body are applied separately and are NOT style-dependent.
 */
export function humanStyleClause(styleId?: string | null): string {
  const id = (styleId && styleId !== "auto") ? styleId : "hyperrealistic";
  return STYLE_CLAUSES[id] || STYLE_CLAUSES["hyperrealistic"];
}
```

Now replace the `REFERENCE_STYLE_HUMAN` constant with a builder + a back-compat constant:

```ts
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
```

> Note: the old constant opened with "premium Pixar-style stylized 3D character". After this change the
> default is hyper-realistic. If any other module imports `REFERENCE_STYLE_HUMAN` directly, it now gets the
> hyper-realistic default — grep for it (`grep -rn REFERENCE_STYLE_HUMAN`) before finishing; only
> `avatarPrompts.ts`, `server.ts` (indirect) and `tests/avatar_prompts.test.mjs` should reference it.

### 4.3 `avatarPrompts.ts` — thread `style` through `buildReferencePrompt`

Change the signature (line 131) to accept an optional style, and pass it into the human branch (lines 158–164):

```ts
export function buildReferencePrompt(
  type: SubjectClass,
  accent?: string | null,
  hasFacePhoto?: boolean,
  photoCount?: number,
  style?: string | null,            // NEW
): string {
  // …unchanged accent/face/multi-photo clause setup…

  if (type === 'human') {
    return (
      `You are given one or more reference photos, all of the SAME person. ` +
      faceClause + multiPhotoClause +
      `Generate ONE image of this exact person seen DIRECTLY FROM THE FRONT (head and body facing straight toward the camera). ` +
      buildHumanReferenceStyle(style) + accentClause + ` Respond with only the generated image.`   // CHANGED
    );
  }
  // …dog / object branches unchanged…
}
```

> The `object` and `dog` branches keep their existing `REFERENCE_STYLE_OBJECT` / `REFERENCE_STYLE_DOG`
> behaviour for now (out of scope). If you also want dog styles later, apply the same pattern.

### 4.4 `avatarPrompts.ts` — add the style option to the dropdown list

Add `hyperrealistic` to `TEXT_STYLE_OPTIONS` (line 311) and make it the recommended default. Reorder so the
top item is the human-friendly default while still working for pets/objects:

```ts
export const TEXT_STYLE_OPTIONS: TextOption[] = [
  { id: "auto",           label: "Auto (let AI decide)", hint: "Best for arbitrary images — the generator picks the most fitting style" },
  { id: "hyperrealistic", label: "Hyper-realistic", recommended: true, hint: "Photoreal, scan-like detail — best for people" },
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
```

> ⚠️ **Regression check for the text-to-3D path:** `buildTextPrompt` (line 440) uses
> `STYLE_CLAUSES[style]`. Because `pick()` (line 421) falls back to the `recommended` option, changing the
> recommended id to `hyperrealistic` means a text prompt with no style now defaults to hyper-realistic instead
> of `auto`. That is desirable for humans; if you want text-mode to stay `auto` by default, keep `auto`'s
> `recommended: true` and instead special-case the human photo path default inside `buildHumanReferenceStyle`
> (which already treats `auto` ⇒ hyperrealistic). **Choose one** and note it in the PR description.
> Recommended: keep `auto` as the text default (`recommended: true` on `auto`), and rely on
> `buildHumanReferenceStyle` mapping `auto → hyperrealistic` for the human photo path only. That keeps the
> two paths independent. If you take this option, do NOT move `recommended` off `auto`; just add the
> `hyperrealistic` option below it.

### 4.5 `server.ts` — pass `style` into the human/photo reference builder

`style` is already destructured (line 843). Thread it into `generatePetReferenceImage`.

Update the function signature (~line 808) to accept a style and forward it:

```ts
async function generatePetReferenceImage(
  photos: string[],
  accent: string | null | undefined,
  type: SubjectClass,
  hasFacePhoto?: boolean,
  extra?: string,
  errRef?: { code?: number | string; message?: string; quota?: boolean },
  style?: string | null,            // NEW
): Promise<string | null> {
  // …unchanged imageParts assembly…

  const referencePrompt = buildReferencePrompt(type, accent, hasFacePhoto, photos.length, style) // CHANGED
    + (corrective ? ` IMPORTANT — fix these issues from the previous attempt: ${corrective}.` : "");
  return generateImageWithFallback([...imageParts, { text: referencePrompt }], "referenceImage", errRef);
}
```

Update the call site (~line 907):

```ts
candidate = await generatePetReferenceImage(photoList, accent, avatarType, hasFacePhoto, corrective, imgErr, style); // CHANGED
```

No other server changes are required — the qualification/triage, Backblaze save, credit deduction and Tripo
submission all run on whatever reference image comes out.

### 4.6 `src/components/CreateAvatarDialog.tsx` — wording only (no behavior change needed)

The Style dropdown already renders for image mode (line 378) and `style` is already submitted (line 181).
Two small polish items:

1. The default `style` state (line 111) picks the `recommended` option. With §4.4 that is `hyperrealistic`
   (good default for the human photo flow). Verify the dropdown shows "Hyper-realistic" selected by default.
2. Optional: when `avatarType === 'human'`, show a one-line helper under the Style select, e.g.
   *"Humans always render as a full standing figure — pick the finish."* Purely cosmetic.

No payload/interface change: `onSubmit` already includes `style`, and `AvatarDialogValues` (line ~20) already
types `style?: string`.

---

## 5. Tests

### 5.1 Update `tests/avatar_prompts.test.mjs`

Add `buildHumanReferenceStyle` / `HUMAN_FULLBODY_SPEC` to the import block, and add these tests:

```ts
test("HUMAN_ANATOMY_SPEC now enforces five toes per foot", () => {
  const a = HUMAN_ANATOMY_SPEC.toLowerCase();
  assert.ok(a.includes("five toes") || a.includes("five distinct toes"),
    "expected the anatomy spec to require five toes per foot");
});

test("HUMAN_FULLBODY_SPEC forces a complete, uncropped standing figure", () => {
  const f = HUMAN_FULLBODY_SPEC.toLowerCase();
  assert.match(f, /full[- ]?body|entire person|head down to/i);
  assert.match(f, /both feet/i);
  assert.match(f, /not a bust|not.*cropped|nothing is cropped/i);
});

test("buildReferencePrompt(human) defaults to hyper-realistic and stays anatomically complete", () => {
  const p = buildReferencePrompt("human").toLowerCase();
  assert.match(p, /hyper-realistic|photoreal/i);       // default look
  assert.match(p, /five distinct fingers|five fingers/i);
  assert.match(p, /five toes/i);
  assert.match(p, /both feet/i);
});

test("buildReferencePrompt(human, …, 'pixar') switches the look but keeps anatomy", () => {
  const p = buildReferencePrompt("human", null, false, 1, "pixar").toLowerCase();
  assert.match(p, /pixar/i);
  assert.match(p, /five toes/i);       // anatomy is style-independent
  assert.match(p, /both feet/i);
});

test("humanStyleClause maps auto/undefined to hyper-realistic", () => {
  assert.match(humanStyleClause(undefined), /hyper-realistic|photoreal/i);
  assert.match(humanStyleClause("auto"), /hyper-realistic|photoreal/i);
  assert.match(humanStyleClause("chibi"), /chibi/i);
});
```

The existing test *"REFERENCE_STYLE_HUMAN embeds the anatomy and proportion specs"* (line 36) still passes
because `buildHumanReferenceStyle()` includes both specs. It will now **also** include `HUMAN_FULLBODY_SPEC`;
optionally extend that test to assert the full-body spec is embedded too.

### 5.2 Run

```bash
cd /Users/robert/Desktop/claude7126/PawsMemories
node --test tests/avatar_prompts.test.mjs
# and the broader suite if present:
node --test
npx tsc --noEmit          # type-check server.ts + avatarPrompts.ts changes
```

---

## 6. Manual verification (end-to-end)

1. Start the app; open **Create 3D Model** → **Upload Photos** → type **Person**.
2. Upload 1 face + 1–2 body photos. Confirm the **Style** dropdown defaults to **Hyper-realistic**.
3. Generate. Inspect the saved reference image in Backblaze (the pipeline persists every AI render before
   scoring). Confirm: full standing figure, head-to-feet in frame, both feet flat, 5 visible fingers/hand and
   5 visible toes/foot, hyper-real finish.
4. Repeat with **Style = Pixar** and **Style = Claymation**: the *look* changes, the *anatomy and full-body
   framing* stay identical.
5. Confirm the resulting Tripo GLB is a complete standing human (no cropped legs/feet).

**Acceptance criteria**
- [ ] Default human upload renders hyper-realistic (not Pixar).
- [ ] Every style produces a complete, uncropped, full standing figure with correct counts incl. 5 toes/foot.
- [ ] Selecting any Tripo style changes only the finish, never the anatomy or framing.
- [ ] `node --test tests/avatar_prompts.test.mjs` passes; `tsc --noEmit` clean.
- [ ] No other importer of `REFERENCE_STYLE_HUMAN` broke (grep verified).

---

## 7. Optional enhancement (recommended follow-up, not required)

**Enable human multiview** for stronger full-body geometry. Currently multiview turnaround runs for dogs only
(`server.ts` ~line 983: `if (avatarType === 'dog' …)`). Humans go single-image. A single front image can leave
Tripo guessing at the back of the legs/feet. To improve full-standing fidelity:

- Change the guard to include humans: `if ((avatarType === 'dog' || avatarType === 'human') && …)`.
- `turnaroundViewsForType('human')` already exists (`avatarPrompts.ts` line 201) and returns left/back/right
  human prompts, so `generateTurnaroundViews` will produce a proper turnaround; `startImageTo3D` already
  upgrades to `multiview_to_model` when any side view is present.
- Cost/latency: this adds 3 extra Gemini image generations per human. Gate behind a flag
  (e.g. `HUMAN_MULTIVIEW=1`) if you want to A/B it.

Keep this as a separate PR so the prompt/style fix ships independently and is easy to bisect.

---

## 8. File-change checklist

- [ ] `avatarPrompts.ts` — `HUMAN_ANATOMY_SPEC` (add toes/torso), add `HUMAN_FULLBODY_SPEC`,
      add `hyperrealistic` to `STYLE_CLAUSES`, add `humanStyleClause`, replace `REFERENCE_STYLE_HUMAN` with
      `buildHumanReferenceStyle()` + back-compat const, extend `buildReferencePrompt` signature + human branch,
      add `hyperrealistic` to `TEXT_STYLE_OPTIONS`.
- [ ] `server.ts` — extend `generatePetReferenceImage` signature, pass `style` at the call site (~line 907).
- [ ] `src/components/CreateAvatarDialog.tsx` — verify default style; optional human helper text.
- [ ] `tests/avatar_prompts.test.mjs` — new/updated assertions (toes, full-body, style switching).
- [ ] (Optional) `server.ts` human multiview guard behind `HUMAN_MULTIVIEW` flag.
