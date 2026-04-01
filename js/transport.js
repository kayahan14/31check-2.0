import { state } from './state.js';
import { DISCORD_CLIENT_ID, MOCK_MODE, MOCK_SCOPE_KEY, OFFLINE_MODE, GAME_BACKEND_URL, FRONTEND_API_ORIGIN } from './constants.js';
import { dedupeMembers, currentUserAsMember, sortMessages, mergeMessages, shouldPreferLocalMessage, buildMessagesApiUrl, buildGameApiUrl, buildGameSocketUrl } from './utils.js';
import { Events } from "@discord/embedded-app-sdk";

export async function authenticateWithDiscord() {
  let oauthError = null;

  try {
    state.runtimeNote = "Discord izin penceresi aciliyor...";
    render();
    let code = "";
    try {
      const result = await state.discordSdk.commands.authorize({
        client_id: DISCORD_CLIENT_ID,
        response_type: "code",
        state: `31check-activity-${Date.now()}`,
        prompt: "none",
        scope: ["identify"]
      });
      code = result?.code || "";
    } catch (error) {
      throw new Error(`authorize: ${String(error?.message || error || "basarisiz")}`);
    }

    state.runtimeNote = "Discord token aliniyor...";
    render();
    let response;
    try {
      response = await fetch(buildFrontendApiUrl("/api/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
    } catch (error) {
      throw new Error(`token-fetch: ${String(error?.message || error || "basarisiz")}`);
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.details?.error_description || payload.error || "Discord token exchange failed.");
    }

    const token = await response.json();
    state.runtimeNote = "Discord oturumu dogrulaniyor...";
    render();
    let auth;
    try {
      auth = await state.discordSdk.commands.authenticate({ access_token: token.access_token });
    } catch (error) {
      throw new Error(`sdk-authenticate: ${String(error?.message || error || "basarisiz")}`);
    }
    return { ...auth, access_token: token.access_token };
  } catch (error) {
    oauthError = error;
    console.warn("OAuth auth failed, trying direct SDK authenticate.", error);
  }

  try {
    state.runtimeNote = "Discord dogrudan kimlik dogrulamasi deneniyor...";
    render();
    const auth = await state.discordSdk.commands.authenticate({});
    return { ...auth, access_token: auth?.access_token || "" };
  } catch (fallbackError) {
    const oauthMessage = String(oauthError?.message || oauthError || "");
    const fallbackMessage = String(fallbackError?.message || fallbackError || "");
    throw new Error(
      `OAuth: ${oauthMessage || "basarisiz"} | SDK: ${fallbackMessage || "basarisiz"}`
    );
  }
}

export async function resolveDiscordIdentity() {
  const currentUser = await waitForDiscordCurrentUser(2000);
  if (currentUser?.id) {
    return { user: currentUser, access_token: "" };
  }

  try {
    return await authenticateWithDiscord();
  } catch (error) {
    console.warn("Discord OAuth auth failed, continuing with SDK identity only.", error);
    const fallbackUser = await waitForDiscordCurrentUser(1000);
    if (fallbackUser?.id) {
      return { user: fallbackUser, access_token: "" };
    }

    return { user: null, access_token: "" };
  }
}

export async function waitForDiscordCurrentUser(timeoutMs = 2000) {
  if (!state.discordSdk || MOCK_MODE) return null;

  return await new Promise((resolve) => {
    let settled = false;
    let timeoutHandle = 0;

    const finish = (user) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        window.clearTimeout(timeoutHandle);
      }
      resolve(user || null);
    };

    const handleUser = (user) => {
      if (user?.id) {
        finish(user);
      }
    };

    timeoutHandle = window.setTimeout(() => finish(null), timeoutMs);

    state.discordSdk.subscribe(Events.CURRENT_USER_UPDATE, handleUser).catch((error) => {
      console.warn("Could not subscribe to current user updates during bootstrap.", error);
      finish(null);
    });
  });
}

export function hydrateCurrentUser(auth) {
  const user = auth?.user || {};
  const username = user.username || state.currentUser.username;
  const displayName = user.global_name || username || state.currentUser.displayName;
  const isAdmin = computeIsAdmin(user);
  state.currentUser = {
    ...state.currentUser,
    id: user.id || state.currentUser.id,
    username,
    displayName,
    tag: username ? `@${username}` : state.currentUser.tag,
    discriminator: user.discriminator || "0000",
    avatarUrl: buildDiscordUserAvatarUrl(user.id, user.avatar, user.discriminator),
    guildId: state.discordSdk?.guildId || "",
    isAdmin
  };
  syncUserTag();
}

export async function subscribeDiscordEvents() {
  if (!state.discordSdk) return;

  try {
    await state.discordSdk.subscribe(Events.CURRENT_USER_UPDATE, (user) => {
      if (!user?.id) return;
      hydrateCurrentUser({ user, access_token: "" });
      render();
      renderUserModal();
    });
  } catch (error) {
    console.warn("Could not subscribe to current user updates.", error);
  }

  try {
    await state.discordSdk.subscribe(Events.CURRENT_GUILD_MEMBER_UPDATE, (member) => {
      applyGuildMemberData(member, state.currentUser.id);
      render();
      renderUserModal();
    });
  } catch (error) {
    console.warn("Could not subscribe to current guild member updates.", error);
  }

  try {
    await state.discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, (payload) => {
      syncParticipants(payload?.participants || []);
      render();
    });
  } catch (error) {
    console.warn("Could not subscribe to participant updates.", error);
  }
}

export async function hydrateGuildMember(auth) {
  const guildId = state.discordSdk?.guildId || "";
  if (!guildId || !auth?.access_token || MOCK_MODE) return;

  try {
    const response = await fetch(`https://discord.com/api/v10/users/@me/guilds/${guildId}/member`, {
      headers: {
        Authorization: `Bearer ${auth.access_token}`
      }
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "Guild member fetch failed.");
    }

    const member = await response.json();
    applyGuildMemberData(member, auth?.user?.id || state.currentUser.id);
    render();
    renderUserModal();
  } catch (error) {
    console.warn("Could not hydrate current guild member.", error);
  }
}

export function applyGuildMemberData(member, userId) {
  if (!member || !userId) return;

  const guildId = member.guild_id || state.discordSdk?.guildId || state.currentUser.guildId;
  const nickname = member.nick || member.nickname || "";
  const memberAvatarHash = member.avatar || "";

  state.currentUser = {
    ...state.currentUser,
    displayName: nickname || state.currentUser.displayName || state.currentUser.username,
    guildId,
    avatarUrl: buildDiscordGuildAvatarUrl(guildId, userId, memberAvatarHash) || state.currentUser.avatarUrl
  };
  syncUserTag();
}

export async function hydrateParticipants() {
  try {
    const result = await state.discordSdk.commands.getInstanceConnectedParticipants();
    syncParticipants(result?.participants || []);
  } catch (error) {
    state.membersLoading = false;
    state.members = [currentUserAsMember()];
    console.warn("Could not fetch connected Discord participants.", error);
  }
}

export function syncParticipants(participants) {
  if (!Array.isArray(participants)) return;

  const mapped = participants.map((participant, index) => mapDiscordParticipant(participant, index));
  state.membersLoading = false;
  state.members = mapped.length ? dedupeMembers(mapped) : [currentUserAsMember()];
}

export async function loadPersistedMessages({ initial = false } = {}) {
  if (initial) {
    state.isMessagesLoading = true;
    render();
  }

  if (!initial && hasActiveBlackjackInteraction()) {
    return;
  }

  const requestEpoch = state.remoteSyncEpoch;

  try {
    const response = await fetch(buildMessagesApiUrl({
      scopeKey: state.scopeKey,
      ts: Date.now()
    }), {
      cache: "no-store"
    });
    if (!response.ok) return;

    const payload = await response.json();
    if (requestEpoch !== state.remoteSyncEpoch) {
      return;
    }
    syncRemoteMessages(payload.channels || {});
  } catch (error) {
    console.warn("Message sync failed.", error);
  } finally {
    if (state.isMessagesLoading) {
      state.isMessagesLoading = false;
      render();
    }
  }
}

export function startMessageSync() {
  stopMessageSync();
  if (!state.scopeKey) return;

  state.messageSyncHandle = window.setInterval(() => {
    if (hasActiveBlackjackInteraction()) return;
    void loadPersistedMessages();
  }, 1000);

  document.addEventListener("visibilitychange", handleVisibilitySync);
}

export function stopMessageSync() {
  if (state.messageSyncHandle) {
    window.clearInterval(state.messageSyncHandle);
    state.messageSyncHandle = null;
  }

  document.removeEventListener("visibilitychange", handleVisibilitySync);
  stopDragonSessionSync();
  stopDragonModalLoop();
  stopMiningSessionSync();
  stopMiningCanvasLoop();
  closeRealtimeSocket("dragon");
  closeRealtimeSocket("mining");
}

export function handleVisibilitySync() {
  if (hasActiveBlackjackInteraction()) return;
  if (document.visibilityState === "visible") {
    void loadPersistedMessages();
    void loadDragonSession();
    void loadMiningState();
  }
}

export function syncRemoteMessages(channels) {
  const nextMessages = mergeMessages(channels);
  const pending = mergeMessages(state.pendingMessagesByChannel);

  for (const [channelId, pendingList] of Object.entries(pending)) {
    if (!pendingList.length) continue;

    const remoteIds = new Set((nextMessages[channelId] || []).map((message) => message.id));
    const stillPending = pendingList.filter((message) => !remoteIds.has(message.id));

    if (stillPending.length) {
      nextMessages[channelId] = sortMessages([...(nextMessages[channelId] || []), ...stillPending]);
    }

    state.pendingMessagesByChannel[channelId] = stillPending;
  }

  for (const [messageId, pendingMessage] of Object.entries(state.pendingUpdatedMessages || {})) {
    if (!pendingMessage) continue;
    const channelId = pendingMessage.channelId;
    const list = [...(nextMessages[channelId] || [])];
    const index = list.findIndex((message) => message.id === messageId);
    if (index === -1) {
      list.push(pendingMessage);
    } else {
      list[index] = pendingMessage;
    }
    nextMessages[channelId] = sortMessages(list);
  }

  for (const [channelId, currentList] of Object.entries(state.messagesByChannel || {})) {
    if (!currentList?.length || !nextMessages[channelId]?.length) continue;

    nextMessages[channelId] = sortMessages((nextMessages[channelId] || []).map((remoteMessage) => {
      const localMessage = currentList.find((message) => message.id === remoteMessage.id);
      if (!localMessage) return remoteMessage;
      return shouldPreferLocalMessage(localMessage, remoteMessage) ? localMessage : remoteMessage;
    }));
  }

  const previousSnapshot = JSON.stringify(state.messagesByChannel);
  const nextSnapshot = JSON.stringify(nextMessages);
  if (previousSnapshot === nextSnapshot) return;

  const animationKeys = collectGameAnimationKeys(state.messagesByChannel, nextMessages);
  state.messagesByChannel = nextMessages;
  if (animationKeys.length) {
    markAnimatingCards(animationKeys);
  }
  render();
}

export async function persistMessage(message) {
  const channel = selectedChannel();
  if (!channel) return;

  try {
    const response = await fetch(buildMessagesApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeKey: state.scopeKey, channelId: channel.id, message })
    });
    if (!response.ok) {
      throw new Error("Message persistence request failed.");
    }
    await loadPersistedMessages();
  } catch (error) {
    state.pendingMessagesByChannel[channel.id] = (state.pendingMessagesByChannel[channel.id] || [])
      .filter((entry) => entry.id !== message.id);
    console.warn("Message persistence failed.", error);
  }
}

export async function persistMessageUpdate(message) {
  try {
    const response = await fetch(buildMessagesApiUrl(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeKey: state.scopeKey,
        messageId: message.id,
        message
      })
    });

    if (!response.ok) {
      throw new Error("Message update request failed.");
    }

    const payload = await response.json();
    clearPendingUpdatedMessageIfCurrent(message);
    const storedMessage = payload.message || message;
    if (hasMeaningfulMessageDifference(findMessageById(message.id), storedMessage)) {
      replaceLocalMessage(storedMessage);
    }
    return storedMessage;
  } catch (error) {
    clearPendingUpdatedMessageIfCurrent(message);
    console.warn("Message update failed.", error);
    return null;
  }
}

export async function loadDragonSession({ initial = false } = {}) {
  if (initial) {
    state.dragonStateLoading = true;
    if (isCasinoDragonView()) render();
  }

  try {
    const response = await fetch(buildGameApiUrl("/api/dragon", {
      scopeKey: state.scopeKey,
      ts: Date.now()
    }), {
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    applyDragonTransportPayload(payload, { forceRender: initial });
  } catch (error) {
    console.warn("Dragon session load failed.", error);
  } finally {
    state.dragonStateLoading = false;
    if (initial && isCasinoDragonView()) render();
  }
}

export function hasDirectRealtimeBackend() {
  if (GAME_BACKEND_URL) return true;
  const { hostname, port } = window.location;
  return (hostname === "localhost" || hostname === "127.0.0.1") && port === "5173";
}

export function buildGameApiUrl(path, query = {}) {
  return buildFrontendApiUrl(path, query);
}

export function buildGameSocketUrl(stream, scopeKey) {
  const url = new URL("/ws", `${getGameBackendOrigin()}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("stream", String(stream || ""));
  url.searchParams.set("scopeKey", String(scopeKey || "local-preview"));
  url.searchParams.set("actorId", String(state.currentUser.id || ""));
  url.searchParams.set("actorName", String(state.currentUser.displayName || state.currentUser.username || "Oyuncu"));
  return url.toString();
}

export function getRealtimeSocketState(kind) {
  if (kind === "dragon") {
    return {
      socketKey: "dragonRealtimeSocket",
      readyKey: "dragonRealtimeReady",
      reconnectKey: "dragonRealtimeReconnectHandle"
    };
  }

  return {
    socketKey: "miningRealtimeSocket",
    readyKey: "miningRealtimeReady",
    reconnectKey: "miningRealtimeReconnectHandle"
  };
}

export function closeRealtimeSocket(kind) {
  const keys = getRealtimeSocketState(kind);
  const reconnectHandle = state[keys.reconnectKey];
  if (reconnectHandle) {
    window.clearTimeout(reconnectHandle);
    state[keys.reconnectKey] = null;
  }

  const socket = state[keys.socketKey];
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Best-effort shutdown.
    }
  }
  state[keys.socketKey] = null;
  state[keys.readyKey] = false;
}

export function scheduleRealtimeReconnect(kind, connect) {
  const keys = getRealtimeSocketState(kind);
  if (state[keys.reconnectKey]) return;
  state[keys.reconnectKey] = window.setTimeout(() => {
    state[keys.reconnectKey] = null;
    connect();
  }, 1200);
}

export function connectRealtimeSocket(kind, scopeKey, handlers) {
  if (!hasDirectRealtimeBackend()) {
    return;
  }
  const keys = getRealtimeSocketState(kind);
  closeRealtimeSocket(kind);

  let socket;
  try {
    socket = new WebSocket(buildGameSocketUrl(kind, scopeKey));
  } catch (error) {
    console.warn(`${kind} realtime socket failed to initialize.`, error);
    scheduleRealtimeReconnect(kind, () => connectRealtimeSocket(kind, scopeKey, handlers));
    return;
  }

  state[keys.socketKey] = socket;

  socket.onopen = () => {
    state[keys.readyKey] = true;
    handlers?.onHeartbeat?.(Date.now());
    handlers?.onStatusChange?.(true);
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data || "{}"));
      if (Number.isFinite(Number(message?.serverNowMs))) {
        handlers?.onHeartbeat?.(Number(message.serverNowMs));
      }
      if (message?.type === "snapshot" && message?.payload) {
        handlers?.onSnapshot?.(message.payload);
      } else if (message?.type) {
        handlers?.onMessage?.(message);
      }
    } catch (error) {
      console.warn(`${kind} realtime message parse failed.`, error);
    }
  };

  socket.onerror = (error) => {
    console.warn(`${kind} realtime socket error.`, error);
  };

  socket.onclose = () => {
    const isSameSocket = state[keys.socketKey] === socket;
    if (!isSameSocket) return;
    state[keys.socketKey] = null;
    state[keys.readyKey] = false;
    handlers?.onStatusChange?.(false);
    scheduleRealtimeReconnect(kind, () => connectRealtimeSocket(kind, scopeKey, handlers));
  };
}

export function startDragonSessionSync() {
  stopDragonSessionSync();
  if (!state.scopeKey) return;

  state.dragonSessionSyncHandle = window.setInterval(() => {
    if (state.dragonRealtimeReady && !isCasinoDragonView()) return;
    if (!state.dragonSession && !isCasinoDragonView()) return;
    void loadDragonSession();
  }, state.dragonRealtimeReady ? 5000 : 1000);
}

export function stopDragonSessionSync() {
  if (!state.dragonSessionSyncHandle) return;
  window.clearInterval(state.dragonSessionSyncHandle);
  state.dragonSessionSyncHandle = null;
}

export function startMiningSessionSync() {
  stopMiningSessionSync();
  if (!state.scopeKey) return;

  state.miningSessionSyncHandle = window.setInterval(() => {
    if (state.miningRealtimeReady && !isCasinoMiningView()) return;
    if (!state.miningSession && !isCasinoMiningView()) return;
    void loadMiningState();
  }, isCasinoMiningView() ? 3000 : (state.miningRealtimeReady ? 5000 : 2000));
}

export function stopMiningSessionSync() {
  if (!state.miningSessionSyncHandle) return;
  window.clearInterval(state.miningSessionSyncHandle);
  state.miningSessionSyncHandle = null;
}
