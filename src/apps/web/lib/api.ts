import type { ChatResponse, Hub, Source } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listHubs(): Promise<Hub[]> {
  const res = await fetch(`${API_BASE}/hubs`, { cache: "no-store" });
  return handle<Hub[]>(res);
}

export async function createHub(data: { name: string; description?: string }): Promise<Hub> {
  const res = await fetch(`${API_BASE}/hubs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<Hub>(res);
}

export async function listSources(hubId: string): Promise<Source[]> {
  const res = await fetch(`${API_BASE}/sources/${hubId}`, { cache: "no-store" });
  return handle<Source[]>(res);
}

export async function createSource(data: { hub_id: string; original_name: string }): Promise<{ source: Source; upload_url: string }> {
  const res = await fetch(`${API_BASE}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle(res);
}

export async function getSourceStatus(sourceId: string): Promise<{ id: string; status: string; failure_reason?: string }> {
  const res = await fetch(`${API_BASE}/sources/${sourceId}/status`, { cache: "no-store" });
  return handle(res);
}

export async function enqueueSource(sourceId: string): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/sources/${sourceId}/enqueue`, {
    method: "POST",
  });
  return handle(res);
}

export async function askQuestion(data: { hub_id: string; scope: "hub" | "global"; question: string }): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handle<ChatResponse>(res);
}
