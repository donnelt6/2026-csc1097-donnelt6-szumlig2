import type { ChatAnswerStatus, ChatResponse, Citation } from "@shared/index";

const ABSTAIN_MARKERS = [
  "don't have enough information",
  "do not have enough information",
  "not enough information",
  "insufficient information",
  "cannot determine",
  "can't determine",
];

const GREETING_ANSWERS = new Set([
  "Hi! How can I help you with this hub?",
  "You're welcome! Let me know if there's anything else I can help with.",
]);

const EMPTY_ANSWER_FALLBACK = "I don't have enough information from this hub's sources to answer that.";

export type ChatResponseLike = Omit<ChatResponse, "answer_status"> & {
  answer_status?: ChatAnswerStatus;
};

export function inferAnswerStatus(content: string, citations: Citation[]): ChatAnswerStatus {
  if (citations.length > 0) {
    return "answered";
  }
  if (GREETING_ANSWERS.has(content.trim())) {
    return "greeting";
  }
  const lowered = content.toLowerCase();
  return ABSTAIN_MARKERS.some((marker) => lowered.includes(marker)) ? "abstained" : "answered";
}

export function normaliseChatResponse(response: ChatResponseLike): ChatResponse {
  const answer = response.answer.trim() ? response.answer : EMPTY_ANSWER_FALLBACK;
  return {
    ...response,
    answer,
    answer_status: response.answer_status ?? inferAnswerStatus(answer, response.citations),
  };
}
