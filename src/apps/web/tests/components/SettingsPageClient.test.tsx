import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPageClient } from "../../components/settings/SettingsPageClient";

const { updateUser, back, push, refreshUser, mockUser } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  refreshUser: vi.fn(),
  mockUser: {
    id: "user-1",
    email: "ada@example.com",
    user_metadata: {
      full_name: "Ada Lovelace",
      avatar_mode: "preset",
      avatar_key: "rocket",
      avatar_color: null,
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back,
    push,
  }),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: mockUser,
    refreshUser,
  }),
}));

vi.mock("../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      updateUser,
    },
  },
}));

describe("SettingsPageClient", () => {
  beforeEach(() => {
    updateUser.mockReset();
    back.mockReset();
    push.mockReset();
    refreshUser.mockReset();
    window.history.pushState({}, "", "/");
    window.history.pushState({}, "", "/settings");
  });

  it("loads existing metadata and persists edits before returning to the previous page", async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<SettingsPageClient />);

    expect(screen.getByLabelText("Full name")).toHaveValue("Ada Lovelace");

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Full name"));
    await user.type(screen.getByLabelText("Full name"), "Ada Byron");
    await user.click(screen.getByRole("button", { name: "Choose glass avatar 2" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({
        data: {
          full_name: "Ada Byron",
          avatar_mode: "preset",
          avatar_key: "glass-02",
          avatar_color: null,
        },
      }),
    );
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(back).toHaveBeenCalled();
  });

  it("shows a back button that returns to the previous page", async () => {
    render(<SettingsPageClient />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(back).toHaveBeenCalled();
  });
});
