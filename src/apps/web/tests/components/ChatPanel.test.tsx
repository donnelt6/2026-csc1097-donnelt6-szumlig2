import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../components/ChatPanel";
import {
  askQuestion,
  flagMessage,
  getChatSessionMessages,
  listChatSessions,
} from "../../lib/api";
import type { Source } from "../../lib/types";
import { renderWithQueryClient } from "../test-utils";

const replaceMock = vi.fn();
let currentSearchParams = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/hubs/hub-1",
  useSearchParams: () => new URLSearchParams(currentSearchParams),
}));

vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
  }),
}));

vi.mock("../../lib/api", () => ({
  askQuestion: vi.fn(),
  deleteChatSession: vi.fn(),
  flagMessage: vi.fn(),
  getChatSessionMessages: vi.fn(),
  listChatSessions: vi.fn(),
}));

const sources: Source[] = [
  {
    id: "src-1",
    hub_id: "hub-1",
    type: "file",
    original_name: "Assignments.pdf",
    status: "complete",
    created_at: "2026-01-02T10:00:00Z",
  },
  {
    id: "src-2",
    hub_id: "hub-1",
    type: "file",
    original_name: "Guide.md",
    status: "complete",
    created_at: "2026-01-01T10:00:00Z",
  },
];

describe("ChatPanel", () => {
  beforeEach(() => {
    currentSearchParams = "";
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows the empty state on first visit when there are no sessions", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    expect(screen.getByText("Ask a question about your hub")).toBeInTheDocument();
  });

  it("creates a saved session from the draft on first send", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Use Moodle.",
      citations: [],
      message_id: "message-1",
      session_id: "session-1",
      session_title: "Assignment Help",
      flag_status: "none",
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Ask a question"), "How do I submit assignments?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(askQuestion).toHaveBeenCalled());
    expect(askQuestion).toHaveBeenCalledWith({
      hub_id: "hub-1",
      question: "How do I submit assignments?",
      scope: "hub",
      source_ids: ["src-1", "src-2"],
      session_id: null,
    });
    await waitFor(() => expect(screen.getByText("Assignment Help")).toBeInTheDocument());
    expect(screen.getByText("Use Moodle.")).toBeInTheDocument();
    expect(replaceMock).toHaveBeenLastCalledWith("/hubs/hub-1?session=session-1", { scroll: false });
  });

  it("keeps a failed first send in draft mode without creating a saved session", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockRejectedValue(new Error("Request failed"));

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Ask a question"), "How do I submit assignments?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText("Error: Request failed")).toBeInTheDocument());
    expect(screen.queryByText("Assignment Help")).not.toBeInTheDocument();
  });

  it("allows hub plus global chat with no selected hub sources", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Global answer.",
      citations: [],
      message_id: "message-3",
      session_id: "session-3",
      session_title: "Global Help",
      flag_status: "none",
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Sources (2/2)" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Hub + global" }));
    await user.type(screen.getByLabelText("Ask a question"), "What should I know before starting?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(askQuestion).toHaveBeenCalled());
    expect(askQuestion).toHaveBeenCalledWith({
      hub_id: "hub-1",
      question: "What should I know before starting?",
      scope: "global",
      source_ids: [],
      session_id: null,
    });
    expect(screen.queryByText("Select at least one source above to send in this chat.")).not.toBeInTheDocument();
  });

  it("loads an existing session from the URL query param", async () => {
    currentSearchParams = "session=session-1";
    vi.mocked(listChatSessions).mockResolvedValue([
      {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1", "src-2"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
    ]);
    vi.mocked(getChatSessionMessages).mockResolvedValue({
      session: {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1", "src-2"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "How do I submit assignments?",
          citations: [],
          created_at: "2026-01-02T12:00:00Z",
          flag_status: "none",
        },
      ],
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    await waitFor(() => expect(screen.getByText("How do I submit assignments?")).toBeInTheDocument());
    expect(screen.getByText("Assignments")).toBeInTheDocument();
  });

  it("updates the active session title when the shared session cache changes", async () => {
    currentSearchParams = "session=session-1";
    vi.mocked(listChatSessions).mockResolvedValue([
      {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1", "src-2"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
    ]);
    vi.mocked(getChatSessionMessages).mockResolvedValue({
      session: {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1", "src-2"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
      messages: [],
    });

    const { queryClient } = renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());

    queryClient.setQueryData(["chat-sessions", "hub-1"], [
      {
        id: "session-1",
        hub_id: "hub-1",
        title: "Renamed Session",
        scope: "hub",
        source_ids: ["src-1", "src-2"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
    ]);

    await waitFor(() => expect(screen.getByText("Renamed Session")).toBeInTheDocument());
  });

  it("restores saved source selection after sources load later", async () => {
    currentSearchParams = "session=session-1";
    vi.mocked(listChatSessions).mockResolvedValue([
      {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
    ]);
    vi.mocked(getChatSessionMessages).mockResolvedValue({
      session: {
        id: "session-1",
        hub_id: "hub-1",
        title: "Assignments",
        scope: "hub",
        source_ids: ["src-1"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
      messages: [],
    });

    const { rerender } = renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={[]} sourcesLoading />
    );

    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    rerender(<ChatPanel hubId="hub-1" sources={sources} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Sources (1/2)" })).toBeInTheDocument());
  });

  it("flags an assistant response for moderation", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Use Moodle.",
      citations: [],
      message_id: "message-1",
      session_id: "session-1",
      session_title: "Assignment Help",
      flag_status: "none",
    });
    vi.mocked(flagMessage).mockResolvedValue({
      created: true,
      flag_case: {
        id: "flag-1",
        hub_id: "hub-1",
        session_id: "session-1",
        message_id: "message-1",
        created_by: "user-1",
        reason: "outdated",
        status: "open",
        created_at: "2026-03-22T10:00:00Z",
        updated_at: "2026-03-22T10:00:00Z",
      },
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubRole="viewer" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Ask a question"), "How do I submit assignments?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText("Report")).toBeInTheDocument());
    await user.click(screen.getByText("Report"));
    await user.click(screen.getByText("Outdated"));

    await waitFor(() => expect(flagMessage).toHaveBeenCalledWith("message-1", { reason: "outdated" }));
  });
});
