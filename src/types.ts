export enum Screen {
  SIGN_UP = "SIGN_UP",
  WELCOME = "WELCOME",
  TUTORIAL = "TUTORIAL",
  DASHBOARD = "DASHBOARD",
  EDIT_MEMORY = "EDIT_MEMORY",
  SHARE_MEMORY = "SHARE_MEMORY",
}

export type StyleType = "Realistic" | "Sketch" | "Clay" | "Artistic" | "Anime" | "3D" | "Retro";

export type BackgroundType = "Canyon" | "Paris" | "Cabin" | "Rocky" | "Meadow";

export interface LocationParams {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  fov: number;
  placeLabel: string;
}

export interface Creation {
  id: number;
  user_phone: string;
  album_id: number | null;
  media_type: 'still' | 'video';
  style: StyleType;
  backdrop_kind: 'preset' | 'streetview';
  preset_name: string | null;
  sv_lat: number | null;
  sv_lng: number | null;
  sv_heading: number | null;
  sv_pitch: number | null;
  sv_fov: number | null;
  place_label: string | null;
  image_url: string | null;
  video_url: string | null;
  sort_order: number;
  created_at: string;
  // Legacy / frontend-only fields
  name?: string;
  breed?: string;
  background?: BackgroundType;
  isCustomUploaded?: boolean;
}

export interface Album {
  id: string;
  name: string;
  itemCount: number;
  imageUrl: string;
}

export interface UserProfile {
  fullName: string;
  phoneNumber: string;
  email?: string;
  credits: number;
  isAdmin?: boolean;
  city?: string;
  ageVerified?: boolean;
}

/** User shape returned by the auth API. */
export interface PublicUser {
  id: number;
  phone: string;
  fullName: string;
  email: string;
  credits: number;
  city: string;
  birthdate: string;
  profileComplete: boolean;
  isAdmin: boolean;
  dailyStreak: number;
  lastStreakClaim: string | null;
  achievements: any[];
}

export interface PhysicalOrder {
  orderId: string;
  creationId: string;
  creationName: string;
  imageUrl: string;
  style: string;
  creditsDeducted: number;
  cashPaid: number;
  shippingName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  createdAt: string;
  status: "pending" | "processing" | "shipped" | "cancelled";
}

export interface GenerationJob {
  id: number;
  status: "queued" | "running" | "done" | "failed";
  video_url?: string | null;
  error?: string | null;
}

