import { Screen } from "./types";

const BRAND = "Pawsome3D";
const PUBLIC_TITLE = "Pawsome3D | Create 3D Pet Models, Videos & Keepsakes";
const PUBLIC_DESCRIPTION = "Turn your pet photos into 3D models, animated videos, custom styles, Pawprints designs, and shareable digital keepsakes with Pawsome3D.";

const PRIVATE_TITLES: Partial<Record<Screen, string>> = {
  [Screen.DASHBOARD]: "Home",
  [Screen.MODELS]: "Furball3D Model Builder",
  [Screen.ANIMATOR]: "Video Creator & 3D Animator",
  [Screen.PAWPRINTS]: "Pawprints Studio",
  [Screen.PAWLISHER]: "Fido's Styles",
  [Screen.FURBIN]: "Fur Bin",
  [Screen.CREATIONS]: "Creations",
  [Screen.ALBUMS]: "My Albums",
  [Screen.PROFILE]: "Profile",
  [Screen.STORE]: "Store",
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

/** Keeps crawl metadata consistent with this client-routed application. */
export function syncSeoMetadata(screen: Screen, isAuthenticated: boolean) {
  const publicPage = !isAuthenticated && screen === Screen.SIGN_UP;
  const title = publicPage ? PUBLIC_TITLE : `${PRIVATE_TITLES[screen] || "Pawsome3D"} | ${BRAND}`;
  const description = publicPage
    ? PUBLIC_DESCRIPTION
    : "Private Pawsome3D studio workspace.";
  const canonical = publicPage ? `${window.location.origin}/` : `${window.location.origin}${window.location.pathname}`;
  const robots = publicPage
    ? "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
    : "noindex,nofollow,noarchive";

  document.title = title;
  upsertMeta('meta[name="description"]', { name: "description", content: description });
  upsertMeta('meta[name="robots"]', { name: "robots", content: robots });
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  upsertCanonical(canonical);
}
