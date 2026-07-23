import { Screen } from "./types";

const BRAND = "Pawsome3D";

const PUBLIC_METADATA: Partial<Record<Screen, { title: string; desc: string }>> = {
  [Screen.DASHBOARD]: {
    title: `Custom 3D Pet Models Made to Keep | ${BRAND}`,
    desc: "Turn pet photos into personalized 3D models, validate the design, and order a physical keepsake."
  },
  [Screen.LANDING_MODELS]: {
    title: `Custom 3D Printed Pet Models | ${BRAND}`,
    desc: "Create a personalized 3D pet model from photos and prepare it for printing as a meaningful keepsake."
  },
  [Screen.LANDING_DOGS]: {
    title: `Custom Dog Figurines from Your Photos | ${BRAND}`,
    desc: "Create a personalized dog figurine with breed, pose, collar, tag, and memorial options."
  },
  [Screen.LANDING_MEMORIALS]: {
    title: `Pet Memorial Models and Keepsakes | ${BRAND}`,
    desc: "Honor a beloved companion with a personalized memorial model designed for physical printing."
  },
  [Screen.PAWPRINTS]: {
    title: `Personalized Pawprints Pet Art | ${BRAND}`,
    desc: "Create digital and printable pet keepsakes with your photos, message, and chosen occasion."
  },
  [Screen.HOW_IT_WORKS]: {
    title: `How Custom 3D Pet Models Work | ${BRAND}`,
    desc: "Upload photos, personalize the model, check printability, and order your physical pet keepsake."
  },
  [Screen.PRICING]: {
    title: `3D Pet Model and Pawprint Pricing | ${BRAND}`,
    desc: "See how model creation, customization, Pawprints, and physical printing are priced."
  },
  [Screen.CREATE]: {
    title: `Create Your Custom 3D Pet Model | ${BRAND}`,
    desc: "Upload a photo to generate a custom 3D pet model, personalize it, and prepare for printing."
  },
  [Screen.SIGN_UP]: {
    title: `Sign In | ${BRAND}`,
    desc: "Sign in to Pawsome3D to create and order personalized pet models."
  }
};

const PRIVATE_TITLES: Partial<Record<Screen, string>> = {
  [Screen.MODELS]: "Furball3D Model Builder",
  [Screen.ANIMATOR]: "Video Creator & 3D Animator",
  [Screen.PAWLISHER]: "Fido's Styles",
  [Screen.FURBIN]: "Fur Bin",
  [Screen.ALBUMS]: "My Albums",
  [Screen.PROFILE]: "Profile",
  [Screen.STORE]: "Store",
  [Screen.VOICE_TEST]: "Voice and Lip-Sync Test",
  [Screen.BIM]: "Scaled BIM Preview",
  [Screen.COMMUNITY]: "Community",
};

function upsertMeta(selector: string, attributes: Record<string, string>) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([name, value]) => element!.setAttribute(name, value));
}

function upsertCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
}

function upsertJsonLd(id: string, data: any | null) {
  let element = document.head.querySelector<HTMLScriptElement>(`script#${id}`);
  if (!data) {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement("script");
    element.id = id;
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(data);
}

/** Keeps crawl metadata consistent with this client-routed application. */
export function syncSeoMetadata(screen: Screen, isAuthenticated: boolean) {
  const publicMeta = PUBLIC_METADATA[screen];
  const isPublicPage = !!publicMeta;
  
  const title = isPublicPage ? publicMeta.title : `${PRIVATE_TITLES[screen] || "Pawsome3D"} | ${BRAND}`;
  const description = isPublicPage
    ? publicMeta.desc
    : "Private Pawsome3D studio workspace.";
  const canonical = `${window.location.origin}${window.location.pathname}`;
  const robots = isPublicPage
    ? "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
    : "noindex,nofollow,noarchive";

  document.title = title;
  upsertMeta('meta[name="description"]', { name: "description", content: description });
  upsertMeta('meta[name="robots"]', { name: "robots", content: robots });
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  
  // Ensure we add a placeholder image for public pages if required (can be generic for now)
  if (isPublicPage) {
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: `${window.location.origin}/MAIN4.jpg` });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  }

  upsertCanonical(canonical);

  // Structured Data
  if (screen === Screen.DASHBOARD) {
    upsertJsonLd("schema-org", {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "Pawsome3D",
      "url": "https://pawsome3d.com",
      "logo": "https://pawsome3d.com/brand/pawsome-logo.png"
    });
    upsertJsonLd("schema-website", {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Pawsome3D",
      "url": "https://pawsome3d.com"
    });
  } else {
    upsertJsonLd("schema-org", null);
    upsertJsonLd("schema-website", null);
  }
}
