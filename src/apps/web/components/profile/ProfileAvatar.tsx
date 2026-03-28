'use client';

import { getPresetAvatar, resolveProfile, type ProfileSummary } from "../../lib/profile";

interface Props {
  profile?: ProfileSummary | null;
  className: string;
  title?: string;
  ariaLabel?: string;
}

export function ProfileAvatar({ profile, className, title, ariaLabel }: Props) {
  const resolved = resolveProfile(profile);
  const preset = getPresetAvatar(resolved.avatar_key);
  return (
    <span
      className={className}
      title={title}
      aria-label={ariaLabel}
      data-avatar-mode="preset"
      data-avatar-key={preset.key}
    >
      <img className="profile-badge__image" src={preset.imagePath} alt={`${preset.label} avatar`} />
    </span>
  );
}
