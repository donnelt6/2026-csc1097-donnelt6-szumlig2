export type AvatarMode = "preset" | "initials";

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
  initials: string;
}

export interface PresetAvatarOption {
  key: string;
  label: string;
  imagePath: string;
  background: string;
}

export interface InitialsColorOption {
  key: string;
  label: string;
  background: string;
  color: string;
}

export const PROFILE_PRESET_AVATARS: PresetAvatarOption[] = [
  // DiceBear Glass avatars are bundled locally so the picker stays stable and offline-friendly.
  { key: "ava", label: "Avatar 1", imagePath: "/profile-avatars/ava.svg", background: "#f7efe8" },
  { key: "felix", label: "Avatar 2", imagePath: "/profile-avatars/felix.svg", background: "#eef4fb" },
  { key: "luna", label: "Avatar 3", imagePath: "/profile-avatars/luna.svg", background: "#f6eefc" },
  { key: "maya", label: "Avatar 4", imagePath: "/profile-avatars/maya.svg", background: "#fdf1ea" },
  { key: "kai", label: "Avatar 5", imagePath: "/profile-avatars/kai.svg", background: "#edf8f1" },
  { key: "nina", label: "Avatar 6", imagePath: "/profile-avatars/nina.svg", background: "#f9eef2" },
  { key: "omar", label: "Avatar 7", imagePath: "/profile-avatars/omar.svg", background: "#f2f0fb" },
  { key: "zoe", label: "Avatar 8", imagePath: "/profile-avatars/zoe.svg", background: "#eef7fb" },
];

const LEGACY_PROFILE_AVATAR_KEY_MAP: Record<string, string> = {
  cap: "ava",
  beaker: "felix",
  book: "luna",
  bolt: "kai",
  briefcase: "omar",
  chat: "maya",
  cloud: "zoe",
  cog: "felix",
  code: "kai",
  globe: "omar",
  heart: "nina",
  idea: "luna",
  lock: "ava",
  map: "zoe",
  plane: "maya",
  rocket: "kai",
  shield: "omar",
  sparkles: "zoe",
  star: "nina",
  tools: "felix",
  fox: "kai",
  cat: "ava",
  dog: "felix",
  panda: "omar",
  lion: "omar",
  tiger: "maya",
  owl: "luna",
  rabbit: "zoe",
};

export const PROFILE_INITIALS_COLORS: InitialsColorOption[] = [
  { key: "slate", label: "Slate", background: "#334155", color: "#f8fafc" },
  { key: "blue", label: "Blue", background: "#2563eb", color: "#eff6ff" },
  { key: "teal", label: "Teal", background: "#0f766e", color: "#f0fdfa" },
  { key: "emerald", label: "Emerald", background: "#15803d", color: "#f0fdf4" },
  { key: "amber", label: "Amber", background: "#b45309", color: "#fffbeb" },
  { key: "rose", label: "Rose", background: "#be123c", color: "#fff1f2" },
  { key: "violet", label: "Violet", background: "#7c3aed", color: "#f5f3ff" },
  { key: "ink", label: "Ink", background: "#111827", color: "#f9fafb" },
];

export const DEFAULT_PROFILE_COLOR_KEY = "slate";
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

  const avatarMode = coerceAvatarMode(profile?.avatar_mode ?? metadata.avatar_mode);
  const avatarKey = normalizePresetAvatarKey(profile?.avatar_key ?? metadata.avatar_key);
  const avatarColor = isValidInitialsColorKey(profile?.avatar_color ?? metadata.avatar_color)
    ? normalizeString(profile?.avatar_color ?? metadata.avatar_color)
    : DEFAULT_PROFILE_COLOR_KEY;

  if (avatarMode === "preset" && avatarKey) {
    return {
      email,
      displayName,
      initials: deriveInitials(displayName),
      full_name: fullName,
      avatar_mode: "preset",
      avatar_key: avatarKey,
      avatar_color: avatarColor,
    };
  }

  return {
    email,
    displayName,
    initials: deriveInitials(displayName),
    full_name: fullName,
    avatar_mode: "preset",
    avatar_key: DEFAULT_PROFILE_AVATAR_KEY,
    avatar_color: avatarColor,
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

export function deriveInitials(value: string): string {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "P";
  }
  if (words.length === 1) {
    const compact = words[0].replace(/[^a-z0-9]/gi, "");
    return (compact.slice(0, 2) || "P").toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase() || "P";
}

export function getPresetAvatar(key?: string | null): PresetAvatarOption {
  return PROFILE_PRESET_AVATARS.find((option) => option.key === key) ?? PROFILE_PRESET_AVATARS[0];
}

export function getInitialsColor(key?: string | null): InitialsColorOption {
  return PROFILE_INITIALS_COLORS.find((option) => option.key === key) ?? PROFILE_INITIALS_COLORS[0];
}

export function getRandomInitialsColorKey() {
  const index = Math.floor(Math.random() * PROFILE_INITIALS_COLORS.length);
  return PROFILE_INITIALS_COLORS[index]?.key ?? DEFAULT_PROFILE_COLOR_KEY;
}

export function isValidPresetAvatarKey(value?: string | null): value is string {
  return !!normalizePresetAvatarKey(value);
}

export function isValidInitialsColorKey(value?: string | null): value is string {
  return PROFILE_INITIALS_COLORS.some((option) => option.key === value);
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
    avatar_mode: coerceAvatarMode(metadata.avatar_mode),
    avatar_key: normalizePresetAvatarKey(metadata.avatar_key),
    avatar_color: normalizeString(metadata.avatar_color) ?? null,
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

function coerceAvatarMode(value: unknown): AvatarMode {
  return value === "preset" ? "preset" : "initials";
}
