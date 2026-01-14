'use client';

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { askQuestion } from "../lib/api";
import type { ChatResponse, Citation } from "../lib/types";

interface Props {
  hubId: string;
}

export function ChatPanel({ hubId }: Props) {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [scope, setScope] = useState<"hub" | "global">("hub");
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const mutation = useMutation({
    mutationFn: () => askQuestion({ hub_id: hubId, scope, question }),
    onSuccess: (data) => {
      setResponse(data);
    },
  });

  const onSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!question.trim()) return;
    mutation.mutate();
  };

  return (
    <div className="card grid">
      <div>
        <h3 style={{ margin: 0 }}>Ask a question</h3>
        <p className="muted">Answers use your hub by default; flip the scope to include broader model context.</p>
      </div>
      <form onSubmit={onSubmit} className="grid">
        <label style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className="muted" style={{ minWidth: 110 }}>
            Scope
          </span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "hub" | "global")}
            style={{
              background: "#0f1726",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "8px 10px",
            }}
          >
            <option value="hub">Hub only</option>
            <option value="global">Hub + global</option>
          </select>
        </label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What are the onboarding steps for engineering?"
        />
        <button className="button" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Thinking..." : "Ask"}
        </button>
      </form>
      {mutation.error && <p className="muted">Error: {(mutation.error as Error).message}</p>}
      {response && (
        <div className="card" style={{ borderColor: "#1e2535" }}>
          <p>{response.answer}</p>
          {response.citations.length === 0 && (
            <p className="muted">No sources matched this question. Try rephrasing or upload more documents.</p>
          )}
          {response.citations.length > 0 && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {response.citations.map((citation) => {
                const preview =
                  citation.snippet.length > 120 ? `${citation.snippet.slice(0, 120)}...` : citation.snippet;
                return (
                  <button
                    key={`${citation.source_id}-${citation.chunk_index}`}
                    onClick={() => setActiveCitation(citation)}
                    style={{
                      border: "1px solid #243145",
                      borderRadius: "10px",
                      padding: "6px 10px",
                      fontSize: "0.9rem",
                      background: "#0f1726",
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                    type="button"
                  >
                    {citation.source_id.slice(0, 6)} - {preview}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {activeCitation && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setActiveCitation(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6, 10, 20, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 50,
          }}
        >
          <div
            className="card"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: "720px", width: "100%", maxHeight: "80vh", overflow: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
              <strong>Source {activeCitation.source_id.slice(0, 8)}</strong>
              <button className="button" type="button" onClick={() => setActiveCitation(null)}>
                Close
              </button>
            </div>
            <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {activeCitation.snippet}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
