---
name: Spatial Glow
colors:
  surface: '#fff8f8'
  surface-dim: '#efd3dc'
  surface-bright: '#fff8f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff0f3'
  surface-container: '#ffe8ef'
  surface-container-high: '#fee1ea'
  surface-container-highest: '#f8dbe4'
  on-surface: '#27171d'
  on-surface-variant: '#593f49'
  inverse-surface: '#3d2b32'
  inverse-on-surface: '#ffecf1'
  outline: '#8d6f7a'
  outline-variant: '#e1bdc9'
  surface-tint: '#b70071'
  primary: '#b70070'
  on-primary: '#ffffff'
  primary-container: '#e3048d'
  on-primary-container: '#120007'
  inverse-primary: '#ffb0cf'
  secondary: '#a5316c'
  on-secondary: '#ffffff'
  secondary-container: '#fe78b5'
  on-secondary-container: '#770347'
  tertiary: '#236c00'
  on-tertiary: '#ffffff'
  tertiary-container: '#2e8800'
  on-tertiary-container: '#ffffff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffd9e5'
  primary-fixed-dim: '#ffb0cf'
  on-primary-fixed: '#3d0022'
  on-primary-fixed-variant: '#8c0055'
  secondary-fixed: '#ffd9e5'
  secondary-fixed-dim: '#ffb0cf'
  on-secondary-fixed: '#3d0022'
  on-secondary-fixed-variant: '#861553'
  tertiary-fixed: '#90fc62'
  tertiary-fixed-dim: '#75de49'
  on-tertiary-fixed: '#062100'
  on-tertiary-fixed-variant: '#195200'
  background: '#fff8f8'
  on-background: '#27171d'
  surface-variant: '#f8dbe4'
typography:
  display-lg:
    fontFamily: Boldonse
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Boldonse
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Boldonse
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Changa
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-sm:
    fontFamily: Changa
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Vesper Libre
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 64px
---

## Brand & Style

This design system captures a "Spatial Glow" aesthetic specifically tailored for a cat rendering application. The brand personality is energetic, futuristic, and unashamedly fun, merging the mystery of deep space with the playful nature of feline companions. 

The visual direction utilizes a refined **Glassmorphism** approach. Interfaces are built using translucent layers that appear to float over cosmic backgrounds. In this Light Mode iteration, depth is communicated through soft prismatic refractions and vibrant "aura" gradients that emanate from interactive elements and high-quality cat renders. The emotional response should be one of wonder and excitement, like discovering a sun-lit nebula.

## Colors

The palette is rooted in a bright, ethereal atmosphere with a focus on sophisticated magentas and organic greens. The primary background is a clean, high-luminance surface, while the foundation is anchored by a dusty **Celestial Taupe (#887179)** used for neutral boundaries and subtle structural elements.

Accents are high-energy neon signals optimized for visibility on light surfaces:
- **Magenta Glow (#E3048D)**: Used for primary actions and "love" interactions.
- **Dusty Rose (#C44A85)**: Used for secondary actions and subtle technical readouts.
- **Deep Forest Neon (#38A000)**: Used for success states, highlight callouts, and "Go" actions.

Gradients should be applied to surfaces as ultra-soft washes (e.g., a 10% opacity radial gradient of Magenta Glow) to simulate light passing through crystalline structures or interstellar clouds.

## Typography

The typography strategy balances heavy impact with geometric structure, optimized for high legibility in a light-themed interface.

**Boldonse** serves as the display typeface. Its structural weight and unique character feel authoritative and futuristic. For large headings, use prominent weights to anchor the page against the airy background.

**Changa** is used for body copy. Its square-ish, modern proportions ensure high legibility against light, translucent backgrounds while maintaining a digital, sci-fi feel.

**Vesper Libre** is used for labels, metadata, and technical "rendering" stats. Its serif-influenced details provide a sophisticated contrast to the chunky headline and body fonts. All Vesper Libre labels should be in uppercase with increased letter spacing.

## Layout & Spacing

The layout follows a **Fluid Grid** philosophy to accommodate various rendering aspect ratios. 

- **Desktop**: 12-column grid with a wide 64px outer margin to allow the airy background effects to breathe.
- **Mobile**: 4-column grid with 16px margins. 

Spacing follows an 8px rhythmic scale. Use generous padding (Level: `lg`) around cat renders to create a "gallery" feel. Interactive controls should be clustered using `sm` or `md` spacing to create functional groups that float over the background.

## Elevation & Depth

In Light Mode, depth is achieved through **Prismatic Glassmorphism** and **Soft Shadows**:

1.  **The Ether (Level 0)**: The bright base background with high-key gradients and subtle "solar flare" light leaks.
2.  **Nebula Clouds (Level 1)**: Large, blurred blobs of soft magenta or green at 5% opacity, placed behind content layers.
3.  **Glass Panels (Level 2)**: Containers use a highly translucent white background with a `backdrop-filter: blur(16px)`. Edges are defined by a 1px `white` border at 40% opacity and a very soft, large-radius ambient shadow.
4.  **Glow Points (Level 3)**: Active buttons and selected states emit a soft `box-shadow` using their accent color (e.g., `0 10px 30px rgba(227, 4, 141, 0.3)`), making them appear to hover above the glass.

## Shapes

The shape language is ultra-rounded and pill-shaped to create a friendly, organic contrast against the futuristic aesthetic. 

Standard components (Cards, Modals) use **32px (2rem)** corner radii to maintain a soft, approachable feel. 
Buttons and input fields use **Full Round (Pill)** shapes to create a soft, inviting touch target. Secondary icons or "Cat Tags" should follow the high-radius theme for consistency within the glass panels.

## Components

### Buttons
Primary buttons are solid neon (Magenta or Green) with white or high-contrast dark text. They should have a "bloom" effect on hover, where the outer glow intensifies and the button lifts slightly. Secondary buttons use the "Glass" style with a colored border and 10% fill.

### Chips / Tags
Used for cat breeds or render settings. These should be semi-transparent with a 1px border matching the accent color. Use `Vesper Libre` for the text inside chips, rendered in a slightly darker tone of the accent color for legibility.

### Cards (The "Bio-Pod")
Cards containing cat renders have a soft "frosted glass" background. Upon hover, the glass becomes more opaque, and a subtle "Magenta" glow highlights the card's perimeter.

### Input Fields
Search bars and text inputs are pill-shaped with a light, translucent fill and a subtle inner shadow to suggest a recessed surface. The focus state should change the border color to Forest Green.

### Progress Bars (Rendering)
Use a dual-tone gradient (Magenta to Rose). The progress bar container should be a faint gray track, with the active "head" emitting a bright glow.

### Custom Component: The "Aura" Toggle
Switch components should bleed soft color into the surrounding glass panel when toggled "on," creating a localized glow effect that feels like a light turning on behind frosted glass.