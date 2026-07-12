# Text-to-Model Fix + Customization Menu Simplification

**Status:** Ready for implementation
**Owner:** coding agent
**Scope:** Two related hardening changes to the Create-3D-Model flow:
1. **Fix the text-prompt path** — "Text Prompt" mode wrongly returns *"At least one photo required"* instead of
   generating an image from the prompt. Root cause is a frontend→server field-name mismatch.
2. **Simplify the customization menus** — remove the output-quality selectors **Detail**, **Texture**, and
   **Lighting**. The pipeline should use its high-quality defaults instead.

---

## 1. Bug: Text Prompt mode demands a photo

### 1.1 Symptom
Switching Create 3D Model → **Text Prompt**, entering a subject, and pressing Create returns an error like
*"At least one photo required."* No image is generated from the prompt.

### 1.2 Root cause — camelCase vs snake_case contract mismatch

The dialog builds a **camelCase** options object and it is passed **verbatim** to the API, but the server reads
**snake_case** keys. So the server never sees `input_mode`, reads it as `undefined`, and the `=== "text"` check
fails — dropping into the photo-required branch.

**Frontend emits** (`src/components/CreateAvatarDialog.tsx`, `handleSave` ~line 173):
```ts
onSubmit({
  name, avatarType, inputMode,
  photos, facePhoto, subject, palette,
  style, framing, angle, lighting, geoDetail, geoTexture,
});
```

**Passed straight through unmapped** (`src/components/AvatarDashboard.tsx`, `handleCreateAvatar` ~line 111):
```ts
const result = await generate3DAvatar(options);   // options forwarded as-is
```
`generate3DAvatar` (`src/api.ts` ~line 354) `JSON.stringify`s the object directly into the POST body.

**Server reads** (`server.ts`, `POST /api/avatars` ~line 843):
```ts
const { name, photo, photos, palette, avatar_type, face_photo, input_mode,
        subject, detail, texture, style, lighting } = req.body;
```

**Mismatch table**

| Frontend key | Server key | Consequence today |
| --- | --- | --- |
| `inputMode` | `input_mode` | **THE BUG** — `input_mode` is `undefined`, so text mode is treated as image mode → "photo required". |
| `avatarType` | `avatar_type` | Type is lost; server defaults to `'dog'` and relies on image auto-detection to recover it. |
| `facePhoto` | `face_photo` | Dedicated face close-up role is lost (face-priority prompt clause never triggers). |
| `geoDetail` | `detail` | Detail selection ignored (being removed — see §2). |
| `geoTexture` | `texture` | Texture selection ignored (being removed — see §2). |
| `subject`, `photos`, `palette`, `style`, `lighting`, `name` | same | Match. (`lighting` being removed — see §2.) |

Why image mode still "works": photos are present so the photo-required branch passes, and the server's
image auto-detection (`triageReferenceImage` / `isClassMismatch`) recovers the real subject class. Text mode
has no photo to fall back on, so it fails at validation before any generation happens.

Confirm the server text branch that never runs today (`server.ts` ~line 860):
```ts
if (input_mode === "text") {            // input_mode is undefined → false
  // subject validation …
} else {
  if (photoList.length === 0) {
    return res.status(400).json({ error: "At least one photo required." });  // ← user sees this
  }
}
```

### 1.3 Fix — map the payload to the server contract at the boundary

Do the camelCase→snake_case translation once, where the request leaves the app. Keep the dialog's typed
`CreateModelOptions` (camelCase) as-is for UI code; build the wire payload in `handleCreateAvatar`.

**`src/components/AvatarDashboard.tsx` — `handleCreateAvatar` (~line 111):**
```ts
const handleCreateAvatar = async (options: CreateModelOptions) => {
  if (userProfile.credits < 400) {
    alert("You need 400 credits to create a model.");
    return;
  }
  setCreating(true);
  try {
    // Translate the dialog's camelCase options to the server's snake_case contract.
    const payload = {
      name: options.name,
      avatar_type: options.avatarType,
      input_mode: options.inputMode,
      photos: options.photos,
      face_photo: options.facePhoto ?? null,
      subject: options.subject,
      palette: options.palette ?? null,
      style: options.style,
      // NOTE: detail, texture, lighting intentionally omitted (see menu simplification).
      // The server falls back to its high-quality Tripo defaults.
    };
    const result = await generate3DAvatar(payload);
    // …unchanged optimistic credit deduction, notice handling, reload…
  } catch (err: any) {
    alert(err.message || "Failed to create model.");
  } finally {
    setCreating(false);
  }
};
```

> Import the `CreateModelOptions` type in `AvatarDashboard.tsx` if it isn't already
> (`import CreateAvatarDialog, { type CreateModelOptions } from "./CreateAvatarDialog";`) and change the
> `handleCreateAvatar` parameter type from `any` to `CreateModelOptions` for safety.

**Alternative (equally acceptable):** do the mapping inside `generate3DAvatar` in `src/api.ts`. Pick one place;
do **not** map in both. Mapping at `handleCreateAvatar` is preferred because `api.ts` currently takes `any`.

### 1.4 Server hardening (defensive, recommended)
Make the server tolerant of either casing so a future caller can't silently reintroduce this bug. In
`server.ts` right after the destructure (~line 843):
```ts
const inputMode = input_mode ?? req.body.inputMode;
const avatarTypeRaw = avatar_type ?? req.body.avatarType;
const facePhotoRaw = face_photo ?? req.body.facePhoto;
```
Then use `inputMode`, `avatarTypeRaw`, `facePhotoRaw` in place of the snake_case originals below. This is a
belt-and-suspenders measure; the §1.3 mapping is the primary fix.

---

## 2. Remove the Detail, Texture, and Lighting menus

The user does not want output-quality knobs exposed. Remove **Detail**, **Texture**, and **Lighting**. The
pipeline already has strong defaults, so removing them improves consistency:
- **Detail/Texture** map to Tripo `face_limit` / `pbr`. With them omitted, `server.ts` (~line 1016)
  `const geo = (detail || texture) ? geometryToTripo(detail, texture) : undefined;` yields `undefined`, and
  `startImageTo3D` (`tripo.ts` line 165) uses its defaults: **40k faces, detailed PBR, aligned to the
  reference image**.
- **Lighting** feeds `buildTextPrompt`. Omitted, `pick()` falls back to the recommended/`auto` option
  (`avatarPrompts.ts` line 421) → *"clean, even lighting optimised for 3D reconstruction with no harsh
  shadows"*, which is the best choice for reconstruction anyway.

### 2.1 `src/components/CreateAvatarDialog.tsx`

Remove UI, state, and payload for the three fields.

1. **Remove the three `<PromptSelect>`s** (lines ~379–381):
```tsx
<PromptSelect label="Lighting" value={lighting} onChange={setLighting} options={TEXT_LIGHTING_OPTIONS} />
<PromptSelect label="Detail"   value={geoDetail} onChange={setGeoDetail} options={GEOMETRY_DETAIL_OPTIONS} />
<PromptSelect label="Texture"  value={geoTexture} onChange={setGeoTexture} options={GEOMETRY_TEXTURE_OPTIONS} />
```
After removal the styling grid keeps only **Style** (and, if kept, Framing/Angle — see §2.3). Consider
changing the wrapper from `grid-cols-2` to a single column if only Style remains, so it doesn't look sparse.

2. **Remove the state hooks** for `lighting`, `geoDetail`, `geoTexture` (around lines ~111–118; grep the
   component for `setLighting`, `setGeoDetail`, `setGeoTexture`, `geoDetail`, `geoTexture`, `lighting`).

3. **Remove them from the `onSubmit` payload** (`handleSave` ~line 181): drop `lighting`, `geoDetail`,
   `geoTexture` (and `framing`, `angle` too if you remove those per §2.3).

4. **Remove now-unused imports** from `../../avatarPrompts` (top of file, lines ~4–10):
   `TEXT_LIGHTING_OPTIONS`, `GEOMETRY_DETAIL_OPTIONS`, `GEOMETRY_TEXTURE_OPTIONS`
   (and `TEXT_FRAMING_OPTIONS`, `TEXT_ANGLE_OPTIONS` if removing §2.3). Leave `TEXT_STYLE_OPTIONS`.

5. **Update the `CreateModelOptions` interface** (lines ~12–26): delete `lighting?`, `geoDetail?`,
   `geoTexture?` (and `framing?`, `angle?` per §2.3).

### 2.2 Server — keep tolerant (no required change)
`detail`, `texture`, and `lighting` are optional destructures. With the frontend no longer sending them they
are simply `undefined`, and the existing fallbacks apply (defaults described above). No server edit is
strictly required. Optionally delete the now-dead `lighting`/`detail`/`texture` references for tidiness, but
leaving them is backward-compatible with any external caller.

### 2.3 Decision needed: Framing & Angle (text mode only)
`Framing` and `Angle` are shown only in text mode (`CreateAvatarDialog.tsx` ~line 387) but are **currently
never sent to the server** — `handleCreateAvatar` doesn't forward them and the server's text branch builds the
prompt as `{ subject, style, lighting, corrective }` (`server.ts` ~line 904), ignoring framing/angle entirely.
So today they are dead controls. Choose one:

- **(A) Remove them** (simplest, matches "fewer knobs"): delete the Framing/Angle selects, state, imports, and
  interface fields. Text prompts then use `buildTextPrompt` defaults (auto framing/angle).
- **(B) Wire them up**: forward `framing` and `angle` in the §1.3 payload and add them to the server's
  `TextPromptFields` at line 904 (`{ subject, style, framing, angle, lighting, corrective }`). Only do this if
  you actually want users choosing full-body vs bust; note this can conflict with the "always full standing"
  goal from the human-fullbody work.

**Recommended: (A) remove**, to stay consistent with removing the other knobs and with the full-standing
default. This doc assumes (A) unless you decide otherwise.

---

## 3. Resulting minimal payload

After both changes the POST `/api/avatars` body is:
```jsonc
{
  "name": "string",
  "avatar_type": "dog | human | object",
  "input_mode": "image | text",
  "photos": ["dataURL", "..."],   // [] for text mode
  "face_photo": "dataURL | null", // null for text mode
  "subject": "string | undefined",// present for text mode
  "palette": "string | null",
  "style": "string"               // e.g. hyperrealistic / pixar / …
}
```
`detail`, `texture`, `lighting` (and `framing`/`angle` under option A) are no longer sent. Tripo uses 40k
faces + detailed PBR; the reference prompt uses clean even lighting.

---

## 4. Tests & verification

### 4.1 Automated
- If a payload-mapping unit test is feasible, assert `handleCreateAvatar`/`generate3DAvatar` produces
  `input_mode`, `avatar_type`, `face_photo` (snake_case) from camelCase input.
- `npx tsc --noEmit` — confirms the removed interface fields aren't referenced anywhere and imports are clean.
- Existing `node --test` suites should still pass (no prompt-builder signature changes here).

### 4.2 Manual — text mode (the fix)
1. Create 3D Model → **Text Prompt** → enter e.g. "a corgi wearing a tiny wizard hat" → Create.
2. Expect: **no "photo required" error**; generation proceeds; a reference image is produced from the prompt
   and a model is created. (Watch the network tab: request body has `input_mode: "text"`, `subject` set,
   `photos: []`.)
3. Try text mode with each avatar type (Person / Pet / Object) and confirm it generates.

### 4.3 Manual — image mode (regression)
1. Upload a photo (Person and Pet) → Create. Confirm still works, and that the type you picked now reaches the
   server (`avatar_type` correct) rather than relying solely on auto-detect.
2. Confirm the face-close-up slot now influences the result (`face_photo` populated).

### 4.4 Manual — menus
1. Open the styling panel: **Detail**, **Texture**, **Lighting** are gone. **Style** and **Color
   Coordination** remain. (Framing/Angle gone under option A.)
2. Generated models still come out at full quality (detailed PBR, ~40k faces) with clean lighting.

**Acceptance criteria**
- [ ] Text Prompt mode generates from the prompt (no "photo required").
- [ ] `input_mode`, `avatar_type`, `face_photo` arrive at the server in snake_case (verified in network body).
- [ ] Detail, Texture, Lighting selectors removed from the dialog; no dangling state/imports/interface fields.
- [ ] Image mode still works; output quality unchanged (Tripo defaults).
- [ ] `tsc --noEmit` clean; existing test suites pass.

---

## 5. File-change checklist
- [ ] `src/components/AvatarDashboard.tsx` — add camelCase→snake_case payload mapping in `handleCreateAvatar`;
      type the param as `CreateModelOptions`; import the type.
- [ ] `src/components/CreateAvatarDialog.tsx` — remove Detail/Texture/Lighting selects, state, payload fields,
      imports, and interface fields; simplify the styling grid; (option A) also remove Framing/Angle.
- [ ] `server.ts` — (optional, recommended) accept either casing defensively (§1.4); no other required change.
- [ ] Verify: `npx tsc --noEmit`, `node --test`, and the manual checks in §4.

## 6. Out of scope / notes
- **Human multiview stays disabled.** A prior experiment enabling human turnaround/multiview caused **extra
  limbs**; do not re-enable it here. Humans remain single-image `image_to_model`.
- This change does not alter the human full-body/anatomy prompt work (see
  `HUMAN_FULLBODY_STYLE_IMPLEMENTATION.md`); the two are independent and compatible.
