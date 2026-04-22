// api.ts: Typed fetch helpers and error handling for all backend API calls.

import { getAccessToken } from "./supabaseClient";
import type {
  ActivityEvent,
  AssignableMembershipRole,
  ChatSessionDetail,
  ChatPromptSuggestion,
  ChatFeedbackResponse,
  ChatEventResponse,
  ChatEventType,
  ChatAnalyticsSummary,
  ChatAnalyticsTrends,
  ChatSearchResult,
  ChatSessionSummary,
  ChatResponse,
  ChatFeedbackRating,
  CitationFeedbackEventType,
  CitationFeedbackResponse,
  ContentFlag,
  ContentFlagResponse,
  ContentFlagStatus,
  ContentFlagType,
  FlagCase,
  FlagCaseStatus,
  FlagMessageResponse,
  FlagReason,
  FlaggedChatDetail,
  FlaggedChatQueueItem,
  FlaggedContentQueueItem,
  HistoryMessage,
  Hub,
  HubMember,
  FaqEntry,
  GuideEntry,
  GuideStep,
  MessageRevision,
  NotificationEvent,
  PendingInvite,
  Reminder,
  ReminderCandidate,
  ReminderCandidateStatus,
  ReminderUpdateAction,
  Source,
  SourceSuggestion,
  SourceSuggestionStatus,
} from "@shared/index";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.detail) {
        if (typeof parsed.detail === "string") {
          throw new Error(parsed.detail);
        }
        if (Array.isArray(parsed.detail)) {
          const msg = parsed.detail.map((e: { msg?: string }) => e.msg ?? "Unknown error").join(". ");
          throw new Error(msg);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message !== detail) throw e;
    }
    throw new Error(detail || `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function authedFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("You must be signed in to continue.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function listHubs(): Promise<Hub[]> {
  const res = await authedFetch(`${API_BASE}/hubs`, { cache: "no-store" });
  return handle<Hub[]>(res);
}

export async function createHub(data: {
  name: string;
  description?: string;
  icon_key?: string;
  color_key?: string;
}): Promise<Hub> {
  const res = await authedFetch(`${API_BASE}/hubs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<Hub>(res);
}

export async function updateHub(
  hubId: string,
  data: {
    name?: string;
    description?: string;
    icon_key?: string;
    color_key?: string;
  }
): Promise<Hub> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<Hub>(res);
}

export async function archiveHub(hubId: string): Promise<Hub> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/archive`, {
    method: "POST",
  });
  return handle<Hub>(res);
}

export async function unarchiveHub(hubId: string): Promise<Hub> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/unarchive`, {
    method: "POST",
  });
  return handle<Hub>(res);
}

export async function trackHubAccess(hubId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/access`, {
    method: "POST",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function toggleHubFavourite(hubId: string, isFavourite: boolean): Promise<void> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/favourite`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_favourite: isFavourite }),
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function listSources(hubId: string): Promise<Source[]> {
  const res = await authedFetch(`${API_BASE}/sources/${hubId}`, { cache: "no-store" });
  return handle<Source[]>(res);
}

export async function createSource(data: { hub_id: string; original_name: string }): Promise<{ source: Source; upload_url: string }> {
  const res = await authedFetch(`${API_BASE}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function createWebSource(data: { hub_id: string; url: string }): Promise<Source> {
  const res = await authedFetch(`${API_BASE}/sources/web`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function createYouTubeSource(data: {
  hub_id: string;
  url: string;
  language?: string | null;
  allow_auto_captions?: boolean;
}): Promise<Source> {
  const res = await authedFetch(`${API_BASE}/sources/youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function createSourceUploadUrl(sourceId: string): Promise<{ upload_url: string }> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}/upload-url`, {
    method: "POST",
  });
  return handle(res);
}

export async function failSource(sourceId: string, failureReason: string): Promise<{ id: string; status: string; failure_reason?: string }> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}/fail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ failure_reason: failureReason }),
  });
  return handle(res);
}

export async function getSourceStatus(sourceId: string): Promise<{ id: string; status: string; failure_reason?: string }> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}/status`, { cache: "no-store" });
  return handle(res);
}

export async function enqueueSource(sourceId: string): Promise<{ status: string }> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}/enqueue`, {
    method: "POST",
  });
  return handle(res);
}

export async function refreshSource(sourceId: string): Promise<{ status: string }> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}/refresh`, {
    method: "POST",
  });
  return handle(res);
}

export async function listSourceChunks(sourceId: string): Promise<{ chunk_index: number; text: string }[]> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}/chunks`, { cache: "no-store" });
  return handle(res);
}

export async function deleteSource(sourceId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function listSourceSuggestions(params: {
  hubId: string;
  status?: SourceSuggestionStatus;
}): Promise<SourceSuggestion[]> {
  const search = new URLSearchParams();
  search.set("hub_id", params.hubId);
  if (params.status) search.set("status", params.status);
  const res = await authedFetch(`${API_BASE}/sources/suggestions?${search}`, { cache: "no-store" });
  return handle<SourceSuggestion[]>(res);
}

export async function decideSourceSuggestion(
  suggestionId: string,
  data: { action: SourceSuggestionStatus }
): Promise<{ suggestion: SourceSuggestion; source?: Source }> {
  const res = await authedFetch(`${API_BASE}/sources/suggestions/${suggestionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function getChatHistory(hubId: string): Promise<HistoryMessage[]> {
  const res = await authedFetch(`${API_BASE}/chat/history?hub_id=${hubId}`, { cache: "no-store" });
  return handle<HistoryMessage[]>(res);
}

export async function getChatPromptSuggestion(hubId: string, sourceIds: string[]): Promise<ChatPromptSuggestion> {
  const search = new URLSearchParams();
  search.set("hub_id", hubId);
  sourceIds.forEach((sourceId) => search.append("source_ids", sourceId));
  const res = await authedFetch(`${API_BASE}/chat/prompt-suggestion?${search.toString()}`, { cache: "no-store" });
  return handle<ChatPromptSuggestion>(res);
}

export async function listChatSessions(hubId: string): Promise<ChatSessionSummary[]> {
  const res = await authedFetch(`${API_BASE}/chat/sessions?hub_id=${hubId}`, { cache: "no-store" });
  return handle<ChatSessionSummary[]>(res);
}

export async function getChatSessionMessages(sessionId: string, hubId: string): Promise<ChatSessionDetail> {
  const res = await authedFetch(
    `${API_BASE}/chat/sessions/${sessionId}/messages?hub_id=${hubId}`,
    { cache: "no-store" }
  );
  return handle<ChatSessionDetail>(res);
}

export async function searchChatMessages(hubId: string, query: string): Promise<ChatSearchResult[]> {
  const search = new URLSearchParams();
  search.set("hub_id", hubId);
  search.set("q", query);
  const res = await authedFetch(`${API_BASE}/chat/search?${search.toString()}`, { cache: "no-store" });
  return handle<ChatSearchResult[]>(res);
}

export async function renameChatSession(sessionId: string, title: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/chat/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/chat/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function askQuestion(data: {
  hub_id: string;
  scope: "hub" | "global";
  question: string;
  source_ids?: string[];
  session_id?: string | null;
}): Promise<ChatResponse> {
  const res = await authedFetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ChatResponse>(res);
}

export async function submitChatFeedback(
  messageId: string,
  data: { rating: ChatFeedbackRating; reason?: string }
): Promise<ChatFeedbackResponse> {
  const res = await authedFetch(`${API_BASE}/chat/messages/${messageId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ChatFeedbackResponse>(res);
}

export async function submitCitationFeedback(
  messageId: string,
  data: { source_id: string; chunk_index?: number; event_type: CitationFeedbackEventType; note?: string }
): Promise<CitationFeedbackResponse> {
  const res = await authedFetch(`${API_BASE}/chat/messages/${messageId}/citations/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<CitationFeedbackResponse>(res);
}

export async function createChatEvent(data: {
  hub_id: string;
  session_id?: string | null;
  message_id?: string | null;
  event_type: ChatEventType;
  metadata?: Record<string, unknown>;
}): Promise<ChatEventResponse> {
  const res = await authedFetch(`${API_BASE}/chat/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ChatEventResponse>(res);
}

export async function getHubAnalyticsSummary(hubId: string, days?: number): Promise<ChatAnalyticsSummary> {
  const search = new URLSearchParams();
  if (days) search.set("days", String(days));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/analytics/summary${suffix}`, { cache: "no-store" });
  return handle<ChatAnalyticsSummary>(res);
}

export async function getHubAnalyticsTrends(hubId: string, days?: number): Promise<ChatAnalyticsTrends> {
  const search = new URLSearchParams();
  if (days) search.set("days", String(days));
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/analytics/trends${suffix}`, { cache: "no-store" });
  return handle<ChatAnalyticsTrends>(res);
}

export async function listActivity(hubId?: string, limit = 50): Promise<ActivityEvent[]> {
  const params = new URLSearchParams();
  if (hubId) params.set("hub_id", hubId);
  params.set("limit", String(limit));
  const res = await authedFetch(`${API_BASE}/activity?${params}`, { cache: "no-store" });
  return handle<ActivityEvent[]>(res);
}

export async function flagMessage(
  messageId: string,
  data: { reason: FlagReason; notes?: string }
): Promise<FlagMessageResponse> {
  const res = await authedFetch(`${API_BASE}/messages/${messageId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<FlagMessageResponse>(res);
}

export async function listFlaggedChats(
  hubId: string,
  params: {
    status?: FlagCaseStatus;
  } = {}
): Promise<FlaggedChatQueueItem[]> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  const url = search.toString()
    ? `${API_BASE}/hubs/${hubId}/flagged-chats?${search}`
    : `${API_BASE}/hubs/${hubId}/flagged-chats`;
  const res = await authedFetch(url, { cache: "no-store" });
  return handle<FlaggedChatQueueItem[]>(res);
}

export async function getFlaggedChat(hubId: string, flagId: string): Promise<FlaggedChatDetail> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-chats/${flagId}`, { cache: "no-store" });
  return handle<FlaggedChatDetail>(res);
}

export async function regenerateFlaggedChat(hubId: string, flagId: string): Promise<MessageRevision> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-chats/${flagId}/regenerate`, {
    method: "POST",
  });
  return handle<MessageRevision>(res);
}

export async function createFlaggedChatRevision(
  hubId: string,
  flagId: string,
  data: { content: string; citations: ChatResponse["citations"] }
): Promise<MessageRevision> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-chats/${flagId}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<MessageRevision>(res);
}

export async function applyFlaggedChatRevision(hubId: string, flagId: string, revisionId: string): Promise<FlagCase> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-chats/${flagId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision_id: revisionId }),
  });
  return handle<FlagCase>(res);
}

export async function dismissFlaggedChat(hubId: string, flagId: string): Promise<FlagCase> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-chats/${flagId}/dismiss`, {
    method: "POST",
  });
  return handle<FlagCase>(res);
}

export async function flagFaq(
  faqId: string,
  data: { reason: FlagReason; notes?: string },
): Promise<ContentFlagResponse> {
  const res = await authedFetch(`${API_BASE}/faqs/${faqId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ContentFlagResponse>(res);
}

export async function flagGuide(
  guideId: string,
  data: { reason: FlagReason; notes?: string },
): Promise<ContentFlagResponse> {
  const res = await authedFetch(`${API_BASE}/guides/${guideId}/flag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ContentFlagResponse>(res);
}

export async function listFlaggedContent(
  hubId: string,
  params?: { status?: ContentFlagStatus; content_type?: ContentFlagType },
): Promise<FlaggedContentQueueItem[]> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.content_type) search.set("content_type", params.content_type);
  const qs = search.toString();
  const res = await authedFetch(
    `${API_BASE}/hubs/${hubId}/flagged-content${qs ? `?${qs}` : ""}`,
    { cache: "no-store" },
  );
  return handle<FlaggedContentQueueItem[]>(res);
}

export async function resolveContentFlag(hubId: string, flagId: string): Promise<ContentFlag> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-content/${flagId}/resolve`, {
    method: "POST",
  });
  return handle<ContentFlag>(res);
}

export async function dismissContentFlag(hubId: string, flagId: string): Promise<ContentFlag> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/flagged-content/${flagId}/dismiss`, {
    method: "POST",
  });
  return handle<ContentFlag>(res);
}

export async function listFaqs(hubId: string): Promise<FaqEntry[]> {
  const res = await authedFetch(`${API_BASE}/faqs?hub_id=${hubId}`, { cache: "no-store" });
  return handle<FaqEntry[]>(res);
}

export async function createFaq(data: {
  hub_id: string;
  question: string;
  answer: string;
}): Promise<FaqEntry> {
  const res = await authedFetch(`${API_BASE}/faqs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function generateFaqs(data: {
  hub_id: string;
  source_ids: string[];
  count?: number;
}): Promise<{ entries: FaqEntry[] }> {
  const res = await authedFetch(`${API_BASE}/faqs/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function updateFaq(
  faqId: string,
  data: {
    question?: string;
    answer?: string;
    is_pinned?: boolean;
    archived?: boolean;
  }
): Promise<FaqEntry> {
  const res = await authedFetch(`${API_BASE}/faqs/${faqId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function archiveFaq(faqId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/faqs/${faqId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function listGuides(hubId: string): Promise<GuideEntry[]> {
  const res = await authedFetch(`${API_BASE}/guides?hub_id=${hubId}`, { cache: "no-store" });
  return handle<GuideEntry[]>(res);
}

export async function generateGuide(data: {
  hub_id: string;
  source_ids: string[];
  topic?: string;
  step_count?: number;
}): Promise<{ entry: GuideEntry | null }> {
  const res = await authedFetch(`${API_BASE}/guides/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function updateGuide(
  guideId: string,
  data: {
    title?: string;
    topic?: string;
    summary?: string;
    is_favourited?: boolean;
    archived?: boolean;
  }
): Promise<GuideEntry> {
  const res = await authedFetch(`${API_BASE}/guides/${guideId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function updateGuideStep(
  stepId: string,
  data: {
    title?: string;
    instruction?: string;
  }
): Promise<GuideStep> {
  const res = await authedFetch(`${API_BASE}/guides/steps/${stepId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function createGuideStep(
  guideId: string,
  data: {
    title?: string;
    instruction: string;
  }
): Promise<GuideStep> {
  const res = await authedFetch(`${API_BASE}/guides/${guideId}/steps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function reorderGuideSteps(
  guideId: string,
  ordered_step_ids: string[]
): Promise<GuideStep[]> {
  const res = await authedFetch(`${API_BASE}/guides/${guideId}/steps/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ordered_step_ids }),
  });
  return handle(res);
}

export async function updateGuideStepProgress(
  stepId: string,
  data: {
    is_complete: boolean;
  }
): Promise<GuideStep> {
  const res = await authedFetch(`${API_BASE}/guides/steps/${stepId}/progress`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function archiveGuide(guideId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/guides/${guideId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function listMembers(hubId: string): Promise<HubMember[]> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members`, { cache: "no-store" });
  return handle<HubMember[]>(res);
}

export async function inviteMember(hubId: string, data: { email: string; role: AssignableMembershipRole }): Promise<HubMember> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const payload = await handle<{ member: HubMember }>(res);
  return payload.member;
}

export async function acceptInvite(hubId: string): Promise<HubMember> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/accept`, {
    method: "POST",
  });
  return handle<HubMember>(res);
}

export async function dismissInviteNotification(hubId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/dismiss-notification`, {
    method: "POST",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function updateMemberRole(
  hubId: string,
  userId: string,
  data: { role: AssignableMembershipRole }
): Promise<HubMember> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<HubMember>(res);
}

export async function transferHubOwnership(hubId: string, userId: string): Promise<HubMember> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/${userId}/transfer-ownership`, {
    method: "POST",
  });
  return handle<HubMember>(res);
}

export async function removeMember(hubId: string, userId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function listInvites(): Promise<PendingInvite[]> {
  const res = await authedFetch(`${API_BASE}/invites`, { cache: "no-store" });
  return handle<PendingInvite[]>(res);
}

export async function listInviteNotifications(): Promise<PendingInvite[]> {
  const res = await authedFetch(`${API_BASE}/invites/notifications`, { cache: "no-store" });
  return handle<PendingInvite[]>(res);
}

export async function listReminders(params: {
  hubId?: string;
  status?: string;
  dueFrom?: string;
  dueTo?: string;
  sourceId?: string;
}): Promise<Reminder[]> {
  const search = new URLSearchParams();
  if (params.hubId) search.set("hub_id", params.hubId);
  if (params.status) search.set("status", params.status);
  if (params.dueFrom) search.set("due_from", params.dueFrom);
  if (params.dueTo) search.set("due_to", params.dueTo);
  if (params.sourceId) search.set("source_id", params.sourceId);
  const url = search.toString() ? `${API_BASE}/reminders?${search}` : `${API_BASE}/reminders`;
  const res = await authedFetch(url, { cache: "no-store" });
  return handle<Reminder[]>(res);
}

export async function createReminder(data: {
  hub_id: string;
  source_id?: string;
  due_at: string;
  timezone: string;
  title?: string;
  message?: string;
  notify_before?: number;
}): Promise<Reminder> {
  const res = await authedFetch(`${API_BASE}/reminders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<Reminder>(res);
}

export async function updateReminder(
  reminderId: string,
  data: {
    due_at?: string;
    timezone?: string;
    title?: string;
    message?: string;
    notify_before?: number | null;
    action?: ReminderUpdateAction;
    snooze_minutes?: number;
  }
): Promise<Reminder> {
  const res = await authedFetch(`${API_BASE}/reminders/${reminderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<Reminder>(res);
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/reminders/${reminderId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function listReminderCandidates(params: {
  hubId?: string;
  sourceId?: string;
  status?: ReminderCandidateStatus;
}): Promise<ReminderCandidate[]> {
  const search = new URLSearchParams();
  if (params.hubId) search.set("hub_id", params.hubId);
  if (params.sourceId) search.set("source_id", params.sourceId);
  if (params.status) search.set("status", params.status);
  const url = search.toString()
    ? `${API_BASE}/reminders/candidates?${search}`
    : `${API_BASE}/reminders/candidates`;
  const res = await authedFetch(url, { cache: "no-store" });
  return handle<ReminderCandidate[]>(res);
}

export async function decideReminderCandidate(
  candidateId: string,
  data: {
    action: ReminderCandidateStatus;
    edited_due_at?: string;
    edited_message?: string;
    timezone?: string;
  }
): Promise<{ candidate: ReminderCandidate; reminder?: Reminder }> {
  const res = await authedFetch(`${API_BASE}/reminders/candidates/${candidateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function listReminderNotifications(params: { reminderId?: string } = {}): Promise<NotificationEvent[]> {
  const search = new URLSearchParams();
  if (params.reminderId) search.set("reminder_id", params.reminderId);
  const url = search.toString()
    ? `${API_BASE}/reminders/notifications?${search}`
    : `${API_BASE}/reminders/notifications`;
  const res = await authedFetch(url, { cache: "no-store" });
  return handle<NotificationEvent[]>(res);
}

export async function dismissReminderNotification(notificationId: string): Promise<NotificationEvent> {
  const res = await authedFetch(`${API_BASE}/reminders/notifications/${notificationId}/dismiss`, {
    method: "POST",
  });
  return handle<NotificationEvent>(res);
}
