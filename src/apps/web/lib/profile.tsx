// profile.tsx: Profile types, preset avatars, and display-name resolution helpers.

export type AvatarMode = "preset";

export interface ProfileMetadata {
  full_name: string;
  avatar_mode: AvatarMode;
  avatar_key: string | null;
  avatar_color: string | null;
}

export interface ProfileSummary {
  email?: string | null;
  full_name?: string | null;
  display_name?: string | null;
  avatar_mode?: string | null;
  avatar_key?: string | null;
  avatar_color?: string | null;
  user_metadata?: unknown;
}

export interface ResolvedProfile extends ProfileMetadata {
  email: string | null;
  displayName: string;
}

export interface PresetAvatarOption {
  key: string;
  label: string;
  imagePath: string;
  background: string;
}

export const PROFILE_PRESET_AVATARS: PresetAvatarOption[] = [
  // DiceBear Glass avatars are bundled locally so the picker stays stable and offline-friendly.
  { key: "glass-01", label: "Avatar 1", imagePath: "/profile-avatars/glass-01.svg", background: "#f7efe8" },
  { key: "glass-02", label: "Avatar 2", imagePath: "/profile-avatars/glass-02.svg", background: "#eef4fb" },
  { key: "glass-03", label: "Avatar 3", imagePath: "/profile-avatars/glass-03.svg", background: "#f6eefc" },
  { key: "glass-04", label: "Avatar 4", imagePath: "/profile-avatars/glass-04.svg", background: "#fdf1ea" },
  { key: "glass-05", label: "Avatar 5", imagePath: "/profile-avatars/glass-05.svg", background: "#edf8f1" },
  { key: "glass-06", label: "Avatar 6", imagePath: "/profile-avatars/glass-06.svg", background: "#f9eef2" },
  { key: "glass-07", label: "Avatar 7", imagePath: "/profile-avatars/glass-07.svg", background: "#f2f0fb" },
  { key: "glass-08", label: "Avatar 8", imagePath: "/profile-avatars/glass-08.svg", background: "#eef7fb" },
];

const LEGACY_PROFILE_AVATAR_KEY_MAP: Record<string, string> = {
  "glass-01": "glass-01",
  "glass-02": "glass-02",
  "glass-03": "glass-03",
  "glass-04": "glass-04",
  "glass-05": "glass-05",
  "glass-06": "glass-06",
  "glass-07": "glass-07",
  "glass-08": "glass-08",
  ava: "glass-01",
  felix: "glass-02",
  luna: "glass-03",
  maya: "glass-04",
  kai: "glass-05",
  nina: "glass-06",
  omar: "glass-07",
  zoe: "glass-08",
  cap: "glass-01",
  beaker: "glass-02",
  book: "glass-03",
  bolt: "glass-05",
  briefcase: "glass-07",
  chat: "glass-04",
  cloud: "glass-08",
  cog: "glass-02",
  code: "glass-05",
  globe: "glass-07",
  heart: "glass-06",
  idea: "glass-03",
  lock: "glass-01",
  map: "glass-08",
  plane: "glass-04",
  rocket: "glass-05",
  shield: "glass-07",
  sparkles: "glass-08",
  star: "glass-06",
  tools: "glass-02",
  fox: "glass-05",
  cat: "glass-01",
  dog: "glass-02",
  panda: "glass-07",
  lion: "glass-07",
  tiger: "glass-04",
  owl: "glass-03",
  rabbit: "glass-08",
};

export const DEFAULT_PROFILE_AVATAR_KEY = PROFILE_PRESET_AVATARS[0].key;

export function buildProfileFormValue(profile?: ProfileSummary | null): ProfileMetadata {
  const resolved = resolveProfile(profile);
  return {
    full_name: resolved.full_name,
    avatar_mode: "preset",
    avatar_key: resolved.avatar_key ?? DEFAULT_PROFILE_AVATAR_KEY,
    avatar_color: null,
  };
}

export function resolveProfile(profile?: ProfileSummary | null): ResolvedProfile {
  const metadata = readProfileMetadata(profile?.user_metadata);
  const fullName = normalizeString(profile?.full_name) ?? normalizeString(metadata.full_name) ?? "";
  const email = normalizeString(profile?.email) ?? null;
  const displayName = normalizeString(profile?.display_name) || fullName || email || "Profile";

  const avatarMode = normalizeAvatarMode(profile?.avatar_mode ?? metadata.avatar_mode);
  const avatarKey = normalizePresetAvatarKey(profile?.avatar_key ?? metadata.avatar_key);

  if (avatarMode === "preset" && avatarKey) {
    return {
      email,
      displayName,
      full_name: fullName,
      avatar_mode: "preset",
      avatar_key: avatarKey,
      avatar_color: null,
    };
  }

  return {
    email,
    displayName,
    full_name: fullName,
    avatar_mode: "preset",
    avatar_key: DEFAULT_PROFILE_AVATAR_KEY,
    avatar_color: null,
  };
}

export function toProfileMetadata(value: ProfileMetadata): ProfileMetadata {
  const fullName = value.full_name.trim();
  const avatarKey = normalizePresetAvatarKey(value.avatar_key) ?? DEFAULT_PROFILE_AVATAR_KEY;

  return {
    full_name: fullName,
    avatar_mode: "preset",
    avatar_key: avatarKey,
    avatar_color: null,
  };
}

export function getPresetAvatar(key?: string | null): PresetAvatarOption {
  return PROFILE_PRESET_AVATARS.find((option) => option.key === key) ?? PROFILE_PRESET_AVATARS[0];
}

export function isValidPresetAvatarKey(value?: string | null): value is string {
  return !!normalizePresetAvatarKey(value);
}

export function isValidProfileMetadata(value: ProfileMetadata): boolean {
  return !!value.full_name.trim() && isValidPresetAvatarKey(value.avatar_key);
}

function readProfileMetadata(value: unknown): Partial<ProfileMetadata> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const metadata = value as Record<string, unknown>;
  return {
    full_name: normalizeString(metadata.full_name) ?? "",
    avatar_mode: normalizeAvatarMode(metadata.avatar_mode),
    avatar_key: normalizePresetAvatarKey(metadata.avatar_key),
    avatar_color: null,
  };
}

function normalizePresetAvatarKey(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const mapped = LEGACY_PROFILE_AVATAR_KEY_MAP[normalized] ?? normalized;
  return PROFILE_PRESET_AVATARS.some((option) => option.key === mapped) ? mapped : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAvatarMode(_value: unknown): AvatarMode {
  return "preset";
}
