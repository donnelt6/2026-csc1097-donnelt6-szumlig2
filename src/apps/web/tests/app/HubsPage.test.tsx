import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HubsPage from "../../app/hubs/page";
import { createHub } from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

const replaceMock = vi.fn();
let currentSearchParams = "create=true";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearchParams),
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("../../lib/SearchContext", () => ({
  useSearch: () => ({
    searchQuery: "",
    setSearchQuery: vi.fn(),
  }),
}));

vi.mock("../../lib/api", () => ({
  createHub: vi.fn(),
}));

vi.mock("../../components/HubsList", () => ({
  HubsList: () => <div>Hubs list</div>,
}));

vi.mock("../../components/HubsToolbar", () => ({
  HubsToolbar: () => <div>Toolbar</div>,
}));

vi.mock("../../components/HubAppearanceModal", () => ({
  HubAppearanceModal: ({
    onSubmit,
    name,
    onNameChange,
    submitLabel,
  }: {
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
    name: string;
    onNameChange: (value: string) => void;
    submitLabel: string;
  }) => (
    <form onSubmit={onSubmit}>
      <input
        aria-label="Hub title"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
      <button type="submit">{submitLabel}</button>
    </form>
  ),
}));

describe("HubsPage", () => {
  afterEach(() => {
    currentSearchParams = "create=true";
    vi.clearAllMocks();
  });

  it("clears pending client sync immediately after create success", async () => {
    vi.mocked(createHub).mockResolvedValue({
      id: "hub-1",
      owner_id: "user-1",
      name: "Created Hub",
      description: null,
      created_at: "2026-01-01T00:00:00Z",
      role: "owner",
      is_favourite: false,
    });

    const user = userEvent.setup();
    const { queryClient } = renderWithQueryClient(<HubsPage />);
    queryClient.setQueryData(["hubs"], []);

    await user.type(await screen.findByLabelText("Hub title"), "Created Hub");
    await user.click(screen.getByRole("button", { name: "Create hub" }));

    await waitFor(() => expect(createHub).toHaveBeenCalled());
    await waitFor(() =>
      expect(queryClient.getQueryData<{ id: string; _isPendingClientSync?: boolean }[]>(["hubs"])).toEqual([
        expect.objectContaining({
          id: "hub-1",
          _isPendingClientSync: false,
        }),
      ])
    );
  });
});
