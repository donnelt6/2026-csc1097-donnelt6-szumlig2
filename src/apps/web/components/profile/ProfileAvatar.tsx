'use client';

import { getInitialsColor, getPresetAvatar, resolveProfile, type ProfileSummary } from "../../lib/profile";

interface Props {
  profile?: ProfileSummary | null;
  className: string;
  title?: string;
  ariaLabel?: string;
}

export function ProfileAvatar({ profile, className, title, ariaLabel }: Props) {
  const resolved = resolveProfile(profile);

  if (resolved.avatar_mode === "preset" && resolved.avatar_key) {
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

  const initialsColor = getInitialsColor(resolved.avatar_color);
  return (
    <span
      className={className}
      title={title}
      aria-label={ariaLabel}
      data-avatar-mode="initials"
      data-avatar-color={initialsColor.key}
      style={{ background: initialsColor.background, color: initialsColor.color }}
    >
      <span className="profile-badge__initials">{resolved.initials}</span>
    </span>
  );
}
