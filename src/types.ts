export enum Screen {
  SIGN_UP = "SIGN_UP",
  WELCOME = "WELCOME",
  TUTORIAL = "TUTORIAL",
  DASHBOARD = "DASHBOARD",
  EDIT_MEMORY = "EDIT_MEMORY",
  SHARE_MEMORY = "SHARE_MEMORY",
}

export type StyleType = "Realistic" | "Sketch" | "Clay" | "Artistic";

export type BackgroundType = "Canyon" | "Paris" | "Cabin" | "Rocky" | "Meadow";

export interface Creation {
  id: string;
  name: string;
  breed?: string;
  style: StyleType;
  background: BackgroundType;
  imageUrl: string;
  createdAt: string;
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
}

/** User shape returned by the auth API. */
export interface PublicUser {
  phone: string;
  fullName: string;
  email: string;
  credits: number;
  profileComplete: boolean;
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

