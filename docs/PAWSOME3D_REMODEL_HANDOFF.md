# Pawsome3D Remodel Handoff

## Product position

Pawsome3D helps people turn a beloved pet into a customizable, printable keepsake. The primary business path is **3D create → personalize → validate → print**. Pawprints and the marketplace are supporting paths. Animation Studio, Video Generation, and Fido's Styles remain visible but locked as **Under Construction**.

Preserve the existing warm premium palette, rounded geometry, glassmorphism, and friendly pet-centered tone.

## Homepage wireframe

```text
┌──────────────────────────────────────────────────────────────┐
│ Global shell: logo · Create · Marketplace · Pawprints · profile│
├──────────────────────────────────────────────────────────────┤
│ HERO                                                         │
│                                                              │
│  Turn your pet into something you can hold.   [3D render]   │
│  Upload a photo, personalize the model, and print it.       │
│  [Create My 3D Model]  [Browse Marketplace]                 │
├──────────────────────────────────────────────────────────────┤
│ FEATURED MODELS                                              │
│ [model] [model] [model] [model]                               │
│ Original photo · 3D result · size · starting price           │
├──────────────────────────────────────────────────────────────┤
│ HOW IT WORKS                                                 │
│ 1 Upload → 2 Customize → 3 Validate → 4 Print              │
├──────────────────────────────────────────────────────────────┤
│ PERSONAL STORIES                                             │
│ Memorials · new puppies · gifts · family companions         │
├──────────────────────────────────────────────────────────────┤
│ PAWPRINTS                                                     │
│ Digital keepsakes, cards, and personalized artwork           │
│ [Create a Pawprint]                                          │
├──────────────────────────────────────────────────────────────┤
│ MARKETPLACE                                                   │
│ Breed models · memorial pieces · accessories · seasonal     │
│ [Explore the Marketplace]                                    │
├──────────────────────────────────────────────────────────────┤
│ LOCKED MODULES                                               │
│ [Animation Studio — Under Construction]                      │
│ [Video Generation — Under Construction]                      │
│ [Fido's Styles — Under Construction]                         │
└──────────────────────────────────────────────────────────────┘
```

## Homepage behavior

- The first viewport must make 3D creation and physical printing the dominant action.
- The primary CTA is always **Create My 3D Model**.
- The secondary CTA is **Browse Marketplace**.
- Do not present the homepage as a grid of equal-weight module launchers.
- Featured model cards should show a finished result, not an empty placeholder.
- Use the existing product imagery and glass treatment, but give showcase tiles slightly lower opacity than standard content cards.
- Every marketplace or model card should expose a clear next action: customize, view, or order.

## Create-to-print screen map

### `/create`

Purpose: choose the pet subject and begin the guided flow.

Required controls:

- Species: dog, cat, bird, rabbit, horse, reptile, small animal, other
- Dog breed suggestion and manual override
- Pet name
- Photo upload with clear image requirements
- Optional memorial / gift intent

### `/create/reference`

Purpose: generate one clean reference image.

Required behavior:

- Show progress and the selected subject type.
- Never send a movement/contact sheet as the reference image.
- Show the generated image before starting the paid 3D build.
- Provide **Approve and Build** and **Remake Image**.
- Remake must preserve the user's species, breed, and style choices.

### `/create/customize`

Purpose: personalize the model while keeping it printable.

Controls:

- Pose presets constrained to printable poses
- Ear, tail, coat, and silhouette adjustments
- Collar, tag, hat, bow, plaque, and base accessories
- Engraved name/message
- Model scale and print material preview

Every control must display its effect in the 3D preview and update estimated size and price.

### `/create/validate`

Purpose: verify that the design can be manufactured.

Validation categories:

- Minimum wall thickness
- Unsupported/floating geometry
- Fragile appendages
- Minimum engraving size
- Mesh manifoldness and intersections
- Physical bounds and scale
- Polygon/texture budget

Statuses:

- **Print-ready** — user may continue
- **Needs adjustment** — show actionable fixes
- **Not printable** — block checkout and explain why

### `/create/checkout`

Purpose: choose a size, review price, and order.

Show:

- Final preview
- Physical dimensions
- Material and finish
- Print price
- Shipping estimate
- Validation report summary
- Digital JPG download, free
- Order confirmation and FurBin save

## Pet and dog-lover priorities

The system must support pets broadly, but dog workflows should receive the deepest refinement:

- Breed-aware suggestions
- Coat color and pattern
- Ear and tail profiles
- Collar/tag personalization
- Memorial plaque options
- Gift-ready packaging and seasonal accessories

## Locked modules

Animation Studio, Video Generation, and Fido's Styles should:

- Remain visible in navigation and on the homepage
- Display a clear lock icon and **Under Construction** label
- Never expose controls that appear functional
- Never deduct PupCoins
- Offer an optional notification signup
- Explain that the core 3D create/print workflow is available now

## Acceptance criteria

- A first-time visitor understands the 3D print product without opening a secondary module.
- A user can reach a physical-print estimate in four guided stages or fewer.
- A generated reference image must be approved before paid 3D generation begins.
- Invalid printable geometry cannot reach checkout.
- Species selection is not dog-only.
- The homepage preserves the current brand palette and glassmorphic language.
- Locked modules are visually honest and non-interactive beyond the construction notice.
- All finished outputs are saved to the user's FurBin with type and creation date.

## Implementation order

1. Homepage information architecture and hero.
2. Create-to-print route shell and navigation.
3. Reference-image approval/remake gate.
4. Customization state model and constrained controls.
5. Printability validator and actionable warnings.
6. Marketplace and Pawprints homepage sections.
7. Under Construction gating.
8. End-to-end QA across mobile, desktop, signed-out, and low-memory devices.

