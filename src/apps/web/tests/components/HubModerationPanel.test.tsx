import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubModerationPanel } from "../../components/HubModerationPanel";
import {
  applyFlaggedChatRevision,
  createFlaggedChatRevision,
  dismissFlaggedChat,
  getFlaggedChat,
  listFlaggedChats,
  regenerateFlaggedChat,
} from "../../lib/api";
import { renderWithQueryClient } from "../test-utils";

vi.mock("../../lib/api", () => ({
  applyFlaggedChatRevision: vi.fn(),
  createFlaggedChatRevision: vi.fn(),
  dismissFlaggedChat: vi.fn(),
  getFlaggedChat: vi.fn(),
  listFlaggedChats: vi.fn(),
  regenerateFlaggedChat: vi.fn(),
}));

function buildDetail(flagId: string, overrides: Record<string, unknown> = {}) {
  return {
    case: {
      id: flagId,
      hub_id: "hub-1",
      session_id: `session-${flagId}`,
      message_id: `message-${flagId}`,
      created_by: "user-1",
      reason: "incorrect",
      notes: null,
      status: "open",
      reviewed_by: null,
      reviewed_at: null,
      resolved_revision_id: null,
      created_at: "2026-03-22T10:00:00Z",
      updated_at: "2026-03-22T10:00:00Z",
    },
    hub_name: "Hub One",
    session_title: `Session ${flagId}`,
    question_message: {
      id: `question-${flagId}`,
      role: "user",
      content: `Question ${flagId}`,
      citations: [],
      created_at: "2026-03-22T10:00:00Z",
      flag_status: "none",
    },
    flagged_message: {
      id: `message-${flagId}`,
      role: "assistant",
      content: `Visible answer ${flagId}`,
      citations: [],
      created_at: "2026-03-22T10:00:01Z",
      active_flag_id: flagId,
      flag_status: "open",
    },
    revisions: [
      {
        id: `original-${flagId}`,
        message_id: `message-${flagId}`,
        flag_case_id: flagId,
        revision_type: "original",
        content: `Original answer ${flagId}`,
        citations: [],
        created_at: "2026-03-22T10:00:01Z",
        applied_at: null,
      },
    ],
    ...overrides,
  };
}

describe("HubModerationPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("selects a regenerated revision after same-case refetch", async () => {
    const queue = [
      {
        id: "flag-1",
        hub_id: "hub-1",
        hub_name: "Hub One",
        session_id: "session-1",
        session_title: "Session One",
        message_id: "message-1",
        question_preview: "Question",
        answer_preview: "Visible answer",
        reason: "incorrect",
        status: "open",
        flagged_at: "2026-03-22T10:00:00Z",
        reviewed_at: null,
      },
    ];
    let detailState = buildDetail("flag-1");
    vi.mocked(listFlaggedChats).mockResolvedValue(queue);
    vi.mocked(getFlaggedChat).mockImplementation(async () => detailState);
    vi.mocked(regenerateFlaggedChat).mockImplementation(async () => {
      detailState = buildDetail("flag-1", {
        revisions: [
          ...detailState.revisions,
          {
            id: "revision-2",
            message_id: "message-1",
            flag_case_id: "flag-1",
            revision_type: "regenerated",
            content: "Generated draft",
            citations: [],
            created_at: "2026-03-22T10:05:00Z",
            applied_at: null,
          },
        ],
      });
      return detailState.revisions[1];
    });

    renderWithQueryClient(<HubModerationPanel hubId="hub-1" hubRole="owner" />);

    await waitFor(() => expect(screen.getByText("Session One")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue("Visible answer flag-1"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Regenerate draft" }));

    await waitFor(() => expect(regenerateFlaggedChat).toHaveBeenCalledWith("hub-1", "flag-1"));
    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue("Generated draft"));
    expect(screen.getAllByText("Generated draft").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("Generated draft");
  });

  it("keeps a newly saved manual revision selected after refetch", async () => {
    const queue = [
      {
        id: "flag-1",
        hub_id: "hub-1",
        hub_name: "Hub One",
        session_id: "session-1",
        session_title: "Session One",
        message_id: "message-1",
        question_preview: "Question",
        answer_preview: "Visible answer",
        reason: "incorrect",
        status: "open",
        flagged_at: "2026-03-22T10:00:00Z",
        reviewed_at: null,
      },
    ];
    let detailState = buildDetail("flag-1", {
      revisions: [
        {
          id: "original-flag-1",
          message_id: "message-1",
          flag_case_id: "flag-1",
          revision_type: "original",
          content: "Original answer",
          citations: [],
          created_at: "2026-03-22T10:00:01Z",
          applied_at: null,
        },
        {
          id: "revision-1",
          message_id: "message-1",
          flag_case_id: "flag-1",
          revision_type: "manual_edit",
          content: "Older draft",
          citations: [],
          created_at: "2026-03-22T10:01:00Z",
          applied_at: null,
        },
      ],
    });
    vi.mocked(listFlaggedChats).mockResolvedValue(queue);
    vi.mocked(getFlaggedChat).mockImplementation(async () => detailState);
    vi.mocked(createFlaggedChatRevision).mockImplementation(async (_hubId, _flagId, data) => {
      const revision = {
        id: "revision-2",
        message_id: "message-1",
        flag_case_id: "flag-1",
        revision_type: "manual_edit",
        content: data.content,
        citations: data.citations,
        created_at: "2026-03-22T10:06:00Z",
        applied_at: null,
      };
      detailState = buildDetail("flag-1", {
        revisions: [...detailState.revisions, revision],
      });
      return revision;
    });

    renderWithQueryClient(<HubModerationPanel hubId="hub-1" hubRole="owner" />);

    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue("Older draft"));
    const user = userEvent.setup();
    await user.clear(screen.getAllByRole("textbox")[0]);
    await user.type(screen.getAllByRole("textbox")[0], "New manual draft");
    await user.click(screen.getByRole("button", { name: "Save manual draft" }));

    await waitFor(() =>
      expect(createFlaggedChatRevision).toHaveBeenCalledWith("hub-1", "flag-1", {
        content: "New manual draft",
        citations: [],
      })
    );
    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue("New manual draft"));
    expect(screen.getAllByText("New manual draft").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("New manual draft");
  });

  it("resets draft state when switching to a different flag case", async () => {
    const queue = [
      {
        id: "flag-1",
        hub_id: "hub-1",
        hub_name: "Hub One",
        session_id: "session-1",
        session_title: "Session One",
        message_id: "message-1",
        question_preview: "Question one",
        answer_preview: "Visible answer one",
        reason: "incorrect",
        status: "open",
        flagged_at: "2026-03-22T10:00:00Z",
        reviewed_at: null,
      },
      {
        id: "flag-2",
        hub_id: "hub-1",
        hub_name: "Hub One",
        session_id: "session-2",
        session_title: "Session Two",
        message_id: "message-2",
        question_preview: "Question two",
        answer_preview: "Visible answer two",
        reason: "outdated",
        status: "open",
        flagged_at: "2026-03-22T10:02:00Z",
        reviewed_at: null,
      },
    ];
    const detailsByFlagId = {
      "flag-1": buildDetail("flag-1", {
        revisions: [
          {
            id: "original-flag-1",
            message_id: "message-1",
            flag_case_id: "flag-1",
            revision_type: "original",
            content: "Original answer one",
            citations: [],
            created_at: "2026-03-22T10:00:01Z",
            applied_at: null,
          },
          {
            id: "revision-1",
            message_id: "message-1",
            flag_case_id: "flag-1",
            revision_type: "manual_edit",
            content: "Draft one",
            citations: [],
            created_at: "2026-03-22T10:01:00Z",
            applied_at: null,
          },
        ],
      }),
      "flag-2": buildDetail("flag-2", {
        revisions: [
          {
            id: "original-flag-2",
            message_id: "message-2",
            flag_case_id: "flag-2",
            revision_type: "original",
            content: "Original answer two",
            citations: [],
            created_at: "2026-03-22T10:02:01Z",
            applied_at: null,
          },
          {
            id: "revision-2",
            message_id: "message-2",
            flag_case_id: "flag-2",
            revision_type: "manual_edit",
            content: "Draft two",
            citations: [],
            created_at: "2026-03-22T10:03:00Z",
            applied_at: null,
          },
        ],
      }),
    };
    vi.mocked(listFlaggedChats).mockResolvedValue(queue);
    vi.mocked(getFlaggedChat).mockImplementation(async (_hubId, flagId) => detailsByFlagId[flagId as "flag-1" | "flag-2"]);
    vi.mocked(applyFlaggedChatRevision).mockResolvedValue(buildDetail("flag-1").case);
    vi.mocked(createFlaggedChatRevision).mockResolvedValue(detailsByFlagId["flag-1"].revisions[1]);
    vi.mocked(dismissFlaggedChat).mockResolvedValue(buildDetail("flag-1").case);
    vi.mocked(regenerateFlaggedChat).mockResolvedValue(detailsByFlagId["flag-1"].revisions[1]);

    renderWithQueryClient(<HubModerationPanel hubId="hub-1" hubRole="owner" />);

    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue("Draft one"));
    const user = userEvent.setup();
    await user.clear(screen.getAllByRole("textbox")[0]);
    await user.type(screen.getAllByRole("textbox")[0], "Unsaved edit");
    await user.click(screen.getByRole("button", { name: /Session Two/i }));

    await waitFor(() => expect(screen.getAllByRole("textbox")[0]).toHaveValue("Draft two"));
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("Draft two");
  });
});
