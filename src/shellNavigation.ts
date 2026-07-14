import { Screen } from "./types";

export interface ShellNavigationItem {
  id: string;
  label: string;
  screen: Screen;
  materialIcon: string;
}

export const TOP_PRIMARY_NAV: ShellNavigationItem[] = [
  { id: "furball", label: "Furball3D©️", screen: Screen.MODELS, materialIcon: "pets" },
  { id: "pawprints", label: "Pawprints", screen: Screen.PAWPRINTS, materialIcon: "auto_stories" },
  { id: "fidos-styles", label: "Fido's Styles", screen: Screen.PAWLISHER, materialIcon: "brush" },
];

export const SIDEBAR_NAV: ShellNavigationItem[] = [
  { id: "home", label: "Home", screen: Screen.DASHBOARD, materialIcon: "home" },
  { id: "fur-bin", label: "Fur Bin©️", screen: Screen.FURBIN, materialIcon: "inventory_2" },
  { id: "profile", label: "Profile", screen: Screen.PROFILE, materialIcon: "person" },
  { id: "fidos-styles", label: "Fido's Styles", screen: Screen.PAWLISHER, materialIcon: "brush" },
];

export const MOBILE_NAV = SIDEBAR_NAV;
