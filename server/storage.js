// ── Chat Message Storage (PostgreSQL with in-memory fallback) ────────
import { query, getPool } from "./db.js";

const MESSAGE_LIMIT = 50;

// Fallback in-memory store for when DATABASE_URL is not configured
globalThis.__activityChatStore ||= { scopes: {} };

export async function listScopeChannels(scopeKey, options = {}) {
  const messages = await listScopeMessages(scopeKey, options);
  const channels = {};
  for (const message of messages) {
    channels[message.channelId] ||= [];
    channels[message.channelId].push(message);
  }
  return normalizeChannels(channels);
}

export async function listScopeMessages(scopeKey, options = {}) {
  if (getPool()) {
    return listDbMessages(scopeKey, options);
  }
  return listEphemeralMessages(scopeKey, options);
}

export async function appendMessage(scopeKey, channelId, message) {
  const normalizedMessage = normalizeMessage({
    ...message,
    channelId: channelId || message?.channelId || ""
  });

  if (getPool()) {
    await insertDbMessage(scopeKey, channelId, normalizedMessage);
  } else {
    appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
  }
  return normalizedMessage;
}

export async function updateMessage(scopeKey, messageId, nextMessage) {
  const normalizedMessage = normalizeMessage(nextMessage);

  if (getPool()) {
    return updateDbMessage(scopeKey, messageId, normalizedMessage);
  }
  return updateEphemeralMessage(scopeKey, messageId, normalizedMessage);
}

// ── PostgreSQL implementations ──────────────────────────────────────

async function listDbMessages(scopeKey, options = {}) {
  const {
    channelId = "",
    messageTypes = [],
    excludeTypes = [],
    limit = MESSAGE_LIMIT
  } = options;

  let sql = `SELECT * FROM messages WHERE scope_key = $1`;
  const params = [scopeKey];
  let paramIndex = 2;

  if (channelId) {
    sql += ` AND channel_id = $${paramIndex++}`;
    params.push(channelId);
  }
  if (messageTypes.length) {
    sql += ` AND message_type = ANY($${paramIndex++})`;
    params.push(messageTypes);
  }
  if (excludeTypes.length) {
    sql += ` AND message_type != ALL($${paramIndex++})`;
    params.push(excludeTypes);
  }

  sql += ` ORDER BY server_created_at_ms DESC LIMIT $${paramIndex}`;
  params.push(Math.max(1, Number(limit) || MESSAGE_LIMIT));

  const { rows } = await query(sql, params);

  // Map DB rows to message objects and reverse for chronological order
  return rows.map(rowToMessage).reverse();
}

async function insertDbMessage(scopeKey, channelId, message) {
  const sql = `
    INSERT INTO messages (id, scope_key, channel_id, author_name, avatar_label, avatar_url,
                          content, message_type, created_at, created_at_ms,
                          server_created_at, server_created_at_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO NOTHING
  `;
  const content = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content ?? "");

  await query(sql, [
    message.id,
    scopeKey,
    channelId,
    message.author || "",
    message.avatar || "",
    message.avatarUrl || "",
    content,
    message.type || "text",
    message.createdAt || new Date().toISOString(),
    message.createdAtMs || Date.now(),
    message.serverCreatedAt || new Date().toISOString(),
    message.serverCreatedAtMs || Date.now()
  ]);
}

async function updateDbMessage(scopeKey, messageId, nextMessage) {
  const content = typeof nextMessage.content === "string"
    ? nextMessage.content
    : JSON.stringify(nextMessage.content ?? "");

  const { rows } = await query(
    `UPDATE messages SET content = $1, message_type = $2
     WHERE scope_key = $3 AND id = $4
     RETURNING *`,
    [content, nextMessage.type || "text", scopeKey, messageId]
  );

  if (rows.length) {
    return rowToMessage(rows[0]);
  }

  // If not found, insert
  const channelId = nextMessage.channelId || "";
  await insertDbMessage(scopeKey, channelId, { ...nextMessage, id: messageId });
  return normalizeMessage(nextMessage);
}

function rowToMessage(row) {
  let content = row.content;
  // Try to parse JSON content (for blackjack/game messages)
  if (row.message_type !== "text") {
    try { content = JSON.parse(content); } catch { /* keep as string */ }
  }

  return {
    id: row.id,
    channelId: row.channel_id,
    author: row.author_name,
    avatar: row.avatar_label,
    avatarUrl: row.avatar_url,
    content,
    type: row.message_type,
    createdAt: row.created_at?.toISOString?.() || String(row.created_at),
    createdAtMs: Number(row.created_at_ms),
    serverCreatedAt: row.server_created_at?.toISOString?.() || String(row.server_created_at),
    serverCreatedAtMs: Number(row.server_created_at_ms),
    time: new Date(Number(row.server_created_at_ms)).toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

// ── In-memory fallback implementations ──────────────────────────────

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

// ── Shared helpers ──────────────────────────────────────────────────

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
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(message?.createdAt || ""));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Date.now();
}

function normalizeServerCreatedAtMs(message, fallback = Date.now()) {
  const numeric = Number(message?.serverCreatedAtMs);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(message?.serverCreatedAt || ""));
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

function cloneChannels(channels) {
  return normalizeChannels(JSON.parse(JSON.stringify(channels || {})));
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  return content ?? "";
}
