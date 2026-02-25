export type HubScope = "hub" | "global";
export type MembershipRole = "owner" | "editor" | "viewer";

export interface Hub {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  created_at: string;
  role?: MembershipRole | null;
  members_count?: number | null;
  sources_count?: number | null;
  last_accessed_at?: string | null;
  is_favourite?: boolean | null;
}

export interface Source {
  id: string;
  hub_id: string;
  type: "file" | "web" | "youtube";
  original_name: string;
  storage_path?: string | null;
  status: "queued" | "processing" | "failed" | "complete";
  failure_reason?: string;
  ingestion_metadata?: Record<string, unknown> | null;
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

export interface FaqEntry {
  id: string;
  hub_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  source_ids: string[];
  confidence: number;
  is_pinned: boolean;
  archived_at?: string | null;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  generation_batch_id?: string | null;
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

export type ReminderStatus = "scheduled" | "sent" | "completed" | "cancelled";
export type ReminderCandidateStatus = "pending" | "accepted" | "declined" | "expired";
export type ReminderUpdateAction = "complete" | "cancel" | "snooze";
export type NotificationStatus = "queued" | "sent" | "failed";
export type NotificationChannel = "in_app";

export interface Reminder {
  id: string;
  user_id: string;
  hub_id: string;
  source_id?: string | null;
  due_at: string;
  timezone: string;
  message?: string | null;
  status: ReminderStatus;
  created_at: string;
  sent_at?: string | null;
  completed_at?: string | null;
}

export interface ReminderCandidate {
  id: string;
  hub_id: string;
  source_id: string;
  snippet: string;
  due_at: string;
  timezone: string;
  title_suggestion?: string | null;
  confidence: number;
  status: ReminderCandidateStatus;
  created_at: string;
}

export interface ReminderSummary {
  id: string;
  hub_id: string;
  source_id?: string | null;
  due_at: string;
  message?: string | null;
  status: ReminderStatus;
}

export interface NotificationEvent {
  id: string;
  reminder_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  scheduled_for: string;
  sent_at?: string | null;
  reminder: ReminderSummary;
}
