import { head, put } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";

const SESSION_PATH = "session.json";
const MINING_CHANNEL_ID = "casino:mining";
const SESSION_TYPE = "mining_session";
const PROFILE_TYPE = "mining_profile";
const MINING_SESSION_TABLE = "mining_sessions";
const MINING_PROFILE_TABLE = "mining_profiles";

globalThis.__miningBlobFallbackStore ||= { sessions: {}, profiles: {} };
let supabaseClient;

function hasBlobConfig() {
  return process.env.MINING_USE_BLOB === "1" && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
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

function miningScopeFolder(scopeKey) {
  return `mining-store/${sanitizeSegment(scopeKey)}`;
}

function sessionPath(scopeKey) {
  return `${miningScopeFolder(scopeKey)}/${SESSION_PATH}`;
}

function profilePath(scopeKey, userId) {
  return `${miningScopeFolder(scopeKey)}/profiles/${sanitizeSegment(userId)}.json`;
}

function sessionRecordId(scopeKey) {
  return `mining-session:${scopeKey}`;
}

function profileRecordId(scopeKey, userId) {
  return `mining-profile:${scopeKey}:${userId}`;
}

function sanitizeSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_");
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

async function fetchBlobJson(pathname) {
  if (!hasBlobConfig()) {
    return globalThis.__miningBlobFallbackStore.sessions[pathname]
      || globalThis.__miningBlobFallbackStore.profiles[pathname]
      || null;
  }
  try {
    const meta = await head(pathname);
    const response = await fetch(meta.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Blob fetch failed: ${response.status}`);
    }
    const payload = await response.json();
    return {
      pathname: meta.pathname,
      uploadedAt: meta.uploadedAt,
      payload
    };
  } catch (error) {
    const normalized = String(error?.message || "").toLowerCase();
    if (normalized.includes("not found") || normalized.includes("does not exist") || normalized.includes("suspended")) {
      return null;
    }
    throw error;
  }
}

async function writeBlobJson(pathname, payload) {
  if (!hasBlobConfig()) {
    const record = {
      pathname,
      uploadedAt: new Date(),
      payload
    };
    if (pathname.endsWith(SESSION_PATH)) {
      globalThis.__miningBlobFallbackStore.sessions[pathname] = record;
    } else {
      globalThis.__miningBlobFallbackStore.profiles[pathname] = record;
    }
    return true;
  }

  try {
    await put(pathname, JSON.stringify(payload), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return true;
  } catch (error) {
    const normalized = String(error?.message || "").toLowerCase();
    if (normalized.includes("suspended")) {
      return false;
    }
    throw error;
  }
}

async function getSupabaseRecord(scopeKey, id) {
  if (!hasSupabaseConfig()) return null;
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
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    channelId: data.channel_id,
    author: data.author_name,
    avatar: data.avatar_label,
    avatarUrl: data.avatar_url,
    content: typeof data.content === "string" ? JSON.parse(data.content) : data.content,
    type: data.message_type,
    createdAt: data.created_at,
    createdAtMs: data.created_at_ms,
    serverCreatedAt: data.server_created_at,
    serverCreatedAtMs: data.server_created_at_ms
  };
}

async function getMiningTableSessionRecord(scopeKey) {
  if (!hasSupabaseConfig()) return null;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(MINING_SESSION_TABLE)
    .select("scope_key,record")
    .eq("scope_key", scopeKey)
    .maybeSingle();

  if (error) {
    if (String(error.code || "") === "42P01") return null;
    throw error;
  }
  return normalizeStoredRecord(data?.record || null);
}

async function upsertMiningTableSessionRecord(scopeKey, record) {
  if (!hasSupabaseConfig()) return normalizeStoredRecord(record);
  const client = getSupabaseClient();
  const normalized = normalizeStoredRecord(record);
  const { error } = await client
    .from(MINING_SESSION_TABLE)
    .upsert({
      scope_key: scopeKey,
      record: normalized
    }, { onConflict: "scope_key" });

  if (error) {
    if (String(error.code || "") === "42P01") return null;
    throw error;
  }
  return normalized;
}

async function getMiningTableProfileRecord(scopeKey, userId) {
  if (!hasSupabaseConfig()) return null;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(MINING_PROFILE_TABLE)
    .select("scope_key,user_id,record")
    .eq("scope_key", scopeKey)
    .eq("user_id", String(userId || ""))
    .maybeSingle();

  if (error) {
    if (String(error.code || "") === "42P01") return null;
    throw error;
  }
  return normalizeStoredRecord(data?.record || null);
}

async function upsertMiningTableProfileRecord(scopeKey, userId, record) {
  if (!hasSupabaseConfig()) return normalizeStoredRecord(record);
  const client = getSupabaseClient();
  const normalized = normalizeStoredRecord(record);
  const { error } = await client
    .from(MINING_PROFILE_TABLE)
    .upsert({
      scope_key: scopeKey,
      user_id: String(userId || ""),
      record: normalized
    }, { onConflict: "scope_key,user_id" });

  if (error) {
    if (String(error.code || "") === "42P01") return null;
    throw error;
  }
  return normalized;
}

async function upsertSupabaseRecord(scopeKey, record) {
  if (!hasSupabaseConfig()) {
    return normalizeStoredRecord(record);
  }
  const client = getSupabaseClient();
  const normalized = normalizeStoredRecord(record);
  const payload = {
    id: normalized.id,
    scope_key: scopeKey,
    channel_id: normalized.channelId,
    author_name: normalized.author,
    avatar_label: normalized.avatar,
    avatar_url: normalized.avatarUrl || "",
    content: JSON.stringify(normalized.content),
    message_type: normalized.type,
    created_at: normalized.createdAt,
    created_at_ms: normalized.createdAtMs,
    server_created_at: normalized.serverCreatedAt,
    server_created_at_ms: normalized.serverCreatedAtMs
  };

  const { error } = await client
    .from("messages")
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
  return normalized;
}

export async function getMiningSessionRecord(scopeKey) {
  const tableRecord = await getMiningTableSessionRecord(scopeKey);
  if (tableRecord) return tableRecord;
  const blobRecord = await fetchBlobJson(sessionPath(scopeKey));
  if (blobRecord?.payload) return normalizeStoredRecord(blobRecord.payload);
  return getSupabaseRecord(scopeKey, sessionRecordId(scopeKey));
}

export async function saveMiningSessionRecord(scopeKey, sessionRecord) {
  const normalized = normalizeStoredRecord({
    ...sessionRecord,
    id: sessionRecord?.id || sessionRecordId(scopeKey),
    channelId: MINING_CHANNEL_ID,
    type: SESSION_TYPE
  });
  const tableRecord = await upsertMiningTableSessionRecord(scopeKey, normalized);
  if (tableRecord) return tableRecord;
  const wroteBlob = await writeBlobJson(sessionPath(scopeKey), normalized);
  if (wroteBlob) return normalized;
  return upsertSupabaseRecord(scopeKey, normalized);
}

export async function getMiningProfileRecord(scopeKey, userId) {
  const tableRecord = await getMiningTableProfileRecord(scopeKey, userId);
  if (tableRecord) return tableRecord;
  const blobRecord = await fetchBlobJson(profilePath(scopeKey, userId));
  if (blobRecord?.payload) return normalizeStoredRecord(blobRecord.payload);
  return getSupabaseRecord(scopeKey, profileRecordId(scopeKey, userId));
}

export async function saveMiningProfileRecord(scopeKey, userId, profileRecord) {
  const normalized = normalizeStoredRecord({
    ...profileRecord,
    id: profileRecord?.id || profileRecordId(scopeKey, userId),
    channelId: MINING_CHANNEL_ID,
    type: PROFILE_TYPE
  });
  const tableRecord = await upsertMiningTableProfileRecord(scopeKey, userId, normalized);
  if (tableRecord) return tableRecord;
  const wroteBlob = await writeBlobJson(profilePath(scopeKey, userId), normalized);
  if (wroteBlob) return normalized;
  return upsertSupabaseRecord(scopeKey, normalized);
}
