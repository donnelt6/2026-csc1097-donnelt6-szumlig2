'use client';

import { ProfileAvatar } from "./ProfileAvatar";
import {
  PROFILE_PRESET_AVATARS,
  type ProfileMetadata,
} from "../../lib/profile";

interface Props {
  value: ProfileMetadata;
  previewEmail?: string | null;
  onChange: (value: ProfileMetadata) => void;
}

export function ProfilePicker({ value, previewEmail, onChange }: Props) {
  return (
    <div className="profile-picker">
      <div className="hub-appearance-section hub-appearance-section--compact">
        <span className="modal__picker-label">Customise appearance</span>

        <div className="hub-appearance-picker">
          <div className="profile-avatar-grid" aria-label="Profile avatars">
            {PROFILE_PRESET_AVATARS.map((option, index) => (
              <button
                key={option.key}
                className={`profile-avatar-tile${value.avatar_mode === "preset" && value.avatar_key === option.key ? " profile-avatar-tile--active" : ""}`}
                type="button"
                onClick={() => onChange({ ...value, avatar_mode: "preset", avatar_key: option.key, avatar_color: null })}
                aria-label={`Choose glass avatar ${index + 1}`}
              >
                <ProfileAvatar
                  className="profile-avatar-tile__badge"
                  profile={{
                    full_name: value.full_name,
                    email: previewEmail,
                    avatar_mode: "preset",
                    avatar_key: option.key,
                    avatar_color: value.avatar_color,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
