import { Screen } from "./types";

export interface ShellNavigationItem {
  id: string;
  label: string;
  screen: Screen;
  materialIcon: string;
  imageSrc?: string;
}

export const TOP_PRIMARY_NAV: ShellNavigationItem[] = [
  { id: "create", label: "Create", screen: Screen.CREATE, materialIcon: "add_circle", imageSrc: "/brand/furball3d.jpg" },
  { id: "marketplace", label: "Marketplace", screen: Screen.MARKETPLACE, materialIcon: "storefront" },
  { id: "pawprints", label: "Pawprints", screen: Screen.PAWPRINTS, materialIcon: "auto_stories", imageSrc: "/brand/pawprints.png" },
];

/**
 * SHELL_ICON_NAV — the four stencil icons in the header's right corner.
 *
 * Deliberately exactly four. The header previously carried ten controls on the
 * right (Pet Health, Store, Community, theme, profile, PupCoins, help, two
 * admin buttons, logout), which is why nothing in it read as primary. Those
 * controls are not deleted — everything except the four below now lives in the
 * profile overflow menu, so the shell keeps one obvious row of destinations.
 *
 * "Stencil" here means stroke-only lucide glyphs at a uniform 1.75 stroke
 * width, no fills and no pill/border chrome. Active state is carried by colour
 * and a dot, not by a filled background, so all four stay visually equal
 * weight. `screens` lists every route that should light the icon — the Create
 * flow spans five screens and must not go dark mid-flow.
 */
export interface ShellIconNavItem {
  id: string;
  label: string;
  screen: Screen;
  /** Every screen that counts as "inside" this destination, for active state. */
  screens: Screen[];
}

export const SHELL_ICON_NAV: ShellIconNavItem[] = [
  {
    id: "create",
    label: "Create",
    screen: Screen.CREATE,
    screens: [
      Screen.CREATE,
      Screen.CREATE_REFERENCE,
      Screen.CREATE_CUSTOMIZE,
      Screen.CREATE_VALIDATE,
      Screen.CREATE_CHECKOUT,
    ],
  },
  { id: "marketplace", label: "Marketplace", screen: Screen.MARKETPLACE, screens: [Screen.MARKETPLACE] },
  { id: "pawprints", label: "Pawprints", screen: Screen.PAWPRINTS, screens: [Screen.PAWPRINTS, Screen.PAWLISHER] },
  { id: "profile", label: "Profile", screen: Screen.PROFILE, screens: [Screen.PROFILE] },
];

export const SIDEBAR_NAV: ShellNavigationItem[] = [
  { id: "home", label: "Home", screen: Screen.DASHBOARD, materialIcon: "home" },
  { id: "fur-bin", label: "Fur Bin©️", screen: Screen.FURBIN, materialIcon: "inventory_2" },
  { id: "marketplace-side", label: "Marketplace", screen: Screen.MARKETPLACE, materialIcon: "storefront" },
  { id: "wags-inbox", label: "Wags", screen: Screen.WAGS_INBOX, materialIcon: "redeem" },
  // RD-1: "Animate" removed while Animation Studio is gated behind
  // UnderConstructionLock — the shell must never navigate to a dead end.
  // Restore this entry when the studio unlocks.
];

export const MOBILE_NAV = [...SIDEBAR_NAV, { id: "profile", label: "Profile", screen: Screen.PROFILE, materialIcon: "person" }];
