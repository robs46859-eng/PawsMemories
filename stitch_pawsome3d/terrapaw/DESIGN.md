---
name: TerraPaw
colors:
  surface: '#faf9f5'
  surface-dim: '#dadad6'
  surface-bright: '#faf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4f0'
  surface-container: '#eeeeea'
  surface-container-high: '#e8e8e4'
  surface-container-highest: '#e2e3df'
  on-surface: '#1a1c1a'
  on-surface-variant: '#504441'
  inverse-surface: '#2f312e'
  inverse-on-surface: '#f1f1ed'
  outline: '#827470'
  outline-variant: '#d4c3be'
  surface-tint: '#77574d'
  primary: '#442a22'
  on-primary: '#ffffff'
  primary-container: '#5d4037'
  on-primary-container: '#d4ada1'
  inverse-primary: '#e7bdb1'
  secondary: '#4c616c'
  on-secondary: '#ffffff'
  secondary-container: '#cfe6f2'
  on-secondary-container: '#526772'
  tertiary: '#352f2c'
  on-tertiary: '#ffffff'
  tertiary-container: '#4c4542'
  on-tertiary-container: '#bdb3af'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd0'
  primary-fixed-dim: '#e7bdb1'
  on-primary-fixed: '#2c160e'
  on-primary-fixed-variant: '#5d4037'
  secondary-fixed: '#cfe6f2'
  secondary-fixed-dim: '#b4cad6'
  on-secondary-fixed: '#071e27'
  on-secondary-fixed-variant: '#354a53'
  tertiary-fixed: '#ece0dc'
  tertiary-fixed-dim: '#cfc4c0'
  on-tertiary-fixed: '#201a18'
  on-tertiary-fixed-variant: '#4c4542'
  background: '#faf9f5'
  on-background: '#1a1c1a'
  surface-variant: '#e2e3df'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Be Vietnam Pro
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 20px
  margin-desktop: 64px
  container-max: 1200px
---

## Brand & Style
The design system is built for the modern, active dog owner who values both the grit of an outdoor adventure and the precision of health tracking. The personality is **energetic, tactile, and grounded**. It avoids the sterile "clinical" feel of traditional pet apps in favor of an immersive, adventurous aesthetic that feels like a walk through a damp forest.

The style is a hybrid of **Minimalism** and **Tactile Modernism**. It leverages high-quality whitespace to allow 3D assets to breathe, while using soft, "squishy" interface elements that invite interaction. The emotional response is one of reliability and warmth—professional enough to trust with medical data, but playful enough to celebrate the joy of owning a dog.

## Colors
The palette captures the "muddy and wet" narrative through a sophisticated, organic lens. 

- **Primary (Bark Brown):** A deep, earthy brown used for primary actions and key structural elements. It provides the "muddy" foundation without losing professional clarity.
- **Secondary (Slate Mist):** A cool, desaturated blue-grey that evokes wet pavement and overcast skies. Used for data visualization and secondary interactive states.
- **Tertiary (Warm Cream):** A soft, comforting off-white used for cards and surfaces to prevent the UI from feeling heavy.
- **Neutral (Pebble):** An extremely light grey-beige used for global backgrounds to maintain a clean, modern canvas for 3D elements.

## Typography
The typography strategy balances playfulness with technical precision. 

**Plus Jakarta Sans** is used for headlines to provide a soft, rounded, and welcoming character. Its bold weights feel friendly and substantial. **Be Vietnam Pro** handles body copy, offering a contemporary and warm reading experience that scales beautifully across long-form content. For technical data—such as pet vitals or GPS coordinates—**Space Grotesk** is used in labels to provide a subtle "tech-forward" contrast that aligns with the 3D dashboard's innovative feel.

## Layout & Spacing
The layout follows a **fluid grid** model with generous internal padding to support the "immersive" goal. 

- **Mobile:** A 4-column grid with 20px side margins. Elements are stacked vertically to prioritize thumb-reachability.
- **Desktop:** A 12-column grid with a 1200px max-width container. 3D dashboard elements should occupy at least 6 columns of width to maintain visual dominance.
- **Rhythm:** All spacing is based on a 4px baseline unit. Use 16px (4 units) for standard component spacing and 32px (8 units) for section breaks.

## Elevation & Depth
Depth is created using **Tonal Layers** combined with **Ambient Shadows**. 

Surfaces do not use pure black shadows; instead, they use shadows tinted with the Primary Bark Brown at low opacity (8-12%) to maintain the earthy feel. To support the 3D dashboard, the design system utilizes "Object Casting"—where key UI cards appear to float slightly above the background with a soft, diffused blur (24px to 40px radius). Low-contrast outlines in the Secondary Slate color are used for inactive states to keep the UI from feeling cluttered.

## Shapes
The shape language is consistently **Rounded**. This reinforces the friendly, organic nature of the brand. 

Standard components (inputs, small buttons) use a 0.5rem radius. Larger containers, such as profile cards or dashboard widgets, use `rounded-xl` (1.5rem) to create a "container" feel that mimics smooth river stones. Interaction states should emphasize this roundness—hovering over a card should result in a slight scale-up and increased shadow spread.

## Components
- **Buttons:** Primary buttons are "Bark Brown" with white text, using `rounded-lg`. They should have a subtle inner-glow to appear slightly convex and tactile.
- **Chips:** Used for pet traits or filters. They use "Slate Mist" backgrounds with 50% opacity and `rounded-full` (pill) shapes.
- **Lists:** Items are separated by soft, Warm Cream dividers. Each item features a generous 16px padding to ensure touch targets are accessible for active owners on the move.
- **Input Fields:** These use the "Tertiary Warm Cream" as a background fill rather than a border-only style, making them feel like physical recessed wells in the UI.
- **Cards:** Dashboard cards should use backdrop-blur effects when overlapping 3D elements, creating a "frosted earth" glass effect that maintains legibility without hiding the background environment.
- **Progress Toggles:** Checkboxes and radio buttons should be oversized (24px) with high-contrast active states in Bark Brown.