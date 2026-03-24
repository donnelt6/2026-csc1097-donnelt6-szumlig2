export type HubScope = "hub" | "global";
export type MembershipRole = "owner" | "admin" | "editor" | "viewer";
export type AssignableMembershipRole = "admin" | "editor" | "viewer";
export type FlagCaseStatus = "open" | "in_review" | "resolved" | "dismissed";
export type MessageFlagStatus = "none" | FlagCaseStatus;
export type FlagReason = "incorrect" | "unsupported" | "harmful" | "outdated" | "other";
export type MessageRevisionType = "original" | "regenerated" | "manual_edit";

export interface Hub {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  icon_key?: string | null;
  color_key?: string | null;
  created_at: string;
  archived_at?: string | null;
  role?: MembershipRole | null;
  members_count?: number | null;
  sources_count?: number | null;
  last_accessed_at?: string | null;
  is_favourite?: boolean | null;
  member_emails?: string[] | null;
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

export type SourceSuggestionType = "web" | "youtube";
export type SourceSuggestionStatus = "pending" | "accepted" | "declined";

export interface SourceSuggestion {
  id: string;
  hub_id: string;
  type: SourceSuggestionType;
  status: SourceSuggestionStatus;
  url: string;
  canonical_url?: string | null;
  video_id?: string | null;
  title?: string | null;
  description?: string | null;
  rationale?: string | null;
  confidence: number;
  seed_source_ids: string[];
  search_metadata?: Record<string, unknown> | null;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  accepted_source_id?: string | null;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  message_id: string;
  session_id: string;
  session_title: string;
  active_flag_id?: string | null;
  flag_status: MessageFlagStatus;
}

export interface Citation {
  source_id: string;
  snippet: string;
  chunk_index?: number;
}

export interface HistoryMessage {
  role: string;
  content: string;
  citations: Citation[];
  created_at: string;
  active_flag_id?: string | null;
  flag_status: MessageFlagStatus;
}

export interface ChatSessionSummary {
  id: string;
  hub_id: string;
  title: string;
  scope: HubScope;
  source_ids: string[];
  created_at: string;
  last_message_at: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
  active_flag_id?: string | null;
  flag_status: MessageFlagStatus;
}

export interface ChatSessionDetail {
  session: ChatSessionSummary;
  messages: SessionMessage[];
}

export interface ActivityEvent {
  id: string;
  hub_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  metadata: Record<string, unknown>;
  created_at: string;
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

export interface GuideStep {
  id: string;
  guide_id: string;
  step_index: number;
  title?: string | null;
  instruction: string;
  citations: Citation[];
  confidence: number;
  created_at: string;
  updated_at?: string | null;
  is_complete?: boolean;
  completed_at?: string | null;
}

export interface GuideEntry {
  id: string;
  hub_id: string;
  title: string;
  topic?: string | null;
  summary?: string | null;
  source_ids: string[];
  archived_at?: string | null;
  created_at: string;
  created_by?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  generation_batch_id?: string | null;
  steps: GuideStep[];
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

export interface FlagCase {
  id: string;
  hub_id: string;
  session_id: string;
  message_id: string;
  created_by: string;
  reason: FlagReason;
  notes?: string | null;
  status: FlagCaseStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  resolved_revision_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlagMessageResponse {
  flag_case: FlagCase;
  created: boolean;
}

export interface MessageRevision {
  id: string;
  message_id: string;
  flag_case_id: string;
  revision_type: MessageRevisionType;
  content: string;
  citations: Citation[];
  created_by?: string | null;
  created_at: string;
  applied_at?: string | null;
}

export interface FlaggedChatQueueItem {
  id: string;
  hub_id: string;
  hub_name: string;
  session_id: string;
  session_title: string;
  message_id: string;
  question_preview: string;
  answer_preview: string;
  reason: FlagReason;
  status: FlagCaseStatus;
  flagged_at: string;
  reviewed_at?: string | null;
}

export interface FlaggedChatDetail {
  case: FlagCase;
  hub_name: string;
  session_title: string;
  question_message: SessionMessage;
  flagged_message: SessionMessage;
  revisions: MessageRevision[];
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
