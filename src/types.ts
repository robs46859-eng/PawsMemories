export enum Screen {
  SIGN_UP = "SIGN_UP",
  WELCOME = "WELCOME",
  TUTORIAL = "TUTORIAL",
  DASHBOARD = "DASHBOARD",
  ALBUM_VIEW = "ALBUM_VIEW",
  EDIT_MEMORY = "EDIT_MEMORY",
  SHARE_MEMORY = "SHARE_MEMORY",
  AVATAR_DASHBOARD = "AVATAR_DASHBOARD",
  REQUEST_MEMORY = "REQUEST_MEMORY",
}

export type StyleType = "Realistic" | "Sketch" | "Clay" | "Artistic" | "Anime" | "3D" | "Retro";

// Background ids are defined in src/backgrounds.ts (single source of truth).
// Kept as a string so new presets can be added without touching this type.
export type BackgroundType = string;

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
  media_type: 'still' | 'video' | 'model';
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
  model_url: string | null;
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
  email?: string;
  credits: number;
  treats: number;
  isAdmin?: boolean;
  city?: string;
  ageVerified?: boolean;
}

export interface PublicUser {
  id: number;
  fullName: string;
  email: string;
  credits: number;
  treats: number;
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
  model_url?: string | null;
  error?: string | null;
}

export type AvatarAction = 'eating' | 'drinking' | 'running' | 'playing' | 'sleeping' | 'photo';

export interface AnimationDef {
  row: number;
  frames: number;
  fps: number;
}

export interface AnimationMetadata {
  frameWidth: number;
  frameHeight: number;
  animations: Record<AvatarAction, AnimationDef>;
}

export interface Avatar {
  id: number;
  user_phone: string;
  name: string;
  image_url: string;
  model_url?: string | null;
  sprite_sheet_url?: string | null;
  animation_data?: AnimationMetadata | null;
  animal_type?: string | null;
  breed?: string | null;
  generation_status: 'pending' | 'generating_mesh' | 'rigging' | 'baking_sprites' | 'done' | 'failed';
  generation_error?: string | null;
  food_level: number;
  water_level: number;
  last_fed: string;
  last_watered: string;
  created_at: string;
}

export type RequestType = 'photo_standard' | 'photo_premium' | 'video_standard' | 'video_premium';
export type RequestStatus = 'pending' | 'fulfilled' | 'rejected';

export interface PhotoRequest {
  id: number;
  user_phone?: string;
  request_type: RequestType;
  comment: string;
  photo_url: string | null;
  result_url: string | null;
  creation_id: number | null;
  status: RequestStatus;
  paid: number;
  amount_paid: number | null;
  admin_notes?: string | null;
  created_at: string;
  updated_at?: string;
  // Admin-joined fields
  user_full_name?: string | null;
  user_email?: string | null;
}
