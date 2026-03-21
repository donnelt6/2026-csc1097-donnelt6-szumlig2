import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../components/ChatPanel";
import {
  askQuestion,
  deleteChatSession,
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

vi.mock("../../lib/api", () => ({
  askQuestion: vi.fn(),
  deleteChatSession: vi.fn(),
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
  });

  it("shows a draft on first visit when there are no sessions", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    await waitFor(() => expect(screen.getAllByText("New Chat").length).toBeGreaterThan(0));
    expect(screen.getByText("No saved chats yet.")).toBeInTheDocument();
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
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByText("New Chat").length).toBeGreaterThan(0));
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
    await waitFor(() => expect(screen.getAllByText("Assignment Help").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("Use Moodle.")).toBeInTheDocument();
    expect(replaceMock).toHaveBeenLastCalledWith("/hubs/hub-1?session=session-1", { scroll: false });
  });

  it("keeps a failed first send in draft mode without creating a saved session", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockRejectedValue(new Error("Request failed"));

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByText("New Chat").length).toBeGreaterThan(0));
    await user.type(screen.getByLabelText("Ask a question"), "How do I submit assignments?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText("Error: Request failed")).toBeInTheDocument());
    expect(screen.getByText("No saved chats yet.")).toBeInTheDocument();
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
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByText("New Chat").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: "Sources (2/2)" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Hub only" }));
    await user.click(screen.getByRole("option", { name: "Hub + global" }));
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

  it("switches sessions and discards unsaved control changes on the persisted session", async () => {
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
      {
        id: "session-2",
        hub_id: "hub-1",
        title: "Exams",
        scope: "global",
        source_ids: ["src-2"],
        created_at: "2026-01-01T12:00:00Z",
        last_message_at: "2026-01-01T12:00:00Z",
      },
    ]);
    vi.mocked(getChatSessionMessages).mockImplementation(async (sessionId) => {
      if (sessionId === "session-1") {
        return {
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
            },
          ],
        };
      }
      return {
        session: {
          id: "session-2",
          hub_id: "hub-1",
          title: "Exams",
          scope: "global",
          source_ids: ["src-2"],
          created_at: "2026-01-01T12:00:00Z",
          last_message_at: "2026-01-01T12:00:00Z",
        },
        messages: [
          {
            id: "msg-2",
            role: "user",
            content: "When is the exam?",
            citations: [],
            created_at: "2026-01-01T12:00:00Z",
          },
        ],
      };
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("How do I submit assignments?")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Sources (2/2)" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Hub only" }));
    await user.click(screen.getByRole("option", { name: "Hub + global" }));

    expect(screen.getByRole("button", { name: "Sources (0/2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hub + global" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Exams 01 Jan" }));
    await waitFor(() => expect(screen.getByText("When is the exam?")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Assignments 02 Jan" }));
    await waitFor(() => expect(screen.getByText("How do I submit assignments?")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Sources (2/2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hub only" })).toBeInTheDocument();
  });

  it("deletes the active session and returns to the draft", async () => {
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
    vi.mocked(deleteChatSession).mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn(() => true));

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Delete Assignments" }));

    await waitFor(() => expect(deleteChatSession).toHaveBeenCalledWith("session-1"));
    expect(screen.getAllByText("New Chat").length).toBeGreaterThan(0);
    expect(replaceMock).toHaveBeenLastCalledWith("/hubs/hub-1", { scroll: false });
  });

  it("falls back from an invalid session query to the most recent session", async () => {
    currentSearchParams = "session=invalid-session";
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
    vi.mocked(getChatSessionMessages)
      .mockRejectedValueOnce(new Error("Chat session not found"))
      .mockResolvedValueOnce({
        session: {
          id: "session-1",
          hub_id: "hub-1",
          title: "Assignments",
          scope: "hub",
          source_ids: ["src-1"],
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
          },
        ],
      });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />
    );

    await waitFor(() => expect(screen.getByText("How do I submit assignments?")).toBeInTheDocument());
    expect(replaceMock).toHaveBeenLastCalledWith("/hubs/hub-1?session=session-1", { scroll: false });
  });

  it("restores saved source selection after sources load later", async () => {
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
      <ChatPanel hubId="hub-1" hubName="CSC1097" sources={[]} sourcesLoading />
    );

    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    rerender(<ChatPanel hubId="hub-1" hubName="CSC1097" sources={sources} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Sources (1/2)" })).toBeInTheDocument());
  });
});
