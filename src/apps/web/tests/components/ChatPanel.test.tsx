import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../../components/ChatPanel";
import {
  askQuestion,
  flagMessage,
  getChatPromptSuggestion,
  getChatSessionMessages,
  listChatSessions,
  submitChatFeedback,
  submitCitationFeedback,
} from "../../lib/api";
import type { Source } from "@shared/index";
import { renderWithQueryClient } from "../test-utils";

const replaceMock = vi.fn((nextUrl?: string) => {
  if (!nextUrl) {
    currentSearchParams = "";
    return;
  }
  const queryIndex = nextUrl.indexOf("?");
  currentSearchParams = queryIndex === -1 ? "" : nextUrl.slice(queryIndex + 1);
});
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
  createChatEvent: vi.fn(),
  deleteChatSession: vi.fn(),
  flagMessage: vi.fn(),
  getChatPromptSuggestion: vi.fn(),
  getChatSessionMessages: vi.fn(),
  listChatSessions: vi.fn(),
  submitChatFeedback: vi.fn(),
  submitCitationFeedback: vi.fn(),
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
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows the empty state on first visit when there are no sessions", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);

    const { container } = renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    await waitFor(() => expect(screen.getByText("Ask a question about your hub")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Action items and deadlines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Summarise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Key Risks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest a tailored prompt" })).toBeInTheDocument();
    expect(container.querySelector(".chat__lane--messages")).toBeTruthy();
    expect(container.querySelector(".chat__lane--composer")).toBeTruthy();
  });

  it("prefills the composer with a tailored AI suggestion", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(getChatPromptSuggestion).mockResolvedValue({
      prompt: "What deadlines matter most here?",
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Ask a question")).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "Suggest a tailored prompt" }));

    await waitFor(() => expect(getChatPromptSuggestion).toHaveBeenCalledWith("hub-1", ["src-1", "src-2"]));
    expect(screen.getByLabelText("Ask a question")).toHaveValue("What deadlines matter most here?");
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
    const textarea = screen.getByLabelText("Ask a question");
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(textarea).not.toBeDisabled());
    await user.type(textarea, "How do I submit assignments?");
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    await user.click(sendButton);

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
    const textarea = screen.getByLabelText("Ask a question");
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(textarea).not.toBeDisabled());
    await user.type(textarea, "How do I submit assignments?");
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    await user.click(sendButton);

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
    const textarea = screen.getByLabelText("Ask a question");
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(textarea).not.toBeDisabled());
    await user.type(textarea, "What should I know before starting?");
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    await user.click(sendButton);

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
    expect(screen.getByRole("button", { name: "Suggest a tailored prompt" })).toBeInTheDocument();
  });

  it("highlights a deep-linked message when opening a session from search", async () => {
    currentSearchParams = "session=session-1&message=msg-1";
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

    const message = await screen.findByText("How do I submit assignments?");
    await waitFor(() => expect(message.closest(".chat__message--highlighted")).toBeInTheDocument());
  });

  it("submits helpful feedback for an assistant message", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Use Moodle.",
      citations: [],
      message_id: "message-1",
      session_id: "session-1",
      session_title: "Assignment Help",
      flag_status: "none",
      feedback_rating: null,
    });
    vi.mocked(submitChatFeedback).mockResolvedValue({
      message_id: "message-1",
      rating: "helpful",
      updated_at: "2026-01-02T12:00:00Z",
    });

    renderWithQueryClient(<ChatPanel hubId="hub-1" sources={sources} />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Ask a question"), "How do I submit assignments?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    const answer = await screen.findByText("Use Moodle.");
    const answerPair = answer.closest(".chat__pair");
    expect(answerPair).toBeTruthy();

    await user.click(within(answerPair as HTMLElement).getByRole("button", { name: "Mark answer helpful" }));

    await waitFor(() => expect(submitChatFeedback).toHaveBeenCalledWith("message-1", { rating: "helpful" }));
    expect(within(answerPair as HTMLElement).getByText("Helpful")).toBeInTheDocument();
  });

  it("tracks citation opens and lets the user flag a citation", async () => {
    vi.mocked(listChatSessions).mockResolvedValue([]);
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Orientation starts in September. [1]",
      citations: [{ source_id: "src-1", snippet: "Orientation starts on September 12.", chunk_index: 0 }],
      message_id: "message-2",
      session_id: "session-2",
      session_title: "Orientation",
      flag_status: "none",
      feedback_rating: null,
    });
    vi.mocked(submitCitationFeedback)
      .mockResolvedValueOnce({
        message_id: "message-2",
        source_id: "src-1",
        chunk_index: 0,
        event_type: "opened",
        created_at: "2026-01-02T12:00:00Z",
      })
      .mockResolvedValueOnce({
        message_id: "message-2",
        source_id: "src-1",
        chunk_index: 0,
        event_type: "flagged_incorrect",
        created_at: "2026-01-02T12:00:05Z",
      });

    renderWithQueryClient(<ChatPanel hubId="hub-1" sources={sources} />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("New Chat")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Ask a question"), "When does orientation start?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Assignments.pdf" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Assignments.pdf" }));
    await waitFor(() =>
      expect(submitCitationFeedback).toHaveBeenCalledWith("message-2", {
        source_id: "src-1",
        chunk_index: 0,
        event_type: "opened",
      })
    );

    await user.click(screen.getByRole("button", { name: "Flag citation" }));
    await waitFor(() =>
      expect(submitCitationFeedback).toHaveBeenCalledWith("message-2", {
        source_id: "src-1",
        chunk_index: 0,
        event_type: "flagged_incorrect",
      })
    );
    expect(screen.getByText("Citation flagged")).toBeInTheDocument();
  });

  it("blocks composer input and submission while the chat is bootstrapping", async () => {
    let resolveSessions!: () => void;
    vi.mocked(listChatSessions).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSessions = () => resolve([]);
        })
    );

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    expect(screen.getByTestId("chat-loading-skeleton")).toBeInTheDocument();
    const textarea = screen.getByLabelText("Ask a question");
    const sendButton = screen.getByRole("button", { name: "Send message" });

    expect(textarea).toBeDisabled();
    expect(sendButton).toBeDisabled();

    const user = userEvent.setup();
    await user.type(textarea, "How do I submit assignments?");
    await user.keyboard("{Enter}");

    expect(askQuestion).not.toHaveBeenCalled();

    resolveSessions();
    await waitFor(() => expect(screen.getByText("Ask a question about your hub")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-loading-skeleton")).not.toBeInTheDocument();
    expect(textarea).not.toBeDisabled();
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

  it("starts a new chat and auto-sends a launched dashboard prompt", async () => {
    currentSearchParams = "session=new&promptAction=send&prompt=Extract%20the%20main%20action%20items";
    vi.mocked(listChatSessions).mockResolvedValue([
      {
        id: "session-existing",
        hub_id: "hub-1",
        title: "Existing Chat",
        scope: "hub",
        source_ids: ["src-1", "src-2"],
        created_at: "2026-01-02T12:00:00Z",
        last_message_at: "2026-01-02T12:00:00Z",
      },
    ]);
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Checklist ready.",
      citations: [],
      message_id: "message-9",
      session_id: "session-9",
      session_title: "Action Items",
      flag_status: "none",
    });

    renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    await waitFor(() => expect(askQuestion).toHaveBeenCalledWith({
      hub_id: "hub-1",
      question: "Extract the main action items",
      scope: "hub",
      source_ids: ["src-1", "src-2"],
      session_id: null,
    }));
    expect(getChatSessionMessages).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalledWith("/hubs/hub-1", { scroll: false });
    expect(replaceMock).toHaveBeenLastCalledWith("/hubs/hub-1?session=session-9", { scroll: false });
    await waitFor(() => expect(screen.getByText("Action Items")).toBeInTheDocument());
  });

  it("ignores a stale send response after the user switches sessions", async () => {
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
      {
        id: "session-2",
        hub_id: "hub-1",
        title: "Exams",
        scope: "hub",
        source_ids: ["src-1"],
        created_at: "2026-01-03T12:00:00Z",
        last_message_at: "2026-01-03T12:00:00Z",
      },
    ]);
    vi.mocked(getChatSessionMessages).mockImplementation(async (sessionId: string) => {
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
          messages: [],
        };
      }
      return {
        session: {
          id: "session-2",
          hub_id: "hub-1",
          title: "Exams",
          scope: "hub",
          source_ids: ["src-1"],
          created_at: "2026-01-03T12:00:00Z",
          last_message_at: "2026-01-03T12:00:00Z",
        },
        messages: [],
      };
    });

    let resolveAsk!: (value: Awaited<ReturnType<typeof askQuestion>>) => void;
    vi.mocked(askQuestion).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAsk = resolve;
        })
    );

    const { rerender } = renderWithQueryClient(
      <ChatPanel hubId="hub-1" sources={sources} />
    );

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText("Assignments")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Ask a question"), "How do I submit assignments?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(askQuestion).toHaveBeenCalledTimes(1));

    currentSearchParams = "session=session-2";
    rerender(<ChatPanel hubId="hub-1" sources={sources} />);
    await waitFor(() => expect(screen.getByText("Exams")).toBeInTheDocument());
    const replaceCallsBeforeResolve = replaceMock.mock.calls.length;

    resolveAsk({
      answer: "Use Moodle.",
      citations: [],
      message_id: "message-1",
      session_id: "session-1",
      session_title: "Assignments",
      flag_status: "none",
    });

    await waitFor(() => expect(screen.getByText("Exams")).toBeInTheDocument());
    expect(screen.queryByText("Use Moodle.")).not.toBeInTheDocument();
    expect(replaceMock.mock.calls).toHaveLength(replaceCallsBeforeResolve);
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
    const textarea = screen.getByLabelText("Ask a question");
    const sendButton = screen.getByRole("button", { name: "Send message" });
    await waitFor(() => expect(textarea).not.toBeDisabled());
    await user.type(textarea, "How do I submit assignments?");
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    await user.click(sendButton);

    await waitFor(() => expect(screen.getByText("Report")).toBeInTheDocument());
    await user.click(screen.getByText("Report"));
    await user.click(screen.getByText("Outdated"));

    await waitFor(() => expect(flagMessage).toHaveBeenCalledWith("message-1", { reason: "outdated" }));
  });
});
