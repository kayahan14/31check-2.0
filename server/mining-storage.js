import { hasDatabaseConfig, runQuery } from "./db.js";

const MINING_CHANNEL_ID = "casino:mining";
const SESSION_TYPE = "mining_session";
const PROFILE_TYPE = "mining_profile";

globalThis.__miningRecordFallbackStore ||= { sessions: {}, profiles: {} };

function isMissingRelationError(error) {
  return String(error?.code || "") === "42P01";
}

function normalizeStoredRecord(record) {
  if (!record) return null;
  return {
    ...record,
    channelId: record.channelId || MINING_CHANNEL_ID,
    createdAt: record.createdAt || new Date(Number(record.createdAtMs || Date.now())).toISOString(),
    createdAtMs: Number(record.createdAtMs || Date.now()),
    serverCreatedAt: record.serverCreatedAt || new Date(Number(record.serverCreatedAtMs || record.createdAtMs || Date.now())).toISOString(),
    serverCreatedAtMs: Number(record.serverCreatedAtMs || record.createdAtMs || Date.now())
  };
}

function sessionRecordId(scopeKey) {
  return `mining-session:${scopeKey}`;
}

function profileRecordId(scopeKey, userId) {
  return `mining-profile:${scopeKey}:${userId}`;
}

function fallbackSession(scopeKey) {
  return globalThis.__miningRecordFallbackStore.sessions[String(scopeKey || "")] || null;
}

function fallbackProfile(scopeKey, userId) {
  return globalThis.__miningRecordFallbackStore.profiles[`${scopeKey}:${userId}`] || null;
}

function saveFallbackSession(scopeKey, record) {
  globalThis.__miningRecordFallbackStore.sessions[String(scopeKey || "")] = record;
}

function saveFallbackProfile(scopeKey, userId, record) {
  globalThis.__miningRecordFallbackStore.profiles[`${scopeKey}:${userId}`] = record;
}

async function getMiningTableSessionRecord(scopeKey) {
  if (!hasDatabaseConfig()) return null;
  try {
    const { rows } = await runQuery(`
      select record
      from mining_sessions
      where scope_key = $1
      limit 1
    `, [scopeKey]);
    return normalizeStoredRecord(rows[0]?.record || null);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function upsertMiningTableSessionRecord(scopeKey, record) {
  if (!hasDatabaseConfig()) return normalizeStoredRecord(record);
  try {
    const normalized = normalizeStoredRecord(record);
    const { rows } = await runQuery(`
      insert into mining_sessions (scope_key, record, updated_at)
      values ($1, $2::jsonb, timezone('utc', now()))
      on conflict (scope_key) do update
      set record = excluded.record,
          updated_at = timezone('utc', now())
      returning record
    `, [scopeKey, JSON.stringify(normalized)]);
    return normalizeStoredRecord(rows[0]?.record || normalized);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function getMiningTableProfileRecord(scopeKey, userId) {
  if (!hasDatabaseConfig()) return null;
  try {
    const { rows } = await runQuery(`
      select record
      from mining_profiles
      where scope_key = $1 and user_id = $2
      limit 1
    `, [scopeKey, String(userId || "")]);
    return normalizeStoredRecord(rows[0]?.record || null);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function upsertMiningTableProfileRecord(scopeKey, userId, record) {
  if (!hasDatabaseConfig()) return normalizeStoredRecord(record);
  try {
    const normalized = normalizeStoredRecord(record);
    const { rows } = await runQuery(`
      insert into mining_profiles (scope_key, user_id, record, updated_at)
      values ($1, $2, $3::jsonb, timezone('utc', now()))
      on conflict (scope_key, user_id) do update
      set record = excluded.record,
          updated_at = timezone('utc', now())
      returning record
    `, [scopeKey, String(userId || ""), JSON.stringify(normalized)]);
    return normalizeStoredRecord(rows[0]?.record || normalized);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function getMessageRecord(id) {
  if (!hasDatabaseConfig()) return null;
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
    where id = $1
    limit 1
  `, [id]);

  const row = rows[0];
  if (!row) return null;
  return normalizeStoredRecord({
    id: row.id,
    channelId: row.channel_id,
    author: row.author_name,
    avatar: row.avatar_label,
    avatarUrl: row.avatar_url,
    content: typeof row.content === "string" ? safeJsonParse(row.content) : row.content,
    type: row.message_type,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    createdAtMs: row.created_at_ms,
    serverCreatedAt: row.server_created_at instanceof Date ? row.server_created_at.toISOString() : row.server_created_at,
    serverCreatedAtMs: row.server_created_at_ms
  });
}

async function upsertMessageRecord(scopeKey, record) {
  if (!hasDatabaseConfig()) return normalizeStoredRecord(record);
  const normalized = normalizeStoredRecord(record);
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
    normalized.id,
    scopeKey,
    normalized.channelId,
    normalized.author,
    normalized.avatar,
    normalized.avatarUrl || "",
    JSON.stringify(normalized.content),
    normalized.type,
    normalized.createdAt,
    normalized.createdAtMs,
    normalized.serverCreatedAt,
    normalized.serverCreatedAtMs
  ]);
  return normalized;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function getMiningSessionRecord(scopeKey) {
  try {
    const tableRecord = await getMiningTableSessionRecord(scopeKey);
    if (tableRecord) return tableRecord;
    const fallback = fallbackSession(scopeKey);
    if (fallback) return fallback;
    return await getMessageRecord(sessionRecordId(scopeKey));
  } catch (error) {
    console.warn("Mining session read failed, falling back to memory.", error);
    return fallbackSession(scopeKey);
  }
}

export async function saveMiningSessionRecord(scopeKey, sessionRecord) {
  const normalized = normalizeStoredRecord({
    ...sessionRecord,
    id: sessionRecord?.id || sessionRecordId(scopeKey),
    channelId: MINING_CHANNEL_ID,
    type: SESSION_TYPE
  });

  try {
    const tableRecord = await upsertMiningTableSessionRecord(scopeKey, normalized);
    if (tableRecord) {
      saveFallbackSession(scopeKey, tableRecord);
      return tableRecord;
    }
    const stored = await upsertMessageRecord(scopeKey, normalized);
    saveFallbackSession(scopeKey, stored);
    return stored;
  } catch (error) {
    console.warn("Mining session write failed, falling back to memory.", error);
    saveFallbackSession(scopeKey, normalized);
    return normalized;
  }
}

export async function getMiningProfileRecord(scopeKey, userId) {
  try {
    const tableRecord = await getMiningTableProfileRecord(scopeKey, userId);
    if (tableRecord) return tableRecord;
    const fallback = fallbackProfile(scopeKey, userId);
    if (fallback) return fallback;
    return await getMessageRecord(profileRecordId(scopeKey, userId));
  } catch (error) {
    console.warn("Mining profile read failed, falling back to memory.", error);
    return fallbackProfile(scopeKey, userId);
  }
}

export async function saveMiningProfileRecord(scopeKey, userId, profileRecord) {
  const normalized = normalizeStoredRecord({
    ...profileRecord,
    id: profileRecord?.id || profileRecordId(scopeKey, userId),
    channelId: MINING_CHANNEL_ID,
    type: PROFILE_TYPE
  });

  try {
    const tableRecord = await upsertMiningTableProfileRecord(scopeKey, userId, normalized);
    if (tableRecord) {
      saveFallbackProfile(scopeKey, userId, tableRecord);
      return tableRecord;
    }
    const stored = await upsertMessageRecord(scopeKey, normalized);
    saveFallbackProfile(scopeKey, userId, stored);
    return stored;
  } catch (error) {
    console.warn("Mining profile write failed, falling back to memory.", error);
    saveFallbackProfile(scopeKey, userId, normalized);
    return normalized;
  }
}
