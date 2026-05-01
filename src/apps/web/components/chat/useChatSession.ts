'use client';

// useChatSession.ts: Owns chat session lifecycle, persistence sync, and send orchestration.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  askQuestion,
  createChatEvent,
  getChatSessionMessages,
  listChatSessions,
} from "../../lib/api";
import { normaliseChatResponse } from "../../lib/chatResponse";
import type {
  ChatFeedbackRating,
  ChatSessionSummary,
  SessionMessage,
  Source,
} from "@shared/index";
import {
  buildDraftState,
  ChatScope,
  convertSessionMessagesToPairs,
  DraftState,
  MessagePair,
  moveSessionToTop,
  normalizeSelectedSourceIds,
  upsertSessionSummary,
} from "./chatPanelShared";

interface UseChatSessionArgs {
  hubId: string;
  sources: Source[];
  onSourceSelectionChange?: (selectedIds: string[]) => void;
}

export function useChatSession({ hubId, sources, onSourceSelectionChange }: UseChatSessionArgs) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSessionParam = searchParams.get("session");
  const initialMessageParam = searchParams.get("message");
  const sessionQueryKey = ["chat-sessions", hubId] as const;

  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [messages, setMessages] = useState<MessagePair[]>([]);
  const [scope, setScope] = useState<ChatScope>("hub");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, ChatFeedbackRating>>({});

  const { data: sessionList = [], refetch: refetchSessionList } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => listChatSessions(hubId),
    enabled: false,
    initialData: () => queryClient.getQueryData<ChatSessionSummary[]>(sessionQueryKey) ?? [],
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageElementRefs = useRef(new Map<string, HTMLDivElement>());
  const previousCompleteSourceIdsRef = useRef<string[]>([]);
  const sessionSourceCacheRef = useRef<Map<string | null, string[]>>(new Map());
  const pendingSessionSourceIdsRef = useRef<string[] | null>(null);
  const hasActivatedNewSessionDraftRef = useRef(false);
  const activeLoadTokenRef = useRef(0);

  function invalidateActiveLoadToken() {
    // Session navigation must invalidate both in-flight loads and pending sends.
    activeLoadTokenRef.current += 1;
    return activeLoadTokenRef.current;
  }

  function reportStorageFailure(message: string, error: unknown) {
    console.error(message, error);
    setPanelError((current) => current ?? message);
  }

  function readLastSessionId(): string | null {
    try {
      return localStorage.getItem(`caddie:last-session:${hubId}`);
    } catch (error) {
      reportStorageFailure("Chat session preferences could not be read from local storage.", error);
      return null;
    }
  }

  function persistLastSessionId(sessionId: string) {
    try {
      localStorage.setItem(`caddie:last-session:${hubId}`, sessionId);
    } catch (error) {
      reportStorageFailure("Chat session preferences could not be saved to local storage.", error);
    }
  }

  function clearLastSessionId(sessionId: string) {
    try {
      if (localStorage.getItem(`caddie:last-session:${hubId}`) === sessionId) {
        localStorage.removeItem(`caddie:last-session:${hubId}`);
      }
    } catch (error) {
      reportStorageFailure("Chat session preferences could not be updated in local storage.", error);
    }
  }

  const readSessionSourceCache = (sessionId: string | null): string[] | null => {
    const inMemory = sessionSourceCacheRef.current.get(sessionId);
    if (inMemory) return inMemory;
    if (sessionId === null) return null;
    try {
      const raw = localStorage.getItem(`caddie:session-sources:${sessionId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      reportStorageFailure("Chat source filters could not be restored from local storage.", error);
      return null;
    }
  };

  const completeSources = useMemo(
    () => sources.filter((source) => source.status === "complete"),
    [sources],
  );
  const completeSourceIds = useMemo(
    () => completeSources.map((source) => source.id),
    [completeSources],
  );
  const completeSourceIdsRef = useRef<string[]>([]);
  completeSourceIdsRef.current = completeSourceIds;

  const hasSelectableSources = completeSourceIds.length > 0;
  const normalizedSelectedSourceIds = useMemo(
    () => normalizeSelectedSourceIds(selectedSourceIds, completeSourceIds),
    [selectedSourceIds, completeSourceIds],
  );
  const canAsk = scope === "global" || !hasSelectableSources || normalizedSelectedSourceIds.length > 0;
  const isComposerLocked = isBootstrapping || isLoadingSession;
  const activeSessionTitle = useMemo(() => {
    if (activeSessionId === null) {
      return "New Chat";
    }
    return sessionList.find((session) => session.id === activeSessionId)?.title ?? "New Chat";
  }, [activeSessionId, sessionList]);

  useEffect(() => {
    hasActivatedNewSessionDraftRef.current = false;
  }, [hubId, initialSessionParam]);

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
      } catch (error) {
        reportStorageFailure("Chat source filters could not be saved to local storage.", error);
      }
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  useEffect(() => {
    const targetMessageId = searchParams.get("message") ?? initialMessageParam;
    if (!targetMessageId || messages.length === 0) {
      return;
    }
    const hasTarget = messages.some((message) =>
      message.userMessageId === targetMessageId || message.response?.message_id === targetMessageId,
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

  function updateSessionCache(updater: (current: ChatSessionSummary[]) => ChatSessionSummary[]) {
    queryClient.setQueryData<ChatSessionSummary[]>(sessionQueryKey, (current) =>
      updater(current ?? []),
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
    setActiveSessionId(session.id);
    persistLastSessionId(session.id);
    setMessages(convertSessionMessagesToPairs(sessionMessages));
    setScope(session.scope);
    setSelectedSourceIds(activeSelection);
    setPanelError(null);
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
        : nextDraft.selectedSourceIds,
    );
    setPanelError(null);
    if (clearQuery) {
      syncSessionQuery(null);
    }
  }

  async function openSession(
    sessionId: string,
    summary?: ChatSessionSummary,
    updateUrl = true,
    loadToken = activeLoadTokenRef.current,
    fallbackToAnotherSession = true,
  ) {
    const isStale = () => loadToken !== activeLoadTokenRef.current;
    setIsLoadingSession(true);
    setPanelError(null);
    try {
      const detail = await getChatSessionMessages(sessionId, hubId);
      if (isStale()) {
        return;
      }
      hydrateSession(detail.session, detail.messages);
      updateSessionCache((current) => upsertSessionSummary(current, summary ?? detail.session));
      if (updateUrl) {
        syncSessionQuery(detail.session.id);
      }
    } catch (error) {
      if (isStale()) {
        return;
      }
      updateSessionCache((current) => current.filter((session) => session.id !== sessionId));
      clearLastSessionId(sessionId);
      const fallbackSession = fallbackToAnotherSession
        ? sessionList.find((session) => session.id !== sessionId) ?? null
        : null;
      if (fallbackSession) {
        await openSession(fallbackSession.id, fallbackSession, true, loadToken);
      } else {
        activateDraft(buildDraftState(draftState, completeSourceIds), true);
      }
      setPanelError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!isStale()) {
        setIsLoadingSession(false);
      }
    }
  }

  useEffect(() => {
    const loadToken = activeLoadTokenRef.current + 1;
    activeLoadTokenRef.current = loadToken;
    const isStale = () => loadToken !== activeLoadTokenRef.current;

    async function initializeChat() {
      setIsBootstrapping(true);
      setPanelError(null);
      try {
        const { data: sessions = [] } = await refetchSessionList();
        if (isStale()) {
          return;
        }

        if (initialSessionParam === "new") {
          sessionSourceCacheRef.current.delete(null);
          activateDraft({ messages: [], scope: "hub", selectedSourceIds: [...completeSourceIdsRef.current] }, false);
          return;
        }

        const cachedSessionId = readLastSessionId();
        const preferredSessionId = initialSessionParam ?? cachedSessionId;

        if (preferredSessionId && sessions.some((session) => session.id === preferredSessionId)) {
          try {
            const detail = await getChatSessionMessages(preferredSessionId, hubId);
            if (isStale()) {
              return;
            }
            hydrateSession(detail.session, detail.messages);
            updateSessionCache((current) => upsertSessionSummary(current, detail.session));
            syncSessionQuery(detail.session.id, { preserveMessage: true });
            return;
          } catch (error) {
            if (!isStale()) {
              setPanelError(error instanceof Error ? error.message : String(error));
            }
            syncSessionQuery(null);
          }
        }

        if (sessions.length > 0) {
          await openSession(sessions[0].id, sessions[0], true, loadToken);
          return;
        }

        activateDraft(buildDraftState(draftState, completeSourceIdsRef.current), false);
      } catch (error) {
        if (!isStale()) {
          setPanelError(error instanceof Error ? error.message : String(error));
          activateDraft(buildDraftState(draftState, completeSourceIdsRef.current), false);
        }
      } finally {
        if (!isStale()) {
          setIsBootstrapping(false);
        }
      }
    }

    initializeChat();
    return () => {
      if (activeLoadTokenRef.current === loadToken) {
        activeLoadTokenRef.current += 1;
      }
    };
  }, [hubId, refetchSessionList]);

  const currentSessionParam = searchParams.get("session");
  useEffect(() => {
    if (isBootstrapping) return;
    if (currentSessionParam === "new") {
      if (activeSessionId !== null || !hasActivatedNewSessionDraftRef.current) {
        hasActivatedNewSessionDraftRef.current = true;
        invalidateActiveLoadToken();
        sessionSourceCacheRef.current.delete(null);
        activateDraft({ messages: [], scope, selectedSourceIds: [...completeSourceIds] }, false);
      }
      return;
    }
    if (currentSessionParam && currentSessionParam !== activeSessionId) {
      const loadToken = invalidateActiveLoadToken();
      void openSession(currentSessionParam, undefined, false, loadToken, false);
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
      }),
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

  function handleSelectAllSources(selectionScope?: string[]) {
    if (selectionScope) {
      setSelectedSourceIds((prev) => {
        const set = new Set(prev);
        for (const id of selectionScope) set.add(id);
        const next = [...set];
        logSourceSelectionChange(next);
        return next;
      });
      return;
    }
    const next = [...completeSourceIds];
    logSourceSelectionChange(next);
    setSelectedSourceIds(next);
  }

  function handleClearSourceSelection(selectionScope?: string[]) {
    if (selectionScope) {
      const remove = new Set(selectionScope);
      setSelectedSourceIds((prev) => {
        const next = prev.filter((id) => !remove.has(id));
        logSourceSelectionChange(next);
        return next;
      });
      return;
    }
    logSourceSelectionChange([]);
    setSelectedSourceIds([]);
  }

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isSending || isComposerLocked || !canAsk) {
      return false;
    }

    const loadToken = activeLoadTokenRef.current;
    const isStale = () => loadToken !== activeLoadTokenRef.current;
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
    setIsSending(true);
    setPanelError(null);

    if (currentSessionId) {
      const now = pendingPair.timestamp;
      updateSessionCache((current) =>
        moveSessionToTop(
          current.map((session) =>
            session.id === currentSessionId
              ? { ...session, scope: requestScope, source_ids: [...requestSourceIds], last_message_at: now ?? session.last_message_at }
              : session,
          ),
          currentSessionId,
        ),
      );
    }

    try {
      const response = normaliseChatResponse(await askQuestion(requestBody));
      if (isStale()) {
        return false;
      }
      const updatedPair: MessagePair = {
        ...pendingPair,
        response,
        isLoading: false,
      };

      setMessages((current) =>
        current.map((pair) => (pair.id === pendingId ? updatedPair : pair)),
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
      return true;
    } catch (error) {
      if (isStale()) {
        return false;
      }
      queryClient.setQueryData(sessionQueryKey, previousSessions);
      const message = error instanceof Error ? error.message : String(error);
      setMessages((current) =>
        current.map((pair) =>
          pair.id === pendingId
            ? { ...pair, error: message, isLoading: false }
            : pair,
        ),
      );
      return false;
    } finally {
      if (!isStale()) {
        setIsSending(false);
      }
    }
  }

  return {
    activeSessionId,
    activeSessionTitle,
    assignMessageRef,
    canAsk,
    completeSourceIds,
    completeSources,
    feedbackByMessageId,
    highlightedMessageId,
    isBootstrapping,
    isComposerLocked,
    isSending,
    messages,
    messagesEndRef,
    normalizedSelectedSourceIds,
    panelError,
    scope,
    searchParams,
    selectedSourceIds,
    sessionList,
    setFeedbackByMessageId,
    setMessages,
    setPanelError,
    setScope,
    submitQuestion,
    handleClearSourceSelection,
    handleSelectAllSources,
    handleToggleSource,
    hasSelectableSources,
  };
}
