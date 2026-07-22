# Spatial Glow Light and Dark UI Implementation Plan

Updated: 2026-07-22  
Status: Planned  
Source designs: `liteDESIGN.md`, `darkDESIGN.md`  
Tracker: `PHASED_IMPLEMENTATION.md`

## Objective

Implement the Spatial Glow light and dark designs across the application without duplicating page-level styling or changing product behavior. The result must preserve legibility, touch usability, 3D viewport space, and a comfortable visible gutter around bordered or glowing panels on small mobile screens.

This is a cross-cutting UI track. It begins only after the active Phase 0 release-stability gate is complete and should be delivered in small vertical slices so functional product phases can continue independently.

## Design Sources and Reconciliation

- `liteDESIGN.md` is authoritative for the light palette, prismatic glass treatment, light-mode typography, radii, controls, and elevation.
- `darkDESIGN.md` is authoritative for the dark palette, luminance treatment, dark-mode typography, tighter radii, controls, and elevation.
- Shared spacing, responsive layout, focus behavior, semantic states, and component APIs must have one implementation.
- Mode-specific typefaces and radii are intentional source differences. Load fonts without blocking rendering and test mode changes for layout shift.
- Remove the stray trailing `x\`` in the final dark-mode Aura Toggle sentence before treating that document as implementation-ready.
- If a source value fails contrast, touch-target, overflow, or reduced-motion requirements, accessibility and usability take precedence and the deviation must be recorded here.

## Architecture

### Theme Contract

Create one semantic token layer using CSS custom properties. Components consume semantic roles rather than literal colors:

- Surfaces: background, base surface, elevated surface, glass surface, inverse surface.
- Content: primary text, secondary text, inverse text, disabled text.
- Actions: primary, secondary, success, destructive, focus, and their foreground colors.
- Structure: subtle outline, strong outline, divider, shadow, glow, and backdrop blur.
- Shape: card, modal, control, tag, and pill radii.
- Typography: display, headline, body, small body, and technical label families and metrics.
- Layout: page gutters, content maximum width, section gaps, panel padding, and safe-area offsets.

Apply light tokens at `:root` and dark tokens through one explicit attribute such as `html[data-theme="dark"]`. Do not scatter mode checks through React components when CSS tokens can express the difference.

### Theme Selection

- Offer Light, Dark, and System choices in an accessible settings control.
- Use the operating-system preference on first visit.
- Persist an explicit user choice locally.
- Apply the resolved theme before the application paints to prevent a bright/dark flash.
- Update `color-scheme`, browser chrome metadata where supported, and 3D viewer clear colors with the resolved mode.
- Listen for system-theme changes only while the user preference remains System.

### Component Strategy

Implement or normalize shared primitives before restyling individual pages:

- Application shell, header, navigation, page container, section, and responsive grid.
- Glass panel, card/Bio-Pod, modal, drawer, popover, and tooltip.
- Buttons, icon buttons, inputs, text areas, selectors, chips, tags, Aura Toggle, and progress bars.
- Empty, loading, warning, error, success, and disabled states.
- 3D viewport frame, overlays, model metadata, rendering progress, and viewer controls.

Keep feature logic in existing components. Migrate visual behavior into shared primitives and tokens instead of rewriting working routes.

## Mobile Border and Margin Standard

The design documents specify a 16px mobile margin, but that is too tight when a panel also has a border, glow, or shadow. Treat 16px as the **minimum visible clearance outside all panel effects**, not merely the container's CSS margin.

- Set the normal mobile page gutter to `clamp(20px, 6vw, 24px)`.
- Add left and right safe-area insets independently. Content must not sit beneath a notch or rounded screen edge.
- Preserve at least 16px of visible space from the viewport edge to a bordered panel, including its shadow or glow footprint.
- Use `box-sizing: border-box` globally so borders never expand a component beyond its allocated width.
- Do not use negative horizontal margins for ordinary cards, forms, dialogs, or 3D controls.
- Full-bleed media is an explicit component variant; its controls and captions still align to the safe content gutter.
- Nested panels must not compound outer margins or reduce content below a practical width.
- Dialogs and bottom sheets use the same safe-area rules and retain a visible edge on 320px-wide screens.
- Horizontal chip or toolbar groups may scroll internally, but the document itself must never overflow horizontally.
- Touch targets must be at least 44px by 44px with sufficient separation.
- Compact mobile controls must not cover the pet/model focal area or critical 3D navigation controls.

Suggested layout variables:

```css
:root {
  --page-gutter-fluid: clamp(20px, 6vw, 24px);
  --page-gutter-left: max(var(--page-gutter-fluid), calc(env(safe-area-inset-left) + 16px));
  --page-gutter-right: max(var(--page-gutter-fluid), calc(env(safe-area-inset-right) + 16px));
}
```

## Implementation Slices

### Slice A: Inventory and Baseline

- Inventory global styles, literal colors, duplicated component styles, theme handling, viewport wrappers, overlays, and known horizontal overflow.
- Capture baseline screenshots for representative public, authenticated, creation, Fur Bin, animator, BIM, stationery, checkout, subscription, and assistant screens.
- Record the current theme mechanism and determine which components can migrate without behavioral changes.
- Add automated overflow and viewport-edge measurements before changing layout.

### Slice B: Tokens and Theme Runtime

- Add semantic light and dark token maps from both design documents.
- Add font loading with local or approved hosted assets, fallback metrics, and `font-display` behavior.
- Implement Light, Dark, and System preference resolution and persistence.
- Prevent first-paint theme flashing.
- Add unit tests for preference precedence, persistence, and live system changes.

### Slice C: Shell and Shared Primitives

- Apply the responsive application shell and mobile gutter standard.
- Implement shared glass, card, form, action, feedback, and overlay primitives.
- Verify keyboard focus, hover, active, disabled, loading, and error states in both modes.
- Respect `prefers-reduced-motion` and provide a non-blur fallback where backdrop filtering is unsupported or too expensive.

### Slice D: Feature Migration

- Migrate routes by vertical slice, beginning with the shared shell and highest-traffic Create and Fur Bin flows.
- Continue through the model viewer/animator, BIM builder, stationery/print, subscription, checkout, account, and Randy assistant.
- Preserve route behavior and existing analytics during visual migration.
- Remove obsolete literal styles only after each route passes comparison and functional tests.

### Slice E: Accessibility, Performance, and Release

- Verify WCAG AA contrast for body text, controls, focus indicators, errors, success states, and text over glass/gradients.
- Verify keyboard navigation, labels, screen-reader names, zoom to 200%, reduced motion, and high-contrast behavior.
- Measure font, background-effect, and blur costs on representative mobile hardware.
- Lazy-load noncritical decorative effects and disable expensive effects when performance budgets are exceeded.
- Complete visual regression, functional, build, and extracted-archive checks before rollout.

## Required Test Matrix

- Modes: Light, Dark, and System resolving to each mode.
- Viewport widths: 320px, 360px, 390px, 430px, 768px, 1024px, and 1440px.
- Mobile orientation: portrait and landscape for at least one narrow and one modern-device viewport.
- Browser engines: Chromium, WebKit/mobile Safari equivalent, and Firefox where the existing test stack permits.
- States: default, hover, keyboard focus, active, disabled, loading, empty, validation error, server error, and success.
- Content stress: long names, large prices, translated-length labels, multiline errors, missing images, and oversized model metadata.
- Accessibility: automated scan plus manual keyboard, zoom, contrast, and reduced-motion review.

## Exit Criteria

- [ ] Light mode matches `liteDESIGN.md` through shared semantic tokens and primitives.
- [ ] Dark mode matches `darkDESIGN.md` through the same component structure.
- [ ] Light, Dark, and System selection works without a first-paint flash and persists correctly.
- [ ] No page has document-level horizontal overflow at any required viewport.
- [ ] Bordered/glowing mobile panels retain at least 16px visible edge clearance.
- [ ] Screenshots at 320px, 360px, 390px, and 430px confirm comfortable panel and viewport spacing.
- [ ] Touch targets, safe areas, dialogs, bottom sheets, and 3D overlays pass mobile review.
- [ ] Critical text and controls meet WCAG AA contrast in both modes.
- [ ] Reduced-motion and reduced-effects behavior is available.
- [ ] Existing feature tests, type checking, production build, and deployment archive verification pass.
- [ ] Before/after screenshots and any approved design deviations are recorded in the phase evidence.

## Agent Boundaries

- The design-system agent owns theme tokens, theme runtime, global layout primitives, and visual-regression fixtures.
- Feature agents migrate only their assigned route groups after shared primitives stabilize.
- The accessibility reviewer does not rewrite feature logic; it records and verifies focused corrections.
- The release reviewer validates the final extracted artifact and mobile screenshot evidence.
- No UI agent edits database migrations, release provenance, billing rules, storage semantics, or model-generation contracts.

## Required Project Memory

Each implementation update records changed routes, token changes, screenshots, test viewports, accessibility results, performance findings, exceptions, branch, commit, and archive evidence in `PHASED_IMPLEMENTATION.md` and `handoff.md`. Agent summaries without repository evidence do not close this track.
