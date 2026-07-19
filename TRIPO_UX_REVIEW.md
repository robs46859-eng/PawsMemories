# Tripo3D UX Review → Pawsome3D Pet-Focused Flow
**Reviewed:** tripo3d.ai homepage + feature-page template (image-to-3D). Purpose: adopt Tripo's user flow and layout patterns for Pawsome3D, refocused on pets. No dates/timelines.

---

## 1. What Tripo's site actually is

Two cleanly separated surfaces:

| Surface | Domain | Role |
|---|---|---|
| Marketing site | tripo3d.ai | SEO landing pages, feature pages, gallery, blog, pricing. Every CTA deep-links into the studio with a `?from=` attribution tag |
| Studio (app) | studio.tripo3d.ai | The actual tool: `/workspace/generate`, `/workspace/overview?project=…`, public model pages `/3d-model/:id`. Login prompted at entry (`?open=login`), "free to start, no sign-up" messaging |

Pawsome3D already halfway matches this (landing pages + app in one SPA); the review below is about adopting the *patterns*, not splitting domains.

## 2. Homepage layout (top → bottom) and what each section does

1. **Hero** — full-bleed background video of models forming, one headline ("The Best AI 3D Workspace"), one subline, ONE CTA ("Start for Free"), and a "Scroll to Discover" wheel indicator. No feature list, no nav clutter. The single sticky header button ("Try Tripo Studio") repeats the same action.
2. **Logo strip** — infinite-scroll social proof (Tencent, Sony, Bambu Lab…) immediately under the hero.
3. **Feature sections in WORKFLOW ORDER** — this is the core trick. The page walks the product pipeline top to bottom, one section per stage, each built the same way:
   - Section label + linked H3 (feature page)
   - One-sentence value prop
   - **Interactive-looking before/after demo** (input card → animated output video) — shows the actual UI widget (drag-drop zone with "JPG, PNG, WEBP ≤5MB", a sample prompt in a text box)
   - One CTA deep-linking to that stage in the studio (`from=landingpage_generator`, `_segmentation`, `_texturing`, `_rigging`)
   - Order: **Generate (image/text) → Segment → Texture → Rig & Animate**
4. **Stats counters** — 1000X efficiency, 99% time saved, 50% cost reduction (animated count-up).
5. **Industry tabs** — Gaming / 3D Printing / Animation & Film / Product Design / AR-VR / Architecture.
6. **Community stats** — 6.5M creators, 100M models.
7. **Feedback carousel** on video background.
8. **Gallery** — real generated models, each card = thumbnail + the exact prompt used + link to a PUBLIC model page (`/3d-model/:id`). Doubles as SEO food and "try this prompt" inspiration.
9. **Floating signup card** — bottom corner: "Text & Image to 3D · Free Credits Monthly · Create Now."
10. **Deep footer** — features, industries, plugins, blog, pricing (also the SEO sitemap).

## 3. Feature-page template (repeated per capability)

Numbered rail structure: Hero (headline + demo video + single CTA) → partner logos → showcase cases (each linking to a live studio project) → 3 "why" cards → capability explainer (single-view vs multi-view) → **"How to Use" in 4 steps: Upload → Generate → (Optional) Enhance → Download** → testimonial wall → FAQ (schema-ready Q&A) → blog cross-links → repeat CTA. Every page ends with the same "Ready to create?" CTA block.

## 4. The user flow being sold (and what to copy)

```
Land → see it work in the hero → one click "Start for Free"
  → Studio: upload image OR type text → Generate (fast draft)
  → Optional enhance stages, each its own button: Texture · Segment · Rig · Animate · Stylize
  → Download (GLB/STL/OBJ/FBX) or send to print/game engine
```

Key properties: **(a)** generation first, refinement optional — the user gets a model before making any decisions; **(b)** each enhancement is a separately purchasable, separately clickable stage on the model page, not a wizard; **(c)** every marketing section deep-links to its stage; **(d)** public model pages make output shareable and SEO-indexable; **(e)** "free to start" removes the entry gate — money appears only at enhancement/export depth.

## 5. Mapping onto Pawsome3D (pet-focused)

Pawsome3D's current create flow is a 5-step wizard (Reference → Customize → Validate → Checkout) that ends in a paid build. Tripo's flow is **generate cheap/free first, then upsell stages on the result**. Recommended adoption:

### 5.1 Homepage (replace current HomePage hero area)
| Tripo pattern | Pawsome3D pet version |
|---|---|
| Hero video of models forming | Video of a pet photo turning into a rotating 3D pet figurine (use a real pipeline capture) |
| "The Best AI 3D Workspace" | "Your Pet, In 3D" / sub: "From one photo to a lifelike 3D model — printed, rigged, or animated" |
| One CTA "Start for Free" | One CTA "Turn a Photo Into 3D" → `/create?from=hero` (reference step is already free-preview) |
| Logo strip | Substitute: press mentions, print-partner logos (Slant3D/Printful/Treatstock), community counters (models created, Pawprints sent) |
| Workflow-ordered sections | **Photo → 3D** (drag-drop card w/ pet photo) → **Personalize** (pose/engraving demo) → **Rig & Animate** (+35, tail-wag preview — the new checkbox) → **Print & Keepsakes** (figurine + Pawprints) — each with its own deep-link CTA (`from=landing_generate`, `_personalize`, `_rigging`, `_print`) |
| Industry tabs | Moment tabs: Memorials · Gifts · Gamers (rigged pets) · Collectibles · Pawprints cards |
| Gallery w/ prompts + public pages | Gallery of real pet models, each card = original photo thumbnail + result + breed caption, linking to a **public share page `/model/:id`** (new, shareable + SEO) |
| Floating signup card | "First reference image free · PupCoins monthly bonus" card |

### 5.2 App flow changes (Tripo-izing the wizard)
1. **Generate before checkout.** Keep the free reference step, but after approval land the user on a **model overview page** (Tripo's `workspace/overview`) showing the 3D result with **stage buttons**: `Personalize` · `Rig (+35)` · `Facial rig (+20)` · `Order print` · `Send as Pawprint` · `Download GLB`. The P3/P4 rigging work already supports post-hoc staging (static stored first, rig stage separable) — this UI matches that architecture.
2. **Each stage = one button + one price** on the overview, replacing buried checkboxes. The customize-screen checkboxes remain for users who pre-select, but the overview is the hub.
3. **Public model pages** (`/model/:id`, owner opt-in): viewer + "Made from one photo" caption + CTA "Make yours" — the single strongest growth loop on Tripo's site.
4. **`from=` attribution** on every marketing CTA → log in the create-session so you can see which section converts.
5. **Feature pages** (SEO, using Tripo's template): `/photo-to-3d-pet-model`, `/pet-memorial-models` (exists), `/rigged-pet-models-for-games`, `/3d-printed-pet-figurines`, `/pawprints-photo-cards` — each with the 4-step "How it works" (Upload photo → Generate → Enhance → Print/Download), pet testimonial wall, FAQ block.

### 5.3 What NOT to copy
- Tripo's segmentation/texturing stages have no pet-product equivalent — don't invent them; the pet flow's equivalents are Personalize (pose/engraving) and Fido's Styles (when unlocked).
- Tripo's login-on-entry (`open=login`) — Pawsome3D's free reference preview *before* signup is a stronger hook for consumers; keep money and account gates after the wow moment.
- Multi-domain split (studio subdomain) — unnecessary at current scale.

### 5.4 Build order (no dates)
1. Homepage rebuild to §5.1 section order (hero video capture, workflow sections, moment tabs, gallery).
2. Model overview page with stage buttons (wires to existing endpoints: rig stage, slant3d checkout, pawprints send, library download).
3. Public share pages + gallery feed.
4. Feature-page set from the §3 template with FAQ schema.
5. `from=` attribution through create-sessions; measure section→conversion.
