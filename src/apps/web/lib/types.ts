export type HubScope = "hub" | "global";

export interface Hub {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
}

export interface Source {
  id: string;
  hub_id: string;
  original_name: string;
  storage_path?: string | null;
  status: "queued" | "processing" | "failed" | "complete";
  failure_reason?: string;
  created_at: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  message_id: string;
}

export interface Citation {
  source_id: string;
  snippet: string;
  chunk_index?: number;
}
