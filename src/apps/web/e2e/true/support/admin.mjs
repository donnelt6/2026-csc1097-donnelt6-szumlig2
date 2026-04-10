import { createClient } from "@supabase/supabase-js";
import {
  clearTrueE2EState,
  getTrueE2ERunId,
  readTrueE2EState,
  writeTrueE2EState,
} from "./state.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback) {
  return process.env[name] || fallback;
}

async function runQuery(promise) {
  const { error } = await promise;
  if (error) {
    throw error;
  }
}

function buildRunNamespace() {
  return getTrueE2ERunId();
}

function buildHubName(namespace) {
  return `Caddie True E2E ${namespace}`;
}

function buildFixtureName(namespace) {
  return `true-e2e-${namespace}.txt`;
}

export function getTrueE2EConfig() {
  const namespace = buildRunNamespace();
  return {
    namespace,
    hubName: buildHubName(namespace),
    fixtureFileName: buildFixtureName(namespace),
    email: optionalEnv("CADDIE_TRUE_E2E_EMAIL", "caddie.true.e2e@example.com"),
    password: requiredEnv("CADDIE_TRUE_E2E_PASSWORD"),
    question: optionalEnv(
      "CADDIE_TRUE_E2E_QUESTION",
      "What are the key rollout facts in this source?"
    ),
  };
}

export function createAdminClient() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function findUserByEmail(client, email) {
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw error;
    }
    const users = data?.users || [];
    const matched = users.find(
      (user) => String(user.email || "").toLowerCase() === email.toLowerCase()
    );
    if (matched) {
      return matched;
    }
    if (users.length < 200) {
      return null;
    }
    page += 1;
  }
}

async function ensureUser(client, config) {
  const existing = await findUserByEmail(client, config.email);
  if (existing) {
    return existing;
  }
  const { data, error } = await client.auth.admin.createUser({
    email: config.email,
    password: config.password,
    email_confirm: true,
    user_metadata: {
      full_name: "True E2E User",
      avatar_mode: "preset",
      avatar_key: "glass-01",
      avatar_color: "blue",
    },
  });
  if (error) {
    throw error;
  }
  if (!data.user) {
    throw new Error("Supabase did not return a user for the true E2E account.");
  }
  return data.user;
}

async function ensureHub(client, ownerId, hubName) {
  const { data: hubs, error: hubLookupError } = await client
    .from("hubs")
    .select("id,name")
    .eq("owner_id", ownerId)
    .eq("name", hubName)
    .limit(1);
  if (hubLookupError) {
    throw hubLookupError;
  }
  if (hubs?.length) {
    return hubs[0];
  }

  const { data, error } = await client.rpc("create_hub_with_owner_membership", {
    p_owner_id: ownerId,
    p_name: hubName,
    p_description: "Dedicated real end-to-end test hub.",
    p_icon_key: "stack",
    p_color_key: "slate",
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) {
    throw new Error("Failed to create true E2E hub.");
  }
  return row;
}

async function listStoragePaths(client, bucket, prefix) {
  const pending = [prefix];
  const paths = [];

  while (pending.length > 0) {
    const current = pending.pop();
    const { data, error } = await client.storage.from(bucket).list(current, {
      limit: 100,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      throw error;
    }
    for (const entry of data || []) {
      if (!entry.name) {
        continue;
      }
      const nestedPath = current ? `${current}/${entry.name}` : entry.name;
      if (!entry.metadata) {
        pending.push(nestedPath);
        continue;
      }
      paths.push(nestedPath);
    }
  }

  return paths;
}

async function deleteInChunks(queryBuilderFactory, ids, chunkSize = 100) {
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    if (chunk.length === 0) {
      continue;
    }
    const { error } = await queryBuilderFactory(chunk);
    if (error) {
      throw error;
    }
  }
}

export async function cleanupHubData(client, hubId) {
  const { data: sessions, error: sessionsError } = await client
    .from("chat_sessions")
    .select("id")
    .eq("hub_id", hubId);
  if (sessionsError) {
    throw sessionsError;
  }
  const sessionIds = (sessions || []).map((row) => row.id);

  let messageIds = [];
  if (sessionIds.length > 0) {
    const { data: messages, error: messagesError } = await client
      .from("messages")
      .select("id")
      .in("session_id", sessionIds);
    if (messagesError) {
      throw messagesError;
    }
    messageIds = (messages || []).map((row) => row.id);
  }

  const { data: sources, error: sourcesError } = await client
    .from("sources")
    .select("id,storage_path")
    .eq("hub_id", hubId);
  if (sourcesError) {
    throw sourcesError;
  }
  const sourceIds = (sources || []).map((row) => row.id);

  if (messageIds.length > 0) {
    await deleteInChunks(
      (chunk) => client.from("citation_feedback").delete().in("message_id", chunk),
      messageIds
    );
    await deleteInChunks(
      (chunk) => client.from("chat_feedback").delete().in("message_id", chunk),
      messageIds
    );
  }

  if (sessionIds.length > 0) {
    await deleteInChunks(
      (chunk) => client.from("messages").delete().in("session_id", chunk),
      sessionIds
    );
  }

  await runQuery(client.from("chat_events").delete().eq("hub_id", hubId));
  await runQuery(client.from("activity_events").delete().eq("hub_id", hubId));
  await runQuery(client.from("source_suggestions").delete().eq("hub_id", hubId));

  if (sourceIds.length > 0) {
    await deleteInChunks(
      (chunk) => client.from("source_chunks").delete().in("source_id", chunk),
      sourceIds
    );
    await deleteInChunks(
      (chunk) => client.from("sources").delete().in("id", chunk),
      sourceIds
    );
  }

  if (sessionIds.length > 0) {
    await deleteInChunks(
      (chunk) => client.from("chat_sessions").delete().in("id", chunk),
      sessionIds
    );
  }

  const bucket = requiredEnv("SUPABASE_STORAGE_BUCKET");
  const storagePaths = await listStoragePaths(client, bucket, hubId);
  if (storagePaths.length > 0) {
    await deleteInChunks(
      (chunk) => client.storage.from(bucket).remove(chunk),
      storagePaths,
      50
    );
  }
}

export async function setupTrueE2E() {
  const client = createAdminClient();
  const config = getTrueE2EConfig();
  const user = await ensureUser(client, config);
  const hub = await ensureHub(client, user.id, config.hubName);
  await cleanupHubData(client, hub.id);

  const state = {
    ...config,
    hubId: hub.id,
    userId: user.id,
  };
  writeTrueE2EState(state);
  return state;
}

export async function cleanupTrueE2E() {
  const client = createAdminClient();
  const state = readTrueE2EState();
  await cleanupHubData(client, state.hubId);
  await runQuery(client.from("hub_members").delete().eq("hub_id", state.hubId));
  await runQuery(client.from("hubs").delete().eq("id", state.hubId));
  clearTrueE2EState();
}
