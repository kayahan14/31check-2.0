import { createClient } from "@supabase/supabase-js";

const MESSAGE_LIMIT = 100;

globalThis.__activityChatStore ||= { scopes: {} };
let supabaseClient;

export async function listScopeChannels(scopeKey) {
  if (hasSupabaseConfig()) {
    try {
      return await listSupabaseChannels(scopeKey);
    } catch (error) {
      console.warn("Supabase read failed, falling back to ephemeral store.", error);
      return cloneChannels(globalThis.__activityChatStore.scopes?.[scopeKey]?.channels || {});
    }
  }

  return cloneChannels(globalThis.__activityChatStore.scopes?.[scopeKey]?.channels || {});
}

export async function appendMessage(scopeKey, channelId, message) {
  const normalizedMessage = normalizeMessage(message);

  if (hasSupabaseConfig()) {
    try {
      await appendSupabaseMessage(scopeKey, channelId, normalizedMessage);
      return normalizedMessage;
    } catch (error) {
      console.warn("Supabase write failed, falling back to ephemeral store.", error);
      appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
      return normalizedMessage;
    }
  }

  appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
  return normalizedMessage;
}

async function listSupabaseChannels(scopeKey) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("messages")
    .select([
      "id",
      "scope_key",
      "channel_id",
      "author_name",
      "avatar_label",
      "avatar_url",
      "content",
      "message_type",
      "created_at",
      "created_at_ms",
      "server_created_at",
      "server_created_at_ms"
    ].join(","))
    .eq("scope_key", scopeKey)
    .order("server_created_at_ms", { ascending: false })
    .limit(MESSAGE_LIMIT);

  if (error) {
    throw error;
  }

  const channels = {};
  for (const row of [...(data || [])].reverse()) {
    const message = mapRowToMessage(row);
    channels[message.channelId] ||= [];
    channels[message.channelId].push(message);
  }

  return normalizeChannels(channels);
}

async function appendSupabaseMessage(scopeKey, channelId, message) {
  const client = getSupabaseClient();
  const insertPayload = {
    id: message.id,
    scope_key: scopeKey,
    channel_id: channelId,
    author_name: message.author,
    avatar_label: message.avatar,
    avatar_url: message.avatarUrl,
    content: message.content,
    message_type: message.type,
    created_at: message.createdAt,
    created_at_ms: message.createdAtMs,
    server_created_at: message.serverCreatedAt,
    server_created_at_ms: message.serverCreatedAtMs
  };

  const { error } = await client
    .from("messages")
    .insert(insertPayload);

  if (error) {
    throw error;
  }

  const { data: overflowRows, error: overflowError } = await client
    .from("messages")
    .select("id")
    .eq("scope_key", scopeKey)
    .eq("channel_id", channelId)
    .order("server_created_at_ms", { ascending: false })
    .range(MESSAGE_LIMIT, MESSAGE_LIMIT + 999);

  if (overflowError) {
    throw overflowError;
  }

  const idsToDelete = (overflowRows || []).map((row) => row.id).filter(Boolean);
  if (!idsToDelete.length) {
    return;
  }

  const { error: deleteError } = await client
    .from("messages")
    .delete()
    .in("id", idsToDelete);

  if (deleteError) {
    throw deleteError;
  }
}

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  return supabaseClient;
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function appendEphemeralMessage(scopeKey, channelId, message) {
  globalThis.__activityChatStore.scopes ||= {};
  globalThis.__activityChatStore.scopes[scopeKey] ||= { channels: {} };
  globalThis.__activityChatStore.scopes[scopeKey].channels[channelId] ||= [];
  globalThis.__activityChatStore.scopes[scopeKey].channels[channelId].push(message);
  globalThis.__activityChatStore.scopes[scopeKey].channels[channelId] = sortMessages(
    globalThis.__activityChatStore.scopes[scopeKey].channels[channelId]
  ).slice(-MESSAGE_LIMIT);
}

function mapRowToMessage(row) {
  return normalizeMessage({
    id: row.id,
    channelId: row.channel_id,
    author: row.author_name,
    avatar: row.avatar_label,
    avatarUrl: row.avatar_url,
    content: row.content,
    type: row.message_type,
    createdAt: row.created_at,
    createdAtMs: row.created_at_ms,
    serverCreatedAt: row.server_created_at,
    serverCreatedAtMs: row.server_created_at_ms
  });
}

function normalizeChannels(channels) {
  const normalized = {};
  for (const [channelId, messages] of Object.entries(channels || {})) {
    normalized[channelId] = sortMessages(Array.isArray(messages) ? messages : []).slice(-MESSAGE_LIMIT);
  }
  return normalized;
}

function sortMessages(messages) {
  return [...messages].sort((left, right) => {
    const timeDiff = normalizeServerCreatedAtMs(left) - normalizeServerCreatedAtMs(right);
    if (timeDiff !== 0) return timeDiff;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function normalizeMessage(message) {
  const createdAtMs = normalizeCreatedAtMs(message);
  const serverCreatedAtMs = normalizeServerCreatedAtMs(message, createdAtMs);

  return {
    ...message,
    createdAt: message?.createdAt || new Date(createdAtMs).toISOString(),
    createdAtMs,
    serverCreatedAt: message?.serverCreatedAt || new Date(serverCreatedAtMs).toISOString(),
    serverCreatedAtMs,
    time: message?.time || new Date(serverCreatedAtMs).toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

function normalizeCreatedAtMs(message) {
  const numeric = Number(message?.createdAtMs);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(String(message?.createdAt || ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return Date.now();
}

function normalizeServerCreatedAtMs(message, fallback = Date.now()) {
  const numeric = Number(message?.serverCreatedAtMs);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const parsed = Date.parse(String(message?.serverCreatedAt || ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function cloneChannels(channels) {
  return normalizeChannels(JSON.parse(JSON.stringify(channels || {})));
}
