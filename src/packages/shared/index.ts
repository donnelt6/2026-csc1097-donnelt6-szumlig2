export type HubScope = "hub" | "global";

export interface Hub {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Source {
  id: string;
  hubId: string;
  originalName: string;
  storagePath?: string;
  status: "queued" | "processing" | "failed" | "complete";
  failureReason?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  createdAt: string;
}

export interface Citation {
  sourceId: string;
  snippet: string;
  chunkIndex?: number;
}

export interface ChatRequest {
  hubId: string;
  scope: HubScope;
  question: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  messageId: string;
}
