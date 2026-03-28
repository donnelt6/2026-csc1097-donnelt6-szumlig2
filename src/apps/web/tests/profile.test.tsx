import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileAvatar } from "../components/profile/ProfileAvatar";
import { buildProfileFormValue, deriveInitials, resolveProfile } from "../lib/profile";

describe("profile helpers", () => {
  it("derives preset profile data with display-name fallback ordering", () => {
    const profile = resolveProfile({
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      avatar_mode: "preset",
      avatar_key: "ava",
      avatar_color: null,
    });

    expect(profile.displayName).toBe("Ada Lovelace");
    expect(profile.avatar_mode).toBe("preset");
    expect(profile.avatar_key).toBe("ava");
  });

  it("maps legacy preset avatar keys to the current preset catalog", () => {
    const profile = resolveProfile({
      email: "ada@example.com",
      full_name: "Ada Lovelace",
      avatar_mode: "preset",
      avatar_key: "rocket",
    });

    expect(profile.avatar_mode).toBe("preset");
    expect(profile.avatar_key).toBe("kai");
  });

  it("falls back to initials mode with a default color when metadata is invalid", () => {
    const profile = resolveProfile({
      email: "ada@example.com",
      avatar_mode: "preset",
      avatar_key: "missing",
    });

    expect(profile.displayName).toBe("ada@example.com");
    expect(profile.avatar_mode).toBe("preset");
    expect(profile.avatar_key).toBe("ava");
    expect(deriveInitials("Ada Lovelace")).toBe("AL");
  });

  it("builds a form value with a default preset avatar for new profiles", () => {
    const form = buildProfileFormValue();

    expect(form.avatar_mode).toBe("preset");
    expect(form.avatar_key).toBe("ava");
  });

  it("renders preset avatars and falls back to the default preset avatar", () => {
    const { container: presetContainer, rerender } = render(
      <ProfileAvatar
        className="profile-avatar"
        profile={{ full_name: "Ada Lovelace", avatar_mode: "preset", avatar_key: "ava" }}
      />,
    );

    expect(presetContainer.querySelector("[data-avatar-mode='preset']")).toBeInTheDocument();
    expect(presetContainer.querySelector("img[alt='Avatar 1 avatar']")).toBeInTheDocument();

    rerender(
      <ProfileAvatar
        className="profile-avatar"
        profile={{ full_name: "Ada Lovelace", avatar_mode: "initials", avatar_color: "teal" }}
      />,
    );

    expect(presetContainer.querySelector("[data-avatar-mode='preset']")).toBeInTheDocument();
    expect(presetContainer.querySelector("[data-avatar-key='ava']")).toBeInTheDocument();
  });
});
