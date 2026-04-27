'use client';

// useChatComposer.ts: Isolates composer input, prompt suggestion, and dashboard-launch prompt behavior.

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getChatPromptSuggestion } from "../../lib/api";

interface UseChatComposerArgs {
  hubId: string;
  activeSessionId: string | null;
  canAsk: boolean;
  canSuggestPrompt: boolean;
  completeSourceIds: string[];
  isBootstrapping: boolean;
  isComposerLocked: boolean;
  messagesLength: number;
  sourcesLoading?: boolean;
  submitQuestion: (question: string) => Promise<boolean>;
}

export function useChatComposer({
  hubId,
  activeSessionId,
  canAsk,
  canSuggestPrompt,
  completeSourceIds,
  isBootstrapping,
  isComposerLocked,
  messagesLength,
  sourcesLoading,
  submitQuestion,
}: UseChatComposerArgs) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSessionParam = searchParams.get("session");
  const initialPromptParam = searchParams.get("prompt");
  const initialPromptAction = searchParams.get("promptAction");
  const shouldStartFreshFromPrompt = initialSessionParam === "new" && !!initialPromptParam;
  const shouldAutoSendPrompt = shouldStartFreshFromPrompt && initialPromptAction === "send";
  const hasAutoSent = useRef(false);

  const [question, setQuestion] = useState("");
  const [isSuggestingPrompt, setIsSuggestingPrompt] = useState(false);
  const [promptSuggestionError, setPromptSuggestionError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    hasAutoSent.current = false;
  }, [hubId, initialPromptParam, initialPromptAction, initialSessionParam]);

  function resetTextareaHeight() {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleTextareaChange(event: ChangeEvent<HTMLTextAreaElement>) {
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
      const response = await getChatPromptSuggestion(hubId, completeSourceIds);
      setQuestion(response.prompt);
      textareaRef.current?.focus();
    } catch (error) {
      setPromptSuggestionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSuggestingPrompt(false);
    }
  }

  async function handleSubmit(event?: FormEvent, overrideQuestion?: string) {
    event?.preventDefault();
    const nextQuestion = (overrideQuestion ?? question).trim();
    if (!nextQuestion) {
      return;
    }
    const sent = await submitQuestion(nextQuestion);
    if (sent) {
      setQuestion("");
      resetTextareaHeight();
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  useEffect(() => {
    if (hasAutoSent.current || isBootstrapping || sourcesLoading || !initialPromptParam) return;
    if (shouldAutoSendPrompt && (!canAsk || activeSessionId !== null || messagesLength > 0)) return;

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
      void handleSubmit(undefined, initialPromptParam);
      return;
    }

    setQuestion(initialPromptParam);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [
    activeSessionId,
    canAsk,
    initialPromptParam,
    isBootstrapping,
    messagesLength,
    pathname,
    router,
    searchParams,
    shouldAutoSendPrompt,
    sourcesLoading,
  ]);

  return {
    handleComposerKeyDown,
    handleSubmit,
    handleSuggestPrompt,
    handleTextareaChange,
    isSuggestingPrompt,
    promptSuggestionError,
    question,
    setQuestion,
    textareaRef,
  };
}
