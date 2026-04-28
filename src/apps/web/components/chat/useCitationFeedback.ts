'use client';

// useCitationFeedback.ts: Keeps citation modal state and feedback side effects out of ChatPanel.

import { useEffect, useRef, useState } from "react";
import { submitCitationFeedback } from "../../lib/api";
import type { Citation } from "@shared/index";
import type { ActiveCitationState } from "./chatPanelShared";

export function useCitationFeedback() {
  const [activeCitation, setActiveCitation] = useState<ActiveCitationState | null>(null);
  const [citationFeedbackPending, setCitationFeedbackPending] = useState(false);
  const [citationFeedbackStatus, setCitationFeedbackStatus] = useState<string | null>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);

  const closeCitation = () => {
    setActiveCitation(null);
    setCitationFeedbackStatus(null);
  };

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

  useEffect(() => {
    if (!activeCitation) return;
    modalCloseRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCitation();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [activeCitation]);

  return {
    activeCitation,
    citationFeedbackPending,
    citationFeedbackStatus,
    modalCloseRef,
    openCitation,
    closeCitation,
    handleFlagCitation,
  };
}
