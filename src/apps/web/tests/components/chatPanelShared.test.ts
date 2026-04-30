import { describe, expect, it } from "vitest";
import { convertSessionMessagesToPairs } from "../../components/chat/chatPanelShared";

describe("chatPanelShared", () => {
  it("preserves an explicit greeting answer_status from hydrated session messages", () => {
    const pairs = convertSessionMessagesToPairs([
      {
        id: "user-1",
        role: "user",
        content: "Hi",
        citations: [],
        created_at: "2026-01-01T00:00:00Z",
        flag_status: "none",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi! How can I help you with this hub?",
        citations: [],
        created_at: "2026-01-01T00:00:01Z",
        flag_status: "none",
        answer_status: "greeting",
      },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].response?.answer_status).toBe("greeting");
  });

  it("falls back to abstained inference when older session messages do not include answer_status", () => {
    const pairs = convertSessionMessagesToPairs([
      {
        id: "user-1",
        role: "user",
        content: "What is the deadline?",
        citations: [],
        created_at: "2026-01-01T00:00:00Z",
        flag_status: "none",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "I don't have enough information from this hub's sources to answer that.",
        citations: [],
        created_at: "2026-01-01T00:00:01Z",
        flag_status: "none",
      },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].response?.answer_status).toBe("abstained");
  });
});
