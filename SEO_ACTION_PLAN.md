# SEO Action Plan — Pawsome3D

**Audited:** 2026-07-21, against the live site at `https://pawsome3d.com`.
All findings below were verified by fetching the production HTML, not inferred
from source.

**Context:** this plan is the prerequisite for the marketplace build-out. Member
listings will add hundreds of indexable pages, and every problem below would be
multiplied across them — so fix the routing layer first.

---

## Executive summary

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Every page declares the homepage as its canonical | 🔴 **Critical** | Low |
| 2 | Every route serves identical title / description / OG tags | 🔴 **Critical** | Low (same fix as #1) |
| 3 | No per-page structured data beyond Organization | 🟠 High | Medium |
| 4 | Landing-page content is thin relative to target queries | 🟠 High | Medium |
| 5 | No `lastmod` accuracy or image sitemap | 🟡 Medium | Low |
| 6 | No breadcrumbs, no internal linking strategy | 🟡 Medium | Medium |
| 7 | Marketplace listings will need their own indexable routes | 🟡 Medium (blocking) | High |

**What's already right:** robots.txt correctly disallows app routes while allowing
marketing pages; the sitemap exists with 12 sensible URLs; `index.html` carries a
complete OG/Twitter set and an `Organization` + `WebSite` JSON-LD graph;
`src/seo.ts` already holds per-screen titles and descriptions. The metadata work
is largely done — it just never reaches a crawler.

---

## Finding 1 — Canonical points to `/` on every page 🔴

### The evidence

```
$ curl -s https://pawsome3d.com/pricing | grep canonical
<link rel="canonical" href="https://pawsome3d.com/" />

$ curl -s https://pawsome3d.com/pet-memorial-models | grep canonical
<link rel="canonical" href="https://pawsome3d.com/" />
```

### Why this is the worst item on the list

A canonical tag is not a hint — it is a directive telling Google *"this URL is a
duplicate; index the other one instead."* Every landing page is currently
instructing Google to drop it in favour of the homepage.

This directly contradicts your sitemap, which submits all 12 URLs for indexing.
When a sitemap and a canonical disagree, **the canonical wins**. The practical
result is that `/3d-pet-models`, `/custom-dog-figurines`,
`/pet-memorial-models`, `/how-it-works` and `/pricing` — the entire organic
acquisition strategy — are self-excluded from the index.

`og:url` has the same problem, so every social share also resolves to the
homepage.

### The fix

Covered by the single change in **Finding 2**. Do them together.

### How to verify afterwards

```bash
for p in / /pricing /3d-pet-models /custom-dog-figurines /pet-memorial-models /how-it-works; do
  echo -n "$p -> "; curl -s "https://pawsome3d.com$p" | grep -oE 'rel="canonical" href="[^"]*"'
done
```

Each must echo its own URL. Then in Google Search Console → URL Inspection, check
that "User-declared canonical" matches "Google-selected canonical".

---

## Finding 2 — Identical metadata on every route 🔴

### The evidence

```
/                    <title>Pawsome3D | Create 3D Pet Models, Videos & Keepsakes</title>
/pricing             <title>Pawsome3D | Create 3D Pet Models, Videos & Keepsakes</title>
/3d-pet-models       <title>Pawsome3D | Create 3D Pet Models, Videos & Keepsakes</title>
/pet-memorial-models <title>Pawsome3D | Create 3D Pet Models, Videos & Keepsakes</title>
```

### Root cause

`server.ts:7076` serves the same static `index.html` for every non-asset path:

```js
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
```

`src/seo.ts` *does* set correct per-screen titles — but only in the browser,
after JavaScript executes. Googlebot renders JS and will eventually see them, but:

- **Social scrapers do not run JS.** Facebook, LinkedIn, X, Slack, iMessage,
  WhatsApp all read the raw HTML. Every shared link shows the same generic card
  regardless of what was shared.
- Rendering is a second, deferred crawl pass. Metadata present in the initial
  HTML is used immediately and weighted more reliably.
- Bing, and most AI crawlers, are far less consistent at JS rendering.

### The fix — server-side metadata injection

You have a genuine advantage here: you run **Express**, not a static host. You
don't need SSR, a framework migration, or a prerender service. You need to
string-replace four tags before sending the HTML.

**Step 1.** Create `server/seoMeta.ts` — a server-side mirror of the route table
in `src/seo.ts`:

```ts
export interface PageMeta { title: string; description: string; }

export const PAGE_META: Record<string, PageMeta> = {
  "/":                     { title: "Custom 3D Pet Models Made to Keep | Pawsome3D", description: "Turn pet photos into personalized 3D models, validate the design, and order a physical keepsake." },
  "/3d-pet-models":        { title: "Custom 3D Printed Pet Models | Pawsome3D",       description: "Create a personalized 3D pet model from photos and prepare it for printing as a meaningful keepsake." },
  "/custom-dog-figurines": { title: "Custom Dog Figurines from Your Photos | Pawsome3D", description: "Create a personalized dog figurine with breed, pose, collar, tag, and memorial options." },
  "/pet-memorial-models":  { title: "Pet Memorial Models and Keepsakes | Pawsome3D",  description: "Honor a beloved companion with a personalized memorial model designed for physical printing." },
  "/how-it-works":         { title: "How Custom 3D Pet Models Work | Pawsome3D",      description: "Upload photos, personalize the model, check printability, and order your physical pet keepsake." },
  "/pricing":              { title: "3D Pet Model and Pawprint Pricing | Pawsome3D",  description: "See how model creation, customization, Pawprints, and physical printing are priced." },
  "/marketplace":          { title: "Pet 3D Model Marketplace | Pawsome3D",           description: "Browse customizable pet models, accessories, memorial pieces, and seasonal keepsakes." },
  "/pawprints":            { title: "Personalized Pawprints Pet Art | Pawsome3D",     description: "Create digital and printable pet keepsakes with your photos, message, and chosen occasion." },
};

const ORIGIN = process.env.APP_URL || "https://pawsome3d.com";

/** Escape for safe insertion into an HTML attribute. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function injectMeta(html: string, pathname: string): string {
  const meta = PAGE_META[pathname];
  if (!meta) return html;                       // unknown route: leave defaults
  const url = ORIGIN + (pathname === "/" ? "/" : pathname);

  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/,       `$1${esc(meta.description)}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/,      `$1${esc(meta.title)}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/,`$1${esc(meta.description)}$2`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/,        `$1${esc(url)}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,     `$1${esc(meta.title)}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,`$1${esc(meta.description)}$2`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/,             `$1${esc(url)}$2`);
}
```

**Step 2.** Read the template once at boot and serve the injected version.
Replace the `app.get('*')` handler at `server.ts:7075`:

```ts
import fs from "node:fs";
import { injectMeta } from "./server/seoMeta";

// Read once — this file changes only on deploy.
const INDEX_HTML = fs.readFileSync(path.join(distPath, "index.html"), "utf8");

app.get('*', (req, res) => {
  if (ASSET_EXT.test(req.path)) {
    return res.status(404).type("txt").send("Not found");
  }
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(injectMeta(INDEX_HTML, req.path));
});
```

**Step 3.** Guard it with a test asserting each route's canonical is its own URL,
so a future refactor can't silently regress it.

**Step 4.** Confirm the client doesn't fight the server. `src/seo.ts` sets the
title on mount; that's fine and desirable for client-side navigation. Just make
sure the strings match, or a crawler that renders JS sees the title change.

### Effort

Roughly 60 lines and one test. No dependencies, no build change, no framework.

### Why not the alternatives

- **Prerendering (`vite-plugin-ssr`, `react-snap`)** — adds a build step and a
  second source of truth for routes. Unnecessary when you control the server.
- **A prerender service (Prerender.io)** — monthly cost, external dependency, and
  it only serves bots, which risks cloaking inconsistencies.
- **Full SSR** — a large migration for a marketing-page problem.

---

## Finding 3 — Structured data is Organization-only 🟠

You have `Organization` and `WebSite` in the JSON-LD graph. That earns brand
knowledge-panel eligibility but nothing page-level.

### Add, per page type

**`/pricing`** — `Product` with `offers`, so pricing can show in rich results:

```json
{
  "@type": "Product",
  "name": "Custom 3D Pet Model",
  "description": "A personalized 3D model generated from your pet's photos.",
  "brand": { "@id": "https://pawsome3d.com/#organization" },
  "offers": {
    "@type": "AggregateOffer",
    "priceCurrency": "USD",
    "lowPrice": "5.00",
    "highPrice": "100.00",
    "offerCount": 4
  }
}
```

**`/how-it-works`** — `HowTo` with one `HowToStep` per stage (Upload, Customize,
Validate, Print). This is one of the few schema types that still reliably earns
expanded SERP real estate.

**`/faq` (create this page)** — `FAQPage`. Source the questions from real support
themes: turnaround time, printability, what happens if the model fails, refunds,
whether you keep rights to your pet's model.

**Marketplace listings (when built)** — `Product` + `Offer` per listing with
`availability` and `price`. This is what makes a marketplace surface in shopping
and product-comparison results, and it's the main SEO reason to build listing
routes properly.

### How to implement

Extend `injectMeta()` to also swap a `<!--PAGE_JSONLD-->` placeholder in
`index.html` for a per-route script block. Same mechanism as Finding 2 — one
placeholder, one lookup table.

### Verify

Google Rich Results Test (`search.google.com/test/rich-results`) on each URL, and
Search Console → Enhancements after a week.

---

## Finding 4 — Landing-page content depth 🟠

The landing pages target commercial-intent queries — *"custom dog figurine"*,
*"pet memorial 3D model"* — which are competitive. Thin pages that are mostly
product UI with a paragraph of copy don't rank for those.

### Per landing page, add

1. **800–1,200 words of genuinely useful content.** Not keyword filler — the
   things a buyer actually asks: how the likeness is captured, what breeds work
   best, what the material feels like, what size to choose, what happens with a
   blurry photo.
2. **An FAQ block** (5–8 questions) marked up with `FAQPage`.
3. **Real example images with descriptive `alt` text.** You have
   `public/featured-models/*` already — currently used only on the dashboard.
4. **An internal link** to `/how-it-works` and `/pricing` with descriptive anchor
   text — not "click here".
5. **One clear primary CTA**, repeated at top and bottom.

### Priority order

`/pet-memorial-models` first. Memorial intent has the highest emotional urgency
and lowest price sensitivity, and the query set is less contested than generic
"3d printed pet".

---

## Finding 5 — Sitemap hygiene 🟡

Current sitemap is valid but static.

1. **Make `lastmod` real.** A hardcoded date that never changes is ignored;
   worse, a future-dated one erodes trust. Generate the sitemap at build time
   from actual file mtimes or the deploy date.
2. **Drop `/create` and `/marketplace` from the sitemap** *or* remove them from
   robots' disallow list — pick one. Right now `/create` is submitted but is an
   authenticated app route. Submitting a page that requires login wastes crawl
   budget and can register as a soft-404.
3. **Add an image sitemap** once landing pages carry real photography.
4. **Add `/faq`** when it exists.

---

## Finding 6 — Internal linking and breadcrumbs 🟡

There is currently no crawlable path from the homepage to the landing pages —
they exist in the route table but nothing links to them.

1. **Add a footer** with links to all public pages. Footers are the standard,
   low-friction way to make marketing pages discoverable to crawlers.
2. **Add `BreadcrumbList` JSON-LD** to landing pages.
3. **Cross-link the landing pages** to each other where genuinely relevant
   (memorial ↔ dog figurines).

Without this, those pages are only reachable via the sitemap — which works, but
passes no internal link equity.

---

## Finding 7 — Marketplace listing routes (blocking the build-out) 🟡

This is why SEO comes before the marketplace expansion.

**Required before member listings ship:**

1. **A real URL per listing** — `/marketplace/:slug`, not a query param or a
   modal. Modals cannot be indexed, shared, or linked.
2. **Slugs from the title**, with the UUID retained as the lookup key:
   `/marketplace/golden-retriever-memorial-figurine`.
3. **`injectMeta()` extended to database-backed routes.** Listing pages need a DB
   lookup for title, description, and preview image. Cache aggressively — this is
   in the request path.
4. **`Product` + `Offer` JSON-LD per listing.**
5. **A canonical decision for near-duplicate listings.** If two sellers list very
   similar models, decide now whether they're separate URLs or variants.
6. **`noindex` for unpublished, sold-out, or removed listings** — plus a plan for
   what a delisted URL returns. A 404 loses accumulated authority; a 410 is
   correct for permanent removal; a redirect to the category page is best when a
   near-equivalent exists.
7. **Paginated category pages** with `rel="next"`/`rel="prev"` semantics and a
   crawlable path to every listing.

**Also decide:** whether member-listed models are indexable at all. Opening the
index to user-generated pages invites thin-content and spam penalties at the
domain level. A common approach is to require a minimum quality bar — real
description, at least one preview, one sale, or manual approval — before a
listing becomes indexable.

---

## Suggested sequence

| Phase | Work | Why first |
|---|---|---|
| **1** | Findings 1 + 2 — server-side meta injection | Critical, low effort, unblocks everything else |
| **2** | Finding 5 — sitemap hygiene | Cheap, compounds with phase 1 |
| **3** | Finding 6 — footer + internal links | Makes the landing pages discoverable |
| **4** | Finding 3 — per-page structured data | Needs phase 1's injection mechanism |
| **5** | Finding 4 — content depth, memorial page first | Highest effort, slowest payoff, but where ranking actually comes from |
| **6** | Finding 7 — listing routes | Immediately before the marketplace build |

Phases 1–3 are roughly a day of work combined and address everything currently
preventing the marketing pages from being indexed at all.

---

## Measurement

Before starting, capture a baseline so the work can be judged:

1. **Search Console** — verify the domain if not already, submit the sitemap,
   record current impressions/clicks/indexed-page count.
2. **URL Inspection** on each landing page — note today's "Google-selected
   canonical". This is the number that should change first after phase 1.
3. **Re-check at 2 and 6 weeks.** Indexing changes surface in days; ranking
   movement takes weeks. Don't judge phase 5 content work before 6 weeks.
