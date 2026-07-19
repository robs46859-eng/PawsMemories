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

export const SIDEBAR_NAV: ShellNavigationItem[] = [
  { id: "home", label: "Home", screen: Screen.DASHBOARD, materialIcon: "home" },
  { id: "fur-bin", label: "Fur Bin©️", screen: Screen.FURBIN, materialIcon: "inventory_2" },
  { id: "marketplace-side", label: "Marketplace", screen: Screen.MARKETPLACE, materialIcon: "storefront" },
  // RD-1: "Animate" removed while Animation Studio is gated behind
  // UnderConstructionLock — the shell must never navigate to a dead end.
  // Restore this entry when the studio unlocks.
];

export const MOBILE_NAV = [...SIDEBAR_NAV, { id: "profile", label: "Profile", screen: Screen.PROFILE, materialIcon: "person" }];
