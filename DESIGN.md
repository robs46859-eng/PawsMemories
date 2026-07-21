# Pawsome3D Design Specification and Review Gate

**Status:** Approved direction for the remodel
**Review owner:** Codex review/approval gate
**Effective date:** 2026-07-18
**Scope:** Homepage, UI-only Create and Marketplace shells, Pawprints positioning, navigation restructure, and locked future modules

This document is authoritative for the remodel. If an implementation choice conflicts with this document, stop and request review before merging. Do not infer a new product direction from a visual reference alone.

## 1. Product promise

Pawsome3D turns a beloved pet into a personalized object that can be previewed, validated, ordered, and kept.

The primary journey is:

```text
discover → create a pet model → approve reference → personalize → validate printability → order a physical model
```

Pawprints and the Marketplace are active supporting paths. Animation Studio, Video Generation, and Fido's Styles remain accessible but locked until separately approved for release.

## 1A. Navigation contract

The approved top navigation is exactly:

```text
Create · Marketplace · Pawprints
```

The sidebar must include a `Marketplace` entry. The existing shell, authentication, FurBin, PupCoins, and routing system remain intact.

Fido's Styles, Animation Studio, and Video Generation remain reachable through their existing routes or approved entry points, but each must render an `Under Construction` overlay and must not expose an apparently functional generation workflow.

## 1B. Backend boundary for this phase

This remodel phase is UI-only for Create and Marketplace.

- Do not add API endpoints.
- Do not change backend schemas or migrations.
- Do not alter server-side billing, PupCoins, authentication, storage, or generation behavior.
- Use safe, clearly labeled placeholders for Marketplace products and create-to-print preview data.
- Do not imply that a placeholder product is available for purchase.
- The UI must leave explicit integration points for a later backend phase without inventing contracts.

## 2. Non-negotiable design principles

### Preserve the existing identity

- Keep the current warm, premium palette and typography.
- Keep rounded geometry, glassmorphic surfaces, soft shadows, and pet-friendly language.
- Reuse existing shell components, brand assets, spacing tokens, and responsive breakpoints.
- Do not introduce a competing color system, neon visual language, or generic SaaS dashboard treatment.
- Do not replace the global shell, authentication flow, FurBin, PupCoins, or existing legal surfaces as part of the homepage remodel.

### Make 3D create/print the product

- The homepage is a showcase and conversion surface, not a module directory.
- The first viewport must make 3D creation and physical printing understandable without navigation.
- The primary CTA is `Create My 3D Model`.
- The secondary CTA is `Browse Marketplace`.
- Pawprints is a clear secondary creation path.
- Equal-weight launcher cards for every studio are not approved.

### Be honest about unfinished modules

Animation Studio, Video Generation, and Fido's Styles must:

- Remain discoverable in approved navigation locations.
- Display a lock or construction state and the exact label `Under Construction`.
- Never expose controls that imply the feature is available.
- Never start a generation job or deduct PupCoins while locked.
- Offer an optional notification/waitlist action only if it is wired to a real persistence path.
- Never be represented as broken, silently disabled, or falsely complete.

## 3. Approved homepage composition

### Header and shell

Keep the current global shell. Replace the current top product labels with `Create`, `Marketplace`, and `Pawprints`. Add `Marketplace` to the sidebar. Do not add competing primary navigation bars. The active creation path should remain visually clear. Existing product imagery may remain inside homepage sections and locked-module overlays, but it must not recreate the old top-nav contract.

### Hero

Required content:

- Headline communicating a physical pet keepsake.
- One supporting sentence explaining photo → personalized model → print.
- Primary CTA: `Create My 3D Model`.
- Secondary CTA: `Browse Marketplace`.
- At least one credible finished model render or before/after presentation.

Do not use an abstract gradient, empty canvas, or generic AI claim as the hero's only visual.

### Featured model showcase

Show finished examples, not empty states. Each item should support:

- Pet/species label.
- Finished render or model image.
- Optional original-photo comparison.
- Starting print price or `View details` if pricing is not yet available.
- Action: `Customize`, `View model`, or `Order`.

The showcase must support dogs prominently while representing cats, birds, rabbits, horses, reptiles, and small animals.

### How it works

Use four steps only:

1. Upload photos.
2. Customize the model.
3. Check printability.
4. Order the physical keepsake.

The copy must avoid promising instant perfection or guaranteed anatomical reconstruction.

### Emotional use cases

Approved themes:

- Memorial pets.
- New puppies and adopted pets.
- Family companions.
- Gifts.
- Desk/shelf keepsakes.
- Seasonal ornaments.

Avoid manipulative grief language, medical claims, or promises about preserving a pet exactly.

### Pawprints and Marketplace

Pawprints should be positioned as digital and printable keepsakes with personalized photos and text. The Marketplace should feature ready-made and customizable pet models, accessories, memorial items, and seasonal designs. Both sections must point back to the main pet-create experience where appropriate.

## 4. Create-to-print funnel contract

The implementation may use existing route names, but it must preserve these conceptual stages.

### Stage A — Subject setup

For this UI-only phase, the create flow may use local component state and safe fixtures. It must not require a new server contract.

Required data:

- Species: dog, cat, bird, rabbit, horse, reptile, small animal, other.
- Pet name.
- Photos with clear quality requirements.
- Optional breed or species refinement.
- Optional intent: memorial, gift, display, ornament.

Dogs receive the deepest refinement because dog lovers are the primary buyer, but the UI must not imply that dogs are the only supported pets.

### Stage B — Reference image approval

The server must generate one clean reference image. It must not upload a movement strip, contact sheet, sprite sheet, or multi-pose thumbnail grid as the model reference.

The user must see the generated image before paid 3D generation begins and must have:

- `Approve and Build`.
- `Remake Image`.

Remake must retain species, breed, style, and user-entered intent unless the user changes them.

### Stage C — Personalization

Approved customization categories:

- Constrained pose presets.
- Ear, tail, coat, and silhouette adjustments where supported.
- Collar, tag, hat, bow, plaque, and base accessories.
- Engraved name/message.
- Model scale and material preview.

Every customization must update the preview and any affected size, cost, or printability state. If a control cannot update the actual deliverable, it must not be presented as a real control.

### Stage D — Printability validation

The validator must check:

- Minimum wall thickness.
- Unsupported or floating geometry.
- Fragile appendages.
- Minimum engraving size.
- Non-manifold geometry and self-intersections.
- Physical bounds and scale.
- Polygon, texture, and file-size limits.

Use exactly three user-facing states:

- `Print-ready` — checkout may continue.
- `Needs adjustment` — show actionable corrections.
- `Not printable` — block checkout and explain the blocking reason.

The validator must not silently make material geometry changes without showing the user what changed.

### Stage E — Order review

For this UI-only phase, checkout is a non-purchasing review shell. It must clearly state when data is a placeholder and must not submit an order or imply that payment has occurred.

Show:

- Final preview.
- Physical dimensions.
- Material and finish.
- Print price and shipping estimate where available.
- Validation summary.
- Free JPG download for the generated reference image.
- FurBin save behavior.

## 5. Glassmorphism and component rules

- Use shared classes/tokens for glass cards, lower-opacity showcase tiles, and glass buttons.
- Standard cards are more opaque than homepage showcase tiles.
- Buttons must have visible hover, focus, disabled, and active states.
- Glass must not reduce text contrast below accessible levels.
- Do not stack multiple opaque panels over one another without a content reason.
- Do not use a new one-off `rgba()` value when an existing shared glass class can express the intent.
- Product imagery should be consistent between the homepage, top shell, and feature cards.

## 6. Data, storage, and safety boundaries

- Preserve source media and create versioned derivatives.
- Keep one world unit equal to one meter for 3D workflows.
- Record source dimensions, units, axes, and provenance before normalization.
- Do not claim dimensional accuracy without calibration or trusted metadata.
- Do not charge PupCoins for locked modules or failed validation attempts.
- Do not allow a user to reach physical checkout with a `Not printable` design.
- Keep all generated outputs in the FurBin with output type and creation date.

## 7. Review gate

An implementation is not approved until the reviewer confirms:

- Homepage hierarchy makes 3D create/print dominant.
- Existing palette and shell remain intact.
- The four-stage funnel is reachable and understandable.
- Reference approval/remake is explicit before paid mesh generation.
- Species choices include non-dog pets.
- Printability states are visible and actionable.
- Locked modules cannot run or charge.
- Top navigation is exactly Create, Marketplace, Pawprints.
- Sidebar contains Marketplace.
- Create and Marketplace use safe placeholders only; no backend/API/schema changes are present.
- Mobile and desktop layouts are both usable.
- `npm run lint`, `npm run test`, and `npm run build` pass.

Any failure above is a blocking review finding, not a polish item.
