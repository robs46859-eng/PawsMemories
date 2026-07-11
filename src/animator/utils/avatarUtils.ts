export interface AvatarDTO {
  id: string;
  name: string;
  generation_status: string;
  model_url?: string;
  rigged_model_url?: string;
}

export function filterReadyAvatars(avatars: AvatarDTO[]): AvatarDTO[] {
  return avatars.filter(a => a.generation_status === "done" && resolveAvatarGlbUrl(a) !== null);
}

export function resolveAvatarGlbUrl(avatar: AvatarDTO): string | null {
  return avatar.rigged_model_url || avatar.model_url || null;
}
