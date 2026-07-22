---
name: Spatial Glow
colors:
  surface: '#1e0f15'
  surface-dim: '#1e0f15'
  surface-bright: '#47343b'
  surface-container-lowest: '#180a10'
  surface-container-low: '#27171d'
  surface-container: '#2b1b21'
  surface-container-high: '#36252c'
  surface-container-highest: '#423037'
  on-surface: '#f8dbe4'
  on-surface-variant: '#e1bdc9'
  inverse-surface: '#f8dbe4'
  inverse-on-surface: '#3d2b32'
  outline: '#a88893'
  outline-variant: '#593f49'
  surface-tint: '#ffb0cf'
  primary: '#ffb0cf'
  on-primary: '#63003b'
  primary-container: '#e3048d'
  on-primary-container: '#120007'
  inverse-primary: '#b70071'
  secondary: '#ffb0cf'
  on-secondary: '#63003b'
  secondary-container: '#861553'
  on-secondary-container: '#ff94c1'
  tertiary: '#75de49'
  on-tertiary: '#0f3900'
  tertiary-container: '#2e8800'
  on-tertiary-container: '#ffffff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
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
  background: '#1e0f15'
  on-background: '#f8dbe4'
  surface-variant: '#423037'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
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

The visual direction utilizes a refined **Glassmorphism** approach. Interfaces are built using translucent layers that appear to float over cosmic backgrounds. Depth is not communicated through traditional shadows, but through light: neon outer glows and vibrant "aura" gradients that emanate from interactive elements and high-quality cat renders. The emotional response should be one of wonder and excitement, like discovering a neon-lit nebula.

## Colors

The palette is rooted in a dusty cosmic haze. The background utilizes a warm, muted **Muted Dusk (#887179)** foundation, providing a softer alternative to pure black.

Accents have shifted toward a sophisticated magenta and organic green spectrum:
- **Magenta Glow (#E3048D)**: Used for primary actions and "love" interactions.
- **Deep Rose (#C44A85)**: Used for secondary actions, technical readouts, and rendering progress.
- **Forest Neon (#38A000)**: Used for success states, highlight callouts, and "Go" actions.

Gradients should be applied subtly to surfaces (e.g., a 15% opacity radial gradient of Magenta Glow in the corner of a card) to simulate the reflection of nearby stars or neon lights.

## Typography

The typography strategy balances playfulness with technical precision. 

**Plus Jakarta Sans** serves as the display typeface. Its rounded terminals and geometric structure feel friendly yet modern. For large headings, use "ExtraBold" weight to anchor the page.

**Hanken Grotesk** is used for body copy. It is a clean, contemporary sans-serif that ensures high legibility against dark, complex backgrounds. 

**Space Mono** is used sparingly for labels, metadata, and technical "rendering" stats to reinforce the futuristic, sci-fi theme of the app. All Space Mono labels should be in uppercase with increased letter spacing.

## Layout & Spacing

The layout follows a **Fluid Grid** philosophy to accommodate various rendering aspect ratios. 

- **Desktop**: 12-column grid with a wide 64px outer margin to allow the background effects to breathe.
- **Mobile**: 4-column grid with 16px margins. 

Spacing follows an 8px rhythmic scale. Use generous padding (Level: `lg`) around cat renders to create a "gallery" feel. Interactive controls should be clustered using `sm` or `md` spacing to create functional groups that float over the background.

## Elevation & Depth

Depth is achieved through **Glassmorphism** and **Luminance** rather than shadows:

1.  **The Void (Level 0)**: The base background (#887179) with subtle CSS-animated "star" particles.
2.  **Nebula Clouds (Level 1)**: Large, blurred blobs of color (Magenta/Rose) at 10% opacity, placed behind content layers.
3.  **Glass Panels (Level 2)**: Containers use a translucent dark background with a `backdrop-filter: blur(12px)`. These panels must have a 1px border of `white` at 10% opacity to define their edges.
4.  **Glow Points (Level 3)**: Active buttons and selected states emit a soft `box-shadow` using their accent color (e.g., `0 0 20px rgba(227, 4, 141, 0.5)`).

## Shapes

The shape language is consistently rounded to mirror the friendly brand personality. 

Standard components (Cards, Modals) use **16px (1rem)** corner radii. 
Buttons and input fields use **Full Round (Pill)** shapes to create a soft, inviting touch target that contrasts against the "technical" monospaced labels.
Secondary icons or "Cat Tags" should use the **8px (0.5rem)** radius for a slightly tighter, more organized look within glass panels.

## Components

### Buttons
Primary buttons are solid neon Magenta with white text for maximum contrast. They should have a "bloom" effect on hover, where the outer glow intensifies. Secondary buttons use the "Glass" style with a colored border.

### Chips / Tags
Used for cat breeds or render settings. These should be semi-transparent with a 1px border matching the accent color. Use `Space Mono` for the text inside chips.

### Cards (The "Bio-Pod")
Cards containing cat renders should have no visible background until hovered. Upon hover, the glass panel effect fades in, and a subtle "Magenta" glow highlights the card's perimeter.

### Input Fields
Search bars and text inputs are pill-shaped with a dark, translucent fill. The focus state should change the border color to Forest Neon and add a subtle inner glow.

### Progress Bars (Rendering)
Use a dual-tone gradient (Magenta to Rose). The progress "head" should have a bright white glow to indicate the active rendering point.

### Custom Component: The "Aura" Toggle
Switch components should not just move; they should bleed color into the surrounding glass panel when toggled "on," creating a small localized nebula effect.x`