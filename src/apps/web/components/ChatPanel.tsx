'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardDocumentIcon, FlagIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  askQuestion,
  flagMessage,
  getChatSessionMessages,
  listChatSessions,
} from "../lib/api";
import type { ChatResponse, Citation, ChatSessionSummary, FlagReason, MembershipRole, SessionMessage, Source } from "../lib/types";
import { SourceSelector } from "./SourceSelector";
import { useAuth } from "./auth/AuthProvider";

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

type ChatScope = "hub" | "global";

interface MessagePair {
  id: string;
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

export interface ChatPanelHandle {
  toggleSource: (sourceId: string) => void;
  selectAllSources: () => void;
  clearSourceSelection: () => void;
}

interface Props {
  hubId: string;
  hubName?: string;
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

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel({ hubId, hubName, hubRole, sources, sourcesLoading, onSourceSelectionChange }, ref) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSessionParam = searchParams.get("session");
  const initialPromptParam = searchParams.get("prompt");
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
  const [flaggingMessageId, setFlaggingMessageId] = useState<string | null>(null);
  const [reportMenuMessageId, setReportMenuMessageId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const { data: sessionList = [], refetch: refetchSessionList } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => listChatSessions(hubId),
    enabled: false,
    initialData: () => queryClient.getQueryData<ChatSessionSummary[]>(sessionQueryKey) ?? [],
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const previousCompleteSourceIdsRef = useRef<string[]>([]);
  const sessionSourceCacheRef = useRef<Map<string | null, string[]>>(new Map());
  const pendingSessionSourceIdsRef = useRef<string[] | null>(null);

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

  const userInitial = useMemo(() => {
    const name = user?.email ?? user?.user_metadata?.full_name ?? "U";
    return name.trim()[0]?.toUpperCase() ?? "U";
  }, [user]);

  const completeSources = useMemo(
    () => sources.filter((source) => source.status === "complete"),
    [sources]
  );
  const completeSourceIds = useMemo(
    () => completeSources.map((source) => source.id),
    [completeSources]
  );

  const hasSelectableSources = completeSourceIds.length > 0;
  const normalizedSelectedSourceIds = useMemo(
    () => normalizeSelectedSourceIds(selectedSourceIds, completeSourceIds),
    [selectedSourceIds, completeSourceIds]
  );
  const canAsk = scope === "global" || !hasSelectableSources || normalizedSelectedSourceIds.length > 0;
  const canFlagResponses = !!hubRole;
  const activeSessionTitle = useMemo(() => {
    if (activeSessionId === null) {
      return "New Chat";
    }
    return sessionList.find((session) => session.id === activeSessionId)?.title ?? "New Chat";
  }, [activeSessionId, sessionList]);
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
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeCitation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
            syncSessionQuery(detail.session.id);
            return;
          } catch {
            syncSessionQuery(null);
          }
        }

        if (sessions.length > 0) {
          await openSession(sessions[0].id, sessions[0], true, cancelled);
          return;
        }

        activateDraft(buildDraftState(draftState, completeSourceIds), false);
      } catch (error) {
        if (!cancelled) {
          setPanelError(error instanceof Error ? error.message : String(error));
          activateDraft(buildDraftState(draftState, completeSourceIds), false);
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

  useEffect(() => {
    if (hasAutoSent.current || isBootstrapping || sourcesLoading || !initialPromptParam) return;
    hasAutoSent.current = true;
    setQuestion(initialPromptParam);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("prompt");
    params.delete("tab");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [isBootstrapping, sourcesLoading]);

  const getSourceName = (sourceId: string): string => {
    const source = sources.find((item) => item.id === sourceId);
    return source?.original_name ?? sourceId.slice(0, 8);
  };

  function syncSessionQuery(sessionId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
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
    setDraftState(nextDraft);
    setActiveSessionId(null);
    setMessages(nextDraft.messages);
    setScope(nextDraft.scope);
    setSelectedSourceIds(
      cached
        ? cached.filter((id) => completeSourceIds.includes(id))
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
    if (currentSessionParam === "new") {
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

  function handleToggleSource(sourceId: string) {
    if (!completeSourceIds.includes(sourceId)) {
      return;
    }
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    );
  }

  function handleSelectAllSources() {
    setSelectedSourceIds([...completeSourceIds]);
  }

  function handleClearSourceSelection() {
    setSelectedSourceIds([]);
  }

  useImperativeHandle(ref, () => ({
    toggleSource: handleToggleSource,
    selectAllSources: handleSelectAllSources,
    clearSourceSelection: handleClearSourceSelection,
  }), [completeSourceIds]);

  function handleTextareaChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setQuestion(event.target.value);
    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  async function submitQuestion(event?: React.FormEvent, overrideQuestion?: string) {
    event?.preventDefault();
    const trimmed = (overrideQuestion ?? question).trim();
    if (!trimmed || isSending || !canAsk) {
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
            {(isBootstrapping || isLoadingSession) && (
              <div className="chat__empty">
                <p className="chat__empty-text">Loading chat...</p>
              </div>
            )}

            {!isBootstrapping && !isLoadingSession && messages.length === 0 && (
              <div className="chat__empty">
                <p className="chat__empty-text">Ask a question about your hub</p>
                <p className="muted">Caddie will search your selected sources for answers.</p>
                <div className="chat__prompt-chips">
                  {["Summarise the vault", "Key risks", "Give me an overview"].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="chat__prompt-chip"
                      onClick={() => { setQuestion(prompt); textareaRef.current?.focus(); }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isBootstrapping && !isLoadingSession && messages.map((message) => (
              <div key={message.id} className="chat__pair">
                <div className="chat__message chat__message--user">
                  <div className="chat__bubble chat__bubble--user">
                    {message.question}
                  </div>
                  <div className="chat__avatar chat__avatar--user">
                    <span className="chat__avatar-letter">{userInitial}</span>
                  </div>
                </div>
                {message.timestamp && (
                  <span className="chat__timestamp chat__timestamp--user">{formatMessageTime(message.timestamp)}</span>
                )}
                <div className="chat__message chat__message--ai">
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
                                  onClick={() => setActiveCitation(citation)}
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
                            onClick={() => navigator.clipboard.writeText(message.response!.answer)}
                            aria-label="Copy result"
                          >
                            <ClipboardDocumentIcon className="chat__action-icon" />
                            <span>Copy</span>
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
                                  <span>
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

          <form onSubmit={(event) => void submitQuestion(event)} className="chat__input-bar">
            {!canAsk && (
              <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                Select at least one source above to send in this chat.
              </p>
            )}
            <div className="chat__input-row" onClick={() => textareaRef.current?.focus()}>
              <textarea
                ref={textareaRef}
                className="chat__textarea"
                value={question}
                onChange={handleTextareaChange}
                onKeyDown={handleComposerKeyDown}
                placeholder="Ask a question..."
                aria-label="Ask a question"
                rows={1}
              />
              <button
                className="chat__send"
                type="submit"
                disabled={isSending || isBootstrapping || isLoadingSession || !canAsk || !question.trim()}
                aria-label="Send message"
              >
                <PaperAirplaneIcon className="chat__send-icon" />
              </button>
            </div>
          </form>
          <p className="chat__disclaimer">
            Caddie can make mistakes. Check important info.
          </p>
        </section>
      </div>

      {activeCitation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Source: ${getSourceName(activeCitation.source_id)}`}
          onClick={() => setActiveCitation(null)}
          className="chat__modal-overlay"
        >
          <div
            className="card chat__modal-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chat__modal-header">
              <strong>{getSourceName(activeCitation.source_id)}</strong>
              <button
                ref={modalCloseRef}
                className="button"
                type="button"
                onClick={() => setActiveCitation(null)}
              >
                Close
              </button>
            </div>
            <div className="chat__modal-body">
              <SourceExcerpt
                snippet={activeCitation.snippet}
                relevantQuotes={activeCitation.relevant_quotes}
                paraphrasedQuotes={activeCitation.paraphrased_quotes}
              />
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
