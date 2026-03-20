const MINING_CHANNEL_ID = "casino:mining";
const SESSION_TYPE = "mining_session";
const PROFILE_TYPE = "mining_profile";

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

export async function getMiningSessionRecord(scopeKey) {
  return globalThis.__miningRecordFallbackStore.sessions[String(scopeKey || "")] || null;
}

export async function saveMiningSessionRecord(scopeKey, sessionRecord) {
  const normalized = normalizeStoredRecord({
    ...sessionRecord,
    id: sessionRecord?.id || `mining-session:${scopeKey}`,
    channelId: MINING_CHANNEL_ID,
    type: SESSION_TYPE
  });
  globalThis.__miningRecordFallbackStore.sessions[String(scopeKey || "")] = normalized;
  return normalized;
}

export async function getMiningProfileRecord(scopeKey, userId) {
  return globalThis.__miningRecordFallbackStore.profiles[`${scopeKey}:${userId}`] || null;
}

export async function saveMiningProfileRecord(scopeKey, userId, profileRecord) {
  const normalized = normalizeStoredRecord({
    ...profileRecord,
    id: profileRecord?.id || `mining-profile:${scopeKey}:${userId}`,
    channelId: MINING_CHANNEL_ID,
    type: PROFILE_TYPE
  });
  globalThis.__miningRecordFallbackStore.profiles[`${scopeKey}:${userId}`] = normalized;
  return normalized;
}
