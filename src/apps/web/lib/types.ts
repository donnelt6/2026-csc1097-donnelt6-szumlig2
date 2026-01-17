export type HubScope = "hub" | "global";
export type MembershipRole = "owner" | "editor" | "viewer";

export interface Hub {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  role?: MembershipRole | null;
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

export interface HubMember {
  hub_id: string;
  user_id: string;
  role: MembershipRole;
  invited_at?: string | null;
  accepted_at?: string | null;
  email?: string | null;
}

export interface PendingInvite {
  hub: Hub;
  role: MembershipRole;
  invited_at?: string | null;
}
