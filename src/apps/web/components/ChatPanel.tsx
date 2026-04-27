'use client';

// ChatPanel.tsx: Chat interface shell that delegates session, composer, and citation workflows to hooks.

import { forwardRef, useImperativeHandle, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ClipboardDocumentIcon,
  FlagIcon,
  HandThumbDownIcon,
  HandThumbUpIcon,
  BookmarkIcon,
  PaperAirplaneIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { createChatEvent, createFaq, flagMessage, submitChatFeedback } from "../lib/api";
import type { ChatFeedbackRating, FlagReason, MembershipRole, Source } from "@shared/index";
import { SourceSelector } from "./SourceSelector";
import { useAuth } from "./auth/AuthProvider";
import { ProfileAvatar } from "./profile/ProfileAvatar";
import {
  CHAT_SUGGESTED_PROMPTS,
  ChatLoadingSkeleton,
  FLAG_REASON_OPTIONS,
  formatMessageTime,
  MarkdownAnswer,
  SCOPE_OPTIONS,
  SourceExcerpt,
} from "./chat/chatPanelShared";
import { useChatComposer } from "./chat/useChatComposer";
import { useChatSession } from "./chat/useChatSession";
import { useCitationFeedback } from "./chat/useCitationFeedback";

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

export const ChatPanel = forwardRef<ChatPanelHandle, Props>(function ChatPanel(
  { hubId, hubRole, sources, sourcesLoading, onSourceSelectionChange },
  ref,
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    activeSessionId,
    activeSessionTitle,
    assignMessageRef,
    canAsk,
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
    setFeedbackByMessageId,
    setMessages,
    setPanelError,
    setScope,
    submitQuestion,
    handleClearSourceSelection,
    handleSelectAllSources,
    handleToggleSource,
    hasSelectableSources,
  } = useChatSession({
    hubId,
    sources,
    onSourceSelectionChange,
  });
  const canSuggestPrompt = !isComposerLocked && (!hasSelectableSources || normalizedSelectedSourceIds.length > 0);
  const {
    handleComposerKeyDown,
    handleSubmit,
    handleSuggestPrompt,
    handleTextareaChange,
    isSuggestingPrompt,
    promptSuggestionError,
    question,
    setQuestion,
    textareaRef,
  } = useChatComposer({
    hubId,
    activeSessionId,
    canAsk,
    canSuggestPrompt,
    completeSourceIds: normalizedSelectedSourceIds,
    isBootstrapping,
    messagesLength: messages.length,
    sourcesLoading,
    submitQuestion,
  });
  const {
    activeCitation,
    citationFeedbackPending,
    citationFeedbackStatus,
    closeCitation,
    handleFlagCitation,
    modalCloseRef,
    openCitation,
  } = useCitationFeedback();

  const [flaggingMessageId, setFlaggingMessageId] = useState<string | null>(null);
  const [reportMenuMessageId, setReportMenuMessageId] = useState<string | null>(null);
  const [savedFaqIds, setSavedFaqIds] = useState<Set<string>>(new Set());
  const [savingFaqId, setSavingFaqId] = useState<string | null>(null);
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState<string | null>(null);

  const canEditHub = hubRole === "owner" || hubRole === "admin" || hubRole === "editor";
  const canFlagResponses = !!hubRole;

  const getSourceName = (sourceId: string): string => {
    const source = sources.find((item) => item.id === sourceId);
    return source?.original_name ?? sourceId.slice(0, 8);
  };

  useImperativeHandle(ref, () => ({
    toggleSource: handleToggleSource,
    selectAllSources: handleSelectAllSources,
    clearSourceSelection: handleClearSourceSelection,
  }), [handleClearSourceSelection, handleSelectAllSources, handleToggleSource]);

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
            : message,
        ),
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
      }),
    ).catch(() => {});
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
        }),
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
                    onClick={() => setScope(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="chat__messages">
            <div className="chat__lane chat__lane--messages">
              {isComposerLocked && <ChatLoadingSkeleton />}

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
                        onClick={() => {
                          setQuestion(prompt);
                          textareaRef.current?.focus();
                        }}
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
                      {message.error && <p className="chat__error">Error: {message.error}</p>}
                      {message.response && (
                        <>
                          {(() => {
                            const currentFeedback = feedbackByMessageId[message.response.message_id] ?? message.response.feedback_rating ?? null;
                            return (
                              <>
                                <MarkdownAnswer answer={message.response.answer} />
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
                                      className={`chat__action-btn${savedFaqIds.has(message.id) ? " chat__action-btn--saved" : ""}`}
                                      disabled={savedFaqIds.has(message.id) || savingFaqId === message.id}
                                      onClick={() => {
                                        setSavingFaqId(message.id);
                                        createFaq({ hub_id: hubId, question: message.question, answer: message.response!.answer })
                                          .then(() => {
                                            setSavedFaqIds((prev) => new Set(prev).add(message.id));
                                            queryClient.invalidateQueries({ queryKey: ["faqs", hubId] });
                                          })
                                          .catch(() => setPanelError("Failed to save FAQ"))
                                          .finally(() => setSavingFaqId(null));
                                      }}
                                      aria-label="Save as FAQ"
                                    >
                                      <BookmarkIcon className="chat__action-icon" />
                                      <span className="chat__action-label">
                                        {savedFaqIds.has(message.id) ? "Saved" : savingFaqId === message.id ? "Saving..." : "Save as FAQ"}
                                      </span>
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
                                          aria-label={
                                            message.response.flag_status === "open"
                                              ? "Response flagged"
                                              : message.response.flag_status === "in_review"
                                                ? "Flagged response in review"
                                                : flaggingMessageId === message.response.message_id
                                                  ? "Reporting response"
                                                  : "Report response"
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
              {panelError && <p className="chat__banner-error">Error: {panelError}</p>}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <form onSubmit={(event) => void handleSubmit(event)} className="chat__input-bar">
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
              {promptSuggestionError && <p className="chat__prompt-suggest-error">Error: {promptSuggestionError}</p>}
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
          onClick={closeCitation}
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
                onClick={closeCitation}
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
