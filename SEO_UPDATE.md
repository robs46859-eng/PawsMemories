# Pawsome3D SEO Update Specification

**Status:** Implementation specification
**Review owner:** Codex review/approval gate
**Effective date:** 2026-07-18
**Primary goal:** Make Pawsome3D discoverable for 3D pet models, custom pet figurines, pet memorial keepsakes, Pawprints, and a future pet 3D marketplace.

**Current implementation boundary:** The Create and Marketplace pages in this remodel are UI shells with safe placeholders. SEO must describe the product direction without inventing live inventory, checkout, prices, reviews, or API-backed product availability.

This document is the full SEO brief for the SEO implementation agent. SEO changes must not compromise the authenticated application, private media, or product flow.

## 1. Search positioning

### Primary topic

Custom 3D pet models and printed pet figurines.

### Secondary topics

- Custom dog figurines.
- 3D cat models.
- Pet memorial sculptures.
- Personalized pet keepsakes.
- 3D printed pet gifts.
- Custom pet ornaments.
- Pawprints personalized pet art.
- Pet 3D marketplace.

### Audience

- Dog lovers and pet parents.
- People seeking memorial gifts.
- People buying personalized pet gifts.
- Users looking for a custom 3D printed pet model.
- Marketplace shoppers seeking pet accessories and keepsakes.

Do not optimize the public site primarily for animation, video generation, or Fido's Styles while those modules are Under Construction.

## 2. Public URL and page requirements

Create or confirm indexable public pages with stable canonical URLs:

| URL | Purpose | Primary topic |
|---|---|---|
| `/` | Main product landing page | custom 3D pet models |
| `/create` | UI shell for the guided creation path | custom 3D pet models |
| `/3d-pet-models` | Educational/product landing page | 3D printed pet models |
| `/custom-dog-figurines` | Dog-focused landing page | custom dog figurines |
| `/pet-memorial-models` | Memorial landing page | pet memorial keepsakes |
| `/pawprints` | Pawprints product page | personalized pet art |
| `/marketplace` | UI shell for future marketplace browsing | pet 3D marketplace |
| `/how-it-works` | Process explainer | photo to printed model |
| `/pricing` | Transparent pricing explanation | custom pet model pricing |

Authenticated studio routes, FurBin content, account pages, private media, admin pages, and unfinished modules must remain `noindex, nofollow` unless separately reviewed.

## 3. Metadata specification

Every public page must have:

- One unique `<title>` between approximately 50–60 characters.
- One unique meta description between approximately 140–160 characters.
- One canonical URL.
- Open Graph title, description, URL, and image.
- Twitter/X card metadata.
- A relevant social preview image with a real finished model or product.
- Correct language and viewport metadata.

Recommended metadata:

| Page | Title | Description direction |
|---|---|---|
| `/` | `Custom 3D Pet Models Made to Keep | Pawsome3D` | Turn pet photos into personalized 3D models, validate the design, and order a physical keepsake. |
| `/3d-pet-models` | `Custom 3D Printed Pet Models | Pawsome3D` | Create a personalized 3D pet model from photos and prepare it for printing as a meaningful keepsake. |
| `/custom-dog-figurines` | `Custom Dog Figurines from Your Photos | Pawsome3D` | Create a personalized dog figurine with breed, pose, collar, tag, and memorial options. |
| `/pet-memorial-models` | `Pet Memorial Models and Keepsakes | Pawsome3D` | Honor a beloved companion with a personalized memorial model designed for physical printing. |
| `/pawprints` | `Personalized Pawprints Pet Art | Pawsome3D` | Create digital and printable pet keepsakes with your photos, message, and chosen occasion. |
| `/marketplace` | `Pet 3D Model Marketplace | Pawsome3D` | Browse customizable pet models, accessories, memorial pieces, and seasonal keepsakes. |
| `/how-it-works` | `How Custom 3D Pet Models Work | Pawsome3D` | Upload photos, personalize the model, check printability, and order your physical pet keepsake. |
| `/pricing` | `3D Pet Model and Pawprint Pricing | Pawsome3D` | See how model creation, customization, Pawprints, and physical printing are priced. |

Do not use repeated titles, keyword lists, or claims such as “perfect likeness” unless substantiated.

## 4. Structured data

Implement JSON-LD only on relevant public pages:

- `Organization` on the homepage.
- `WebSite` on the homepage, including a valid site name.
- `Product` for specific marketplace products with real price, currency, availability, and image data.
- `BreadcrumbList` on nested public pages.
- `FAQPage` only when the visible page contains the same questions and answers.
- `HowTo` only for the visible create-to-print process.

Do not emit Product schema for unavailable, placeholder, or Under Construction modules. Do not fabricate reviews, ratings, prices, inventory, or shipping times. Do not create SEO promises that require a backend endpoint in this phase.

## 5. On-page content requirements

The homepage should include crawlable text, not text embedded only in images:

- What Pawsome3D creates.
- How photo-to-model creation works.
- What pets are supported.
- How printability is checked.
- What Pawprints are.
- What the Marketplace contains.
- A clear explanation of digital versus physical products.

Use natural language. Avoid keyword stuffing and repeated variations of “3D pet model” in every heading.

## 6. Internal linking

Required public links:

- Homepage → Create.
- Homepage → 3D Pet Models.
- Homepage → Marketplace.
- Homepage → Pawprints.
- Homepage → How It Works.
- Homepage → Pricing.
- 3D Pet Models → Create flow.
- Memorial page → Create flow with memorial intent.
- Marketplace placeholder → clearly labeled future product experience; no false purchase action.
- Pawprints → Create Pawprint flow.

Do not link public crawlers into authenticated-only screens that return an app shell without useful public content.

## 7. Technical SEO

Verify:

- `robots.txt` permits public pages and blocks private app routes.
- `sitemap.xml` contains only canonical public URLs returning 200.
- Private routes return `X-Robots-Tag: noindex, nofollow` where applicable.
- Canonicals do not point to staging, localhost, query-string, or authenticated URLs.
- Public pages render meaningful server-visible HTML or stable pre-rendered metadata.
- Images have descriptive alt text, explicit dimensions, responsive loading, and modern formats where practical.
- Hero and model images are not unnecessarily oversized.
- Core navigation works without JavaScript where possible.
- 404 pages are useful and do not return a 200 status.
- Redirects are single-hop and preserve canonical paths.
- No secret, signed-media, user email, or private creation URL appears in public HTML or JSON-LD.

## 8. Image SEO

Use descriptive filenames and alt text such as:

- `custom-3d-dog-model.jpg`
- `personalized-pet-memorial-figurine.jpg`
- `pawprints-personalized-pet-art.jpg`

Alt text should describe the visible image and purpose. Do not stuff keywords or describe invisible product claims.

## 9. Content roadmap

Recommended public articles or guides:

1. How to prepare photos for a custom 3D pet model.
2. What makes a 3D printed pet model printable?
3. Custom dog figurine ideas for gifts and memorials.
4. How pet memorial models are designed.
5. Pawprints versus 3D printed keepsakes.
6. Choosing model size, material, and finish.

Each article should link to a relevant product or creation path and include a reviewed author/date policy.

## 10. Measurement and QA

Track:

- Organic landing-page sessions.
- Organic clicks to `Create My 3D Model`.
- Marketplace entry clicks.
- Pawprints entry clicks.
- Indexed public URLs.
- Search impressions and click-through rate by landing page.
- Core Web Vitals on public pages.
- Conversion rate from public landing page to authenticated creation.

Before approval, the SEO agent must provide:

- URL and metadata inventory.
- Rendered HTML inspection for every public page.
- Structured-data validation results.
- Sitemap and robots verification.
- Broken-link report.
- Mobile and desktop screenshots or equivalent QA evidence.
- Confirmation that private routes and signed media are not indexable.

## 11. SEO implementation-agent prompt

Use this exact brief:

> Act as the SEO implementation agent for Pawsome3D. Read `SEO_UPDATE.md` completely before editing. Inspect the existing router, `src/seo.ts`, server-rendered entry handling, sitemap, robots rules, public/private route boundaries, and image assets. Implement only the public SEO scope defined in this document. Preserve authentication, FurBin privacy, signed media, existing visual design, and all application routes. The top navigation contract is `Create · Marketplace · Pawprints`; do not restore the old Furball3D · Pawprints · Fido's Styles contract. Do not make Animation Studio, Video Generation, or Fido's Styles indexable while they are Under Construction. Create and Marketplace are UI shells with safe placeholders in this phase: do not add API endpoints, backend schema changes, migrations, billing behavior, product inventory, checkout behavior, or fabricated product data. Add or repair canonical metadata, Open Graph/Twitter metadata, public landing-page copy, JSON-LD, sitemap, robots, internal links, image alt text, and 404 behavior according to the specification. Never invent prices, reviews, inventory, ratings, product availability, or shipping promises. Use stable absolute canonical URLs based on `APP_URL`. Keep private/authenticated routes noindex. Run `npm run lint`, `npm run test`, and `npm run build`. Then inspect the generated public HTML and report the exact URLs, metadata, structured data, sitemap entries, blocked routes, and any unresolved SEO risks. Stop and request review if a change would alter product behavior or expose private user content.
