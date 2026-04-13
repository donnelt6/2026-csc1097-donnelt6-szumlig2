import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminDashboard } from "../../components/AdminDashboard";
import {
  applyFlaggedChatRevision,
  createFlaggedChatRevision,
  decideSourceSuggestion,
  dismissContentFlag,
  dismissFlaggedChat,
  getFlaggedChat,
  listFlaggedChats,
  listFlaggedContent,
  listSourceSuggestions,
  listSources,
  regenerateFlaggedChat,
  resolveContentFlag,
} from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  applyFlaggedChatRevision: vi.fn(),
  createFlaggedChatRevision: vi.fn(),
  decideSourceSuggestion: vi.fn(),
  dismissContentFlag: vi.fn(),
  dismissFlaggedChat: vi.fn(),
  getFlaggedChat: vi.fn(),
  listFlaggedChats: vi.fn(),
  listFlaggedContent: vi.fn(),
  listSourceSuggestions: vi.fn(),
  listSources: vi.fn(),
  regenerateFlaggedChat: vi.fn(),
  resolveContentFlag: vi.fn(),
}));

describe("AdminDashboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders overview skeletons while admin data is loading", () => {
    const pending = new Promise<never>(() => {});
    vi.mocked(listSources).mockReturnValue(pending);
    vi.mocked(listSourceSuggestions).mockReturnValue(pending);
    vi.mocked(listFlaggedChats).mockReturnValue(pending);
    vi.mocked(listFlaggedContent).mockReturnValue(pending);
    vi.mocked(decideSourceSuggestion).mockResolvedValue(undefined as never);
    vi.mocked(regenerateFlaggedChat).mockResolvedValue(undefined as never);
    vi.mocked(dismissFlaggedChat).mockResolvedValue(undefined as never);
    vi.mocked(resolveContentFlag).mockResolvedValue(undefined as never);
    vi.mocked(dismissContentFlag).mockResolvedValue(undefined as never);
    vi.mocked(getFlaggedChat).mockResolvedValue(undefined as never);
    vi.mocked(createFlaggedChatRevision).mockResolvedValue(undefined as never);
    vi.mocked(applyFlaggedChatRevision).mockResolvedValue(undefined as never);

    renderWithQueryClient(<AdminDashboard hubId="hub-1" hubRole="owner" />);

    expect(screen.getByTestId("admin-stat-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("admin-stat-skeleton-2")).toBeInTheDocument();
    expect(screen.getByTestId("admin-suggestion-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("admin-suggestion-skeleton-2")).toBeInTheDocument();
    expect(screen.getByTestId("admin-moderation-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("admin-moderation-skeleton-2")).toBeInTheDocument();
  });
});
