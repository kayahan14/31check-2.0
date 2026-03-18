import { head, put } from "@vercel/blob";

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
    if (message.toLowerCase().includes("not found")) {
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
  return record?.payload || null;
}

export async function saveMiningSessionRecord(scopeKey, sessionRecord) {
  await writeBlobJson(sessionPath(scopeKey), sessionRecord);
  return sessionRecord;
}

export async function getMiningProfileRecord(scopeKey, userId) {
  const record = await fetchBlobJson(profilePath(scopeKey, userId));
  return record?.payload || null;
}

export async function saveMiningProfileRecord(scopeKey, userId, profileRecord) {
  await writeBlobJson(profilePath(scopeKey, userId), profileRecord);
  return profileRecord;
}
