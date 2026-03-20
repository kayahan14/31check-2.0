const MESSAGE_LIMIT = 50;

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
  return listEphemeralMessages(scopeKey, options);
}

export async function appendMessage(scopeKey, channelId, message) {
  const normalizedMessage = normalizeMessage({
    ...message,
    channelId: channelId || message?.channelId || ""
  });
  appendEphemeralMessage(scopeKey, channelId, normalizedMessage);
  return normalizedMessage;
}

export async function updateMessage(scopeKey, messageId, nextMessage) {
  const normalizedMessage = normalizeMessage(nextMessage);
  return updateEphemeralMessage(scopeKey, messageId, normalizedMessage);
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
