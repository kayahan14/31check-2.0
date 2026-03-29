// ── Mining Session & Profile Storage (PostgreSQL with in-memory fallback) ──
import { query, getPool } from "./db.js";

const MINING_CHANNEL_ID = "casino:mining";
const SESSION_TYPE = "mining_session";
const PROFILE_TYPE = "mining_profile";

// Fallback in-memory store
globalThis.__miningRecordFallbackStore ||= { sessions: {}, profiles: {} };

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

// ── Session ─────────────────────────────────────────────────────────

export async function getMiningSessionRecord(scopeKey) {
  if (getPool()) {
    const { rows } = await query(
      `SELECT record FROM mining_sessions WHERE scope_key = $1`,
      [String(scopeKey || "")]
    );
    if (rows.length && rows[0].record) {
      return normalizeStoredRecord(rows[0].record);
    }
    return null;
  }
  return globalThis.__miningRecordFallbackStore.sessions[String(scopeKey || "")] || null;
}

export async function saveMiningSessionRecord(scopeKey, sessionRecord) {
  const normalized = normalizeStoredRecord({
    ...sessionRecord,
    id: sessionRecord?.id || `mining-session:${scopeKey}`,
    channelId: MINING_CHANNEL_ID,
    type: SESSION_TYPE
  });

  if (getPool()) {
    await query(
      `INSERT INTO mining_sessions (scope_key, record, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (scope_key)
       DO UPDATE SET record = $2, updated_at = NOW()`,
      [String(scopeKey || ""), JSON.stringify(normalized)]
    );
  } else {
    globalThis.__miningRecordFallbackStore.sessions[String(scopeKey || "")] = normalized;
  }
  return normalized;
}

// ── Profile ─────────────────────────────────────────────────────────

export async function getMiningProfileRecord(scopeKey, userId) {
  if (getPool()) {
    const { rows } = await query(
      `SELECT record FROM mining_profiles WHERE scope_key = $1 AND user_id = $2`,
      [String(scopeKey || ""), String(userId || "")]
    );
    if (rows.length && rows[0].record) {
      return normalizeStoredRecord(rows[0].record);
    }
    return null;
  }
  return globalThis.__miningRecordFallbackStore.profiles[`${scopeKey}:${userId}`] || null;
}

export async function saveMiningProfileRecord(scopeKey, userId, profileRecord) {
  const normalized = normalizeStoredRecord({
    ...profileRecord,
    id: profileRecord?.id || `mining-profile:${scopeKey}:${userId}`,
    channelId: MINING_CHANNEL_ID,
    type: PROFILE_TYPE
  });

  if (getPool()) {
    await query(
      `INSERT INTO mining_profiles (scope_key, user_id, record, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (scope_key, user_id)
       DO UPDATE SET record = $3, updated_at = NOW()`,
      [String(scopeKey || ""), String(userId || ""), JSON.stringify(normalized)]
    );
  } else {
    globalThis.__miningRecordFallbackStore.profiles[`${scopeKey}:${userId}`] = normalized;
  }
  return normalized;
}
