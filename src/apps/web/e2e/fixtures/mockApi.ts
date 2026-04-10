import { expect, type Page, type Route } from "@playwright/test";

const API_BASE = "http://127.0.0.1:8000";
const TEST_EMAIL = "e2e@example.com";
const TEST_PASSWORD = "password123";

interface Hub {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  icon_key: string;
  color_key: string;
  created_at: string;
  archived_at: string | null;
  role: "owner" | "admin" | "editor" | "viewer";
  members_count: number;
  sources_count: number;
  last_accessed_at: string | null;
  is_favourite: boolean;
  member_emails: string[];
  member_profiles: Array<{
    user_id: string;
    email: string;
    display_name: string;
    avatar_mode: "preset";
    avatar_key: string;
    avatar_color: string;
  }>;
}

interface Source {
  id: string;
  hub_id: string;
  type: "file" | "web" | "youtube";
  original_name: string;
  storage_path?: string | null;
  status: "queued" | "processing" | "failed" | "complete";
  failure_reason?: string | null;
  ingestion_metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface MockApiState {
  hubs: Hub[];
  sourcesByHub: Record<string, Source[]>;
  sessionsByHub: Record<string, Array<{ id: string; hub_id: string; title: string; scope: "hub" | "global"; source_ids: string[]; created_at: string; last_message_at: string }>>;
  uploadedSourceIds: Set<string>;
}

function nowIso() {
  return "2026-04-10T12:00:00Z";
}

export function createMockApiState(overrides?: Partial<MockApiState>): MockApiState {
  return {
    hubs: overrides?.hubs ?? [
      {
        id: "hub-1",
        owner_id: "e2e-user-1",
        name: "Launch Hub",
        description: "Mocked hub used by Playwright.",
        icon_key: "rocket",
        color_key: "blue",
        created_at: nowIso(),
        archived_at: null,
        role: "owner",
        members_count: 1,
        sources_count: 1,
        last_accessed_at: nowIso(),
        is_favourite: false,
        member_emails: [TEST_EMAIL],
        member_profiles: [
          {
            user_id: "e2e-user-1",
            email: TEST_EMAIL,
            display_name: "E2E User",
            avatar_mode: "preset",
            avatar_key: "glass-01",
            avatar_color: "blue",
          },
        ],
      },
    ],
    sourcesByHub: overrides?.sourcesByHub ?? {
      "hub-1": [
        {
          id: "src-seeded-1",
          hub_id: "hub-1",
          type: "file",
          original_name: "Module Handbook.pdf",
          storage_path: "hub-1/src-seeded-1/module-handbook.pdf",
          status: "complete",
          ingestion_metadata: null,
          created_at: nowIso(),
        },
      ],
    },
    sessionsByHub: overrides?.sessionsByHub ?? { "hub-1": [] },
    uploadedSourceIds: overrides?.uploadedSourceIds ?? new Set<string>(),
  };
}

function jsonResponse(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function emptyResponse(route: Route, status = 204) {
  return route.fulfill({ status, body: "" });
}

function findSource(state: MockApiState, sourceId: string) {
  for (const sources of Object.values(state.sourcesByHub)) {
    const source = sources.find((entry) => entry.id === sourceId);
    if (source) {
      return source;
    }
  }
  return null;
}

export async function installMockApi(page: Page, state: MockApiState) {
  await page.addInitScript(
    ({ email, password }) => {
      window.__caddieE2EAuth = { email, password };
    },
    { email: TEST_EMAIL, password: TEST_PASSWORD },
  );

  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    if (!request.headers()["authorization"] && path !== "/health") {
      return jsonResponse(route, { detail: "Missing Authorization header." }, 401);
    }

    if (method === "GET" && path === "/hubs") {
      return jsonResponse(route, state.hubs);
    }

    if (method === "POST" && /^\/hubs\/[^/]+\/access$/.test(path)) {
      return emptyResponse(route);
    }

    if (method === "GET" && /^\/sources\/[^/]+$/.test(path)) {
      const hubId = path.split("/")[2];
      return jsonResponse(route, state.sourcesByHub[hubId] ?? []);
    }

    if (method === "POST" && path === "/sources") {
      const body = JSON.parse(request.postData() ?? "{}") as { hub_id: string; original_name: string };
      const nextId = `src-upload-${state.uploadedSourceIds.size + 1}`;
      const source: Source = {
        id: nextId,
        hub_id: body.hub_id,
        type: "file",
        original_name: body.original_name,
        storage_path: `${body.hub_id}/${nextId}/${body.original_name}`,
        status: "queued",
        ingestion_metadata: null,
        created_at: nowIso(),
      };
      state.sourcesByHub[body.hub_id] = [source, ...(state.sourcesByHub[body.hub_id] ?? [])];
      return jsonResponse(route, {
        source,
        upload_url: `https://upload.test/${nextId}`,
      }, 201);
    }

    if (method === "POST" && /^\/sources\/[^/]+\/enqueue$/.test(path)) {
      const sourceId = path.split("/")[2];
      const source = findSource(state, sourceId);
      if (!source) {
        return jsonResponse(route, { detail: "Source not found" }, 404);
      }
      source.status = "complete";
      state.uploadedSourceIds.add(sourceId);
      return jsonResponse(route, { status: "queued" });
    }

    if (method === "POST" && /^\/sources\/[^/]+\/refresh$/.test(path)) {
      return jsonResponse(route, { status: "queued" });
    }

    if (method === "GET" && path === "/invites") {
      return jsonResponse(route, []);
    }

    if (method === "GET" && path === "/invites/notifications") {
      return jsonResponse(route, []);
    }

    if (method === "GET" && path === "/reminders/notifications") {
      return jsonResponse(route, []);
    }

    if (method === "GET" && path === "/reminders") {
      return jsonResponse(route, []);
    }

    if (method === "GET" && path === "/activity") {
      return jsonResponse(route, []);
    }

    if (method === "GET" && path === "/chat/search") {
      return jsonResponse(route, []);
    }

    if (method === "GET" && path === "/chat/sessions") {
      const hubId = url.searchParams.get("hub_id") ?? "";
      return jsonResponse(route, state.sessionsByHub[hubId] ?? []);
    }

    if (method === "POST" && path === "/chat") {
      const body = JSON.parse(request.postData() ?? "{}") as {
        hub_id: string;
        question: string;
        scope: "hub" | "global";
        source_ids?: string[];
      };
      const citationSourceId = body.source_ids?.[0] ?? state.sourcesByHub[body.hub_id]?.[0]?.id ?? "src-seeded-1";
      const session = {
        id: "chat-session-1",
        hub_id: body.hub_id,
        title: "E2E chat session",
        scope: body.scope,
        source_ids: body.source_ids ?? [],
        created_at: nowIso(),
        last_message_at: nowIso(),
      };
      state.sessionsByHub[body.hub_id] = [session];
      return jsonResponse(route, {
        answer: `Mocked answer for: ${body.question}`,
        citations: [
          {
            source_id: citationSourceId,
            snippet: "The mocked source snippet backs this answer.",
            chunk_index: 0,
          },
        ],
        message_id: "message-1",
        session_id: session.id,
        session_title: session.title,
        active_flag_id: null,
        flag_status: "none",
        feedback_rating: null,
      });
    }

    return jsonResponse(route, { detail: `Unhandled mock API route: ${method} ${path}` }, 404);
  });

  await page.route("https://upload.test/**", async (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({ status: 200, body: "" });
    }
    return route.fallback();
  });
}

export async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email").fill(TEST_EMAIL);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
  await expect(page.getByText("Recent Hubs")).toBeVisible();
}
