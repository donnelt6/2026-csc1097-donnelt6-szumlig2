'use client';

// chatPanelShared.tsx: Shared chat constants, view helpers, and data shapers.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatResponse,
  ChatSessionSummary,
  FlagReason,
  SessionMessage,
} from "@shared/index";
import { normalizeChatResponse } from "../../lib/chatResponse";

export const SCOPE_OPTIONS = [
  { value: "hub" as const, label: "Hub only" },
  { value: "global" as const, label: "Hub + global" },
];

export const FLAG_REASON_OPTIONS: Array<{ value: FlagReason; label: string }> = [
  { value: "incorrect", label: "Incorrect" },
  { value: "unsupported", label: "Unsupported" },
  { value: "harmful", label: "Harmful" },
  { value: "outdated", label: "Outdated" },
  { value: "other", label: "Other" },
];

export const CHAT_SUGGESTED_PROMPTS = [
  {
    label: "Action items and deadlines",
    prompt: "Extract the main action items, deadlines, and responsibilities from this hub. Present them as a clear checklist.",
  },
  {
    label: "Summarise",
    prompt: "Summarise the selected sources clearly, focusing on the most important points and takeaways.",
  },
  {
    label: "Key Risks",
    prompt: "Identify the main risks, blockers, unanswered questions, or unresolved issues in this hub.",
  },
] as const;

export type ChatScope = "hub" | "global";

export interface MessagePair {
  id: string;
  userMessageId: string | null;
  question: string;
  response: ChatResponse | null;
  error: string | null;
  isLoading: boolean;
  timestamp: string | null;
}

export interface ChatControlState {
  scope: ChatScope;
  selectedSourceIds: string[];
}

export interface DraftState extends ChatControlState {
  messages: MessagePair[];
}

export interface ActiveCitationState {
  citation: Citation;
  messageId: string;
}

export function ChatLoadingSkeleton() {
  return (
    <div className="chat__loading" aria-hidden="true" data-testid="chat-loading-skeleton">
      <div className="chat__loading-pair chat__loading-pair--user">
        <div className="chat__loading-bubble chat__loading-bubble--user">
          <span className="chat__loading-line chat__loading-line--long dash-skeleton" />
          <span className="chat__loading-line chat__loading-line--short dash-skeleton" />
        </div>
        <span className="chat__loading-avatar chat__loading-avatar--user dash-skeleton" />
      </div>

      <div className="chat__loading-pair chat__loading-pair--ai">
        <span className="chat__loading-avatar chat__loading-avatar--ai dash-skeleton" />
        <div className="chat__loading-bubble chat__loading-bubble--ai">
          <span className="chat__loading-line chat__loading-line--medium dash-skeleton" />
          <span className="chat__loading-line chat__loading-line--long dash-skeleton" />
          <span className="chat__loading-line chat__loading-line--short dash-skeleton" />
          <div className="chat__loading-citations">
            <span className="chat__loading-chip dash-skeleton" />
            <span className="chat__loading-chip chat__loading-chip--short dash-skeleton" />
          </div>
        </div>
      </div>

      <div className="chat__loading-pair chat__loading-pair--user">
        <div className="chat__loading-bubble chat__loading-bubble--user">
          <span className="chat__loading-line chat__loading-line--medium dash-skeleton" />
        </div>
        <span className="chat__loading-avatar chat__loading-avatar--user dash-skeleton" />
      </div>
    </div>
  );
}

function buildHighlightedParts(snippet: string, quotes: string[]): { text: string; highlighted: boolean }[] {
  const lower = snippet.toLowerCase();
  const ranges: { start: number; end: number }[] = [];
  for (const quote of quotes) {
    const q = quote.toLowerCase().trim();
    if (!q) continue;
    const idx = lower.indexOf(q);
    if (idx !== -1) ranges.push({ start: idx, end: idx + q.length });
  }
  if (ranges.length === 0) return [{ text: snippet, highlighted: false }];

  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    if (ranges[i].start <= prev.end) {
      prev.end = Math.max(prev.end, ranges[i].end);
    } else {
      merged.push(ranges[i]);
    }
  }

  const parts: { text: string; highlighted: boolean }[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (cursor < range.start) parts.push({ text: snippet.slice(cursor, range.start), highlighted: false });
    parts.push({ text: snippet.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < snippet.length) parts.push({ text: snippet.slice(cursor), highlighted: false });
  return parts;
}

export function SourceExcerpt({
  snippet,
  relevantQuotes,
  paraphrasedQuotes,
}: {
  snippet: string;
  relevantQuotes?: string[];
  paraphrasedQuotes?: string[];
}) {
  const quotes = relevantQuotes?.filter(Boolean) ?? [];
  const paraphrases = paraphrasedQuotes?.filter(Boolean) ?? [];
  const hasPairs = paraphrases.length > 0 && paraphrases.length === quotes.length;
  const parts = buildHighlightedParts(snippet, quotes);

  return (
    <div className="chat__modal-excerpt">
      {hasPairs && paraphrases.map((paraphrase, i) => (
        <div key={i} className="chat__citation-pair">
          <p className="chat__citation-paraphrase">{paraphrase}</p>
          <blockquote className="chat__citation-direct">
            <span className="chat__direct-label">Direct quote</span>
            {quotes[i]}
          </blockquote>
        </div>
      ))}
      <div className="chat__modal-source">
        <span className="chat__modal-section-label">Source chunk</span>
        <p className="chat__modal-snippet">
          {parts.map((part, i) =>
            part.highlighted ? (
              <mark key={i} className="chat__snippet-highlight">{part.text}</mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}

export function MarkdownAnswer({ answer }: { answer: string }) {
  return (
    <div className="chat__answer">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {answer}
      </ReactMarkdown>
    </div>
  );
}

export function convertSessionMessagesToPairs(messages: SessionMessage[]): MessagePair[] {
  const pairs: MessagePair[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      pairs.push({
        id: message.id,
        userMessageId: message.id,
        question: message.content,
        response: null,
        error: null,
        isLoading: false,
        timestamp: message.created_at,
      });
      continue;
    }
    const lastPair = pairs[pairs.length - 1];
    if (!lastPair) {
      continue;
    }
    lastPair.response = {
      ...normalizeChatResponse({
        answer: message.content,
        citations: message.citations,
        message_id: message.id,
        session_id: "",
        session_title: "",
        active_flag_id: message.active_flag_id,
        flag_status: message.flag_status,
        feedback_rating: message.feedback_rating,
        answer_status: message.answer_status,
      }),
    };
  }
  return pairs;
}

export function buildDraftState(currentDraft: DraftState | null, completeSourceIds: string[]): DraftState {
  if (currentDraft) {
    return currentDraft;
  }
  return {
    messages: [],
    scope: "hub",
    selectedSourceIds: [...completeSourceIds],
  };
}

export function normalizeSelectedSourceIds(selectedSourceIds: string[], completeSourceIds: string[]): string[] {
  const selectedSet = new Set(selectedSourceIds);
  return completeSourceIds.filter((sourceId) => selectedSet.has(sourceId));
}

export function upsertSessionSummary(
  sessions: ChatSessionSummary[],
  nextSession: ChatSessionSummary,
): ChatSessionSummary[] {
  const index = sessions.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [...sessions, nextSession];
  }
  const nextSessions = [...sessions];
  nextSessions[index] = nextSession;
  return nextSessions;
}

export function moveSessionToTop(sessions: ChatSessionSummary[], sessionId: string): ChatSessionSummary[] {
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) {
    return sessions;
  }
  return [target, ...sessions.filter((session) => session.id !== sessionId)];
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const day = date.toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
  return `${day} ${time}`;
}
