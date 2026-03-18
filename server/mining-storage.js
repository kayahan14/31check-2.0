import { head, put } from "@vercel/blob";
import { appendMessage, listScopeMessages, updateMessage } from "./storage.js";

const SESSION_PATH = "session.json";
globalThis.__miningBlobFallbackStore ||= { sessions: {}, profiles: {} };

function hasBlobConfig() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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

function sanitizeSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9:_-]/g, "_");
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
    const message = String(error?.message || "");
    const normalized = message.toLowerCase();
    if (normalized.includes("not found") || normalized.includes("does not exist")) {
      return null;
    }
    if (normalized.includes("suspended")) {
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
    return;
  }
  await put(pathname, JSON.stringify(payload), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

export async function getMiningSessionRecord(scopeKey) {
  const record = await fetchBlobJson(sessionPath(scopeKey));
  if (record?.payload) return record.payload;
  const sessions = await listScopeMessages(scopeKey, {
    channelId: "casino:mining",
    messageTypes: ["mining_session"],
    limit: 1
  });
  return sessions[0] || null;
}

export async function saveMiningSessionRecord(scopeKey, sessionRecord) {
  try {
    await writeBlobJson(sessionPath(scopeKey), sessionRecord);
    return sessionRecord;
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("suspended")) throw error;
  }

  const existing = sessionRecord?.id ? await getMiningSessionRecord(scopeKey) : null;
  if (existing?.id) {
    return updateMessage(scopeKey, existing.id, sessionRecord);
  }
  return appendMessage(scopeKey, sessionRecord.channelId, sessionRecord);
}

export async function getMiningProfileRecord(scopeKey, userId) {
  const record = await fetchBlobJson(profilePath(scopeKey, userId));
  if (record?.payload) return record.payload;
  const profiles = await listScopeMessages(scopeKey, {
    channelId: "casino:mining",
    messageTypes: ["mining_profile"],
    limit: 20
  });
  return profiles.find((entry) => String(entry?.content?.userId || "") === String(userId || "")) || null;
}

export async function saveMiningProfileRecord(scopeKey, userId, profileRecord) {
  try {
    await writeBlobJson(profilePath(scopeKey, userId), profileRecord);
    return profileRecord;
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("suspended")) throw error;
  }

  const existing = await getMiningProfileRecord(scopeKey, userId);
  if (existing?.id) {
    return updateMessage(scopeKey, existing.id, profileRecord);
  }
  return appendMessage(scopeKey, profileRecord.channelId, profileRecord);
}
