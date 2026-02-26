'use client';

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDownIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { askQuestion, getChatHistory } from "../lib/api";
import type { ChatResponse, Citation, HistoryMessage, Source } from "../lib/types";
import { SourceSelector } from "./SourceSelector";

const SCOPE_OPTIONS = [
  { value: "hub" as const, label: "Hub only" },
  { value: "global" as const, label: "Hub + global" },
];

interface MessagePair {
  id: string;
  question: string;
  response: ChatResponse | null;
  error: string | null;
  isLoading: boolean;
}

interface Props {
  hubId: string;
  hubName: string;
  hubDescription?: string;
  selectedSourceIds: string[];
  hasSelectableSources: boolean;
  sources: Source[];
  sourcesLoading?: boolean;
  onToggleSource: (id: string) => void;
  onSelectAllSources: () => void;
  onClearSourceSelection: () => void;
}

export function ChatPanel({ hubId, hubName, hubDescription, selectedSourceIds, hasSelectableSources, sources, sourcesLoading, onToggleSource, onSelectAllSources, onClearSourceSelection }: Props) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<MessagePair[]>([]);
  const [scope, setScope] = useState<"hub" | "global">("hub");
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);

  const hasSelection = selectedSourceIds.length > 0;
  const canAsk = !hasSelectableSources || hasSelection;

  // Close scope dropdown on click-away or Escape
  useEffect(() => {
    if (!scopeOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (scopeRef.current && !scopeRef.current.contains(e.target as Node)) {
        setScopeOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setScopeOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [scopeOpen]);

  // Focus close button when modal opens; close on Escape
  useEffect(() => {
    if (!activeCitation) return;
    modalCloseRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveCitation(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeCitation]);

  // Load chat history
  const { data: historyData } = useQuery({
    queryKey: ['chatHistory', hubId],
    queryFn: () => getChatHistory(hubId),
  });

  const historyPairs = useMemo<MessagePair[]>(() => {
    if (!historyData || historyData.length === 0) return [];
    const pairs: MessagePair[] = [];
    for (let i = 0; i < historyData.length; i += 2) {
      const userMsg: HistoryMessage | undefined = historyData[i];
      const aiMsg: HistoryMessage | undefined = historyData[i + 1];
      if (userMsg && userMsg.role === "user") {
        pairs.push({
          id: `history-${i}`,
          question: userMsg.content,
          response: aiMsg
            ? { answer: aiMsg.content, citations: aiMsg.citations, message_id: `history-${i + 1}` }
            : null,
          error: null,
          isLoading: false,
        });
      }
    }
    return pairs;
  }, [historyData]);

  const allMessages = useMemo(
    () => [...historyPairs, ...messages],
    [historyPairs, messages]
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages]);

  const mutation = useMutation({
    mutationFn: ({ questionText }: { msgId: string; questionText: string }) =>
      askQuestion({
        hub_id: hubId,
        scope,
        question: questionText,
        source_ids: hasSelection ? selectedSourceIds : undefined,
      }),
    onSuccess: (data, variables) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === variables.msgId
            ? { ...m, response: data, isLoading: false }
            : m
        )
      );
    },
    onError: (err, variables) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === variables.msgId
            ? { ...m, error: err instanceof Error ? err.message : String(err), isLoading: false }
            : m
        )
      );
    },
  });

  const getSourceName = (sourceId: string): string => {
    const source = sources.find((s) => s.id === sourceId);
    return source?.original_name ?? sourceId.slice(0, 8);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuestion(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const onSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || mutation.isPending) return;

    const msgId = Date.now().toString();
    setMessages((prev) => [
      ...prev,
      { id: msgId, question: trimmed, response: null, error: null, isLoading: true },
    ]);
    setQuestion("");

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    mutation.mutate({ msgId, questionText: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <>
      <div className="chat">
        <div className="chat__controls">
          <div className="chat__hub-info">
            <p className="chat__hub-name">{hubName}</p>
            {hubDescription && <p className="chat__hub-desc">{hubDescription}</p>}
          </div>
          <div className="chat__controls-divider" aria-hidden="true" />
          <div className="chat__controls-right">
            <SourceSelector
              sources={sources}
              sourcesLoading={sourcesLoading}
              selectedSourceIds={selectedSourceIds}
              onToggleSource={onToggleSource}
              onSelectAllSources={onSelectAllSources}
              onClearSourceSelection={onClearSourceSelection}
            />
            <div className="scope-selector" ref={scopeRef} data-open={scopeOpen || undefined}>
              <button
                type="button"
                className="scope-selector__toggle"
                aria-expanded={scopeOpen}
                aria-haspopup="listbox"
                onClick={() => setScopeOpen((v) => !v)}
              >
                <span>{SCOPE_OPTIONS.find((o) => o.value === scope)?.label}</span>
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
                      onClick={() => { setScope(option.value); setScopeOpen(false); }}
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
          {allMessages.length === 0 && (
            <div className="chat__empty">
              <p className="chat__empty-text">Ask a question about your hub</p>
              <p className="muted">Answers use your selected sources. Flip the scope to include broader context.</p>
            </div>
          )}
          {allMessages.map((msg) => (
            <div key={msg.id} className="chat__pair">
              <div className="chat__message chat__message--user">
                <div className="chat__bubble chat__bubble--user">
                  {msg.question}
                </div>
              </div>
              <div className="chat__message chat__message--ai">
                <div className="chat__bubble chat__bubble--ai">
                  {msg.isLoading && (
                    <div className="chat__typing">
                      <span className="chat__dot" />
                      <span className="chat__dot" />
                      <span className="chat__dot" />
                    </div>
                  )}
                  {msg.error && (
                    <p className="chat__error">Error: {msg.error}</p>
                  )}
                  {msg.response && (
                    <>
                      <p className="chat__answer">{msg.response.answer}</p>
                      {msg.response.citations.length === 0 && (
                        <p className="muted" style={{ marginTop: "8px", fontSize: "0.8rem" }}>
                          No sources matched. Try rephrasing or upload more documents.
                        </p>
                      )}
                      {msg.response.citations.length > 0 && (
                        <div className="chat__citations">
                          {msg.response.citations.map((citation, idx) => (
                            <button
                              key={`${citation.source_id}-${citation.chunk_index ?? idx}`}
                              className="chat__citation-chip"
                              onClick={() => setActiveCitation(citation)}
                              type="button"
                            >
                              <span className="chat__citation-num">[{idx + 1}]</span>
                              <span className="chat__citation-name">{getSourceName(citation.source_id)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={onSubmit} className="chat__input-bar">
          {!canAsk && (
            <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
              Select at least one source above to ask a question.
            </p>
          )}
          <div className="chat__input-row">
            <textarea
              ref={textareaRef}
              className="chat__textarea"
              value={question}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question..."
              aria-label="Ask a question"
              rows={1}
            />
            <button
              className="chat__send"
              type="submit"
              disabled={mutation.isPending || !canAsk || !question.trim()}
              aria-label="Send message"
            >
              <PaperAirplaneIcon className="chat__send-icon" />
            </button>
          </div>
        </form>
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
