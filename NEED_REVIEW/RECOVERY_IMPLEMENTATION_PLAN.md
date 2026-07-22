# Pawsome3D Recovery Plan and Checklist

Status legend: `[ ]` pending, `[~]` in progress, `[x]` verified.

## Phase 0 — Baseline and deployment audit

- [x] Preserve and inventory pre-existing uncommitted work.
- [x] Run TypeScript validation.
- [x] Run the production build.
- [x] Record current build warning: oversized client chunks require later splitting.
- [x] Resolve duplicate Sharp/libvips native builds by aligning the app and glTF toolchain on Sharp 0.34.
- [x] Verify the public deployment responds and identify the still-deployed logo path as 404 before release.
- [ ] Inspect private deployment-provider runtime logs and production secrets in the Hostinger panel.

## Phase 1 — Animator first

- [x] Replace the tiny static script feed with 120 validated voice scripts.
- [x] Replace caption-like director choices with 108 action-bearing scene scripts.
- [x] Add freshness/randomization controls without producing invalid clip names.
- [x] Stop director clips from restarting on every rendered frame.
- [x] Refresh director playback when cast mappings change or the timeline loops.
- [x] Wire Play, Pause, Seek, Speed, Camera, Weather, Cast, Voice, and capture controls to the live scene.
- [x] Add tests for script uniqueness, event actions, replay/reset, and control behavior.
- [x] Run the Animator doctor and full regression suite.
- [x] Keep the functional Pro Animator as the default live Animator path.

## Phase 2 — Deployment, branding, home, and photo input

- [x] Repair the logo asset/public path and render the brand image in the header.
- [x] Reconcile the home page and add history-aware browser routes.
- [x] Fix photo picker events, formats, validation, ordering, previews, and visible errors.
- [x] Increase the photo drop/input target and JSON upload capacity to 50 MB on media routes.
- [x] Pin Node 24 LTS compatibility and pass the production build under Node 24.18.0.

## Phase 3 — Furball3D and model builder

- [x] Inventory every remake button and map all six choices to regeneration actions.
- [x] Add confirmation, loading, success refresh, failure, and retry states.
- [x] Add missing navigation paths and deep-link handling.
- [x] Ensure the selected model output style reaches both pet and object generation prompts.
- [x] Test styles produce distinct request contracts.

## Phase 4 — Pawprints templates

- [x] Inventory the nine Pawprints categories and template coverage.
- [x] Search for genuinely free/redistributable layouts in matching categories.
- [x] Record source, license, and original URL for every added layout.
- [x] Add four CC0-backed layout choices to every category.
- [x] Verify category/layout uniqueness and editor selection through automated tests.

## Phase 5 — Wardrobe

- [x] Select the CC0 Quaternius Modular Character Outfits library.
- [x] Add 15 lightweight browser wardrobe derivatives.
- [x] Store source license and URL with every catalog item.
- [x] Add authenticated per-user selection persistence with a maximum of 15 items.
- [x] Validate explicit meter units, attachment anchors, axes, and dimensions in tests.

## Phase 6 — Fidos Styles

- [x] Repair the model viewer and make camera updates apply live.
- [x] Wire the viewer actions, wardrobe selections, downstream Animator, and Pawprints paths.
- [x] Add a control panel for orbit, zoom, lighting, background, reset, and fullscreen.
- [x] Enable mouse/touch orbit, zoom, and pan with responsive controls.

## Phase 7 — Release verification

- [x] `npm run lint` equivalent under Node 24.18.0
- [x] `npm run test` equivalent under Node 24.18.0 (488 passing)
- [x] `npm run test:ar` equivalent under Node 24.18.0 (136 passing)
- [x] `npm run build` equivalent under Node 24.18.0
- [x] Built-server HTTP smoke tests for every repaired route.
- [ ] Verify the updated logo and UI on production after this revision is deployed.
