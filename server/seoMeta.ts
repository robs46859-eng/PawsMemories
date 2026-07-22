/**
 * Server-side per-route metadata injection.
 *
 * Problem this solves: `app.get('*')` served one static `dist/index.html` for
 * every route, so every page shipped `<link rel="canonical" href="https://pawsome3d.com/">`.
 * A canonical is a directive, not a hint — every landing page was telling Google
 * "I'm a duplicate of the homepage, index that instead", which contradicted and
 * overrode the sitemap. `og:url` had the same problem, so social shares all
 * resolved to the homepage too.
 *
 * `src/seo.ts` already sets correct per-screen titles, but only after JS runs.
 * Social scrapers (Facebook, LinkedIn, X, Slack, iMessage, WhatsApp) never run
 * JS, and JS-rendered metadata is a deferred second crawl pass for search.
 *
 * The fix is a string replace on the head before sending. No SSR, no prerender
 * service, no build change. Keep the strings here in sync with `src/seo.ts` so a
 * crawler that *does* render JS doesn't see the title change under it.
 */

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute or root-relative image for OG/Twitter cards. Optional. */
  image?: string;
}

export const PAGE_META: Record<string, PageMeta> = {
  "/": {
    title: "Custom 3D Pet Models Made to Keep | Pawsome3D",
    description:
      "Turn pet photos into personalized 3D models, validate the design, and order a physical keepsake.",
  },
  "/3d-pet-models": {
    title: "Custom 3D Printed Pet Models | Pawsome3D",
    description:
      "Create a personalized 3D pet model from photos and prepare it for printing as a meaningful keepsake.",
  },
  "/custom-dog-figurines": {
    title: "Custom Dog Figurines from Your Photos | Pawsome3D",
    description:
      "Create a personalized dog figurine with breed, pose, collar, tag, and memorial options.",
  },
  "/pet-memorial-models": {
    title: "Pet Memorial Models and Keepsakes | Pawsome3D",
    description:
      "Honor a beloved companion with a personalized memorial model designed for physical printing.",
  },
  "/how-it-works": {
    title: "How Custom 3D Pet Models Work | Pawsome3D",
    description:
      "Upload photos, personalize the model, check printability, and order your physical pet keepsake.",
  },
  "/pricing": {
    title: "3D Pet Model and Pawprint Pricing | Pawsome3D",
    description:
      "See how model creation, customization, Pawprints, and physical printing are priced.",
  },
  "/marketplace": {
    title: "Pet 3D Model Marketplace | Pawsome3D",
    description:
      "Browse customizable pet models, accessories, memorial pieces, and seasonal keepsakes.",
  },
  "/pawprints": {
    title: "Personalized Pawprints Pet Art | Pawsome3D",
    description:
      "Create digital and printable pet keepsakes with your photos, message, and chosen occasion.",
  },
  "/create": {
    title: "Create Your Custom 3D Pet Model | Pawsome3D",
    description:
      "Upload a photo to generate a custom 3D pet model, personalize it, and prepare for printing.",
  },
};

const ORIGIN = (process.env.APP_URL || "https://pawsome3d.com").replace(/\/+$/, "");

/** Escape for safe insertion into an HTML attribute or text node. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Normalize a request path to a metadata key: strip the query string, strip a
 * trailing slash (except for root), and lowercase. `/Pricing/?utm=x` -> `/pricing`.
 */
export function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0].split("#")[0];
  const lowered = withoutQuery.toLowerCase();
  if (lowered.length > 1 && lowered.endsWith("/")) {
    return lowered.replace(/\/+$/, "") || "/";
  }
  return lowered || "/";
}

/**
 * Canonical URL for a path. Unknown routes still get a self-referential
 * canonical rather than inheriting the homepage's — that is the whole bug.
 */
export function canonicalFor(pathname: string): string {
  const normalized = normalizePath(pathname);
  return normalized === "/" ? `${ORIGIN}/` : `${ORIGIN}${normalized}`;
}

/**
 * Rewrite title, description, OG and Twitter tags, and the canonical link.
 *
 * Unknown routes keep the template's title/description (the generic brand copy
 * is a reasonable fallback) but still get a self-referential canonical, so app
 * routes never claim to be the homepage.
 */
export function injectMeta(html: string, pathname: string): string {
  const normalized = normalizePath(pathname);
  const url = canonicalFor(normalized);
  const meta = PAGE_META[normalized];

  // Always fix the canonical and og:url, even for routes without page copy.
  let out = html
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*(")/i, `$1${esc(url)}$2`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${esc(url)}$2`);

  if (!meta) return out;

  const title = esc(meta.title);
  const description = esc(meta.description);

  out = out
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${description}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, `$1${title}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, `$1${description}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i, `$1${title}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i, `$1${description}$2`);

  if (meta.image) {
    const image = esc(meta.image.startsWith("http") ? meta.image : `${ORIGIN}${meta.image}`);
    out = out
      .replace(/(<meta\s+property="og:image"\s+content=")[^"]*(")/i, `$1${image}$2`)
      .replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*(")/i, `$1${image}$2`);
  }

  return out;
}
