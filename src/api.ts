import { PublicUser, Creation, Album, LocationParams, Avatar, PhotoRequest, RequestType, AvatarNeeds, BehaviorAction, PlacedObject } from "./types";

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

export class ApiError extends Error {
  constructor(public status: number, public code: string | null, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function throwApiError(res: Response, fallback: string): Promise<never> {
  let body: any = {};
  try {
    body = await res.json();
  } catch {}
  throw new ApiError(res.status, body?.code ?? null, body?.error || fallback);
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

export async function claimShareReward(platform: string): Promise<{ reward: number; user: PublicUser }> {
  const res = await authedFetch("/api/credits/reward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to claim reward."));
  const data = await res.json();
  return { reward: data.reward as number, user: data.user as PublicUser };
}

export interface CreditTxn {
  id: number;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
}

export async function getCreditHistory(): Promise<CreditTxn[]> {
  const res = await authedFetch("/api/credits/history");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.history as CreditTxn[]) || [];
}

/** Confirm a Stripe checkout session after redirect and credit it if not already done. */
export async function confirmCreditsSession(sessionId: string): Promise<{ credited: number; balance: number } | null> {
  const res = await authedFetch(`/api/credits/confirm?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return null;
  const d = await res.json();
  return { credited: d.credited ?? 0, balance: d.balance ?? 0 };
}

// --- User photo library ----------------------------------------------------

export interface UserPhoto { id: number; image_url: string; source: string; created_at?: string; }

export async function uploadProfilePhoto(image: string): Promise<PublicUser> {
  const res = await authedFetch("/api/profile/photo", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update profile photo."));
  return (await res.json()).user as PublicUser;
}

export async function getUserPhotos(): Promise<UserPhoto[]> {
  const res = await authedFetch("/api/profile/photos");
  if (!res.ok) return [];
  return ((await res.json()).photos as UserPhoto[]) || [];
}

export async function addUserPhoto(image: string): Promise<UserPhoto> {
  const res = await authedFetch("/api/profile/photos", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to add photo."));
  return (await res.json()).photo as UserPhoto;
}

export async function deleteUserPhoto(id: number): Promise<boolean> {
  const res = await authedFetch(`/api/profile/photos/${id}`, { method: "DELETE" });
  return res.ok;
}

// --- Community -------------------------------------------------------------

export interface CommunityPark { name: string; address: string; rating: number | null; open: boolean | null; }
export interface CommunityWeather { tempC: number; tempF: number; condition: string; source: string; }
export interface CommunityRecall { product: string; reason: string; company: string; date: string; classification: string; }
export interface CommunityMemory { id: number; image_url: string; caption: string | null; created_at?: string; }

export async function getCommunityParks(lat: number, lng: number): Promise<CommunityPark[]> {
  const res = await authedFetch(`/api/community/parks?lat=${lat}&lng=${lng}`);
  if (!res.ok) return [];
  return ((await res.json()).parks as CommunityPark[]) || [];
}

export async function getCommunityWeather(lat: number, lng: number): Promise<CommunityWeather | null> {
  const res = await authedFetch(`/api/community/weather?lat=${lat}&lng=${lng}`);
  if (!res.ok) return null;
  return ((await res.json()).weather as CommunityWeather) || null;
}

export async function getPetRecalls(): Promise<CommunityRecall[]> {
  const res = await authedFetch(`/api/community/recalls`);
  if (!res.ok) return [];
  return ((await res.json()).recalls as CommunityRecall[]) || [];
}

export async function getCommunityMemories(): Promise<CommunityMemory[]> {
  const res = await authedFetch(`/api/community/memories`);
  if (!res.ok) return [];
  return ((await res.json()).memories as CommunityMemory[]) || [];
}

export async function uploadCommunityMemory(image: string, caption: string): Promise<CommunityMemory> {
  const res = await authedFetch(`/api/community/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, caption }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to share memory."));
  return (await res.json()).memory as CommunityMemory;
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

export async function createTalkingVideo(creationId: number, script: string, voiceId?: string): Promise<{ jobId: number }> {
  const res = await authedFetch("/api/create-talking-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creationId, script, voiceId }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to start talking video generation."));
  return await res.json();
}

export async function create3DModel(creationId: number): Promise<{ jobId: number }> {
  const res = await authedFetch("/api/create-3d-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creationId }),
  });
  if (!res.ok) await throwApiError(res, "Failed to start 3D model generation.");
  return await res.json();
}

export async function pollJob(jobId: number): Promise<{ status: string; video_url?: string | null; model_url?: string | null; error?: string | null }> {
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

/**
 * Create a new 3D avatar from one or more pet photos.
 * The server first fuses the photos into a single hyper-realistic reference image
 * (pet standing on all 4 legs, facing forward, slight panting expression),
 * then generates the 3D model from that image. Returns immediately; generation is async.
 */
export async function generate3DAvatar(
  name: string,
  photos: string[],
  palette?: string | null,
  avatarType?: 'dog' | 'human'
): Promise<{ avatarId: number; status: string; referenceImageUrl?: string; usedReferenceImage?: boolean }> {
  const res = await authedFetch("/api/avatars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos, name, palette: palette || undefined, avatar_type: avatarType }),
  });
  if (!res.ok) await throwApiError(res, "Failed to create avatar.");
  return await res.json();
}

/** Poll the generation status of a 3D avatar. */
export async function pollAvatarStatus(avatarId: number): Promise<{
  status: string;
  error?: string | null;
  model_url?: string | null;
  sprite_sheet_url?: string | null;
}> {
  const res = await authedFetch(`/api/avatars/${avatarId}/status`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to get avatar status."));
  return await res.json();
}

/** Retry a failed avatar generation. Resets status and re-triggers the 3D pipeline. */
export async function retryAvatarGeneration(avatarId: number): Promise<{ success: boolean; status: string }> {
  const res = await authedFetch(`/api/avatars/${avatarId}/retry`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to retry avatar generation."));
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

// --- Living avatar: needs & commands (Phase 2) -----------------------------

/**
 * Fetch the server-computed live needs for an avatar (server applies offline
 * decay from `last_seen`). Returns null if the endpoint is unavailable so the
 * client can fall back to a local simulation — safe to deploy the frontend
 * before the backend.
 */
export async function fetchAvatarNeeds(avatarId: number): Promise<AvatarNeeds | null> {
  try {
    const res = await authedFetch(`/api/avatars/${avatarId}/state`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.needs as AvatarNeeds) ?? null;
  } catch {
    return null;
  }
}

/** Persist the current needs snapshot. Best-effort; resolves false on failure. */
export async function patchAvatarNeeds(avatarId: number, needs: AvatarNeeds): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/avatars/${avatarId}/state`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ needs }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Log a user-issued command (telemetry + ambient awareness). Best-effort. */
export async function sendAvatarCommand(
  avatarId: number,
  action: BehaviorAction,
  targetObjectId?: string
): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/avatars/${avatarId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, targetObjectId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Placed objects (Phase 3) ----------------------------------------------

/** Load the objects the user has placed for an avatar. Returns [] on failure. */
export async function fetchPlacedObjects(avatarId: number): Promise<PlacedObject[]> {
  try {
    const res = await authedFetch(`/api/avatars/${avatarId}/objects`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.objects as PlacedObject[]) ?? [];
  } catch {
    return [];
  }
}

/** Persist a newly placed object. Best-effort. */
export async function createPlacedObject(avatarId: number, obj: PlacedObject): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/avatars/${avatarId}/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(obj),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Remove a placed object. Best-effort. */
export async function deletePlacedObject(avatarId: number, objectId: string): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/avatars/${avatarId}/objects/${objectId}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}
