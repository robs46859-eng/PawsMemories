# Phase 4 — Animator: Environments, Time-of-Day, Weather, Sound & Voiceover

**Status:** Ready for implementation
**Owner:** coding agent
**Builds on:** Phase 1 (`857deee`) + Phase 2 (`8d1ee27`) + Phase 2 fixes (`9006d36`) + Phase 3 (`fd8afda`).
**Parent spec:** `ANIMATOR_AND_SCENES_IMPLEMENTATION_PLAN.md` — §6.3–§6.7 (scenes/environments/sound/voiceover),
§14 (defaults). This is Phase 4 of §10.

Phase 3 delivered the interactive viewer + multi-model `SceneController` + real-viewport recording. Phase 4
**dresses the scene**: environment presets, time-of-day lighting, weather, ambient/weather sound, pre-made
voiceover, and a multi-step scene sequence with camera cuts. The hard rules from parent §0 still hold —
**preserve originals, no fakery, honest fallbacks, CC0/owned-only assets.**

---

## 0. CLOSE FIRST — Phase 3 gaps (do before new Phase 4 surface area)

Phase 3 shipped the viewer but missed three items from its own DoD. Land these as the first Phase 4 commit
("fix: Phase 3 projects, recording durability, missing tests"):

### 0.1 Project persistence (was required in Phase 3 §7, not built)
No `server/animator/projects.ts` and no project endpoints exist. Add them so users can save/reload animator work:
- `ProjectRecord = { id, userPhone, name, actors: SceneActor[], activeActorId, camera?, recordSettings, createdAt, updatedAt }`,
  persisted as `projects/<id>.json`, zod-validated, **owner-scoped** (mirror the `meta.userPhone` + 403 pattern
  already used in `routes.ts`).
- Endpoints (all `requireAuth`, 403 on cross-user): `POST/GET /api/animator/projects`,
  `GET/PUT/DELETE /api/animator/projects/:id` (delete never touches originals/outputs).
- Default name `"<AvatarName> — <date>"`; autosave draft on edit (defaults §14).

### 0.2 Recording durability — mirror recordings/screenshots to the bucket
Assets and conversion **outputs already mirror** to Backblaze (`importAsset` + `worker.ts` call
`uploadBase64Binary` with a graceful "imported locally" fallback — verified in the test logs). The gap is only the
**recordings/screenshots** endpoints (`routes.ts` ~216–249), which write to the local `/animator-files/...` dir
and return a local URL — a Hostinger redeploy can wipe that. Make those two endpoints mirror each finalized
upload to the bucket via `storage.ts` and return the **bucket URL** (keep the local copy as a cache only), matching
the asset/output path.

### 0.3 Write the missing Phase 3 tests
Author the four suites the Phase 3 doc required (pure logic, no browser):
`tests/animator_controller.test.mjs`, `tests/animator_scene_controller.test.mjs`,
`tests/animator_defaults.test.mjs`, `tests/animator_projects.test.mjs`. See Phase 3 doc §9 for the assertions.
Run them with the project runner (`npm run test` → `tsx --test`), which is how the suite actually executes.

> Note on the test toolchain: the repo runs tests via **`tsx`** (`npm run test`), not `node --test`. Write new
> `.mjs` tests to pass under `tsx`. `npm run lint` = `tsc --noEmit` must stay clean.

---

## 1. What you can reuse (already built / already in the repo)

- **Client scene layer:** `SceneController`/`AnimationController` (Phase 3), `AnimatorScreen`, `src/animator/defaults.ts`.
- **Rendering:** `@react-three/drei@10` ships `<Sky>`, `<Stars>`, `<Cloud>`, `<Environment>` — use these for
  sky/time-of-day/HDRI. `THREE.Points` for weather particles; `THREE.AudioListener`/`Audio` for sound. **No new
  npm needed for rendering.**
- **Voiceover:** `heygen.ts` (`startTalkingVideo`, env `HEYGEN_API_KEY`/`HEYGEN_DEFAULT_VOICE_ID`) + the
  `generation_jobs` poller + credit/refund logic already power `/api/create-talking-video`. **Reuse, don't
  rebuild.**
- **Audio/mux:** `ffmpeg` system binary (present) for the audio-bed mux. `storage.ts` for bucket mirroring.
- **`.blend` → assets:** the headless **blender-worker** (`/execute`, `/export-glb`, `.blend` checkpoints) can
  render `.blend` → HDRI/PNG or export → GLB. Add a worker job for it.

---

## 2. Goals (Phase 4 scope) — build in this order

1. **Environment presets** (parent §6.7.1) — curated CC0 library (basic / generic / captured-HDRI) from
   **ambientCG** + **OpenHDRI**, plus **your `.blend`** environments. `GET /api/scenes/environments`.
2. **Time-of-day lighting rig** (§6.7.2) — pure `lightingFor(timeOfDay, preset)`; morning/afternoon/evening/night
   auto-adjust the lights, `<Sky>` sun, exposure, stars.
3. **Weather** (§6.7.3) — rain/snow particles, fog/overcast; constrained to each preset's `allowedWeather`.
4. **Sound** (§6.7.4) — ambient + weather SFX live preview (WebAudio), muxed into the export server-side.
5. **Voiceover** (§6.6) — pre-made scripts (`GET /api/scenes/scripts`) + `POST /api/scenes/voiceover`; **8–10 s
   cap**; HeyGen audio + ffmpeg **audio-bed mux** (ambient + weather + voiceover) onto the silent clip.
6. **Scene sequence + camera cuts + templates** (§6.2/§6.4) — a multi-step executor (hard cuts only), camera
   bookmarks, `GET /api/scenes/templates`, scene CRUD (`POST/GET /api/scenes`).

**Deferred (not here):** AR multi-model cast (Phase 3b, parent §6.5); the opt-in lossy `optimize` glTF preset
(small addendum, §8). Crossfades/blended sequencing stay deferred and **must not be faked**.

---

## 3. Environment presets — `server/animator/environments/*.json` + loader

- Curated JSON bundled in the repo (like Phase-2 patterns), zod-validated at boot, cached, served read-only via
  `GET /api/scenes/environments`. Schema per parent §6.7.1 (`id, tier, label, backdrop{kind,url}, ground,
  allowedWeather, ambientSound, defaultTimeOfDay, cameraStart, license, source, sourceUrl`).
- Tiers: `basic` (procedural, no asset), `generic` (everyday, CC0 HDRI), `hdri` (captured CC0 environments).
- **Backdrop kinds:** `hdri`/`dome360` (drei `<Environment>` — default for generic/hdri), `image` (billboard),
  `glb-scene` (environment mesh — opt-in only), `procedural` (drei `<Sky>`+`<Stars>`+`<Cloud>` for basic).
- **`.blend` default:** render `.blend` → **HDRI** unless the preset sets `backdrop.kind: "glb-scene"` (parent §14).
- **Licensing (hard):** every preset `license ∈ {CC0, owned, generated}` + `source`/`sourceUrl`. Test asserts it.
- **Import script** `scripts/import-environments.mjs` (parent §6.7.1/§6.7.1a): pull a curated subset of CC0 HDRIs/
  materials from the ambientCG API (`/api/v2/full_json?type=HDRI`) + hand-picked OpenHDRI files, and (for `.blend`)
  send to the blender-worker; downscale/rename; upload to the bucket; emit the preset JSON. **No runtime hotlinking.**

## 4. Time-of-day lighting — `src/animator/scenes/lightingRig.ts`

Pure, unit-testable `lightingFor(timeOfDay, preset) → LightingProfile` (parent §6.7.2): sun elevation/azimuth/
color/intensity, ambient fill, exposure, `showStars`, optional fog. morning=low warm; afternoon=high neutral
bright (matches defaults §14 default); evening=low golden long shadows; night=sun off + moonlight + stars + low
exposure. Preset may override (indoor presets ignore sun, use fixed interior lights; HDRI presets rotate/dim the
env map instead of moving a sun). Applied to the directional + hemisphere lights, `<Sky>` sun, and renderer
exposure — one rig, four presets.

## 5. Weather — `src/animator/scenes/weather/`

Real GPU-cheap effects only: rain/snow via instanced `THREE.Points` (bounded count, mobile-capped per defaults
§14 perf tier); fog/overcast via scene `fog` + dimmed/desaturated lighting (from the profile). Constrained to the
preset's `allowedWeather`; `clear` = nothing. Extensible `WeatherEffect` interface; volumetric clouds/lightning/
puddles are **deferred, not faked**.

## 6. Sound + audio-bed mux

- **Live preview:** `THREE.AudioListener` + looping `Audio` for the preset's `ambientSound` and a weather SFX loop
  (when weather ≠ clear), mixed at `sound.volume`. Curated CC0 audio assets in the bucket.
- **Export:** the WebCodecs recorder stays video-only. Assemble the **audio bed** (ambient + weather SFX +
  voiceover) and mux **server-side with ffmpeg** onto the silent MP4, trimmed to `MAX_CLIP_SECONDS`. Generalize
  the voiceover job (§7) into an "audio-bed mux" job. Sound is optional; muting/missing assets never block export.

## 7. Voiceover (HeyGen, 8–10 s) — `POST /api/scenes/voiceover` + `GET /api/scenes/scripts`

- **Pre-made scripts:** repo-bundled JSON (`server/animator/scripts/*.json`), zod-validated, cached, read-only via
  `GET /api/scenes/scripts`. Each: `{ id, title, category, text, estimatedSeconds, suggestedClip? }`.
- **8–10 s cap (two places):** `estimateSpeechSeconds(text)` (~2.5 words/s → ~20 words@8s, ~25@10s) rejects/trims
  over-length text; recorder hard-stops at `MAX_CLIP_SECONDS=10` (defaults §14). Pre-made scripts pre-validated.
- **Generation + mux:** `POST /api/scenes/voiceover { recordingId, scriptId|text, voiceId? }` (voiceId defaults to
  `HEYGEN_DEFAULT_VOICE_ID`). Server job: `startTalkingVideo(...)` → poll via existing HeyGen poller → **ffmpeg**
  extract audio → mux onto the silent scene MP4 (≤10 s) → new voiced MP4 to `recordings/` + bucket. Reuse the
  `generation_jobs` table + credit/refund logic (`VIDEO_COST`, `MAX_DAILY_VIDEOS`). Originals preserved.
- **Graceful fallback:** HeyGen failure/unconfigured → keep the **silent** clip, surface the error, refund reserved
  credits (mirror `/api/create-talking-video`).
- If HeyGen exposes an audio-only/TTS endpoint, swap the extract step (skip the video render) — mux unchanged.

## 8. Scene sequence, camera cuts, templates + the `optimize` addendum

- **Sequence executor** (parent §6.2): ordered `SequenceStep[]` (each `{actorId, clip, loops?, hardCut}`) played
  as **hard cuts** at boundaries via the Phase-3 `SceneController` (switch active action per step). **Crossfades
  deferred / not faked** — a crossfade request falls back to a hard cut (documented) or isn't offered.
- **Camera cuts:** `CameraBookmark[]` jumped to per step (real).
- **Templates:** repo JSON, `GET /api/scenes/templates`; map generic clip names to the actor's real clips,
  **skip steps whose clips don't exist** (never invent a clip).
- **Scene CRUD:** `POST /api/scenes` (`{ actors[], environment, steps, cameras }`), `GET /api/scenes/:id`,
  `POST /api/scenes/backgrounds` (location/upload/prompt, parent §6.3), owner-scoped.
- **Optimize preset addendum (small, opt-in):** implement the lossy `optimize` glTF preset (resample/weld/KTX2/
  Draco) as a **separate, clearly-labeled** path; `manifest.lossless=false`; never rename animations or remove
  morph targets; ungate the `POST /api/animator/jobs` `optimize` 400 only once this exists.

## 9. New endpoints (Phase 4)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/scenes/environments` | Curated CC0/owned environment presets. |
| `GET` | `/api/scenes/scripts` | Curated pre-made voiceover scripts. |
| `GET` | `/api/scenes/templates` | Pre-scripted scene templates. |
| `POST` | `/api/scenes/backgrounds` | Prepare a custom backdrop (location/upload/prompt). |
| `POST` | `/api/scenes` · `GET /api/scenes/:id` | Scene descriptor CRUD (multi-actor + environment). |
| `POST` | `/api/scenes/voiceover` | HeyGen audio + ffmpeg audio-bed mux onto a recording (≤10 s). |
| `POST/GET/PUT/DELETE` | `/api/animator/projects[/:id]` | **From §0.1** — project persistence. |

All `requireAuth`, owner-scoped, zod-validated.

## 10. Tests (tsx-runnable `.mjs`; `tsc --noEmit` clean)

- `tests/scene_environments.test.mjs` — every bundled env JSON passes zod, `license ∈ {CC0,owned,generated}` +
  `source`/`sourceUrl`; `lightingFor` returns distinct sane profiles per time-of-day (night → low sun + stars;
  afternoon → high sun); weather outside `allowedWeather` normalized to `clear`.
- `tests/scene_scripts.test.mjs` — `estimateSpeechSeconds` monotonic; 8–10 s cap accepts ~20–25-word lines,
  rejects/trims over-length; every script `estimatedSeconds ≤ MAX_CLIP_SECONDS`.
- `tests/scene_sequence.test.mjs` — hard-cut executor advances steps in order; steps with missing clips are
  skipped (not invented); camera bookmark applied per step.
- Plus the **§0.3** controller/scene/defaults/projects suites.
- Keep Phase 1–3 animator tests green.

## 11. Definition of done (Phase 4)

- [ ] §0 closed: project persistence + endpoints; recordings mirrored to bucket; the 4 missing Phase-3 test
      suites written and passing under `tsx`.
- [ ] `GET /api/scenes/environments` lists basic/generic/captured-HDRI presets (all CC0/owned, license recorded,
      imported via `scripts/import-environments.mjs`); `.blend`→HDRI default; `glb-scene` opt-in.
- [ ] Time-of-day auto-adjusts lighting via `lightingFor`; weather renders real particle/fog within
      `allowedWeather`; ambient + weather sound preview live and mux into the exported clip (≤10 s).
- [ ] Voiceover: pre-made scripts load; 8–10 s cap enforced; `POST /api/scenes/voiceover` produces a voiced MP4
      (HeyGen + ffmpeg mux) reusing existing HeyGen/credit logic; silent fallback on failure.
- [ ] Scene sequence (hard cuts) + camera cuts + templates work; missing clips skipped, never invented.
- [ ] `npm run test` (tsx) green for new suites; `npm run lint` (tsc) clean; no original mutated; no faked
      crossfades/volumetrics.

## 12. After Phase 4
- **Phase 3b — AR multi-model cast** (parent §6.5): `scene_actors`, `/api/ar/:avatarId/cast`, hit-test placement.
- Polish: crossfades/blended sequencing, morph-target UI, camera-bookmark UI, multiple brain-driven AR agents —
  all still architected-but-not-faked until built.
