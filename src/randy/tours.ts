import { Screen } from "../types";

export type TourId =
  | "first_avatar"
  | "buy_credits"
  | "request_memory"
  | "make_pawprint"
  | "use_pawlisher"
  | "share_refer"
  | "manage_furbin";

export interface TourStep {
  target: string;
  title: string;
  body: string;
  action?: "click" | "none";
  waitFor?: string;
}

export interface Tour {
  id: TourId;
  title: string;
  screen: Screen;
  steps: TourStep[];
}

const tourTarget = (id: string) => `[data-tour="${id}"]`;

export const tours: Record<TourId, Tour> = {
  first_avatar: {
    id: "first_avatar",
    title: "Make my first avatar",
    screen: Screen.MODELS,
    steps: [
      { target: tourTarget("nav-models"), title: "Open Furball3D", body: "This is where you make a 3D pet. Randy will stay with you one step at a time." },
      { target: tourTarget("avatar-create"), title: "Start with Create", body: "Tap the button that says Create Model. It opens the form for your first avatar.", action: "click" },
      { target: tourTarget("avatar-create-first"), title: "No model yet?", body: "If this is your first visit, tap Create Your First Model. You can use a pet photo or describe your pet.", action: "click" },
    ],
  },
  buy_credits: {
    id: "buy_credits",
    title: "Buy credits",
    screen: Screen.DASHBOARD,
    steps: [
      { target: tourTarget("buy-credits"), title: "Add credits", body: "Tap Buy Credits when you need more. The store opens without leaving your work." },
      { target: tourTarget("profile-credits"), title: "Check your balance", body: "Your credit balance is shown beside your name. It updates after purchases and rewards." },
    ],
  },
  request_memory: {
    id: "request_memory",
    title: "Request a memory",
    screen: Screen.DASHBOARD,
    steps: [
      { target: tourTarget("dashboard-create"), title: "Make or request", body: "Tap Create to start a new memory or avatar. Randy can guide you from there." },
    ],
  },
  make_pawprint: {
    id: "make_pawprint",
    title: "Make a Pawprint",
    screen: Screen.PAWPRINTS,
    steps: [
      { target: tourTarget("pawprints-title"), title: "Choose a card type", body: "Pick the kind of Pawprint you want. Then choose a layout and add simple details." },
      { target: tourTarget("pawprints-create"), title: "Create it", body: "When the details look right, tap Create Pawprint. It costs 75 credits." },
    ],
  },
  use_pawlisher: {
    id: "use_pawlisher",
    title: "Use Pawlisher",
    screen: Screen.PAWLISHER,
    steps: [
      { target: tourTarget("pawlisher-title"), title: "Polish your model", body: "Pawlisher is where you adjust light, motion, voice, and friendly style." },
      { target: tourTarget("pawlisher-voice"), title: "Voice needs permission", body: "Before cloning a voice, confirm you own it or have permission. The app saves that consent." },
    ],
  },
  share_refer: {
    id: "share_refer",
    title: "Share and refer",
    screen: Screen.PROFILE,
    steps: [
      { target: tourTarget("profile-referral"), title: "Share your link", body: "Your referral code lives here. Share it to earn credits." },
    ],
  },
  manage_furbin: {
    id: "manage_furbin",
    title: "Manage Fur Bin",
    screen: Screen.FURBIN,
    steps: [
      { target: tourTarget("furbin-title"), title: "Your storage", body: "Fur Bin shows your models, videos, voice files, Pawprints, and uploads." },
      { target: tourTarget("furbin-voice-files"), title: "Voice consent", body: "Voice clone files show whether consent was saved. This helps keep every voice auditable." },
    ],
  },
};
