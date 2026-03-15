import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const legacyDataFile = path.join(rootDir, "data", "chat-history.json");
const messageDataDir = path.join(rootDir, "data", "chat-messages");
const legacyBlobPathname = "chat-history/store.json";
const messageBlobBasePath = "chat-history/messages";

globalThis.__activityChatStore ||= { scopes: {} };

export async function listScopeChannels(scopeKey) {
  const [legacyChannels, appendOnlyChannels] = await Promise.all([
    readLegacyScopeChannels(scopeKey),
    readAppendOnlyScopeChannels(scopeKey)
  ]);

  return mergeChannelMaps(legacyChannels, appendOnlyChannels);
}

export async function appendMessage(scopeKey, channelId, message) {
  const normalizedMessage = normalizeMessage(message);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      await put(buildMessageBlobPath(scopeKey, channelId, normalizedMessage), JSON.stringify(normalizedMessage, null, 2), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60
      });
      return normalizedMessage;
    } catch (error) {
      console.warn("Blob message append failed, falling back to ephemeral store.", error);
      appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
      return normalizedMessage;
    }
  }

  if (process.env.VERCEL) {
    appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
    return normalizedMessage;
  }

  const filePath = localChannelFile(scopeKey, channelId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const existingMessages = await readLocalChannelFile(filePath);
  const nextMessages = sortAndDedupeMessages([...existingMessages, normalizedMessage]);
  await fs.writeFile(filePath, JSON.stringify(nextMessages, null, 2), "utf8");

  return normalizedMessage;
}

export async function readStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { head } = await import("@vercel/blob");
      let blob;

      try {
        blob = await head(legacyBlobPathname);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("not found")) {
          return { scopes: {} };
        }
        throw error;
      }

      const response = await fetch(withFreshTimestamp(blob.downloadUrl), { cache: "no-store" });
      if (!response.ok) {
        return { scopes: {} };
      }

      const raw = await response.text();
      const parsed = JSON.parse(raw);
      parsed.scopes ||= {};
      return parsed;
    } catch (error) {
      console.warn("Legacy blob read failed, falling back to ephemeral store.", error);
      return globalThis.__activityChatStore;
    }
  }

  if (process.env.VERCEL) {
    return globalThis.__activityChatStore;
  }

  try {
    const raw = await fs.readFile(legacyDataFile, "utf8");
    const parsed = JSON.parse(raw);
    parsed.scopes ||= {};
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { scopes: {} };
    }
    throw error;
  }
}

export async function writeStore(store) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      await put(legacyBlobPathname, JSON.stringify(store, null, 2), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60
      });
      return;
    } catch (error) {
      console.warn("Legacy blob write failed, falling back to ephemeral store.", error);
      globalThis.__activityChatStore = store;
      return;
    }
  }

  if (process.env.VERCEL) {
    globalThis.__activityChatStore = store;
    return;
  }

  await fs.mkdir(path.dirname(legacyDataFile), { recursive: true });
  await fs.writeFile(legacyDataFile, JSON.stringify(store, null, 2), "utf8");
}

async function readLegacyScopeChannels(scopeKey) {
  const store = await readStore();
  return normalizeChannels(store.scopes?.[scopeKey]?.channels || {});
}

async function readAppendOnlyScopeChannels(scopeKey) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      return await readBlobScopeChannels(scopeKey);
    } catch (error) {
      console.warn("Blob message listing failed, falling back to ephemeral store.", error);
      return cloneChannels(globalThis.__activityChatStore.scopes?.[scopeKey]?.channels || {});
    }
  }

  if (process.env.VERCEL) {
    return cloneChannels(globalThis.__activityChatStore.scopes?.[scopeKey]?.channels || {});
  }

  return readDiskScopeChannels(scopeKey);
}

async function readBlobScopeChannels(scopeKey) {
  const { list } = await import("@vercel/blob");
  const prefix = buildMessageScopePrefix(scopeKey);
  const blobs = [];
  let cursor;

  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.cursor;
    if (!page.hasMore) {
      break;
    }
  } while (cursor);

  if (!blobs.length) {
    return {};
  }

  const messageEntries = await Promise.all(blobs.map(async (blob) => {
    const location = parseMessageBlobPath(blob.pathname);
    if (!location) return null;

    const response = await fetch(withFreshTimestamp(blob.downloadUrl), { cache: "no-store" });
    if (!response.ok) return null;

    const message = await response.json();
    return {
      channelId: location.channelId,
      message: normalizeMessage(message)
    };
  }));

  const channels = {};
  for (const entry of messageEntries) {
    if (!entry) continue;
    channels[entry.channelId] ||= [];
    channels[entry.channelId].push(entry.message);
  }

  return normalizeChannels(channels);
}

async function readDiskScopeChannels(scopeKey) {
  const scopeDir = localScopeDir(scopeKey);

  try {
    const files = await fs.readdir(scopeDir, { withFileTypes: true });
    const entries = await Promise.all(files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const channelId = decodePathSegment(entry.name.replace(/\.json$/i, ""));
        const messages = await readLocalChannelFile(path.join(scopeDir, entry.name));
        return [channelId, messages];
      }));

    return normalizeChannels(Object.fromEntries(entries));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function readLocalChannelFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortAndDedupeMessages(parsed) : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function appendEphemeralMessage(scopeKey, channelId, message) {
  globalThis.__activityChatStore.scopes ||= {};
  globalThis.__activityChatStore.scopes[scopeKey] ||= { channels: {} };
  globalThis.__activityChatStore.scopes[scopeKey].channels[channelId] ||= [];
  globalThis.__activityChatStore.scopes[scopeKey].channels[channelId].push(message);
  globalThis.__activityChatStore.scopes[scopeKey].channels[channelId] = sortAndDedupeMessages(
    globalThis.__activityChatStore.scopes[scopeKey].channels[channelId]
  );
}

function normalizeChannels(channels) {
  const normalized = {};
  for (const [channelId, messages] of Object.entries(channels || {})) {
    normalized[channelId] = sortAndDedupeMessages(Array.isArray(messages) ? messages : []);
  }
  return normalized;
}

function mergeChannelMaps(...maps) {
  const merged = {};

  for (const map of maps) {
    for (const [channelId, messages] of Object.entries(map || {})) {
      merged[channelId] = sortAndDedupeMessages([...(merged[channelId] || []), ...(messages || [])]);
    }
  }

  return merged;
}

function sortAndDedupeMessages(messages) {
  const byId = new Map();
  for (const message of messages || []) {
    if (!message || !message.id) continue;
    byId.set(message.id, normalizeMessage(message));
  }

  return [...byId.values()].sort(compareMessages);
}

function compareMessages(left, right) {
  const createdDiff = normalizeCreatedAtMs(left) - normalizeCreatedAtMs(right);
  if (createdDiff !== 0) return createdDiff;
  return String(left.id).localeCompare(String(right.id));
}

function normalizeMessage(message) {
  const createdAtMs = normalizeCreatedAtMs(message);
  return {
    ...message,
    createdAt: message?.createdAt || new Date(createdAtMs).toISOString(),
    createdAtMs
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

function buildMessageScopePrefix(scopeKey) {
  return `${messageBlobBasePath}/${encodePathSegment(scopeKey)}/`;
}

function buildMessageBlobPath(scopeKey, channelId, message) {
  const timestamp = String(normalizeCreatedAtMs(message)).padStart(13, "0");
  return `${buildMessageScopePrefix(scopeKey)}${encodePathSegment(channelId)}/${timestamp}-${encodePathSegment(message.id)}.json`;
}

function parseMessageBlobPath(pathname) {
  const parts = String(pathname || "").split("/");
  if (parts.length < 5) return null;

  return {
    scopeKey: decodePathSegment(parts[2]),
    channelId: decodePathSegment(parts[3])
  };
}

function withFreshTimestamp(input) {
  const url = new URL(input);
  url.searchParams.set("ts", Date.now().toString());
  return url.toString();
}

function localScopeDir(scopeKey) {
  return path.join(messageDataDir, encodePathSegment(scopeKey));
}

function localChannelFile(scopeKey, channelId) {
  return path.join(localScopeDir(scopeKey), `${encodePathSegment(channelId)}.json`);
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || ""));
}

function decodePathSegment(value) {
  return decodeURIComponent(String(value || ""));
}

function cloneChannels(channels) {
  return normalizeChannels(JSON.parse(JSON.stringify(channels || {})));
}
