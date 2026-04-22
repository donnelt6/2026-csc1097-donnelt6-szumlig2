// index.ts: Shared TypeScript interfaces and type aliases consumed by the web app.

export type HubScope = "hub" | "global";
export type MembershipRole = "owner" | "admin" | "editor" | "viewer";
export type AssignableMembershipRole = "admin" | "editor" | "viewer";
export type FlagCaseStatus = "open" | "in_review" | "resolved" | "dismissed";
export type MessageFlagStatus = "none" | FlagCaseStatus;
export type FlagReason = "incorrect" | "unsupported" | "harmful" | "outdated" | "other";
export type MessageRevisionType = "original" | "regenerated" | "manual_edit";
export type ContentFlagType = "faq" | "guide";
export type ContentFlagStatus = "open" | "resolved" | "dismissed";
export type ChatFeedbackRating = "helpful" | "not_helpful";
export type CitationFeedbackEventType = "opened" | "flagged_incorrect";
export type ChatEventType =
  | "question_asked"
  | "answer_received"
  | "answer_copied"
  | "answer_feedback_submitted"
  | "citation_opened"
  | "citation_flagged"
  | "source_filter_changed";

export interface ContentFlag {
  id: string;
  hub_id: string;
  content_type: ContentFlagType;
  content_id: string;
  created_by: string;
  reason: FlagReason;
  notes?: string | null;
  status: ContentFlagStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentFlagResponse {
  flag: ContentFlag;
  created: boolean;
}

export interface FlaggedContentQueueItem {
  id: string;
  hub_id: string;
  content_type: ContentFlagType;
  content_id: string;
  title: string;
  preview: string;
  reason: FlagReason;
  status: ContentFlagStatus;
  flagged_at: string;
  reviewed_at?: string | null;
}

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
  member_profiles?: UserProfileSummary[] | null;
  _isPendingClientSync?: boolean;
}

export interface UserProfileSummary {
  user_id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_mode?: "preset" | null;
  avatar_key?: string | null;
  avatar_color?: string | null;
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
  feedback_rating?: ChatFeedbackRating | null;
}

export interface ChatPromptSuggestion {
  prompt: string;
}

export interface Citation {
  source_id: string;
  snippet: string;
  chunk_index?: number;
  relevant_quotes?: string[];
  paraphrased_quotes?: string[];
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
  feedback_rating?: ChatFeedbackRating | null;
}

export interface ChatFeedbackResponse {
  message_id: string;
  rating: ChatFeedbackRating;
  reason?: string | null;
  updated_at: string;
}

export interface CitationFeedbackResponse {
  message_id: string;
  source_id: string;
  chunk_index?: number | null;
  event_type: CitationFeedbackEventType;
  created_at: string;
}

export interface ChatEventResponse {
  event_type: ChatEventType;
  created_at: string;
}

export interface AnalyticsTopSource {
  source_id: string;
  source_name?: string | null;
  citation_returns: number;
  citation_opens: number;
  citation_flags: number;
}

export interface NeverCitedSource {
  source_id: string;
  source_name?: string | null;
}

export interface ChatAnalyticsSummary {
  window_days: number;
  total_questions: number;
  total_answers: number;
  helpful_count: number;
  not_helpful_count: number;
  helpful_rate: number;
  average_citations_per_answer: number;
  citation_open_count: number;
  citation_open_rate: number;
  citation_flag_count: number;
  citation_flag_rate: number;
  average_latency_ms: number;
  total_tokens: number;
  rewrite_usage_rate: number;
  zero_hit_rate: number;
  top_sources: AnalyticsTopSource[];
  never_cited_sources?: NeverCitedSource[];
  never_cited_count?: number;
  total_complete_sources?: number;
}

export interface ChatAnalyticsTrendPoint {
  date: string;
  questions: number;
  answers: number;
  helpful: number;
  not_helpful?: number;
  citation_opens: number;
  citation_flags: number;
}

export interface ChatAnalyticsTrends {
  window_days: number;
  points: ChatAnalyticsTrendPoint[];
}

export interface ChatSessionDetail {
  session: ChatSessionSummary;
  messages: SessionMessage[];
}

export interface ChatSearchResult {
  session_id: string;
  session_title: string;
  hub_id: string;
  message_id: string | null;
  matched_role: "user" | "assistant" | "title";
  snippet: string;
  matched_text?: string | null;
  created_at: string;
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
  is_favourited?: boolean;
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
  display_name?: string | null;
  avatar_mode?: "preset" | null;
  avatar_key?: string | null;
  avatar_color?: string | null;
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
export type ReminderUpdateAction = "complete" | "cancel" | "snooze" | "reopen";
export type NotificationStatus = "queued" | "sent" | "failed";
export type NotificationChannel = "in_app";

export interface Reminder {
  id: string;
  user_id: string;
  hub_id: string;
  source_id?: string | null;
  due_at: string;
  timezone: string;
  title?: string | null;
  message?: string | null;
  notify_before?: number | null;
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
  hub_name?: string | null;
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
  dismissed_at?: string | null;
  reminder: ReminderSummary;
}
