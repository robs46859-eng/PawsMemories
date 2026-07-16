import { Screen } from "./types";

export interface ShellNavigationItem {
  id: string;
  label: string;
  screen: Screen;
  materialIcon: string;
}

export const TOP_PRIMARY_NAV: ShellNavigationItem[] = [];

export const SIDEBAR_NAV: ShellNavigationItem[] = [
  { id: "home", label: "Home", screen: Screen.DASHBOARD, materialIcon: "home" },
  { id: "furball", label: "Furball3D©️", screen: Screen.MODELS, materialIcon: "pets" },
  { id: "pawprints", label: "Pawprints", screen: Screen.PAWPRINTS, materialIcon: "auto_stories" },
  { id: "fidos-styles", label: "Fido's Styles", screen: Screen.PAWLISHER, materialIcon: "brush" },
  { id: "fidos-bin", label: "Fido's Bin", screen: Screen.FURBIN, materialIcon: "other_houses" },
];

export const MOBILE_NAV: ShellNavigationItem[] = [
  { id: "home", label: "Home", screen: Screen.DASHBOARD, materialIcon: "home" },
  { id: "furball", label: "Furball3D©️", screen: Screen.MODELS, materialIcon: "pets" },
  { id: "pawprints", label: "Pawprints", screen: Screen.PAWPRINTS, materialIcon: "auto_stories" },
  { id: "fidos-styles", label: "Fido's Styles", screen: Screen.PAWLISHER, materialIcon: "brush" },
  { id: "fidos-bin", label: "Fido's Bin", screen: Screen.FURBIN, materialIcon: "other_houses" },
];
