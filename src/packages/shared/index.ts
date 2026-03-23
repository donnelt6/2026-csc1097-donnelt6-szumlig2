export type HubScope = "hub" | "global";
export type MembershipRole = "owner" | "admin" | "editor" | "viewer";
export type AssignableMembershipRole = "admin" | "editor" | "viewer";
export type FlagCaseStatus = "open" | "in_review" | "resolved" | "dismissed";
export type MessageFlagStatus = "none" | FlagCaseStatus;
export type FlagReason = "incorrect" | "unsupported" | "harmful" | "outdated" | "other";
export type MessageRevisionType = "original" | "regenerated" | "manual_edit";

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
  activeFlagId?: string | null;
  flagStatus?: MessageFlagStatus;
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
  sourceIds?: string[];
  sessionId?: string | null;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  activeFlagId?: string | null;
  flagStatus: MessageFlagStatus;
}

export interface ChatSessionSummary {
  id: string;
  hubId: string;
  title: string;
  scope: HubScope;
  sourceIds: string[];
  createdAt: string;
  lastMessageAt: string;
}

export interface ChatSessionDetail {
  session: ChatSessionSummary;
  messages: ChatMessage[];
}

export interface FlagCase {
  id: string;
  hubId: string;
  sessionId: string;
  messageId: string;
  createdBy: string;
  reason: FlagReason;
  notes?: string | null;
  status: FlagCaseStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  resolvedRevisionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRevision {
  id: string;
  messageId: string;
  flagCaseId: string;
  revisionType: MessageRevisionType;
  content: string;
  citations: Citation[];
  createdBy?: string | null;
  createdAt: string;
  appliedAt?: string | null;
}
