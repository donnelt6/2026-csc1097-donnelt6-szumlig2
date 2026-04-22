'use client';

// ChatPanel.tsx: Chat interface with message history, streaming responses, and feedback.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardDocumentIcon,
  FlagIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  BookmarkIcon,
  PaperAirplaneIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  askQuestion,
  createFaq,
  createChatEvent,
  flagMessage,
  getChatPromptSuggestion,
  getChatSessionMessages,
  listChatSessions,
  submitChatFeedback,
  submitCitationFeedback,
} from "../lib/api";
import type {
  ChatFeedbackRating,
  ChatResponse,
  Citation,
  ChatSessionSummary,
  FlagReason,
  MembershipRole,
  SessionMessage,
  Source,
} from "@shared/index";
import { SourceSelector } from "./SourceSelector";
import { useAuth } from "./auth/AuthProvider";
import { ProfileAvatar } from "./profile/ProfileAvatar";

const SCOPE_OPTIONS = [
  { value: "hub" as const, label: "Hub only" },
  { value: "global" as const, label: "Hub + global" },
];

const FLAG_REASON_OPTIONS: Array<{ value: FlagReason; label: string }> = [
  { value: "incorrect", label: "Incorrect" },
  { value: "unsupported", label: "Unsupported" },
  { value: "harmful", label: "Harmful" },
  { value: "outdated", label: "Outdated" },
  { value: "other", label: "Other" },
];

const CHAT_SUGGESTED_PROMPTS = [
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

function ChatLoadingSkeleton() {
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

type ChatScope = "hub" | "global";

interface MessagePair {
  id: string;
  userMessageId: string | null;
  question: string;
  response: ChatResponse | null;
  error: string | null;
  isLoading: boolean;
  timestamp: string | null;
}

interface ChatControlState {
  scope: ChatScope;
  selectedSourceIds: string[];
}

interface DraftState extends ChatControlState {
  messages: MessagePair[];
}

interface ActiveCitationState {
  citation: Citation;
  messageId: string;
}

export interface ChatPanelHandle {
  toggleSource: (sourceId: string) => void;
  selectAllSources: (scope?: string[]) => void;
  clearSourceSelection: (scope?: string[]) => void;
}

interface Props {
  hubId: string;
  hubRole?: MembershipRole | null;
  sources: Source[];
  sourcesLoading?: boolean;
  onSourceSelectionChange?: (selectedIds: string[]) => void;
}

function buildHighlightedParts(snippet: string, quotes: string[]): { text: string; highlighted: boolean }[] {
  // Find all match ranges (case-insensitive)
  const lower = snippet.toLowerCase();
  const ranges: { start: number; end: number }[] = [];
  for (const quote of quotes) {
    const q = quote.toLowerCase().trim();
    if (!q) continue;
    const idx = lower.indexOf(q);
    if (idx !== -1) ranges.push({ start: idx, end: idx + q.length });
  }
  if (ranges.length === 0) return [{ text: snippet, highlighted: false }];

  // Merge overlapping ranges
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

  // Build segments
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

function SourceExcerpt({
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

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel({ hubId, hubRole, sources, sourcesLoading, onSourceSelectionChange }, ref) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSessionParam = searchParams.get("session");
  const initialMessageParam = searchParams.get("message");
  const initialPromptParam = searchParams.get("prompt");
  const initialPromptAction = searchParams.get("promptAction");
  const hasAutoSent = useRef(false);
  const sessionQueryKey = ["chat-sessions", hubId] as const;

  const [question, setQuestion] = useState("");
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [messages, setMessages] = useState<MessagePair[]>([]);
  const [scope, setScope] = useState<ChatScope>("hub");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSuggestingPrompt, setIsSuggestingPrompt] = useState(false);
  const [promptSuggestionError, setPromptSuggestionError] = useState<string | null>(null);
  const [flaggingMessageId, setFlaggingMessageId] = useState<string | null>(null);
  const [reportMenuMessageId, setReportMenuMessageId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<ActiveCitationState | null>(null);
  const [savedFaqIds, setSavedFaqIds] = useState<Set<string>>(new Set());
  const [savingFaqId, setSavingFaqId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, ChatFeedbackRating>>({});
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState<string | null>(null);
  const [citationFeedbackPending, setCitationFeedbackPending] = useState(false);
  const [citationFeedbackStatus, setCitationFeedbackStatus] = useState<string | null>(null);

  const { data: sessionList = [], refetch: refetchSessionList } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => listChatSessions(hubId),
    enabled: false,
    initialData: () => queryClient.getQueryData<ChatSessionSummary[]>(sessionQueryKey) ?? [],
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const submitQuestionRef = useRef<((event?: React.FormEvent, overrideQuestion?: string) => Promise<void>) | null>(null);
  const previousCompleteSourceIdsRef = useRef<string[]>([]);
  const sessionSourceCacheRef = useRef<Map<string | null, string[]>>(new Map());
  const pendingSessionSourceIdsRef = useRef<string[] | null>(null);
  const hasActivatedNewSessionDraftRef = useRef(false);

  const readSessionSourceCache = (sessionId: string | null): string[] | null => {
    const inMemory = sessionSourceCacheRef.current.get(sessionId);
    if (inMemory) return inMemory;
    if (sessionId === null) return null;
    try {
      const raw = localStorage.getItem(`caddie:session-sources:${sessionId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const completeSources = useMemo(
    () => sources.filter((source) => source.status === "complete"),
    [sources]
  );
  const completeSourceIds = useMemo(
    () => completeSources.map((source) => source.id),
    [completeSources]
  );
  const completeSourceIdsRef = useRef<string[]>([]);
  completeSourceIdsRef.current = completeSourceIds;

  const hasSelectableSources = completeSourceIds.length > 0;
  const normalizedSelectedSourceIds = useMemo(
    () => normalizeSelectedSourceIds(selectedSourceIds, completeSourceIds),
    [selectedSourceIds, completeSourceIds]
  );
  const canAsk = scope === "global" || !hasSelectableSources || normalizedSelectedSourceIds.length > 0;
  const isComposerLocked = isBootstrapping || isLoadingSession;
  const canSuggestPrompt = !isComposerLocked && (!hasSelectableSources || normalizedSelectedSourceIds.length > 0);
  const canEditHub = hubRole === 'owner' || hubRole === 'admin' || hubRole === 'editor';
  const canFlagResponses = !!hubRole;
  const shouldStartFreshFromPrompt = initialSessionParam === "new" && !!initialPromptParam;
  const shouldAutoSendPrompt = shouldStartFreshFromPrompt && initialPromptAction === "send";
  const activeSessionTitle = useMemo(() => {
    if (activeSessionId === null) {
      return "New Chat";
    }
    return sessionList.find((session) => session.id === activeSessionId)?.title ?? "New Chat";
  }, [activeSessionId, sessionList]);
  useEffect(() => {
    hasAutoSent.current = false;
    hasActivatedNewSessionDraftRef.current = false;
  }, [hubId, initialPromptParam, initialPromptAction, initialSessionParam]);

  useEffect(() => {
    const previousIds = previousCompleteSourceIdsRef.current;
    if (
      activeSessionId === null &&
      previousIds.length === 0 &&
      completeSourceIds.length > 0 &&
      messages.length === 0 &&
      selectedSourceIds.length === 0
    ) {
      setSelectedSourceIds(completeSourceIds);
    }
    previousCompleteSourceIdsRef.current = completeSourceIds;
  }, [activeSessionId, completeSourceIds, messages.length, selectedSourceIds.length]);

  useEffect(() => {
    const pending = pendingSessionSourceIdsRef.current;
    if (pending && completeSourceIds.length > 0) {
      pendingSessionSourceIdsRef.current = null;
      setSelectedSourceIds(pending.filter((id) => completeSourceIds.includes(id)));
    }
  }, [completeSourceIds]);

  useEffect(() => {
    setHighlightedMessageId(null);
  }, [activeSessionId]);

  useEffect(() => {
    sessionSourceCacheRef.current.set(activeSessionId, selectedSourceIds);
    if (activeSessionId !== null) {
      try {
        localStorage.setItem(`caddie:session-sources:${activeSessionId}`, JSON.stringify(selectedSourceIds));
      } catch {}
    }
  }, [activeSessionId, selectedSourceIds]);

  useEffect(() => {
    onSourceSelectionChange?.(selectedSourceIds);
  }, [selectedSourceIds, onSourceSelectionChange]);

  useEffect(() => {
    setFeedbackByMessageId((current) => {
      const next = { ...current };
      for (const message of messages) {
        const messageId = message.response?.message_id;
        const feedbackRating = message.response?.feedback_rating;
        if (messageId && feedbackRating) {
          next[messageId] = feedbackRating;
        }
      }
      return next;
    });
  }, [messages]);

  useEffect(() => {
    if (activeSessionId !== null) {
      return;
    }
    setDraftState({
      messages,
      scope,
      selectedSourceIds,
    });
  }, [activeSessionId, messages, scope, selectedSourceIds]);

  useEffect(() => {
    if (!activeCitation) return;
    modalCloseRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveCitation(null);
        setCitationFeedbackStatus(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeCitation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const targetMessageId = searchParams.get("message") ?? initialMessageParam;
    if (!targetMessageId || messages.length === 0) {
      return;
    }
    const hasTarget = messages.some((message) =>
      message.userMessageId === targetMessageId || message.response?.message_id === targetMessageId
    );
    if (!hasTarget) {
      return;
    }
    setHighlightedMessageId(targetMessageId);
    const element = messageElementRefs.current.get(targetMessageId);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === targetMessageId ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeout);
  }, [initialMessageParam, messages, searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function initializeChat() {
      setIsBootstrapping(true);
      setPanelError(null);
      try {
        const { data: sessions = [] } = await refetchSessionList();
        if (cancelled) {
          return;
        }

        if (initialSessionParam === "new") {
          sessionSourceCacheRef.current.delete(null);
          activateDraft({ messages: [], scope: "hub", selectedSourceIds: [...completeSourceIdsRef.current] }, false);
          return;
        }

        const cachedSessionId = localStorage.getItem(`caddie:last-session:${hubId}`);
        const preferredSessionId = initialSessionParam ?? cachedSessionId;

        if (preferredSessionId && sessions.some((s) => s.id === preferredSessionId)) {
          try {
            const detail = await getChatSessionMessages(preferredSessionId, hubId);
            if (cancelled) {
              return;
            }
            hydrateSession(detail.session, detail.messages);
            updateSessionCache((current) => upsertSessionSummary(current, detail.session));
            syncSessionQuery(detail.session.id, { preserveMessage: true });
            return;
          } catch {
            syncSessionQuery(null);
          }
        }

        if (sessions.length > 0) {
          await openSession(sessions[0].id, sessions[0], true, cancelled);
          return;
        }

        activateDraft(buildDraftState(draftState, completeSourceIdsRef.current), false);
      } catch (error) {
        if (!cancelled) {
          setPanelError(error instanceof Error ? error.message : String(error));
          activateDraft(buildDraftState(draftState, completeSourceIdsRef.current), false);
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    initializeChat();
    return () => {
      cancelled = true;
    };
  }, [hubId, refetchSessionList]);

  const getSourceName = (sourceId: string): string => {
    const source = sources.find((item) => item.id === sourceId);
    return source?.original_name ?? sourceId.slice(0, 8);
  };

  function assignMessageRef(messageId: string | null, element: HTMLDivElement | null) {
    if (!messageId) {
      return;
    }
    if (element) {
      messageElementRefs.current.set(messageId, element);
    } else {
      messageElementRefs.current.delete(messageId);
    }
  }

  function syncSessionQuery(sessionId: string | null, options?: { preserveMessage?: boolean }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("prompt");
    params.delete("promptAction");
    if (options?.preserveMessage && initialMessageParam) {
      params.set("message", initialMessageParam);
    } else {
      params.delete("message");
    }
    if (sessionId) {
      params.set("session", sessionId);
    } else {
      params.delete("session");
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function updateSessionCache(
    updater: (current: ChatSessionSummary[]) => ChatSessionSummary[]
  ) {
    queryClient.setQueryData<ChatSessionSummary[]>(sessionQueryKey, (current) =>
      updater(current ?? [])
    );
  }

  function hydrateSession(session: ChatSessionSummary, sessionMessages: SessionMessage[]) {
    const cached = readSessionSourceCache(session.id);
    const rawIds = cached ?? session.source_ids;
    const activeSelection = rawIds.filter((id) => completeSourceIds.includes(id));
    if (completeSourceIds.length === 0 && rawIds.length > 0) {
      pendingSessionSourceIdsRef.current = rawIds;
    } else {
      pendingSessionSourceIdsRef.current = null;
    }
    const nextControls = {
      scope: session.scope,
      selectedSourceIds: activeSelection,
    };
    setActiveSessionId(session.id);
    localStorage.setItem(`caddie:last-session:${hubId}`, session.id);
    setMessages(convertSessionMessagesToPairs(sessionMessages));
    setScope(nextControls.scope);
    setSelectedSourceIds(nextControls.selectedSourceIds);
    setPanelError(null);
  }

  async function openSession(
    sessionId: string,
    summary?: ChatSessionSummary,
    updateUrl = true,
    cancelled = false,
    fallbackToAnotherSession = true
  ) {
    setIsLoadingSession(true);
    setPanelError(null);
    try {
      const detail = await getChatSessionMessages(sessionId, hubId);
      if (cancelled) {
        return;
      }
      hydrateSession(detail.session, detail.messages);
      updateSessionCache((current) => upsertSessionSummary(current, summary ?? detail.session));
      if (updateUrl) {
        syncSessionQuery(detail.session.id);
      }
    } catch (error) {
      if (cancelled) {
        return;
      }
      updateSessionCache((current) => current.filter((session) => session.id !== sessionId));
      try {
        if (localStorage.getItem(`caddie:last-session:${hubId}`) === sessionId) {
          localStorage.removeItem(`caddie:last-session:${hubId}`);
        }
      } catch {}
      const fallbackSession = fallbackToAnotherSession
        ? sessionList.find((session) => session.id !== sessionId) ?? null
        : null;
      if (fallbackSession) {
        await openSession(fallbackSession.id, fallbackSession, true);
      } else {
        activateDraft(buildDraftState(draftState, completeSourceIds), true);
      }
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!cancelled) {
        setIsLoadingSession(false);
      }
    }
  }

  function activateDraft(nextDraft: DraftState, clearQuery: boolean) {
    const cached = sessionSourceCacheRef.current.get(null);
    const currentCompleteIds = completeSourceIdsRef.current;
    setDraftState(nextDraft);
    setActiveSessionId(null);
    setMessages(nextDraft.messages);
    setScope(nextDraft.scope);
    setSelectedSourceIds(
      cached && cached.length > 0
        ? cached.filter((id) => currentCompleteIds.includes(id))
        : nextDraft.selectedSourceIds
    );
    setPanelError(null);
    if (clearQuery) {
      syncSessionQuery(null);
    }
  }

  const currentSessionParam = searchParams.get("session");
  useEffect(() => {
    if (isBootstrapping) return;
    if (
      currentSessionParam === "new"
      && activeSessionId === null
      && !hasActivatedNewSessionDraftRef.current
    ) {
      hasActivatedNewSessionDraftRef.current = true;
      sessionSourceCacheRef.current.delete(null);
      activateDraft({ messages: [], scope, selectedSourceIds: [...completeSourceIds] }, false);
      return;
    }
    if (currentSessionParam && currentSessionParam !== activeSessionId) {
      void openSession(currentSessionParam, undefined, false, false, false);
    }
  }, [currentSessionParam, activeSessionId, isBootstrapping, completeSourceIds, scope]);

  useEffect(() => {
    if (
      isBootstrapping ||
      activeSessionId === null ||
      currentSessionParam === "new" ||
      sessionList.some((session) => session.id === activeSessionId)
    ) {
      return;
    }
    activateDraft(buildDraftState(draftState, completeSourceIds), true);
  }, [activeSessionId, completeSourceIds, currentSessionParam, draftState, isBootstrapping, sessionList]);

  function handleScopeChange(nextScope: ChatScope) {
    setScope(nextScope);
  }

  function logSourceSelectionChange(nextSelectedSourceIds: string[]) {
    void Promise.resolve(
      createChatEvent({
        hub_id: hubId,
        session_id: activeSessionId,
        event_type: "source_filter_changed",
        metadata: {
          selected_source_ids: nextSelectedSourceIds,
          scope,
        },
      })
    ).catch(() => {});
  }

  function handleToggleSource(sourceId: string) {
    if (!completeSourceIds.includes(sourceId)) {
      return;
    }
    setSelectedSourceIds((current) => {
      const next = current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId];
      logSourceSelectionChange(next);
      return next;
    });
  }

  function handleSelectAllSources(scope?: string[]) {
    if (scope) {
      setSelectedSourceIds((prev) => {
        const set = new Set(prev);
        for (const id of scope) set.add(id);
        const next = [...set];
        logSourceSelectionChange(next);
        return next;
      });
    } else {
      const next = [...completeSourceIds];
      logSourceSelectionChange(next);
      setSelectedSourceIds(next);
    }
  }

  function handleClearSourceSelection(scope?: string[]) {
    if (scope) {
      const remove = new Set(scope);
      setSelectedSourceIds((prev) => {
        const next = prev.filter((id) => !remove.has(id));
        logSourceSelectionChange(next);
        return next;
      });
    } else {
      logSourceSelectionChange([]);
      setSelectedSourceIds([]);
    }
  }

  async function handleMessageFeedback(messageId: string, rating: ChatFeedbackRating) {
    if (feedbackSubmittingId) {
      return;
    }
    setFeedbackSubmittingId(messageId);
    try {
      const response = await submitChatFeedback(messageId, { rating });
      setFeedbackByMessageId((current) => ({
        ...current,
        [messageId]: response.rating,
      }));
      setMessages((current) =>
        current.map((message) =>
          message.response?.message_id === messageId && message.response
            ? {
                ...message,
                response: {
                  ...message.response,
                  feedback_rating: response.rating,
                },
              }
            : message
        )
      );
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setFeedbackSubmittingId(null);
    }
  }

  async function handleCopyAnswer(messageId: string, sessionId: string | null, answer: string) {
    await navigator.clipboard.writeText(answer);
    void Promise.resolve(
      createChatEvent({
        hub_id: hubId,
        session_id: sessionId,
        message_id: messageId,
        event_type: "answer_copied",
        metadata: { answer_length: answer.length },
      })
    ).catch(() => {});
  }

  function openCitation(messageId: string, citation: Citation) {
    setCitationFeedbackStatus(null);
    setActiveCitation({ citation, messageId });
    void submitCitationFeedback(messageId, {
      source_id: citation.source_id,
      chunk_index: citation.chunk_index,
      event_type: "opened",
    }).catch(() => {});
  }

  async function handleFlagCitation() {
    if (!activeCitation || citationFeedbackPending) {
      return;
    }
    setCitationFeedbackPending(true);
    setCitationFeedbackStatus(null);
    try {
      await submitCitationFeedback(activeCitation.messageId, {
        source_id: activeCitation.citation.source_id,
        chunk_index: activeCitation.citation.chunk_index,
        event_type: "flagged_incorrect",
      });
      setCitationFeedbackStatus("Citation flagged");
    } catch (error) {
      setCitationFeedbackStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setCitationFeedbackPending(false);
    }
  }

  useImperativeHandle(ref, () => ({
    toggleSource: handleToggleSource,
    selectAllSources: handleSelectAllSources,
    clearSourceSelection: handleClearSourceSelection,
  }), [completeSourceIds]);

  function handleTextareaChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuestion(event.target.value);
    setPromptSuggestionError(null);
    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  async function handleSuggestPrompt() {
    if (isSuggestingPrompt || !canSuggestPrompt) {
      return;
    }
    setIsSuggestingPrompt(true);
    setPromptSuggestionError(null);
    try {
      const response = await getChatPromptSuggestion(hubId, normalizedSelectedSourceIds);
      setQuestion(response.prompt);
      textareaRef.current?.focus();
    } catch (error) {
      setPromptSuggestionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSuggestingPrompt(false);
    }
  }

  async function submitQuestion(event?: React.FormEvent, overrideQuestion?: string) {
    event?.preventDefault();
    const trimmed = (overrideQuestion ?? question).trim();
    if (!trimmed || isSending || isComposerLocked || !canAsk) {
      return;
    }

    const currentSessionId = activeSessionId;
    const requestScope = scope;
    const requestSourceIds = normalizeSelectedSourceIds(selectedSourceIds, completeSourceIds);
    const previousSessions = queryClient.getQueryData<ChatSessionSummary[]>(sessionQueryKey) ?? [];
    const requestBody = {
      hub_id: hubId,
      scope: requestScope,
      question: trimmed,
      source_ids: hasSelectableSources ? requestSourceIds : undefined,
      session_id: currentSessionId,
    };

    const pendingId = `pending-${Date.now()}`;
    const pendingPair: MessagePair = {
      id: pendingId,
      userMessageId: null,
      question: trimmed,
      response: null,
      error: null,
      isLoading: true,
      timestamp: new Date().toISOString(),
    };

    setMessages((current) => [...current, pendingPair]);
    setQuestion("");
    setIsSending(true);
    setPanelError(null);

    if (currentSessionId) {
      const now = pendingPair.timestamp;
      updateSessionCache((current) =>
        moveSessionToTop(
          current.map((session) =>
            session.id === currentSessionId
              ? { ...session, scope: requestScope, source_ids: [...requestSourceIds], last_message_at: now ?? session.last_message_at }
              : session
          ),
          currentSessionId,
        )
      );
    }

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const response = await askQuestion(requestBody);
      const updatedPair: MessagePair = {
        ...pendingPair,
        response,
        isLoading: false,
      };

      setMessages((current) =>
        current.map((pair) => (pair.id === pendingId ? updatedPair : pair))
      );

      const normalizedPersistedSourceIds = [...requestSourceIds];
      const now = new Date().toISOString();
      const existingSession = currentSessionId
        ? sessionList.find((session) => session.id === currentSessionId) ?? null
        : null;
      const nextSummary: ChatSessionSummary = {
        id: response.session_id,
        hub_id: hubId,
        title: existingSession?.title ?? response.session_title,
        scope: requestScope,
        source_ids: normalizedPersistedSourceIds,
        created_at: existingSession?.created_at ?? now,
        last_message_at: now,
      };

      updateSessionCache((current) => moveSessionToTop(upsertSessionSummary(current, nextSummary), nextSummary.id));
      setActiveSessionId(response.session_id);
      setScope(requestScope);
      setSelectedSourceIds(normalizedPersistedSourceIds);
      syncSessionQuery(response.session_id);

      if (currentSessionId === null) {
        setDraftState(null);
      }
    } catch (error) {
      queryClient.setQueryData(sessionQueryKey, previousSessions);
      const message = error instanceof Error ? error.message : String(error);
      setMessages((current) =>
        current.map((pair) =>
          pair.id === pendingId
            ? { ...pair, error: message, isLoading: false }
            : pair
        )
      );
    } finally {
      setIsSending(false);
    }
  }
  submitQuestionRef.current = submitQuestion;

  useEffect(() => {
    if (hasAutoSent.current || isBootstrapping || sourcesLoading || !initialPromptParam) return;
    if (shouldAutoSendPrompt && (!canAsk || activeSessionId !== null || messages.length > 0)) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("prompt");
    params.delete("promptAction");
    if (params.get("session") === "new") {
      params.delete("session");
    }
    const query = params.toString();

    hasAutoSent.current = true;
    if (shouldAutoSendPrompt) {
      setQuestion(initialPromptParam);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      void submitQuestionRef.current?.(undefined, initialPromptParam);
      return;
    }

    setQuestion(initialPromptParam);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    activeSessionId,
    canAsk,
    initialPromptParam,
    isBootstrapping,
    messages.length,
    pathname,
    router,
    searchParams,
    shouldAutoSendPrompt,
    sourcesLoading,
  ]);

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion();
    }
  }


  async function handleFlagResponse(messageId: string, reason: FlagReason) {
    if (!canFlagResponses || flaggingMessageId) {
      return;
    }
    setReportMenuMessageId(null);
    setFlaggingMessageId(messageId);
    try {
      const result = await flagMessage(messageId, { reason });
      setMessages((current) =>
        current.map((pair) => {
          if (!pair.response || pair.response.message_id !== messageId) {
            return pair;
          }
          return {
            ...pair,
            response: {
              ...pair.response,
              active_flag_id: result.flag_case.id,
              flag_status: result.flag_case.status,
            },
          };
        })
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["flagged-chats", hubId] }),
        queryClient.invalidateQueries({ queryKey: ["flagged-chat", hubId, result.flag_case.id] }),
      ]);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setFlaggingMessageId(null);
    }
  }

  return (
    <>
      <div className="chat">
        <section className="chat__main">
          <div className="chat__controls">
            <div className="chat__hub-info">
              <p className="chat__hub-name">{activeSessionTitle}</p>
            </div>
            <div className="chat__controls-right">
              <SourceSelector
                sources={sources}
                sourcesLoading={sourcesLoading}
                selectedSourceIds={normalizedSelectedSourceIds}
                onToggleSource={handleToggleSource}
                onSelectAllSources={handleSelectAllSources}
                onClearSourceSelection={handleClearSourceSelection}
              />
              <div className="chat__scope-pills">
                {SCOPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`chat__scope-pill${scope === option.value ? " chat__scope-pill--active" : ""}`}
                    onClick={() => handleScopeChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="chat__messages">
            <div className="chat__lane chat__lane--messages">
              {isComposerLocked && (
                <ChatLoadingSkeleton />
              )}

              {!isComposerLocked && messages.length === 0 && (
                <div className="chat__empty">
                  <p className="chat__empty-text">Ask a question about your hub</p>
                  <p className="muted">Caddie will search your selected sources for answers.</p>
                  <div className="chat__prompt-chips">
                    {CHAT_SUGGESTED_PROMPTS.map(({ label, prompt }) => (
                      <button
                        key={label}
                        type="button"
                        className="chat__prompt-chip"
                        onClick={() => { setQuestion(prompt); textareaRef.current?.focus(); }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!isComposerLocked && messages.map((message) => (
                <div key={message.id} className="chat__pair">
                <div
                  ref={(element) => assignMessageRef(message.userMessageId, element)}
                  className={`chat__message chat__message--user${highlightedMessageId !== null && message.userMessageId === highlightedMessageId ? " chat__message--highlighted" : ""}`}
                >
                  <div className="chat__bubble chat__bubble--user">
                    {message.question}
                  </div>
                  <ProfileAvatar className="chat__avatar chat__avatar--user" profile={user ?? undefined} />
                </div>
                {message.timestamp && (
                  <span className="chat__timestamp chat__timestamp--user">{formatMessageTime(message.timestamp)}</span>
                )}
                <div
                  ref={(element) => assignMessageRef(message.response?.message_id ?? null, element)}
                  className={`chat__message chat__message--ai${highlightedMessageId !== null && message.response?.message_id === highlightedMessageId ? " chat__message--highlighted" : ""}`}
                >
                  <div className="chat__avatar chat__avatar--ai">
                    <span className="chat__avatar-letter">C</span>
                  </div>
                  <div className="chat__bubble chat__bubble--ai">
                    {message.isLoading && (
                      <div className="chat__typing">
                        <span className="chat__dot" />
                        <span className="chat__dot" />
                        <span className="chat__dot" />
                      </div>
                    )}
                    {message.error && (
                      <p className="chat__error">Error: {message.error}</p>
                    )}
                    {message.response && (
                      <>
                        {(() => {
                          const currentFeedback = feedbackByMessageId[message.response.message_id] ?? message.response.feedback_rating ?? null;
                          return (
                            <>
                        <div className="chat__answer">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.response.answer}
                          </ReactMarkdown>
                        </div>
                        {message.response.citations.length === 0 && (
                          <p className="muted" style={{ marginTop: "8px", fontSize: "0.8rem" }}>
                            No sources matched. Try rephrasing or select different sources.
                          </p>
                        )}
                        {message.response.citations.length > 0 && (
                          <div className="chat__sources-block">
                            <span className="chat__sources-label">Sources</span>
                            <div className="chat__citations">
                              {message.response.citations.map((citation, index) => (
                                <button
                                  key={`${citation.source_id}-${citation.chunk_index ?? index}`}
                                  className="chat__citation-chip"
                                  type="button"
                                  onClick={() => openCitation(message.response!.message_id, citation)}
                                >
                                  {getSourceName(citation.source_id)}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="chat__actions">
                          <button
                            type="button"
                            className="chat__action-btn"
                            onClick={() =>
                              void handleCopyAnswer(
                                message.response!.message_id,
                                message.response!.session_id || activeSessionId,
                                message.response!.answer,
                              )
                            }
                            aria-label="Copy result"
                          >
                            <ClipboardDocumentIcon className="chat__action-icon" />
                            <span className="chat__action-label">Copy</span>
                          </button>
                          {canEditHub && (
                            <button
                              type="button"
                              className={`chat__action-btn${savedFaqIds.has(message.id) ? ' chat__action-btn--saved' : ''}`}
                              disabled={savedFaqIds.has(message.id) || savingFaqId === message.id}
                              onClick={() => {
                                setSavingFaqId(message.id);
                                createFaq({ hub_id: hubId, question: message.question, answer: message.response!.answer })
                                  .then(() => {
                                    setSavedFaqIds((prev) => new Set(prev).add(message.id));
                                    queryClient.invalidateQueries({ queryKey: ['faqs', hubId] });
                                  })
                                  .catch(() => setPanelError('Failed to save FAQ'))
                                  .finally(() => setSavingFaqId(null));
                              }}
                              aria-label="Save as FAQ"
                            >
                              <BookmarkIcon className="chat__action-icon" />
                              <span className="chat__action-label">{savedFaqIds.has(message.id) ? 'Saved' : savingFaqId === message.id ? 'Saving...' : 'Save as FAQ'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`chat__action-btn${currentFeedback === "helpful" ? " chat__action-btn--active" : ""}`}
                            onClick={() => void handleMessageFeedback(message.response!.message_id, "helpful")}
                            aria-label="Mark answer helpful"
                            disabled={feedbackSubmittingId === message.response.message_id}
                          >
                            <HandThumbUpIcon className="chat__action-icon" />
                            <span className="chat__action-label">{currentFeedback === "helpful" ? "Helpful" : "Mark helpful"}</span>
                          </button>
                          <button
                            type="button"
                            className={`chat__action-btn${currentFeedback === "not_helpful" ? " chat__action-btn--active" : ""}`}
                            onClick={() => void handleMessageFeedback(message.response!.message_id, "not_helpful")}
                            aria-label="Mark answer not helpful"
                            disabled={feedbackSubmittingId === message.response.message_id}
                          >
                            <HandThumbDownIcon className="chat__action-icon" />
                            <span className="chat__action-label">{currentFeedback === "not_helpful" ? "Not helpful" : "Mark not helpful"}</span>
                          </button>
                          {canFlagResponses && (
                            <>
                              {(message.response.flag_status === "resolved" || message.response.flag_status === "dismissed") && (
                                <span className="chat__response-status">
                                  {message.response.flag_status === "resolved" ? "Moderated" : "Dismissed"}
                                </span>
                              )}
                              {reportMenuMessageId === message.response.message_id ? (
                                <div className="chat__report-reasons">
                                  {FLAG_REASON_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className="chat__report-reason"
                                      onClick={() => void handleFlagResponse(message.response!.message_id, option.value)}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    className="chat__action-btn"
                                    onClick={() => setReportMenuMessageId(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={`chat__action-btn chat__report-btn${
                                    message.response.flag_status === "open" || message.response.flag_status === "in_review"
                                      ? " chat__report-btn--active"
                                      : ""
                                  }`}
                                  onClick={() => setReportMenuMessageId(message.response!.message_id)}
                                  disabled={
                                    flaggingMessageId === message.response.message_id ||
                                    message.response.flag_status === "open" ||
                                    message.response.flag_status === "in_review"
                                  }
                                >
                                  <FlagIcon className="chat__action-icon" />
                                  <span className="chat__action-label">
                                    {message.response.flag_status === "open"
                                      ? "Flagged"
                                      : message.response.flag_status === "in_review"
                                        ? "In review"
                                        : flaggingMessageId === message.response.message_id
                                          ? "Reporting..."
                                          : "Report"}
                                  </span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                            </>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>
                {!message.isLoading && message.timestamp && (
                  <span className="chat__timestamp chat__timestamp--ai">
                    {formatMessageTime(message.timestamp)}
                  </span>
                )}
                </div>
              ))}
              {panelError && (
                <p className="chat__banner-error">Error: {panelError}</p>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <form onSubmit={(event) => void submitQuestion(event)} className="chat__input-bar">
            <div className="chat__lane chat__lane--composer">
              {!canAsk && (
                <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                  Select at least one source above to send in this chat.
                </p>
              )}
              <div className="chat__input-row" onClick={() => textareaRef.current?.focus()}>
                {!isComposerLocked && (
                  <button
                    type="button"
                    className="chat__prompt-suggest-btn"
                    onClick={() => void handleSuggestPrompt()}
                    disabled={isSuggestingPrompt || !canSuggestPrompt}
                    title={!canSuggestPrompt && hasSelectableSources ? "Select at least one source to get a tailored prompt." : undefined}
                    aria-label={isSuggestingPrompt ? "Getting tailored prompt suggestion" : "Suggest a tailored prompt"}
                  >
                    <SparklesIcon className="chat__prompt-suggest-icon" />
                  </button>
                )}
                <textarea
                  ref={textareaRef}
                  className="chat__textarea"
                  value={question}
                  onChange={handleTextareaChange}
                  onKeyDown={handleComposerKeyDown}
                  disabled={isComposerLocked}
                  placeholder="Ask a question..."
                  aria-label="Ask a question"
                  rows={1}
                />
                <button
                  className="chat__send"
                  type="submit"
                  disabled={isSending || isComposerLocked || !canAsk || !question.trim()}
                  aria-label="Send message"
                >
                  <PaperAirplaneIcon className="chat__send-icon" />
                </button>
              </div>
              {promptSuggestionError && (
                <p className="chat__prompt-suggest-error">Error: {promptSuggestionError}</p>
              )}
              <p className="chat__disclaimer">
                Caddie can make mistakes. Check important info.
              </p>
            </div>
          </form>
        </section>
      </div>

      {activeCitation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Source: ${getSourceName(activeCitation.citation.source_id)}`}
          onClick={() => {
            setActiveCitation(null);
            setCitationFeedbackStatus(null);
          }}
          className="chat__modal-overlay"
        >
          <div
            className="card chat__modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat__modal-header">
              <strong>{getSourceName(activeCitation.citation.source_id)}</strong>
              <button
                ref={modalCloseRef}
                className="button"
                type="button"
                onClick={() => {
                  setActiveCitation(null);
                  setCitationFeedbackStatus(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="chat__modal-body">
              <SourceExcerpt
                snippet={activeCitation.citation.snippet}
                relevantQuotes={activeCitation.citation.relevant_quotes}
                paraphrasedQuotes={activeCitation.citation.paraphrased_quotes}
              />
              <div className="chat__modal-actions">
                <button
                  type="button"
                  className="chat__action-btn"
                  onClick={() => void handleFlagCitation()}
                  disabled={citationFeedbackPending}
                >
                  <FlagIcon className="chat__action-icon" />
                  <span>{citationFeedbackPending ? "Flagging..." : "Flag citation"}</span>
                </button>
                {citationFeedbackStatus && <p className="muted chat__modal-status">{citationFeedbackStatus}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

function convertSessionMessagesToPairs(messages: SessionMessage[]): MessagePair[] {
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
      answer: message.content,
      citations: message.citations,
      message_id: message.id,
      session_id: "",
      session_title: "",
      active_flag_id: message.active_flag_id,
      flag_status: message.flag_status,
      feedback_rating: message.feedback_rating,
    };
  }
  return pairs;
}

function buildDraftState(currentDraft: DraftState | null, completeSourceIds: string[]): DraftState {
  if (currentDraft) {
    return currentDraft;
  }
  return {
    messages: [],
    scope: "hub",
    selectedSourceIds: [...completeSourceIds],
  };
}

function normalizeSelectedSourceIds(selectedSourceIds: string[], completeSourceIds: string[]): string[] {
  const selectedSet = new Set(selectedSourceIds);
  return completeSourceIds.filter((sourceId) => selectedSet.has(sourceId));
}

function upsertSessionSummary(
  sessions: ChatSessionSummary[],
  nextSession: ChatSessionSummary
): ChatSessionSummary[] {
  const index = sessions.findIndex((session) => session.id === nextSession.id);
  if (index === -1) {
    return [...sessions, nextSession];
  }
  const nextSessions = [...sessions];
  nextSessions[index] = nextSession;
  return nextSessions;
}

function moveSessionToTop(sessions: ChatSessionSummary[], sessionId: string): ChatSessionSummary[] {
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) {
    return sessions;
  }
  return [target, ...sessions.filter((session) => session.id !== sessionId)];
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const day = date.toLocaleDateString("en-IE", { day: "2-digit", month: "short" });
  return `${day} ${time}`;
}
