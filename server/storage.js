import { hasDatabaseConfig, runQuery } from "./db.js";

const MESSAGE_LIMIT = 50;

globalThis.__activityChatStore ||= { scopes: {} };

export async function listScopeChannels(scopeKey, options = {}) {
  return listScopeChannelsFiltered(scopeKey, options);
}

export async function listScopeMessages(scopeKey, options = {}) {
  if (hasDatabaseConfig()) {
    try {
      return await listDatabaseMessages(scopeKey, options);
    } catch (error) {
      console.warn("Database read failed, falling back to ephemeral store.", error);
      return listEphemeralMessages(scopeKey, options);
    }
  }

  return listEphemeralMessages(scopeKey, options);
}

async function listScopeChannelsFiltered(scopeKey, options = {}) {
  const messages = await listScopeMessages(scopeKey, options);
  const channels = {};
  for (const message of messages) {
    channels[message.channelId] ||= [];
    channels[message.channelId].push(message);
  }
  return normalizeChannels(channels);
}

export async function appendMessage(scopeKey, channelId, message) {
  const normalizedMessage = normalizeMessage({
    ...message,
    channelId: channelId || message?.channelId || ""
  });

  if (hasDatabaseConfig()) {
    try {
      await appendDatabaseMessage(scopeKey, channelId, normalizedMessage);
      return normalizedMessage;
    } catch (error) {
      console.warn("Database write failed, falling back to ephemeral store.", error);
      appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
      return normalizedMessage;
    }
  }

  appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
  return normalizedMessage;
}

export async function updateMessage(scopeKey, messageId, nextMessage) {
  const normalizedMessage = normalizeMessage(nextMessage);

  if (hasDatabaseConfig()) {
    try {
      const { rows } = await runQuery(`
        update messages
        set author_name = $3,
            avatar_label = $4,
            avatar_url = $5,
            content = $6,
            message_type = $7,
            created_at = $8,
            created_at_ms = $9,
            server_created_at = $10,
            server_created_at_ms = $11
        where scope_key = $1 and id = $2
        returning id,
                  scope_key,
                  channel_id,
                  author_name,
                  avatar_label,
                  avatar_url,
                  content,
                  message_type,
                  created_at,
                  created_at_ms,
                  server_created_at,
                  server_created_at_ms
      `, [
        scopeKey,
        messageId,
        normalizedMessage.author,
        normalizedMessage.avatar,
        normalizedMessage.avatarUrl,
        serializeContent(normalizedMessage.content),
        normalizedMessage.type,
        normalizedMessage.createdAt,
        normalizedMessage.createdAtMs,
        normalizedMessage.serverCreatedAt,
        normalizedMessage.serverCreatedAtMs
      ]);

      if (rows[0]) {
        return mapRowToMessage(rows[0]);
      }

      await appendDatabaseMessage(scopeKey, normalizedMessage.channelId, normalizedMessage);
      return normalizedMessage;
    } catch (error) {
      console.warn("Database update failed, falling back to ephemeral store.", error);
      return updateEphemeralMessage(scopeKey, messageId, normalizedMessage);
    }
  }

  return updateEphemeralMessage(scopeKey, messageId, normalizedMessage);
}

async function listDatabaseMessages(scopeKey, options = {}) {
  const {
    channelId = "",
    messageTypes = [],
    excludeTypes = [],
    limit = MESSAGE_LIMIT
  } = options;
  const params = [scopeKey];
  const clauses = ["scope_key = $1"];

  if (channelId) {
    params.push(channelId);
    clauses.push(`channel_id = $${params.length}`);
  }

  if (Array.isArray(messageTypes) && messageTypes.length) {
    params.push(messageTypes);
    clauses.push(`message_type = any($${params.length}::text[])`);
  }

  if (Array.isArray(excludeTypes) && excludeTypes.length) {
    params.push(excludeTypes);
    clauses.push(`not (message_type = any($${params.length}::text[]))`);
  }

  params.push(Math.max(1, Number(limit) || MESSAGE_LIMIT));
  const { rows } = await runQuery(`
    select id,
           scope_key,
           channel_id,
           author_name,
           avatar_label,
           avatar_url,
           content,
           message_type,
           created_at,
           created_at_ms,
           server_created_at,
           server_created_at_ms
    from messages
    where ${clauses.join(" and ")}
    order by server_created_at_ms desc, id desc
    limit $${params.length}
  `, params);

  return [...rows].reverse().map((row) => mapRowToMessage(row));
}

async function appendDatabaseMessage(scopeKey, channelId, message) {
  await runQuery(`
    insert into messages (
      id,
      scope_key,
      channel_id,
      author_name,
      avatar_label,
      avatar_url,
      content,
      message_type,
      created_at,
      created_at_ms,
      server_created_at,
      server_created_at_ms
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
    )
    on conflict (id) do update set
      scope_key = excluded.scope_key,
      channel_id = excluded.channel_id,
      author_name = excluded.author_name,
      avatar_label = excluded.avatar_label,
      avatar_url = excluded.avatar_url,
      content = excluded.content,
      message_type = excluded.message_type,
      created_at = excluded.created_at,
      created_at_ms = excluded.created_at_ms,
      server_created_at = excluded.server_created_at,
      server_created_at_ms = excluded.server_created_at_ms
  `, [
    message.id,
    scopeKey,
    channelId,
    message.author,
    message.avatar,
    message.avatarUrl,
    serializeContent(message.content),
    message.type,
    message.createdAt,
    message.createdAtMs,
    message.serverCreatedAt,
    message.serverCreatedAtMs
  ]);

  await runQuery(`
    delete from messages
    where id in (
      select id
      from messages
      where scope_key = $1 and channel_id = $2
      order by server_created_at_ms desc, id desc
      offset $3
    )
  `, [scopeKey, channelId, MESSAGE_LIMIT]);
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

function listEphemeralMessages(scopeKey, options = {}) {
  const {
    channelId = "",
    messageTypes = [],
    excludeTypes = [],
    limit = MESSAGE_LIMIT
  } = options;
  const channels = cloneChannels(globalThis.__activityChatStore.scopes?.[scopeKey]?.channels || {});
  const flattened = Object.entries(channels)
    .filter(([currentChannelId]) => !channelId || currentChannelId === channelId)
    .flatMap(([, messages]) => messages || [])
    .filter((message) => !messageTypes.length || messageTypes.includes(message.type))
    .filter((message) => !excludeTypes.length || !excludeTypes.includes(message.type))
    .sort((left, right) => normalizeServerCreatedAtMs(left) - normalizeServerCreatedAtMs(right));

  return flattened.slice(-Math.max(1, Number(limit) || MESSAGE_LIMIT));
}

function updateEphemeralMessage(scopeKey, messageId, nextMessage) {
  const channels = globalThis.__activityChatStore.scopes?.[scopeKey]?.channels || {};
  for (const [channelId, messages] of Object.entries(channels)) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index === -1) continue;
    const merged = { ...messages[index], ...nextMessage, channelId };
    channels[channelId][index] = normalizeMessage(merged);
    channels[channelId] = sortMessages(channels[channelId]).slice(-MESSAGE_LIMIT);
    return channels[channelId][index];
  }

  appendEphemeralMessage(scopeKey, nextMessage.channelId, nextMessage);
  return nextMessage;
}

function mapRowToMessage(row) {
  return normalizeMessage({
    id: row.id,
    channelId: row.channel_id,
    author: row.author_name,
    avatar: row.avatar_label,
    avatarUrl: row.avatar_url,
    content: deserializeContent(row.content, row.message_type),
    type: row.message_type,
    createdAt: normalizeTimestamp(row.created_at, row.created_at_ms),
    createdAtMs: Number(row.created_at_ms || 0),
    serverCreatedAt: normalizeTimestamp(row.server_created_at, row.server_created_at_ms),
    serverCreatedAtMs: Number(row.server_created_at_ms || 0)
  });
}

function normalizeTimestamp(value, fallbackMs = Date.now()) {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  const numeric = Number(fallbackMs || Date.now());
  return new Date(numeric).toISOString();
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
    content: normalizeContent(message.content),
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

function serializeContent(content) {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content ?? null);
}

function deserializeContent(content, type) {
  if (typeof content !== "string") {
    return content;
  }

  const normalizedType = String(type || "");
  if (!shouldParseStructuredContent(normalizedType, content)) {
    return content;
  }

  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }

  return content ?? "";
}

function shouldParseStructuredContent(type, content) {
  if (!type || type === "text") {
    return false;
  }

  if (
    type.startsWith("blackjack")
    || type.startsWith("mines")
    || type.startsWith("dragon")
    || type.startsWith("mining")
    || type.endsWith("_session")
    || type.endsWith("_profile")
  ) {
    return true;
  }

  const trimmed = String(content || "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}
