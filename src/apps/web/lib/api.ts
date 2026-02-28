import { getAccessToken } from "./supabaseClient";
import type {
  ChatResponse,
  HistoryMessage,
  Hub,
  HubMember,
  FaqEntry,
  GuideEntry,
  GuideStep,
  NotificationEvent,
  PendingInvite,
  Reminder,
  ReminderCandidate,
  ReminderCandidateStatus,
  ReminderUpdateAction,
  Source,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.detail) {
        throw new Error(parsed.detail);
      }
    } catch {
      // Ignore JSON parse errors and fall back to raw text.
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

export async function createHub(data: { name: string; description?: string }): Promise<Hub> {
  const res = await authedFetch(`${API_BASE}/hubs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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

export async function deleteSource(sourceId: string): Promise<void> {
  const res = await authedFetch(`${API_BASE}/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    await handle(res);
  }
}

export async function getChatHistory(hubId: string): Promise<HistoryMessage[]> {
  const res = await authedFetch(`${API_BASE}/chat/history?hub_id=${hubId}`, { cache: "no-store" });
  return handle<HistoryMessage[]>(res);
}

export async function askQuestion(data: {
  hub_id: string;
  scope: "hub" | "global";
  question: string;
  source_ids?: string[];
}): Promise<ChatResponse> {
  const res = await authedFetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ChatResponse>(res);
}

export async function listFaqs(hubId: string): Promise<FaqEntry[]> {
  const res = await authedFetch(`${API_BASE}/faqs?hub_id=${hubId}`, { cache: "no-store" });
  return handle<FaqEntry[]>(res);
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

export async function inviteMember(hubId: string, data: { email: string; role: "owner" | "editor" | "viewer" }): Promise<HubMember> {
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

export async function updateMemberRole(
  hubId: string,
  userId: string,
  data: { role: "owner" | "editor" | "viewer" }
): Promise<HubMember> {
  const res = await authedFetch(`${API_BASE}/hubs/${hubId}/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
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
  message?: string;
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
    message?: string;
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
