import { PublicUser, Creation, Album, LocationParams, Avatar, PhotoRequest, RequestType, AvatarNeeds, BehaviorAction, PlacedObject, VoiceCloneAsset } from "./types";

/**
 * Lightweight API client that manages the session token and auth flow.
 * The token is stored in localStorage and attached to protected requests.
 */

const TOKEN_KEY = "paws_auth_token";

export function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
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

export async function importIfc(ifcBase64: string): Promise<any> {
  const res = await authedFetch("/api/bim/import-ifc", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ifcBase64 }),
  });
  if (!res.ok) throw new Error(await parseError(res, "IFC import failed."));
  return res.json();
}

export async function preflightBim(model: Record<string, unknown>, mode: "shell" | "ifc"): Promise<any> {
  const res = await authedFetch("/api/bim/preflight", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, mode }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.verification) throw new Error(data.error || "Pre-build verification failed.");
  return data;
}

export async function buildBim(model: Record<string, unknown>, mode: "shell" | "ifc"): Promise<any> {
  const res = await authedFetch("/api/bim/build", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, mode }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Verified model build failed."));
  return res.json();
}

export interface SavedBimBuild {
  id: string; name: string; mode: "shell" | "ifc"; price: number;
  glbUrl: string | null; ifcUrl: string | null; sidecarUrl: string | null;
  elementCount: number; sizeBytes: number; createdAt: string;
}

export async function listBimBuilds(): Promise<SavedBimBuild[]> {
  const res = await authedFetch("/api/bim/builds");
  if (!res.ok) throw new Error(await parseError(res, "Could not load saved models."));
  const data = await res.json();
  return Array.isArray(data.builds) ? data.builds : [];
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
export async function signup(email: string, password: string, confirmPassword: string, acceptedTerms: boolean): Promise<PublicUser> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, confirmPassword, acceptedTerms }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Sign up failed."));
  const data = await res.json();
  setToken(data.token);
  return data.user as PublicUser;
}

export async function acceptCurrentTerms(): Promise<PublicUser> {
  const res = await authedFetch("/api/auth/accept-terms", { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Could not save your acceptance."));
  const data = await res.json();
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

/** Request a password-reset email. Always resolves (no account enumeration). */
export async function requestPasswordReset(email: string): Promise<string> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  return data.message || "If that email is registered, a reset link is on its way.";
}

/** Complete a password reset with the emailed token. */
export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Could not reset password."));
  const data = await res.json();
  return data.message || "Password updated.";
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

export async function listVoiceCloneAssets(): Promise<VoiceCloneAsset[]> {
  const res = await authedFetch("/api/voice-clones");
  if (!res.ok) return [];
  return ((await res.json()).assets as VoiceCloneAsset[]) || [];
}

export async function createVoiceCloneAsset(input: {
  name: string;
  audioBase64: string;
  mimeType: string;
  bytes: number;
  voiceConsent: boolean;
}): Promise<{ asset: VoiceCloneAsset; user?: PublicUser }> {
  const res = await authedFetch("/api/voice-clones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res, "Could not save the voice clone."));
  const data = await res.json();
  return { asset: data.asset as VoiceCloneAsset, user: data.user as PublicUser | undefined };
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
export async function generate3DAvatar(options: any): Promise<{ avatarId: number; status: string; referenceImageUrl?: string; usedReferenceImage?: boolean; avatarType?: 'dog' | 'human' | 'object'; notice?: string }> {
  const res = await authedFetch("/api/avatars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) await throwApiError(res, "Failed to create model.");
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
export async function retryAvatarGeneration(avatarId: number): Promise<{ success: boolean; status: string; chargedCredits?: number; user?: PublicUser }> {
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

// --- AR Cast (Phase 5) ----------------------------------------------------

export async function fetchSceneActors(avatarId: number): Promise<any[]> {
  try {
    const res = await authedFetch(`/api/ar/${avatarId}/cast`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.actors || [];
  } catch {
    return [];
  }
}

export async function addSceneActor(avatarId: number, actor: any): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/ar/${avatarId}/cast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actor),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function updateSceneActor(avatarId: number, actorId: string, transform: any, selectedClip?: string): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/ar/${avatarId}/cast/${actorId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transform, selectedClip }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeSceneActor(avatarId: number, actorId: string): Promise<boolean> {
  try {
    const res = await authedFetch(`/api/ar/${avatarId}/cast/${actorId}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Image-to-3D utility (generic, not pet-specific) -----------------------

export interface ImageTo3DMultiview {
  left?: string;
  back?: string;
  right?: string;
}

/** Geometry overrides for 3D generation (ids match the backend dropdowns). */
export interface ImageTo3DGeometry {
  /** "draft" | "standard" | "high" | "ultra" */
  detail?: string;
  /** "pbr_detailed" | "basic" | "none" */
  texture?: string;
}

/**
 * Submit any arbitrary image for 3D GLB generation via Tripo.
 * Optionally supply multiview turnaround shots and/or geometry overrides.
 * Returns a jobId that can be polled via the existing `pollJob()`.
 */
export async function submitImageTo3D(
  image: string,
  multiview?: ImageTo3DMultiview,
  geometry?: ImageTo3DGeometry
): Promise<{ jobId: number; status: string }> {
  const res = await authedFetch("/api/image-to-3d", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image, multiview, geometry }),
  });
  if (!res.ok) await throwApiError(res, "Failed to start 3D generation.");
  return await res.json();
}

/** Structured text-prompt fields for generating a reference image. */
export interface TextReferenceFields {
  subject: string;
  style?: string;
  framing?: string;
  angle?: string;
  lighting?: string;
}

/**
 * Turn a structured text prompt into a single reference image (data URL) via
 * the backend Gemini step. Cheap preview — the returned image is then passed to
 * `submitImageTo3D()` to actually build the mesh.
 */
export async function generateTextReference(
  fields: TextReferenceFields
): Promise<{ image: string; prompt: string }> {
  const res = await authedFetch("/api/text-to-reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) await throwApiError(res, "Failed to generate reference image.");
  return await res.json();
}

/** Delete an avatar/model from the user's roster (removes the DB row). */
export async function deleteAvatar(id: number): Promise<void> {
  const res = await authedFetch(`/api/avatars/${id}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "Failed to delete model.");
}

/** Public per-site config (deployTarget + printEmail). No auth required. */
export async function getAppConfig(): Promise<{ deployTarget: string; printEmail?: string }> {
  const res = await fetch("/api/config");
  if (!res.ok) return { deployTarget: "main" };
  return await res.json();
}

/** Upload a model file (base64 data URL) for a 3D-print request → durable URL. */
export async function uploadPrintFile(fileBase64: string, mime: string): Promise<string> {
  const res = await authedFetch("/api/print-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64, mime }),
  });
  if (!res.ok) await throwApiError(res, "Upload failed.");
  const data = await res.json();
  return data.url as string;
}

// --- Storage (Phase 8) ------------------------------------------------------

export interface StorageUsage {
  bytesHot: number;
  bytesCold: number;
  freeLimit: number;
  coldGbPurchased: number;
  coldLimit: number;
}

export async function fetchStorageUsage(): Promise<StorageUsage | null> {
  try {
    const res = await authedFetch("/api/storage/usage");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function purchaseStorageGb(requestId: string): Promise<{ success: boolean; error?: string; usage?: StorageUsage }> {
  try {
    const res = await authedFetch("/api/storage/purchase-gb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    const data = await res.json();
    return { success: data.success, error: data.error, usage: data.usage };
  } catch {
    return { success: false, error: "Network error" };
  }
}
