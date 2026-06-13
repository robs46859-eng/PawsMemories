import { PublicUser, Creation, Album, LocationParams, Avatar, PhotoRequest, RequestType } from "./types";

/**
 * Lightweight API client that manages the session token and auth flow.
 * The token is stored in localStorage and attached to protected requests.
 */

const TOKEN_KEY = "paws_auth_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/** fetch() wrapper that adds the Authorization header for protected endpoints. */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

// --- Auth flow -------------------------------------------------------------

/** Step 1: create an account with email + password. Stores the session token. */
export async function signup(email: string, password: string, confirmPassword: string): Promise<PublicUser> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, confirmPassword }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Sign up failed."));
  const data = await res.json();
  setToken(data.token);
  return data.user as PublicUser;
}

/** Step 2: save the required profile (name, birthdate, city, pets) to the DB. */
export async function completeProfile(fullName: string, birthdate: string, city: string, pets?: {name: string, kind: string}[]): Promise<PublicUser> {
  const res = await authedFetch("/api/auth/complete-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, birthdate, city, pets }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Could not save your profile."));
  const data = await res.json();
  return data.user as PublicUser;
}

export async function login(email: string, password: string): Promise<PublicUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Login failed."));
  const data = await res.json();
  setToken(data.token);
  return data.user as PublicUser;
}

/** Restore the session on app load. Returns null if there is no valid session. */
export async function fetchMe(): Promise<PublicUser | null> {
  if (!getToken()) return null;
  try {
    const res = await authedFetch("/api/me");
    if (!res.ok) {
      clearToken();
      return null;
    }
    const data = await res.json();
    return data.user as PublicUser;
} catch {
    return null;
  }
}

export async function claimDailyStreak(): Promise<PublicUser> {
  const res = await authedFetch("/api/streak/claim", { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to claim streak."));
  const data = await res.json();
  return data.user as PublicUser;
}

export async function claimAchievement(id: string): Promise<PublicUser> {
  const res = await authedFetch("/api/achievements/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to claim achievement."));
  const data = await res.json();
  return data.user as PublicUser;
}

// --- Phase 1: Street View & Creations Flow ---------------------------------

export async function checkStreetViewCoverage(lat: number, lng: number): Promise<{ status: string }> {
  const res = await authedFetch(`/api/streetview/coverage?lat=${lat}&lng=${lng}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to check street view coverage."));
  const data = await res.json();
  return data.data;
}

export async function fetchCreations(): Promise<Creation[]> {
  try {
    const res = await authedFetch("/api/creations");
    if (!res.ok) throw new Error("Failed to fetch creations");
    const data = await res.json();
    return data.creations || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

export async function fetchAlbums(): Promise<Album[]> {
  try {
    const res = await authedFetch("/api/albums");
    if (!res.ok) throw new Error("Failed to fetch albums");
    const data = await res.json();
    return data.albums || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

export async function createAlbum(name: string): Promise<Album | null> {
  const res = await authedFetch("/api/albums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    console.error(await parseError(res, "Failed to create album."));
    return null;
  }
  const data = await res.json();
  return data.album as Album;
}

export async function updateCreationOrder(id: number, sortOrder: number): Promise<void> {
  const res = await authedFetch(`/api/creations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sort_order: sortOrder }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update creation order."));
}

export async function createVideo(
  creationId: number,
  motionPrompt?: string,
  generateAudio: boolean = true,
  aspectRatio: "16:9" | "9:16" = "16:9"
): Promise<{ jobId: number }> {
  const res = await authedFetch("/api/create-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creationId, motionPrompt, generateAudio, aspectRatio }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to start video generation."));
  return await res.json();
}

export async function pollJob(jobId: number): Promise<{ status: string; video_url?: string | null; error?: string | null }> {
  const res = await authedFetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to poll job status."));
  return await res.json();
}

// --- Avatars Flow ----------------------------------------------------------

export async function fetchAvatars(): Promise<Avatar[]> {
  try {
    const res = await authedFetch("/api/avatars");
    if (!res.ok) throw new Error("Failed to fetch avatars");
    const data = await res.json();
    return data.avatars || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

export async function createNewAvatar(name: string, python_script: string): Promise<{ success: boolean; id?: number; imageUrl?: string }> {
  const res = await authedFetch("/api/avatars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, python_script }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create avatar."));
  return await res.json();
}

export async function feedAvatarReq(id: number): Promise<boolean> {
  const res = await authedFetch(`/api/avatars/${id}/feed`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to feed avatar."));
  const data = await res.json();
  return data.success;
}

export async function waterAvatarReq(id: number): Promise<boolean> {
  const res = await authedFetch(`/api/avatars/${id}/water`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to water avatar."));
  const data = await res.json();
  return data.success;
}

export async function giveTreatReq(id: number): Promise<{ success: boolean, user?: PublicUser }> {
  const res = await authedFetch(`/api/avatars/${id}/treat`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to give treat."));
  return await res.json();
}

// --- Photo Requests Flow ---------------------------------------------------

/** Submit a photo/video memory request with upfront Stripe payment. */
export async function submitPhotoRequest(
  request_type: RequestType,
  comment: string,
  photo?: string | null
): Promise<{ requestId: number; checkoutUrl: string; mode: string }> {
  const res = await authedFetch("/api/photo-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_type, comment, photo: photo || null }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to submit request."));
  return await res.json();
}

/** Fetch the current user's photo/video requests. */
export async function fetchMyRequests(): Promise<PhotoRequest[]> {
  try {
    const res = await authedFetch("/api/photo-requests");
    if (!res.ok) throw new Error("Failed to fetch requests");
    const data = await res.json();
    return data.requests || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

/** Admin: fetch all photo/video requests. */
export async function fetchAdminRequests(): Promise<PhotoRequest[]> {
  try {
    const res = await authedFetch("/api/admin/photo-requests");
    if (!res.ok) throw new Error("Failed to fetch admin requests");
    const data = await res.json();
    return data.requests || [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

/** Admin: fulfill a request by linking a generation result. */
export async function fulfillRequest(
  requestId: number,
  creationId: number
): Promise<{ success: boolean; userCreationId?: number }> {
  const res = await authedFetch(`/api/admin/photo-requests/${requestId}/fulfill`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creationId }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to fulfill request."));
  return await res.json();
}

/** Admin: reject a request and trigger Stripe refund. */
export async function rejectRequest(
  requestId: number,
  adminNotes?: string
): Promise<{ success: boolean }> {
  const res = await authedFetch(`/api/admin/photo-requests/${requestId}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminNotes }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to reject request."));
  return await res.json();
}
