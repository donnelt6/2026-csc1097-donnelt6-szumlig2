'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon, FlagIcon, PaperAirplaneIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  askQuestion,
  deleteChatSession,
  flagMessage,
  getChatSessionMessages,
  listChatSessions,
} from "../lib/api";
import type { ChatResponse, Citation, ChatSessionSummary, MembershipRole, SessionMessage, Source } from "../lib/types";
import { SourceSelector } from "./SourceSelector";

const SCOPE_OPTIONS = [
  { value: "hub" as const, label: "Hub only" },
  { value: "global" as const, label: "Hub + global" },
];

type ChatScope = "hub" | "global";

interface MessagePair {
  id: string;
  question: string;
  response: ChatResponse | null;
  error: string | null;
  isLoading: boolean;
}

interface ChatControlState {
  scope: ChatScope;
  selectedSourceIds: string[];
}

interface DraftState extends ChatControlState {
  messages: MessagePair[];
}

interface Props {
  hubId: string;
  hubDescription?: string;
  hubRole?: MembershipRole | null;
  sources: Source[];
  sourcesLoading?: boolean;
}

export function ChatPanel({ hubId, hubDescription, hubRole, sources, sourcesLoading }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSessionParam = searchParams.get("session");
  const initialPromptParam = searchParams.get("prompt");
  const hasAutoSent = useRef(false);

  const [question, setQuestion] = useState("");
  const [sessionList, setSessionList] = useState<ChatSessionSummary[]>([]);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [persistedSessionControls, setPersistedSessionControls] = useState<ChatControlState | null>(null);
  const [messages, setMessages] = useState<MessagePair[]>([]);
  const [scope, setScope] = useState<ChatScope>("hub");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [flaggingMessageId, setFlaggingMessageId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const scopeRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const previousCompleteSourceIdsRef = useRef<string[]>([]);

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
  const hasUnsavedSessionControlChanges = useMemo(() => {
    if (activeSessionId === null || persistedSessionControls === null) {
      return false;
    }
    return (
      scope !== persistedSessionControls.scope ||
      !arraysEqual(selectedSourceIds, persistedSessionControls.selectedSourceIds)
    );
  }, [activeSessionId, persistedSessionControls, scope, selectedSourceIds]);

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
    if (!scopeOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (scopeRef.current && !scopeRef.current.contains(event.target as Node)) {
        setScopeOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScopeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [scopeOpen]);

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
        const sessions = await listChatSessions(hubId);
        if (cancelled) {
          return;
        }
        setSessionList(sessions);

        if (initialSessionParam) {
          try {
            const detail = await getChatSessionMessages(initialSessionParam, hubId);
            if (cancelled) {
              return;
            }
            hydrateSession(detail.session, detail.messages);
            setSessionList((current) => upsertSessionSummary(current, detail.session));
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
  }, [hubId]);

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

  function hydrateSession(session: ChatSessionSummary, sessionMessages: SessionMessage[]) {
    const nextControls = {
      scope: session.scope,
      selectedSourceIds: [...session.source_ids],
    };
    setActiveSessionId(session.id);
    setPersistedSessionControls(nextControls);
    setMessages(convertSessionMessagesToPairs(sessionMessages));
    setScope(nextControls.scope);
    setSelectedSourceIds(nextControls.selectedSourceIds);
    setPanelError(null);
  }

  async function openSession(
    sessionId: string,
    summary?: ChatSessionSummary,
    updateUrl = true,
    cancelled = false
  ) {
    setIsLoadingSession(true);
    setPanelError(null);
    try {
      const detail = await getChatSessionMessages(sessionId, hubId);
      if (cancelled) {
        return;
      }
      hydrateSession(detail.session, detail.messages);
      setSessionList((current) => upsertSessionSummary(current, summary ?? detail.session));
      if (updateUrl) {
        syncSessionQuery(detail.session.id);
      }
    } catch (error) {
      if (cancelled) {
        return;
      }
      const fallbackSession = sessionList.find((session) => session.id !== sessionId) ?? null;
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
    setDraftState(nextDraft);
    setActiveSessionId(null);
    setPersistedSessionControls(null);
    setMessages(nextDraft.messages);
    setScope(nextDraft.scope);
    setSelectedSourceIds(nextDraft.selectedSourceIds);
    setPanelError(null);
    if (clearQuery) {
      syncSessionQuery(null);
    }
  }

  function handleNewChat() {
    activateDraft(buildDraftState(draftState, completeSourceIds), true);
  }

  function handleScopeChange(nextScope: ChatScope) {
    setScope(nextScope);
    setScopeOpen(false);
  }

  function handleToggleSource(sourceId: string) {
    if (!completeSourceIds.includes(sourceId)) {
      return;
    }
    setSelectedSourceIds((current) => {
      if (current.includes(sourceId)) {
        return current.filter((id) => id !== sourceId);
      }
      const next = current.filter((id) => id !== sourceId);
      next.push(sourceId);
      return next;
    });
  }

  function handleSelectAllSources() {
    setSelectedSourceIds([...completeSourceIds]);
  }

  function handleClearSourceSelection() {
    setSelectedSourceIds([]);
  }

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
    };

    setMessages((current) => [...current, pendingPair]);
    setQuestion("");
    setIsSending(true);
    setPanelError(null);

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

      setSessionList((current) => moveSessionToTop(upsertSessionSummary(current, nextSummary), nextSummary.id));
      setActiveSessionId(response.session_id);
      setPersistedSessionControls({
        scope: requestScope,
        selectedSourceIds: normalizedPersistedSourceIds,
      });
      setScope(requestScope);
      setSelectedSourceIds(normalizedPersistedSourceIds);
      syncSessionQuery(response.session_id);

      if (currentSessionId === null) {
        setDraftState(null);
      }
    } catch (error) {
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

  async function handleDeleteSession(sessionId: string) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this chat? Messages stay in the database but the chat will disappear.");
      if (!confirmed) {
        return;
      }
    }

    setDeletingSessionId(sessionId);
    setPanelError(null);
    try {
      await deleteChatSession(sessionId);
      setSessionList((current) => current.filter((session) => session.id !== sessionId));
      if (activeSessionId === sessionId) {
        activateDraft(buildDraftState(draftState, completeSourceIds), true);
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleFlagResponse(messageId: string) {
    if (!canFlagResponses || flaggingMessageId) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Flag this response for owner/admin review?");
      if (!confirmed) {
        return;
      }
    }
    setFlaggingMessageId(messageId);
    try {
      const result = await flagMessage(messageId, { reason: "incorrect" });
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
        <aside className="chat__sidebar">
          <button type="button" className="chat__new-button" onClick={handleNewChat}>
            <PlusIcon className="chat__new-icon" />
            <span>New Chat</span>
          </button>

          <div className="chat__sidebar-list">
            {sessionList.length === 0 ? (
              <p className="chat__sidebar-empty">No saved chats yet.</p>
            ) : (
              sessionList.map((session) => (
                <div
                  key={session.id}
                  className={`chat__session-item${activeSessionId === session.id ? " chat__session-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="chat__session-button"
                    onClick={() => void openSession(session.id, session)}
                  >
                    <span className="chat__session-title">{session.title}</span>
                    <span className="chat__session-time">{formatSessionTimestamp(session.last_message_at)}</span>
                  </button>
                  <button
                    type="button"
                    className="chat__session-delete"
                    aria-label={`Delete ${session.title}`}
                    onClick={() => void handleDeleteSession(session.id)}
                    disabled={deletingSessionId === session.id}
                  >
                    <TrashIcon className="chat__session-delete-icon" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="chat__main">
          <div className="chat__controls">
            <div className="chat__hub-info">
              <p className="chat__hub-name">{activeSessionTitle}</p>
              {activeSessionId && (
                <p className="chat__hub-desc">
                  {hasUnsavedSessionControlChanges
                    ? "Unsaved scope and source changes apply on the next successful send."
                    : hubDescription ?? "Resume this chat in the current hub."}
                </p>
              )}
            </div>
            <div className="chat__controls-divider" aria-hidden="true" />
            <div className="chat__controls-right">
              <SourceSelector
                sources={sources}
                sourcesLoading={sourcesLoading}
                selectedSourceIds={normalizedSelectedSourceIds}
                onToggleSource={handleToggleSource}
                onSelectAllSources={handleSelectAllSources}
                onClearSourceSelection={handleClearSourceSelection}
              />
              <div className="scope-selector" ref={scopeRef} data-open={scopeOpen || undefined}>
                <button
                  type="button"
                  className="scope-selector__toggle"
                  aria-expanded={scopeOpen}
                  aria-haspopup="listbox"
                  onClick={() => setScopeOpen((current) => !current)}
                >
                  <span>{SCOPE_OPTIONS.find((option) => option.value === scope)?.label}</span>
                  <ChevronDownIcon className="scope-selector__chevron" />
                </button>
                {scopeOpen && (
                  <div className="scope-selector__dropdown" role="listbox">
                    {SCOPE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={scope === option.value}
                        className={`scope-selector__option${scope === option.value ? " scope-selector__option--active" : ""}`}
                        onClick={() => handleScopeChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
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
                <p className="muted">Answers use the active chat&apos;s selected sources. Change scope only when you want broader context.</p>
              </div>
            )}

            {!isBootstrapping && !isLoadingSession && messages.map((message) => (
              <div key={message.id} className="chat__pair">
                <div className="chat__message chat__message--user">
                  <div className="chat__bubble chat__bubble--user">
                    {message.question}
                  </div>
                </div>
                <div className="chat__message chat__message--ai">
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
                          <div className="chat__citations">
                            {message.response.citations.map((citation, index) => (
                              <button
                                key={`${citation.source_id}-${citation.chunk_index ?? index}`}
                                className="chat__citation-chip"
                                type="button"
                                onClick={() => setActiveCitation(citation)}
                              >
                                <span className="chat__citation-num">[{index + 1}]</span>
                                <span className="chat__citation-name">{getSourceName(citation.source_id)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {canFlagResponses && (
                          <div className="chat__response-footer">
                            {(message.response.flag_status === "resolved" || message.response.flag_status === "dismissed") && (
                              <span className="chat__response-status muted">
                                {message.response.flag_status === "resolved" ? "Moderated" : "Reviewed and dismissed"}
                              </span>
                            )}
                            <button
                              className={`chat__flag-button${
                                message.response.flag_status === "open" || message.response.flag_status === "in_review"
                                  ? " chat__flag-button--active"
                                  : ""
                              }`}
                              type="button"
                              onClick={() => void handleFlagResponse(message.response!.message_id)}
                              disabled={
                                flaggingMessageId === message.response.message_id ||
                                message.response.flag_status === "open" ||
                                message.response.flag_status === "in_review"
                              }
                              aria-label={
                                message.response.flag_status === "open"
                                  ? "Flagged"
                                  : message.response.flag_status === "in_review"
                                    ? "In review"
                                    : flaggingMessageId === message.response.message_id
                                      ? "Flagging..."
                                      : "Flag response"
                              }
                              title={
                                message.response.flag_status === "open"
                                  ? "Flagged"
                                  : message.response.flag_status === "in_review"
                                    ? "In review"
                                    : flaggingMessageId === message.response.message_id
                                      ? "Flagging..."
                                      : "Flag response"
                              }
                            >
                              <FlagIcon className="chat__flag-button-icon" />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
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
            <div className="chat__input-row">
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
            <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {activeCitation.snippet}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

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

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
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

function formatSessionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("en-IE", {
    day: "2-digit",
    month: "short",
  });
}
