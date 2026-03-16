import { DiscordSDK, Events } from "@discord/embedded-app-sdk";

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "1481788345473302578";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://hjlxrgzxyafedqamlzer.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_6e-aU1BGjgWj6tRHdYnD6Q_q5fSXo5X";
const MOCK_MODE = new URLSearchParams(window.location.search).get("mock") === "1" || !DISCORD_CLIENT_ID;
const ADMIN_USER_IDS = parseCsv(import.meta.env.VITE_ACTIVITY_ADMIN_USER_IDS || "");
const ADMIN_USERNAMES = parseCsv(import.meta.env.VITE_ACTIVITY_ADMIN_USERNAMES || "astrian");

const DEFAULT_CHANNELS = [
  { id: "1", name: "🔥🍕-3️⃣ 1️⃣-🍕🔥", categoryId: "" },
  { id: "2", name: "📃-casino-1-📃", categoryId: "" },
  { id: "3", name: "📃-casino-2-📃", categoryId: "" },
  { id: "4", name: "📄-31check-yama-notlari", categoryId: "" },
  { id: "5", name: "📘-31check-wiki", categoryId: "" },
  { id: "6", name: "📢-31check-duyuru", categoryId: "" }
];

const DEFAULT_MEMBERS = [
  { id: uid(), username: "31check", avatar: "31check", status: "online", customStatus: "" },
  { id: uid(), username: "Peder", avatar: "Peder", status: "online", customStatus: "🎮 Oyunda" },
  { id: uid(), username: "Sultan", avatar: "Sultan", status: "online", customStatus: "" },
  { id: uid(), username: "Asuman", avatar: "Asuman", status: "online", customStatus: "" },
  { id: uid(), username: "Ece", avatar: "Ece", status: "online", customStatus: "" },
  { id: uid(), username: "Selin", avatar: "Selin", status: "online", customStatus: "🎵 Müzik dinliyor" },
  { id: uid(), username: "Azdırıan", avatar: "Azdırıan", status: "idle", customStatus: "" },
  { id: uid(), username: "Yiğit", avatar: "Yiğit", status: "idle", customStatus: "☕ Molada" },
  { id: uid(), username: "Metehan", avatar: "Metehan", status: "dnd", customStatus: "📝 Çalışıyor" },
  { id: uid(), username: "Burak", avatar: "Burak", status: "offline", customStatus: "" }
];

const GAME_BUTTONS = [
  { id: "blackjack", label: "🃏 Blackjack", game: "blackjack" },
  { id: "mines", label: "💣 Mines", game: "mines" },
  { id: "dice", label: "🎲 Zar", game: "dice" },
  { id: "case", label: "🎁 Kasa", game: "case" }
];
const CASINO_ITEMS = [
  { id: "casino:dragon", label: "🐉 Ejderha" }
];

const BLACKJACK_SUITS = [
  { key: "spades", symbol: "♠", color: "black" },
  { key: "hearts", symbol: "♥", color: "red" },
  { key: "diamonds", symbol: "♦", color: "red" },
  { key: "clubs", symbol: "♣", color: "black" }
];
const BLACKJACK_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const MINES_GRID_SIZE = 9;
const MINES_MINE_COUNT = 2;
const MINES_BASE_STAKE = 100;
const MINES_MINE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];
const DRAGON_BASE_STAKE = 100;
const DRAGON_TICK_MS = 400;
const LOCAL_MINES_MINE_COUNT_KEY = "31check:mines:mine-count";
const LOCAL_CLEAR_CHAT_KEY = "31check:clear-chat";
const DRAGON_CHANNEL_ID = "casino:dragon";

const FALLBACK_MESSAGE = {
  id: uid(),
  author: "31check",
  avatar: "31check",
  avatarUrl: "",
  time: "04:15",
  type: "text",
  content: "Peder\n\nTOPLAM 31 SÜRESİ: 11950\nTOPLAM 31 ADETİ: 273\nTEZGAH KAR/ZARAR: -888\nTOPLAM RNG: 39\nASUMAN KAR/ZARAR: 1773\nLEVEL: 236\nXP: 35\nPET: Azdırıan"
};

const state = {
  discordSdk: null,
  runtimeMode: MOCK_MODE ? "mock" : "discord",
  runtimeNote: MOCK_MODE ? "Tarayıcı önizleme modu" : "Discord Activity başlatılıyor...",
  scopeKey: "local-preview",
  messageSyncHandle: null,
  dragonTickerHandle: null,
  dragonRealtimeClient: null,
  dragonRealtimeChannel: null,
  dragonSession: null,
  dragonStateLoading: true,
  isMessagesLoading: true,
  membersLoading: !MOCK_MODE,
  composerDraft: "",
  searchQuery: "",
  sidebarCollapsed: false,
  minesSetupOpen: false,
  dragonModalMessageId: "",
  dragonModalRaf: 0,
  preferredMineCount: loadPreferredMineCount(),
  toastMessage: "",
  keepComposerFocus: false,
  messagePanePinnedToBottom: true,
  forceScrollToBottom: false,
  remoteSyncEpoch: 0,
  highlightedMessageId: "",
  animatingCardKeys: [],
  interactiveActionLocks: {},
  pendingUpdatedMessages: {},
  pendingMessagesByChannel: buildEmptyMessageState(),
  currentUser: {
    id: "local-user",
    username: "31check",
    displayName: "31check",
    tag: "@31check",
    discriminator: "0001",
    avatarUrl: "",
    guildId: "",
    isAdmin: MOCK_MODE
  },
  categories: [],
  channels: [...DEFAULT_CHANNELS],
  selectedChannelId: initialChannelId(),
  messagesByChannel: buildEmptyMessageState(),
  members: MOCK_MODE ? [...DEFAULT_MEMBERS] : [],
  activeAdminTab: "channels",
  editingActionId: null,
  tempAction: { label: "", message: "" }
};

const app = document.getElementById("app");
const adminBackdrop = document.getElementById("adminBackdrop");
const userBackdrop = document.getElementById("userBackdrop");
const channelList = document.getElementById("channelList");
const channelCategory = document.getElementById("channelCategory");
const categoryList = document.getElementById("categoryList");
const userModalTag = document.getElementById("userModalTag");
const adminBadge = document.getElementById("adminBadge");
const tabs = [...document.querySelectorAll(".tab")];
let toastTimeoutHandle = 0;
const interactivePersistQueues = {};

bootstrap();

async function bootstrap() {
  decorateStaticUi();
  bindStaticEvents();
  render();
  renderAdmin();
  renderUserModal();
  await initializeRuntime();
}

function decorateStaticUi() {
  document.getElementById("addChannelButton").innerHTML = `${icon("plus", 16)}Ekle`;
  document.getElementById("addCategoryButton").innerHTML = `${icon("plus", 16)}Ekle`;
  document.getElementById("closeAdmin").innerHTML = icon("close", 24);
  document.getElementById("closeUser").innerHTML = icon("close", 24);
  syncUserTag();
}

function bindStaticEvents() {
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    state.activeAdminTab = tab.dataset.tab;
    renderAdmin();
  }));

  document.getElementById("closeAdmin").addEventListener("click", closeAdminModal);
  document.getElementById("adminCloseFooter").addEventListener("click", closeAdminModal);
  document.getElementById("closeUser").addEventListener("click", closeUserModal);
  document.getElementById("userCloseFooter").addEventListener("click", closeUserModal);

  adminBackdrop.addEventListener("click", (event) => {
    if (event.target === adminBackdrop) closeAdminModal();
  });
  userBackdrop.addEventListener("click", (event) => {
    if (event.target === userBackdrop) closeUserModal();
  });

  document.getElementById("channelForm").addEventListener("submit", addChannel);
  document.getElementById("categoryForm").addEventListener("submit", addCategory);

  window.addEventListener("popstate", () => {
    state.selectedChannelId = initialChannelId();
    render();
  });
}

async function initializeRuntime() {
  if (MOCK_MODE) {
    state.messagesByChannel["1"] = [FALLBACK_MESSAGE];
    await loadPersistedMessages({ initial: true });
    state.membersLoading = false;
    startMessageSync();
    await initializeDragonTransport();
    render();
    return;
  }

  try {
    state.discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
    await state.discordSdk.ready();

    const auth = await authenticateWithDiscord();
    hydrateCurrentUser(auth);

    state.scopeKey = buildScopeKey();
    state.runtimeMode = "discord";
    state.runtimeNote = "Discord Activity bağlı";

    await subscribeDiscordEvents(auth);
    await hydrateGuildMember(auth);
    await hydrateParticipants();
    await loadPersistedMessages({ initial: true });
    startMessageSync();
    await initializeDragonTransport();
    render();
    renderUserModal();
  } catch (error) {
    console.error("Discord SDK bootstrap failed, falling back to preview mode.", error);
    state.runtimeMode = "mock";
    state.runtimeNote = `Discord bağlanamadı: ${String(error?.message || "önizleme modu")}`;
    state.scopeKey = "local-preview";
    state.messagesByChannel["1"] = [FALLBACK_MESSAGE];
    state.members = [...DEFAULT_MEMBERS];
    state.membersLoading = false;
    await loadPersistedMessages({ initial: true });
    startMessageSync();
    await initializeDragonTransport();
    render();
  }
}

async function authenticateWithDiscord() {
  const { code } = await state.discordSdk.commands.authorize({
    client_id: DISCORD_CLIENT_ID,
    response_type: "code",
    state: `31check-activity-${Date.now()}`,
    prompt: "none",
    scope: ["identify", "guilds", "guilds.members.read"]
  });

  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.details?.error_description || payload.error || "Discord token exchange failed.");
  }

  const token = await response.json();
  const auth = await state.discordSdk.commands.authenticate({ access_token: token.access_token });
  return { ...auth, access_token: token.access_token };
}

function hydrateCurrentUser(auth) {
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

async function subscribeDiscordEvents(auth) {
  if (!state.discordSdk) return;

  try {
    await state.discordSdk.subscribe(Events.CURRENT_GUILD_MEMBER_UPDATE, (member) => {
      applyGuildMemberData(member, auth?.user?.id || state.currentUser.id);
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

async function hydrateGuildMember(auth) {
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

function applyGuildMemberData(member, userId) {
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

async function hydrateParticipants() {
  try {
    const result = await state.discordSdk.commands.getInstanceConnectedParticipants();
    syncParticipants(result?.participants || []);
  } catch (error) {
    state.membersLoading = false;
    state.members = [currentUserAsMember()];
    console.warn("Could not fetch connected Discord participants.", error);
  }
}

function syncParticipants(participants) {
  if (!Array.isArray(participants)) return;

  const mapped = participants.map((participant, index) => mapDiscordParticipant(participant, index));
  state.membersLoading = false;
  state.members = mapped.length ? dedupeMembers(mapped) : [currentUserAsMember()];
}

async function loadPersistedMessages({ initial = false } = {}) {
  if (initial) {
    state.isMessagesLoading = true;
    render();
  }

  if (!initial && hasActiveBlackjackInteraction()) {
    return;
  }

  const requestEpoch = state.remoteSyncEpoch;

  try {
    const response = await fetch(`/api/messages?scopeKey=${encodeURIComponent(state.scopeKey)}&ts=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) return;

    const payload = await response.json();
    if (requestEpoch !== state.remoteSyncEpoch) {
      return;
    }
    syncRemoteMessages(payload.channels || {});
  } finally {
    if (state.isMessagesLoading) {
      state.isMessagesLoading = false;
      render();
    }
  }
}

function startMessageSync() {
  stopMessageSync();
  if (!state.scopeKey) return;

  state.messageSyncHandle = window.setInterval(() => {
    if (hasActiveBlackjackInteraction()) return;
    void loadPersistedMessages();
  }, 1000);

  document.addEventListener("visibilitychange", handleVisibilitySync);
}

function stopMessageSync() {
  if (state.messageSyncHandle) {
    window.clearInterval(state.messageSyncHandle);
    state.messageSyncHandle = null;
  }

  document.removeEventListener("visibilitychange", handleVisibilitySync);
  stopDragonModalLoop();
}

function handleVisibilitySync() {
  if (hasActiveBlackjackInteraction()) return;
  if (document.visibilityState === "visible") {
    void loadPersistedMessages();
  }
}

function syncRemoteMessages(channels) {
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

function render() {
  const previousMessagesPane = document.querySelector(".messages");
  const previousScrollTop = previousMessagesPane?.scrollTop || 0;
  if (previousMessagesPane) {
    state.messagePanePinnedToBottom = isNearBottom(previousMessagesPane);
  }

  const shouldRestoreComposerFocus = document.activeElement?.id === "composerInput" || state.keepComposerFocus;
  const shouldRestoreSearchFocus = document.activeElement?.id === "messageSearchInput";
  const shouldStickToBottom = state.messagePanePinnedToBottom || state.forceScrollToBottom;
  const isDragonView = isCasinoDragonView();
  const channel = selectedChannel();
  const rawMessages = isDragonView ? [] : applyLocalMessageFilters(state.messagesByChannel[channel?.id] || [], channel?.id).filter((message) => message.type !== "dragon");
  const messages = filterMessages(rawMessages, state.searchQuery);
  const composerDisabled = state.isMessagesLoading;

  app.className = `app ${state.sidebarCollapsed ? "sidebar-collapsed" : ""}`.trim();
  app.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-top">
        <button type="button" class="sidebar-toggle" id="sidebarToggleButton" aria-label="${state.sidebarCollapsed ? "Metin kanallarını geri getir" : "Metin kanallarını küçült"}" aria-expanded="${state.sidebarCollapsed ? "false" : "true"}">
          ${icon(state.sidebarCollapsed ? "chevron-right" : "chevron-left", 16)}
          <span class="sidebar-toggle-label">${state.sidebarCollapsed ? "Geri Getir" : "Küçült"}</span>
        </button>
      </div>
      <div class="sidebar-scroll">
        <div class="runtime-banner">${escapeHtml(state.runtimeNote)}</div>
        ${renderChannelSections()}
      </div>
      <div class="sidebar-footer">
        <button type="button" class="current-user ${state.currentUser.isAdmin ? "" : "is-locked"}" id="openUserButton" ${state.currentUser.isAdmin ? "" : "disabled"}>
          ${renderAvatar(state.currentUser.avatarUrl, state.currentUser.displayName)}
          <span class="user-meta">
            <span class="user-name">${escapeHtml(state.currentUser.displayName)}</span>
            <span class="user-tag">${escapeHtml(state.currentUser.tag)}</span>
          </span>
        </button>
      </div>
    </aside>
    <main class="main">
      <div class="main-panel">
        ${isDragonView ? renderDragonRealtimeView() : `
        <section class="chat">
          <header class="chat-header">
            <div class="chat-header-left">
              ${icon("hash", 24, "icon-muted")}
              <span class="chat-title">${escapeHtml(channel?.name || "")}</span>
            </div>
            <div class="chat-header-right">
              <button type="button" class="icon-muted" aria-label="Bildirim">${icon("bell", 20)}</button>
              <label class="search" aria-label="Ara">
                <input id="messageSearchInput" type="text" value="${escapeAttr(state.searchQuery)}" placeholder="Mesajlarda ara">
                ${icon("search", 16)}
              </label>
            </div>
          </header>
          <div class="messages">
            ${state.isMessagesLoading ? renderChatLoadingState() : messages.length ? renderMessages(messages) : renderEmptyMessageState(channel)}
          </div>
          ${renderScrollToBottomButton()}
          <div class="composer-wrap">
            <div class="quick-actions">${renderGameButtons()}</div>
            <form class="composer" id="composerForm">
              <input id="composerInput" type="text" value="${escapeAttr(state.composerDraft)}" placeholder="${escapeAttr(state.isMessagesLoading ? "Chat yükleniyor..." : (channel?.name || "") + " kanalına mesaj gönder")}" autocomplete="off" ${composerDisabled ? "disabled" : ""}>
              <button type="submit" class="btn btn-primary composer-send" ${composerDisabled ? "disabled" : ""}>Gönder</button>
            </form>
          </div>
        </section>
        <aside class="members">
          <div class="members-scroll">${renderMembers()}</div>
        </aside>`}
      </div>
    </main>
    ${renderDragonModal()}
    ${renderToast()}
  `;

  bindRuntimeUi();
  syncDragonModalLoop();
  if (shouldRestoreComposerFocus) {
    focusComposer();
  }
  if (shouldRestoreSearchFocus) {
    focusSearch();
  }
  const nextMessagesPane = document.querySelector(".messages");
  if (shouldStickToBottom) {
    scrollMessagesToBottom(nextMessagesPane);
  } else if (nextMessagesPane) {
    nextMessagesPane.scrollTop = previousScrollTop;
  }
  state.forceScrollToBottom = false;
}

function renderChannelSections() {
  const grouped = state.categories
    .map((category) => {
      const items = state.channels.filter((channel) => channel.categoryId === category.id);
      if (!items.length) return "";
      return `
        <div class="section">
          <div class="section-header">
            <button type="button" class="section-title category-toggle" data-category-id="${category.id}">
              ${icon(category.collapsed ? "chevron-right" : "chevron-down", 12)}
              <span>${escapeHtml(category.name)}</span>
            </button>
          </div>
          ${category.collapsed ? "" : items.map(renderChannelLink).join("")}
        </div>
      `;
    })
    .join("");

  const rootItems = state.channels.filter((channel) => !channel.categoryId).map(renderChannelLink).join("");

  return `${grouped}
    <div class="section">
      <div class="section-header">
        <div class="section-title">${icon("chevron-down", 12)}<span>Metin Kanalları</span></div>
      </div>
      ${rootItems}
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title">${icon("chevron-down", 12)}<span>Casino</span></div>
      </div>
      ${CASINO_ITEMS.map(renderCasinoLink).join("")}
    </div>
    <div class="section"></div>`;
}

function renderChannelLink(channel) {
  return `<a class="channel ${channel.id === state.selectedChannelId ? "active" : ""}" href="${channelHref(channel.id)}" data-channel-id="${channel.id}">${icon("hash", 20)}<span class="channel-label">${escapeHtml(channel.name)}</span></a>`;
}

function renderCasinoLink(item) {
  return `<a class="channel ${item.id === state.selectedChannelId ? "active" : ""}" href="${channelHref(item.id)}" data-channel-id="${item.id}">${icon("gift", 20)}<span class="channel-label">${escapeHtml(item.label)}</span></a>`;
}

function renderMessages(messages) {
  return `<div class="message-stack">${messages.map((message) => `
      <article class="message ${message.type === "game" ? "message-game" : ""} ${message.type === "blackjack" ? "message-blackjack" : ""} ${message.type === "mines" ? "message-mines" : ""} ${message.type === "dragon" ? "message-dragon" : ""} ${message.id === state.highlightedMessageId ? "message-highlighted" : ""} ${state.searchQuery.trim() ? "message-search-hit" : ""}" data-message-id="${escapeAttr(message.id)}">
        ${renderAvatar(message.avatarUrl, message.avatar || message.author)}
        <div class="message-body">
          <div class="message-meta">
            <span class="message-author">${highlightText(message.author, state.searchQuery)}</span>
            <span class="verified">${icon("verified", 16)}</span>
            <span class="message-time">${escapeHtml(formatMessageTime(message))}</span>
          </div>
          ${renderMessageContent(message)}
        </div>
      </article>`).join("")}</div>`;
}

function renderMembers() {
  if (state.runtimeMode === "discord") {
    if (state.membersLoading) {
      return `<section class="member-group"><div class="member-group-title">Aktif Activity Oyuncuları</div><div class="member-empty">Oyuncular yükleniyor...</div></section>`;
    }
    return `<section class="member-group">
        <div class="member-group-title">Aktif Activity Oyuncuları - ${state.members.length}</div>
        ${state.members.length ? state.members.map(renderMemberRow).join("") : '<div class="member-empty">Bu activityde henüz aktif kimse yok.</div>'}
      </section>`;
  }

  return [
    ["Online", "online"],
    ["Boşta", "idle"],
    ["Rahatsız Etmeyin", "dnd"],
    ["Çevrimdışı", "offline"]
  ].map(([label, key]) => {
    const items = state.members.filter((member) => member.status === key);
    if (!items.length) return "";
    return `<section class="member-group"><div class="member-group-title">${label} - ${items.length}</div>${items.map(renderMemberRow).join("")}</section>`;
  }).join("");
}

function renderGameButtons() {
  return GAME_BUTTONS.map((button) => {
    const isMines = button.game === "mines";
    const popover = isMines ? renderMinesSetupPopover() : "";
    return `
      <div class="game-button-wrap ${isMines ? "is-mines" : ""}">
        <button type="button" data-game-id="${button.game}" aria-expanded="${isMines && state.minesSetupOpen ? "true" : "false"}" ${state.isMessagesLoading ? "disabled" : ""}>${escapeHtml(button.label)}</button>
        ${popover}
      </div>
    `;
  }).join("");
}

function renderMemberRow(member) {
  return `<div class="member">
      <div class="member-avatar-wrap">
        ${renderAvatar(member.avatarUrl, member.avatar || member.username)}
        <span class="status-dot" style="background:${statusColor(member.status)}"></span>
      </div>
      <span class="member-meta">
        <span class="member-name">${escapeHtml(member.username)}</span>
        ${member.customStatus ? `<span class="member-status-text">${escapeHtml(member.customStatus)}</span>` : ""}
      </span>
    </div>`;
}

function bindRuntimeUi() {
  const sidebarToggleButton = document.getElementById("sidebarToggleButton");
  if (sidebarToggleButton) {
    sidebarToggleButton.addEventListener("click", () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      render();
    });
  }
  app.querySelectorAll("[data-channel-id]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    selectChannel(link.dataset.channelId);
  }));
  app.querySelectorAll(".category-toggle").forEach((button) => button.addEventListener("click", () => {
    state.categories = state.categories.map((item) => item.id === button.dataset.categoryId ? { ...item, collapsed: !item.collapsed } : item);
    render();
  }));
  const userButton = document.getElementById("openUserButton");
  if (userButton && state.currentUser.isAdmin) {
    userButton.addEventListener("click", openUserModal);
  }
  app.querySelectorAll("[data-game-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const gameId = button.dataset.gameId;
      const config = GAME_BUTTONS.find((item) => item.game === gameId);
      if (!config) return;
      if (gameId === "mines") {
        openMinesSetup();
        return;
      }
      await sendGameMessage(config.game, config.label);
    });
  });
  app.querySelectorAll("[data-mine-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const mineCount = Number(button.dataset.mineOption);
      if (!MINES_MINE_OPTIONS.includes(mineCount)) return;
      state.preferredMineCount = mineCount;
      savePreferredMineCount(mineCount);
      render();
    });
  });
  const minesStartButton = document.getElementById("startMinesGameButton");
  if (minesStartButton) {
    minesStartButton.addEventListener("click", async () => {
      await startConfiguredMinesGame();
    });
  }
  const minesCancelButton = document.getElementById("closeMinesSetupButton");
  if (minesCancelButton) {
    minesCancelButton.addEventListener("click", closeMinesSetup);
  }
  app.querySelectorAll("[data-bj-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const messageId = button.dataset.messageId;
      const action = button.dataset.bjAction;
      if (!messageId || !action) return;
      await handleBlackjackAction(messageId, action);
    });
  });
  app.querySelectorAll("[data-mines-cell]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const messageId = button.dataset.messageId;
      const cellIndex = Number(button.dataset.minesCell);
      if (!messageId || !Number.isInteger(cellIndex)) return;
      await handleMinesReveal(messageId, cellIndex);
    });
  });
  app.querySelectorAll("[data-mines-collect]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const messageId = button.dataset.messageId;
      if (!messageId) return;
      await handleMinesCollect(messageId);
    });
  });
  app.querySelectorAll("[data-dragon-collect]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const messageId = button.dataset.messageId;
      if (!messageId) return;
      await handleDragonCollect(messageId);
    });
  });
  app.querySelectorAll("[data-dragon-join]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const messageId = button.dataset.messageId;
      if (!messageId) return;
      await handleDragonJoin(messageId);
    });
  });
  app.querySelectorAll("[data-dragon-hub-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.dragonHubAction;
      if (!action || action === "noop") return;
      await handleDragonHubAction(action);
    });
  });
  app.querySelectorAll("[data-open-dragon-modal]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const messageId = button.dataset.openDragonModal;
      if (!messageId) return;
      openDragonModal(messageId);
    });
  });
  const dragonModalBackdrop = document.getElementById("dragonModalBackdrop");
  if (dragonModalBackdrop) {
    dragonModalBackdrop.addEventListener("click", (event) => {
      if (event.target === dragonModalBackdrop) {
        closeDragonModal();
      }
    });
  }
  const closeDragonModalButton = document.getElementById("closeDragonModalButton");
  if (closeDragonModalButton) {
    closeDragonModalButton.addEventListener("click", closeDragonModal);
  }

  const form = document.getElementById("composerForm");
  const input = document.getElementById("composerInput");
  const searchInput = document.getElementById("messageSearchInput");
  const messagesPane = document.querySelector(".messages");
  const scrollButton = document.getElementById("scrollToBottomButton");
  if (messagesPane) {
    messagesPane.addEventListener("scroll", () => {
      state.messagePanePinnedToBottom = isNearBottom(messagesPane);
      const button = document.getElementById("scrollToBottomButton");
      if (button) {
        button.classList.toggle("visible", !state.messagePanePinnedToBottom);
      }
    });
  }
  if (scrollButton) {
    scrollButton.addEventListener("click", () => {
      state.forceScrollToBottom = true;
      state.messagePanePinnedToBottom = true;
      scrollMessagesToBottom(messagesPane);
      const button = document.getElementById("scrollToBottomButton");
      if (button) {
        button.classList.remove("visible");
      }
    });
  }
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.searchQuery = searchInput.value;
      state.highlightedMessageId = "";
      render();
    });
  }
  app.querySelectorAll("[data-message-id]").forEach((messageRow) => {
    messageRow.addEventListener("click", () => {
      if (messageRow.classList.contains("message-dragon")) {
        openDragonModal(messageRow.dataset.messageId);
        return;
      }
      if (!state.searchQuery.trim()) return;
      focusMessage(messageRow.dataset.messageId);
    });
  });
  if (!form || !input) {
    return;
  }
  input.addEventListener("input", () => {
    state.composerDraft = input.value;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    if (isClearChatCommand(value)) {
      state.composerDraft = "";
      input.value = "";
      clearCurrentChannelLocally();
      return;
    }
    input.value = "";
    state.composerDraft = "";
    state.keepComposerFocus = true;
    await submitMessage(value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
}

function renderAdmin() {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeAdminTab));
  document.getElementById("channelsPanel").classList.add("active");

  channelCategory.innerHTML = `<option value="">Kategori Seç (Opsiyonel)</option>${state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("")}`;

  channelList.innerHTML = state.channels.map((channel) => `
      <div class="item">
        <span class="item-name">${escapeHtml(channel.name)}</span>
        <button type="button" class="icon-danger" data-delete-channel-id="${channel.id}" aria-label="Sil">${icon("trash", 16)}</button>
      </div>`).join("");

  bindAdmin();
}

function bindAdmin() {
  channelList.querySelectorAll("[data-delete-channel-id]").forEach((button) => button.addEventListener("click", () => {
    if (state.channels.length === 1) return;
    const id = button.dataset.deleteChannelId;
    state.channels = state.channels.filter((channel) => channel.id !== id);
    delete state.messagesByChannel[id];
    if (!state.channels.find((channel) => channel.id === state.selectedChannelId)) {
      state.selectedChannelId = state.channels[0].id;
      syncUrl(state.selectedChannelId, true);
    }
    render();
    renderAdmin();
  }));
}

function renderUserModal() {
  adminBadge.hidden = !state.currentUser.isAdmin;
  categoryList.innerHTML = state.categories.length
    ? state.categories.map((category) => `
          <div class="item">
            <span class="item-name">${escapeHtml(category.name)}</span>
            <button type="button" class="icon-danger" data-delete-category-id="${category.id}" aria-label="Sil">${icon("trash", 16)}</button>
          </div>`).join("")
    : '<p class="item-subtext" style="text-align:center;padding:16px 0;">Henüz kategori eklenmemiş</p>';

  categoryList.querySelectorAll("[data-delete-category-id]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.deleteCategoryId;
    state.categories = state.categories.filter((category) => category.id !== id);
    state.channels = state.channels.map((channel) => channel.categoryId === id ? { ...channel, categoryId: "" } : channel);
    render();
    renderAdmin();
    renderUserModal();
  }));
}

function addChannel(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("channelName") || "").trim();
  const categoryId = String(form.get("channelCategory") || "");
  if (!name) return;

  const nextId = String(Math.max(0, ...state.channels.map((channel) => Number(channel.id) || 0)) + 1);
  state.channels.push({ id: nextId, name, categoryId });
  state.messagesByChannel[nextId] ||= [];
  event.currentTarget.reset();
  render();
  renderAdmin();
}

function addCategory(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("categoryName") || "").trim();
  if (!name) return;

  state.categories.push({ id: uid(), name, collapsed: false });
  event.currentTarget.reset();
  render();
  renderAdmin();
  renderUserModal();
}

async function submitMessage(content) {
  const message = makeMessage({ type: "text", content });
  appendLocalMessage(message);
  await persistMessage(message);
}

async function sendGameMessage(game, label) {
  if (game === "blackjack") {
    if (findActiveBlackjackMessageForCurrentUser()) {
      showToast("Önce aktif oyununu bitir.");
      return;
    }
    const message = makeMessage({
      type: "blackjack",
      content: createBlackjackGameState()
    });
    appendLocalMessage(message);
    markAnimatingCards(getAllBlackjackCardKeys(message));
    await persistMessage(message);
    return;
  }

  if (game === "mines") {
    if (findActiveMinesMessageForCurrentUser()) {
      showToast("Önce aktif mines oyununu bitir.");
      return;
    }
    const message = makeMessage({
      type: "mines",
      content: createMinesGameState(state.preferredMineCount)
    });
    appendLocalMessage(message);
    await persistMessage(message);
    return;
  }

    if (game === "dragon") {
      const activeDragonMessage = findVisibleActiveDragonMessage();
      if (activeDragonMessage) {
        const activeDragon = normalizeDragonState(activeDragonMessage.content);
        const alreadyJoined = Boolean(getDragonParticipant(activeDragon, state.currentUser.id));
        openDragonModal(activeDragonMessage.id);
        showToast(alreadyJoined ? "Aktif ejderha acildi." : "Aktif ejderhaya katil.");
        return;
      }
      const message = makeMessage({
        type: "dragon",
        content: createDragonGameState()
      });
      appendLocalMessage(message);
      state.dragonModalMessageId = message.id;
      await persistMessage(message);
      return;
    }

  const message = makeMessage({ type: "game", content: buildGameMessage(game, label) });
  appendLocalMessage(message);
  await persistMessage(message);
}

function openMinesSetup() {
  if (state.isMessagesLoading) return;
  if (findActiveMinesMessageForCurrentUser()) {
    closeMinesSetup();
    showToast("Önce aktif mines oyununu bitir.");
    return;
  }
  state.minesSetupOpen = !state.minesSetupOpen;
  render();
}

function closeMinesSetup() {
  if (!state.minesSetupOpen) return;
  state.minesSetupOpen = false;
  render();
}

async function startConfiguredMinesGame() {
  if (state.isMessagesLoading) return;
  if (findActiveMinesMessageForCurrentUser()) {
    closeMinesSetup();
    showToast("Önce aktif mines oyununu bitir.");
    return;
  }
  state.minesSetupOpen = false;
  render();
  await sendGameMessage("mines", "💣 Mines");
}

function appendLocalMessage(message) {
  const channel = selectedChannel();
  if (!channel) return;

  state.pendingMessagesByChannel[channel.id] ||= [];
  state.pendingMessagesByChannel[channel.id] = sortMessages([...(state.pendingMessagesByChannel[channel.id] || []), message]);
  state.messagesByChannel[channel.id] ||= [];
  state.messagesByChannel[channel.id] = sortMessages([...(state.messagesByChannel[channel.id] || []), message]);
  state.forceScrollToBottom = true;
  render();
}

function replaceLocalMessage(message, options = {}) {
  const { shouldRender = true } = options;
  const channelId = message.channelId || selectedChannel()?.id;
  if (!channelId) return;

  const replaceInList = (list) => {
    const nextList = [...(list || [])];
    const index = nextList.findIndex((entry) => entry.id === message.id);
    if (index === -1) {
      nextList.push(message);
    } else {
      nextList[index] = message;
    }
    return sortMessages(nextList);
  };

  const previousList = state.messagesByChannel[channelId] || [];
  const nextList = replaceInList(previousList);
  state.messagesByChannel[channelId] = nextList;
  state.pendingMessagesByChannel[channelId] = (state.pendingMessagesByChannel[channelId] || [])
    .filter((entry) => entry.id !== message.id);
  if (shouldRender && JSON.stringify(previousList) !== JSON.stringify(nextList)) {
    render();
  }
}

async function persistMessage(message) {
  const channel = selectedChannel();
  if (!channel) return;

  try {
    const response = await fetch("/api/messages", {
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

async function persistMessageUpdate(message) {
  try {
    const response = await fetch("/api/messages", {
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

function makeMessage({ type, content }) {
  const createdAtMs = Date.now();
  const channelId = selectedChannel()?.id || state.selectedChannelId;
  return {
    id: uid(),
    channelId,
    author: state.currentUser.displayName,
    avatar: state.currentUser.displayName,
    avatarUrl: state.currentUser.avatarUrl,
    createdAt: new Date(createdAtMs).toISOString(),
    createdAtMs,
    type,
    content
  };
}

function buildGameMessage(game, label) {
  if (game === "blackjack") {
    const score = randomInt(15, 23);
    return `${label}\nEl sonucu: ${score}\n${score > 21 ? "Bust oldun." : score >= 20 ? "Harika el!" : "Orta karar bir el."}`;
  }
  if (game === "mines") {
    const gems = randomInt(1, 4);
    const hitMine = Math.random() > 0.55;
    return `${label}\n${hitMine ? "Mayına bastın." : `${gems} elmas topladın.`}`;
  }
  if (game === "dice") {
    return `${label}\nZar sonucu: ${randomInt(1, 6)}`;
  }
  const rewards = ["Nadir skin", "XP boost", "Boş kutu", "Jeton paketi"];
  return `${label}\nKasadan çıkan: ${rewards[randomInt(0, rewards.length - 1)]}`;
}

function selectChannel(id) {
  const validChannel = state.channels.find((channel) => channel.id === id);
  const validCasinoItem = CASINO_ITEMS.find((item) => item.id === id);
  if (!validChannel && !validCasinoItem) return;
  state.selectedChannelId = id;
  syncUrl(id);
  render();
}

function selectedChannel() {
  return state.channels.find((channel) => channel.id === state.selectedChannelId) || null;
}

function isCasinoDragonView(id = state.selectedChannelId) {
  return id === DRAGON_CHANNEL_ID;
}

function initialChannelId() {
  const fromHash = window.location.hash.match(/channel\/([^/?#]+)/);
  const fromPath = window.location.pathname.match(/channel\/([^/?#]+)/);
  return fromHash?.[1] || fromPath?.[1] || "1";
}

function syncUrl(id, replace = false) {
  if (!id) return;
  const url = window.location.protocol === "file:" ? `#channel/${id}` : `/channel/${id}`;
  if (replace) history.replaceState({}, "", url);
  else history.pushState({}, "", url);
}

function channelHref(id) {
  return window.location.protocol === "file:" ? `#channel/${id}` : `/channel/${id}`;
}

function openAdminModal() {
  if (!state.currentUser.isAdmin) return;
  adminBackdrop.classList.add("open");
  adminBackdrop.setAttribute("aria-hidden", "false");
}

function closeAdminModal() {
  adminBackdrop.classList.remove("open");
  adminBackdrop.setAttribute("aria-hidden", "true");
}

function openUserModal() {
  if (!state.currentUser.isAdmin) return;
  userBackdrop.classList.add("open");
  userBackdrop.setAttribute("aria-hidden", "false");
}

function closeUserModal() {
  userBackdrop.classList.remove("open");
  userBackdrop.setAttribute("aria-hidden", "true");
}

function buildScopeKey() {
  const guildId = state.discordSdk?.guildId || "noguild";
  const channelId = state.discordSdk?.channelId || "nochannel";
  return `${guildId}:${channelId}`;
}

function buildEmptyMessageState() {
  return Object.fromEntries(DEFAULT_CHANNELS.map((channel) => [channel.id, []]));
}

function mergeMessages(channels) {
  const merged = buildEmptyMessageState();
  for (const [channelId, list] of Object.entries(channels)) {
    merged[channelId] = Array.isArray(list) ? sortMessages(list) : [];
  }
  return merged;
}

function shouldPreferLocalMessage(localMessage, remoteMessage) {
  if (localMessage?.type !== "blackjack" || remoteMessage?.type !== "blackjack") {
    return false;
  }

  return getBlackjackRevision(localMessage) > getBlackjackRevision(remoteMessage);
}

function getBlackjackRevision(message) {
  if (message?.type !== "blackjack") return 0;
  const game = normalizeBlackjackState(message.content);
  const revision = Number(game?.revision);
  return Number.isFinite(revision) && revision > 0 ? revision : 1;
}

function syncUserTag() {
  userModalTag.textContent = `${state.currentUser.displayName} (${state.currentUser.tag})`;
}

function computeIsAdmin(user) {
  if (MOCK_MODE) return true;

  const userId = String(user?.id || "");
  const username = String(user?.username || "").toLocaleLowerCase();
  const globalName = String(user?.global_name || "").toLocaleLowerCase();

  return ADMIN_USER_IDS.includes(userId)
    || ADMIN_USERNAMES.includes(username)
    || ADMIN_USERNAMES.includes(globalName);
}

function focusComposer() {
  const input = document.getElementById("composerInput");
  if (!input) return;

  input.focus();
  const cursor = input.value.length;
  try {
    input.setSelectionRange(cursor, cursor);
  } catch {
    // Selection APIs are best-effort in embedded browsers.
  }
  state.keepComposerFocus = false;
}

function focusSearch() {
  const input = document.getElementById("messageSearchInput");
  if (!input) return;

  input.focus();
  const cursor = input.value.length;
  try {
    input.setSelectionRange(cursor, cursor);
  } catch {
    // Selection APIs are best-effort in embedded browsers.
  }
}

function scrollMessagesToBottom(pane = document.querySelector(".messages")) {
  if (!pane) return;
  pane.scrollTop = pane.scrollHeight;
}

function focusMessage(messageId) {
  if (!messageId) return;
  state.highlightedMessageId = messageId;
  render();
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-message-id="${cssEscape(messageId)}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function renderToast() {
  if (!state.toastMessage) return "";
  return `<div class="toast" role="status" aria-live="polite">${escapeHtml(state.toastMessage)}</div>`;
}

function renderChatLoadingState() {
  return `<div class="chat-loading"><div class="chat-loading-spinner"></div><div class="chat-loading-text">Chat yükleniyor...</div></div>`;
}

function renderScrollToBottomButton() {
  const hidden = state.messagePanePinnedToBottom || state.isMessagesLoading;
  return `<button type="button" id="scrollToBottomButton" class="scroll-to-bottom ${hidden ? "" : "visible"}" aria-label="En alta git">${icon("chevron-down", 18)}</button>`;
}

function renderMinesSetupPopover() {
  if (!state.minesSetupOpen || state.isMessagesLoading) return "";
  return `
    <div class="mines-setup-popover" role="dialog" aria-modal="false" aria-label="Mines ayari">
      <div class="mines-setup-title">Kaç mayın olsun?</div>
      <div class="mine-option-row">
        ${MINES_MINE_OPTIONS.map((count) => `<button type="button" class="mine-option ${state.preferredMineCount === count ? "is-active" : ""}" data-mine-option="${count}">${count}</button>`).join("")}
      </div>
      <div class="inline-modal-hint">Sabit oyun degeri: ${MINES_BASE_STAKE} coin</div>
      <div class="mines-setup-actions">
        <button type="button" class="btn btn-primary mines-setup-play" id="startMinesGameButton">Oyna</button>
      </div>
    </div>
  `;
}

function showToast(message) {
  state.toastMessage = message;
  render();
  window.clearTimeout(toastTimeoutHandle);
  toastTimeoutHandle = window.setTimeout(() => {
    state.toastMessage = "";
    render();
  }, 2200);
}

function isNearBottom(element) {
  if (!element) return true;
  const threshold = 24;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
}

function formatMessageTime(message) {
  const timestamp = normalizeMessageTimestamp(message);
  if (!timestamp) {
    return message?.time || "";
  }

  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function sortMessages(messages) {
  return [...messages].sort((left, right) => {
    const timeDiff = normalizeMessageTimestamp(left) - normalizeMessageTimestamp(right);
    if (timeDiff !== 0) return timeDiff;
    return String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function filterMessages(messages, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return messages;
  }

  return messages.filter((message) => {
    const haystack = [
      message.author,
      getSearchableMessageText(message),
      message.type
    ].join(" ").toLocaleLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function highlightText(value, query) {
  return applyHighlightMarkup(escapeHtml(String(value || "")), query);
}

function highlightMultilineText(value, query) {
  return applyHighlightMarkup(escapeHtml(String(value || "")).replaceAll("\n", "<br>"), query);
}

function applyHighlightMarkup(escapedText, query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return escapedText;
  }

  const escapedQuery = escapeRegExp(escapeHtml(normalizedQuery));
  return escapedText.replace(new RegExp(`(${escapedQuery})`, "gi"), '<mark class="message-mark">$1</mark>');
}

function renderEmptyMessageState(channel) {
  if (state.searchQuery.trim()) {
    return `<div class="empty-state">"${escapeHtml(state.searchQuery)}" icin bu kanalda sonuc bulunamadi.</div>`;
  }

  return `<div class="empty-state">${escapeHtml(channel?.name || "Bu kanalda")} icin henuz mesaj yok. Ilk mesaji gonderin!</div>`;
}

function renderMessageContent(message) {
  if (message.type === "blackjack") {
    return renderBlackjackMessage(message);
  }
  if (message.type === "mines") {
    return renderMinesMessage(message);
  }
  if (message.type === "dragon") {
    return renderDragonMessage(message);
  }

  return `<div class="message-text">${highlightMultilineText(message.content, state.searchQuery)}</div>`;
}

function getBlackjackStatusLine(game, activeHand, ownerCanPlay) {
  if (game.status === "finished") {
    return decorateBlackjackSummary(game.resultSummary);
  }

  return "";
}

function renderBlackjackMessage(message) {
  const game = normalizeBlackjackState(message.content);
  const ownerCanPlay = game.ownerId === state.currentUser.id;
  const activeHand = game.hands[game.activeHandIndex] || null;
  const actions = getBlackjackActions(game, activeHand);
  const resultTone = getBlackjackResultTone(game.resultSummary);
  const statusLine = game.status === "finished"
    ? ""
    : getBlackjackStatusLine(game, activeHand, ownerCanPlay);
  const resultTitle = game.status === "finished" ? renderBlackjackResultTitle(game.resultSummary) : "";

  return `
    <div class="blackjack-card">
      ${resultTitle || statusLine ? `
        <div class="blackjack-summary">
          ${resultTitle ? `<div class="blackjack-summary-main ${resultTone ? `is-${resultTone}` : ""}">${escapeHtml(resultTitle)}</div>` : ""}
          ${statusLine ? `<div class="blackjack-summary-sub ${resultTone ? `is-${resultTone}` : ""}">${escapeHtml(statusLine)}</div>` : ""}
        </div>
      ` : ""}
      <div class="blackjack-table">
        <section class="blackjack-seat">
          <div class="blackjack-seat-label">Kasa</div>
          <div class="blackjack-cards">${game.dealer.cards.map((card) => renderPlayingCard(message.id, card)).join("")}</div>
          <div class="blackjack-total">${escapeHtml(renderDealerTotal(game))}</div>
        </section>
        <section class="blackjack-hands">
          ${game.hands.map((hand, index) => renderBlackjackHand(message.id, hand, index, game.activeHandIndex)).join("")}
        </section>
      </div>
      <div class="blackjack-controls">
        ${renderBlackjackActionButton(message.id, "hit", actions.hit, ownerCanPlay)}
        ${renderBlackjackActionButton(message.id, "stand", actions.stand, ownerCanPlay)}
        ${renderBlackjackActionButton(message.id, "double", actions.double, ownerCanPlay)}
        ${renderBlackjackActionButton(message.id, "split", actions.split, ownerCanPlay)}
      </div>
    </div>
  `;
}

function renderBlackjackHand(messageId, hand, index, activeHandIndex) {
  const totals = calculateHandTotals(hand.cards);
  const totalLabel = totals.best > 21 ? `Bust (${totals.best})` : `Toplam: ${totals.best}`;
  const handLabel = hand.isSplitHand ? `El ${index + 1}` : "Oyuncu";
  const flags = [
    hand.isSplitAces ? "Split As" : "",
    hand.doubled ? "Double" : "",
    formatBlackjackResultLabel(hand.resultLabel)
  ].filter(Boolean);
  const tone = getBlackjackResultTone(hand.resultLabel);

  return `
    <div class="blackjack-hand ${index === activeHandIndex ? "is-active" : ""}">
      <div class="blackjack-seat-label">${escapeHtml(handLabel)}</div>
      <div class="blackjack-cards">${hand.cards.map((card) => renderPlayingCard(messageId, card)).join("")}</div>
      <div class="blackjack-total">${escapeHtml(totalLabel)}</div>
      ${flags.length ? `<div class="blackjack-flags ${tone ? `is-${tone}` : ""}">${flags.map((flag) => `<span class="blackjack-flag">${escapeHtml(flag)}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderPlayingCard(messageId, card) {
  const suit = BLACKJACK_SUITS.find((item) => item.key === card.suit) || BLACKJACK_SUITS[0];
  const animate = state.animatingCardKeys.includes(`${messageId}:${card.id}`) ? " flip-in" : "";

  if (card.hidden) {
    return `<div class="playing-card is-face-down${animate}" data-card-id="${escapeAttr(card.id)}"><div class="playing-card-back"></div></div>`;
  }

  return `
    <div class="playing-card ${suit.color === "red" ? "is-red" : ""}${animate}" data-card-id="${escapeAttr(card.id)}">
      <div class="playing-card-corner">${escapeHtml(card.rank)}${escapeHtml(suit.symbol)}</div>
      <div class="playing-card-center">${escapeHtml(suit.symbol)}</div>
    </div>
  `;
}

function renderBlackjackActionButton(messageId, action, enabled, ownerCanPlay) {
  const disabled = state.isMessagesLoading || !enabled || !ownerCanPlay || Boolean(state.interactiveActionLocks[messageId]);
  const labels = {
    hit: "Hit",
    stand: "Stand",
    double: "2x Double",
    split: "Split"
  };
  return `<button type="button" class="btn blackjack-action is-${action}" data-bj-action="${action}" data-message-id="${escapeAttr(messageId)}" ${disabled ? "disabled" : ""}>${escapeHtml(labels[action] || action)}</button>`;
}

async function handleBlackjackAction(messageId, action) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "blackjack") return;
  if (state.interactiveActionLocks[messageId]) return;

  const game = normalizeBlackjackState(message.content);
  if (game.ownerId !== state.currentUser.id || game.status === "finished") return;

  const nextGame = applyBlackjackAction(game, action);
  if (!nextGame) return;

  const nextMessage = {
    ...message,
    content: nextGame
  };

  markAnimatingCards(collectBlackjackCardChanges(message, nextMessage));
  state.remoteSyncEpoch += 1;
  state.interactiveActionLocks[message.id] = true;
  state.pendingUpdatedMessages[message.id] = nextMessage;
  replaceLocalMessage(nextMessage);
  await persistMessageUpdate(nextMessage);
  delete state.interactiveActionLocks[message.id];
  void loadPersistedMessages();
}

function findActiveBlackjackMessageForCurrentUser() {
  const messages = getVisibleMessagesForChannel(selectedChannel()?.id);
  return messages.find((message) => {
    if (message?.type !== "blackjack") return false;
    const game = normalizeBlackjackState(message.content);
    return game.ownerId === state.currentUser.id && game.status !== "finished";
  }) || null;
}

function renderMinesMessage(message) {
  const game = normalizeMinesState(message.content);
  const ownerCanPlay = game.ownerId === state.currentUser.id;
  const disabled = state.isMessagesLoading || game.status !== "playing" || !ownerCanPlay;
  const tone = getMinesResultTone(game.status);
  const title = renderMinesTitle(game);
  const stats = getMinesStats(game);

  return `
    <div class="mines-card">
      <div class="mines-topbar">
        <div class="mines-pill-row">${renderMinesPills(game)}</div>
        ${title ? `<div class="mines-result ${tone ? `is-${tone}` : ""}">${escapeHtml(title)}</div>` : ""}
      </div>
      <div class="mines-board">
        ${game.cells.map((cell, index) => renderMinesCell(message.id, cell, index, disabled)).join("")}
      </div>
      <div class="mines-footer">
        <div class="mines-stat">
          <span class="mines-label">Mayin</span>
          <strong>${escapeHtml(String(game.mineCount))}</strong>
        </div>
        <div class="mines-stat">
          <span class="mines-label">Collectable</span>
          <strong>${escapeHtml(formatCoinValue(stats.collectable))}</strong>
        </div>
        <div class="mines-stat">
          <span class="mines-label">Carpan</span>
          <strong>${escapeHtml(formatMultiplier(game.multiplier))}</strong>
        </div>
        <button type="button" class="btn mines-collect ${tone ? `is-${tone}` : ""}" data-mines-collect data-message-id="${escapeAttr(message.id)}" ${game.status !== "playing" || disabled || game.revealedSafeCount === 0 ? "disabled" : ""}>Collect</button>
      </div>
    </div>
  `;
}

function renderDragonMessage(message) {
  const game = normalizeDragonState(message.content);
  const phase = getDragonPhase(game);
  const joinedCount = (game.participants || []).length;
  const cashedCount = (game.participants || []).filter((entry) => entry.status === "cashed_out").length;
  const crashNow = phase === "playing" && shouldDragonCrash(game);
  const multiplier = phase === "playing"
    ? getDragonLiveMultiplier(game)
    : roundMultiplier(game.finalMultiplier || game.crashAtMultiplier || 1);
  const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - Date.now()) / 1000));
  const tone = game.status === "crashed" ? "is-loss" : cashedCount ? "is-win" : "";
  const statusLabel = phase === "lobby"
    ? `Alev ${secondsLeft}s sonra basliyor`
    : phase === "playing" && !crashNow
      ? "Ejderha ates ufleyerek ilerliyor"
      : (game.resultSummary || "EJDERHA PATLADI 💥");

  return `
    <div class="dragon-card ${tone}">
      <div class="dragon-header">
        <div>
          <div class="dragon-title">Ejderha</div>
          <div class="dragon-status">${escapeHtml(statusLabel)}</div>
        </div>
        <div class="dragon-multiplier ${tone}">${escapeHtml(formatMultiplier(multiplier))}</div>
      </div>
      <div class="dragon-participants">
        <span class="dragon-summary-pill">${escapeHtml(String(joinedCount))} katilim</span>
        <span class="dragon-summary-pill">${escapeHtml(String(cashedCount))} cekis</span>
        ${(game.participants || []).slice(0, 4).map((entry) => renderDragonParticipant(entry)).join("")}
      </div>
      <div class="dragon-stats">
        <div class="dragon-stat">
          <span class="dragon-label">Deger</span>
          <strong>${escapeHtml(formatCoinValue(game.baseStake))}</strong>
        </div>
        <div class="dragon-stat">
          <span class="dragon-label">Durum</span>
          <strong>${escapeHtml(phase === "lobby" ? `${secondsLeft}s` : formatMultiplier(multiplier))}</strong>
        </div>
        <button type="button" class="btn dragon-open" data-open-dragon-modal="${escapeAttr(message.id)}">Ac</button>
      </div>
    </div>
  `;
}

function renderDragonParticipant(entry) {
  const tone = entry.status === "cashed_out" ? "is-win" : entry.status === "crashed" ? "is-loss" : "";
  const suffix = entry.status === "cashed_out"
    ? ` ${formatMultiplier(entry.cashoutMultiplier)}`
    : entry.status === "crashed"
      ? " 💥"
      : "";
  return `<span class="dragon-participant ${tone}">${escapeHtml(entry.name)}${escapeHtml(suffix)}</span>`;
}

function renderDragonRealtimeView() {
  const session = state.dragonSession;
  if (state.dragonStateLoading) {
    return `<section class="dragon-screen"><div class="chat-loading"><div class="chat-loading-spinner"></div><div class="chat-loading-text">Ejderha yukleniyor...</div></div></section>`;
  }

  if (!session) {
    return `
      <section class="dragon-screen">
        <div class="dragon-hub-empty">
          <div class="dragon-modal-title">Ejderha</div>
          <div class="dragon-modal-subtitle">Canli oyun burada akacak.</div>
          <button type="button" class="btn dragon-modal-action" data-dragon-hub-action="start">Baslat</button>
        </div>
      </section>
    `;
  }

  const game = normalizeDragonState(session.content);
  const phase = getDragonPhase(game);
  const participant = getDragonParticipant(game, state.currentUser.id);
  const joined = Boolean(participant);
  const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - Date.now()) / 1000));
  const multiplier = phase === "playing" ? getDragonLiveMultiplier(game) : roundMultiplier(game.finalMultiplier || 1);
  const collectible = participant?.status === "cashed_out"
    ? participant.cashoutValue
    : phase === "playing" && participant?.status === "joined"
      ? roundCoinValue(game.baseStake * multiplier)
      : 0;
  const action = !session
    ? `<button type="button" class="btn dragon-modal-action" data-dragon-hub-action="start">Baslat</button>`
    : phase === "lobby"
      ? `<button type="button" class="btn dragon-modal-action" data-dragon-hub-action="${joined ? "noop" : "join"}" ${joined ? "disabled" : ""}>${joined ? "Katildin" : "Katil"}</button>`
      : phase === "playing"
        ? `<button type="button" class="btn dragon-modal-action" data-dragon-hub-action="cashout" ${!joined || participant?.status !== "joined" ? "disabled" : ""}>Cek</button>`
        : `<button type="button" class="btn dragon-modal-action" data-dragon-hub-action="start">Yeni Tur</button>`;

  return `
    <section class="dragon-screen">
      <div class="dragon-screen-inner">
        <div class="dragon-modal-header">
          <div>
            <div class="dragon-modal-title">Ejderha</div>
            <div class="dragon-modal-subtitle">${escapeHtml(phase === "lobby" ? `Baslangica ${secondsLeft}s var` : (game.resultSummary || "Ejderha oyunda"))}</div>
          </div>
          <div class="dragon-modal-multiplier" data-dragon-live-multiplier>${escapeHtml(formatMultiplier(multiplier))}</div>
        </div>
        <div class="dragon-modal-scene ${phase === "playing" ? "is-live" : ""} ${game.status === "crashed" ? "is-crashed" : ""}">
          <div class="dragon-modal-dragon">${game.status === "crashed" ? "💥" : "🐉"}</div>
          <div class="dragon-modal-fire" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        </div>
        <div class="dragon-modal-stats">
          <div class="dragon-stat">
            <span class="dragon-label">Deger</span>
            <strong>${escapeHtml(formatCoinValue(game.baseStake))}</strong>
          </div>
          <div class="dragon-stat">
            <span class="dragon-label">${phase === "lobby" ? "Sen" : "Cekilebilir"}</span>
            <strong data-dragon-live-collectible>${escapeHtml(formatCoinValue(collectible))}</strong>
          </div>
          <div class="dragon-stat">
            <span class="dragon-label">Oyuncu</span>
            <strong>${escapeHtml(String((game.participants || []).length))}</strong>
          </div>
        </div>
        <div class="dragon-modal-actions">${action}</div>
        <div class="dragon-participants is-modal">
          ${(game.participants || []).map((entry) => renderDragonParticipant(entry)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderDragonModal() {
  const message = state.dragonModalMessageId ? findMessageById(state.dragonModalMessageId) : null;
  if (!message || message.type !== "dragon") return "";

  const game = normalizeDragonState(message.content);
  const phase = getDragonPhase(game);
  const participant = getDragonParticipant(game, state.currentUser.id);
  const joined = Boolean(participant);
  const multiplier = phase === "playing"
    ? getDragonLiveMultiplier(game)
    : roundMultiplier(game.finalMultiplier || 1);
  const collectible = participant?.status === "cashed_out"
    ? participant.cashoutValue
    : phase === "playing" && participant?.status === "joined"
      ? roundCoinValue(game.baseStake * multiplier)
      : 0;
  const disabled = state.isMessagesLoading || Boolean(state.interactiveActionLocks[message.id]);
  const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - Date.now()) / 1000));
  const joinedCount = (game.participants || []).length;
  const action = phase === "lobby"
    ? `<button type="button" class="btn dragon-modal-action" data-dragon-join data-message-id="${escapeAttr(message.id)}" ${disabled || joined ? "disabled" : ""}>${joined ? "Katildin" : "Katil"}</button>`
    : `<button type="button" class="btn dragon-modal-action" data-dragon-collect data-message-id="${escapeAttr(message.id)}" ${disabled || !joined || participant?.status !== "joined" ? "disabled" : ""}>Cek</button>`;

  return `
    <div class="dragon-modal-backdrop" id="dragonModalBackdrop">
      <div class="dragon-modal" role="dialog" aria-modal="true" aria-label="Ejderha oyunu">
        <button type="button" class="dragon-modal-close" id="closeDragonModalButton" aria-label="Kapat">${icon("close", 18)}</button>
        <div class="dragon-modal-header">
          <div>
            <div class="dragon-modal-title">Ejderha</div>
            <div class="dragon-modal-subtitle">${escapeHtml(phase === "lobby" ? `Baslangica ${secondsLeft}s var` : (game.resultSummary || "Ejderha oyunda"))}</div>
          </div>
          <div class="dragon-modal-multiplier" data-dragon-live-multiplier>${escapeHtml(formatMultiplier(multiplier))}</div>
        </div>
        <div class="dragon-modal-scene ${phase === "playing" ? "is-live" : ""} ${game.status === "crashed" ? "is-crashed" : ""}">
          <div class="dragon-modal-dragon">${game.status === "crashed" ? "💥" : "🐉"}</div>
          <div class="dragon-modal-fire" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        </div>
        <div class="dragon-modal-stats">
          <div class="dragon-stat">
            <span class="dragon-label">Deger</span>
            <strong>${escapeHtml(formatCoinValue(game.baseStake))}</strong>
          </div>
          <div class="dragon-stat">
            <span class="dragon-label">${phase === "lobby" ? "Sen" : "Cekilebilir"}</span>
            <strong data-dragon-live-collectible>${escapeHtml(formatCoinValue(collectible))}</strong>
          </div>
          <div class="dragon-stat">
            <span class="dragon-label">Oyuncu</span>
            <strong>${escapeHtml(String(joinedCount))}</strong>
          </div>
        </div>
        <div class="dragon-modal-actions">
          ${action}
        </div>
        <div class="dragon-participants is-modal">
          ${(game.participants || []).map((entry) => renderDragonParticipant(entry)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderMinesPills(game) {
  const nextMultipliers = getNextMinesMultipliers(game).slice(0, 5);
  return nextMultipliers.map((value, index) => `<span class="mines-pill ${index === 0 ? "is-current" : ""}">${escapeHtml(formatMultiplier(value))}</span>`).join("");
}

function renderMinesCell(messageId, cell, index, disabled) {
  const revealed = cell.revealed || false;
  const cellClass = revealed
    ? cell.isMine
      ? index === Number(cell.detonatedAtIndex) ? "is-mine is-detonated" : "is-mine"
      : "is-safe"
    : "";
  const content = revealed ? (cell.isMine ? "💣" : "💎") : "";
  return `<button type="button" class="mines-cell ${cellClass}" data-mines-cell="${index}" data-message-id="${escapeAttr(messageId)}" ${disabled || revealed ? "disabled" : ""}>${content}</button>`;
}

async function handleMinesReveal(messageId, cellIndex) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "mines") return;
  if (state.isMessagesLoading) return;

  const game = normalizeMinesState(message.content);
  if (game.ownerId !== state.currentUser.id || game.status !== "playing") return;

  const nextGame = revealMinesCell(game, cellIndex);
  if (!nextGame) return;

  await persistInteractiveGameUpdate(message, nextGame);
}

async function handleMinesCollect(messageId) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "mines") return;
  if (state.isMessagesLoading) return;

  const game = normalizeMinesState(message.content);
  if (game.ownerId !== state.currentUser.id || game.status !== "playing" || game.revealedSafeCount === 0) return;

  const nextGame = collectMinesWinnings(game);
  await persistInteractiveGameUpdate(message, nextGame);
}

async function handleDragonCollect(messageId) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "dragon") return;
  if (state.isMessagesLoading || state.interactiveActionLocks[messageId]) return;

  const game = normalizeDragonState(message.content);
  if (getDragonPhase(game) !== "playing") return;

  state.interactiveActionLocks[messageId] = true;
  try {
    await performDragonAction(messageId, "dragon_collect");
  } finally {
    delete state.interactiveActionLocks[messageId];
  }
}

async function handleDragonJoin(messageId) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "dragon") return;
  if (state.isMessagesLoading || state.interactiveActionLocks[messageId]) return;

  state.interactiveActionLocks[messageId] = true;
  try {
    await performDragonAction(messageId, "dragon_join");
  } finally {
    delete state.interactiveActionLocks[messageId];
  }
}

async function performDragonAction(messageId, actionType) {
  const response = await fetch("/api/messages", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scopeKey: state.scopeKey,
      messageId,
      actionType,
      actor: {
        id: state.currentUser.id,
        name: state.currentUser.displayName
      }
    })
  });

  if (!response.ok) {
    throw new Error("Dragon action failed.");
  }

  const payload = await response.json();
  if (payload?.message) {
    replaceLocalMessage(payload.message);
  }
  return payload?.message || null;
}

async function handleDragonHubAction(action) {
  if (state.isMessagesLoading || state.interactiveActionLocks[DRAGON_CHANNEL_ID]) return;
  state.interactiveActionLocks[DRAGON_CHANNEL_ID] = true;
  try {
    const response = await fetch("/api/dragon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeKey: state.scopeKey,
        action,
        actor: {
          id: state.currentUser.id,
          name: state.currentUser.displayName
        }
      })
    });
    if (!response.ok) {
      throw new Error("Dragon action failed.");
    }
    const payload = await response.json();
    state.dragonSession = payload.session || null;
    render();
  } catch (error) {
    console.warn("Dragon hub action failed.", error);
  } finally {
    delete state.interactiveActionLocks[DRAGON_CHANNEL_ID];
  }
}

async function loadDragonSession({ initial = false } = {}) {
  if (initial) {
    state.dragonStateLoading = true;
    if (isCasinoDragonView()) render();
  }

  try {
    const response = await fetch(`/api/dragon?scopeKey=${encodeURIComponent(state.scopeKey)}&ts=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    state.dragonSession = payload.session || null;
  } catch (error) {
    console.warn("Dragon session load failed.", error);
  } finally {
    state.dragonStateLoading = false;
    if (isCasinoDragonView()) render();
  }
}

async function initializeDragonTransport() {
  await loadDragonSession({ initial: true });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    if (!state.dragonRealtimeClient) {
      state.dragonRealtimeClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    if (state.dragonRealtimeChannel) {
      state.dragonRealtimeClient.removeChannel(state.dragonRealtimeChannel);
      state.dragonRealtimeChannel = null;
    }
    state.dragonRealtimeChannel = state.dragonRealtimeClient
      .channel(`dragon-${state.scopeKey}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const row = payload?.new || payload?.old;
        if (!isDragonRealtimeRow(row)) return;
        void loadDragonSession();
      })
      .subscribe();
  } catch (error) {
    console.warn("Dragon realtime subscription failed, falling back to refresh.", error);
  }
}

function isDragonRealtimeRow(row) {
  return row
    && row.scope_key === state.scopeKey
    && row.channel_id === DRAGON_CHANNEL_ID
    && row.message_type === "dragon_state";
}

async function persistInteractiveGameUpdate(message, nextContent) {
  const nextMessage = {
    ...message,
    content: nextContent
  };

  state.remoteSyncEpoch += 1;
  state.pendingUpdatedMessages[message.id] = nextMessage;
  replaceLocalMessage(nextMessage);
  const previousQueue = interactivePersistQueues[message.id] || Promise.resolve();
  const nextQueue = previousQueue
    .catch(() => null)
    .then(async () => {
      await persistMessageUpdate(nextMessage);
    });
  interactivePersistQueues[message.id] = nextQueue;
  await nextQueue.finally(() => {
    if (interactivePersistQueues[message.id] === nextQueue) {
      delete interactivePersistQueues[message.id];
    }
  });
  void loadPersistedMessages();
}

function createMinesGameState(mineCount = state.preferredMineCount) {
  const cells = Array.from({ length: MINES_GRID_SIZE }, (_, index) => ({
    id: uid(),
    index,
    isMine: false,
    revealed: false
  }));

  const safeMineCount = MINES_MINE_OPTIONS.includes(Number(mineCount)) ? Number(mineCount) : MINES_MINE_COUNT;
  const mineIndexes = shuffle(Array.from({ length: MINES_GRID_SIZE }, (_, index) => index)).slice(0, safeMineCount);
  for (const mineIndex of mineIndexes) {
    cells[mineIndex].isMine = true;
  }

  return normalizeMinesState({
    game: "mines",
    ownerId: state.currentUser.id,
    ownerName: state.currentUser.displayName,
    revision: 1,
    status: "playing",
    baseStake: MINES_BASE_STAKE,
    mineCount: safeMineCount,
    revealedSafeCount: 0,
    multiplier: 1,
    collectible: MINES_BASE_STAKE,
    resultSummary: "",
    cells
  });
}

function normalizeMinesState(content) {
  const game = typeof content === "string" ? JSON.parse(content) : cloneData(content);
  game.game ||= "mines";
  game.ownerId ||= state.currentUser.id;
  game.ownerName ||= state.currentUser.displayName;
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.status ||= "playing";
  game.baseStake = Number(game.baseStake) > 0 ? Number(game.baseStake) : MINES_BASE_STAKE;
  game.mineCount = Number(game.mineCount) > 0 ? Number(game.mineCount) : MINES_MINE_COUNT;
  game.cells = Array.isArray(game.cells) ? game.cells : [];
  game.revealedSafeCount = Number(game.revealedSafeCount) >= 0 ? Number(game.revealedSafeCount) : countRevealedMinesSafeCells(game.cells);
  game.multiplier = Number(game.multiplier) > 0 ? Number(game.multiplier) : calculateMinesMultiplier(game.revealedSafeCount, game.mineCount, game.cells.length || MINES_GRID_SIZE);
  game.collectible = Number(game.collectible) > 0 ? Number(game.collectible) : Math.round(game.baseStake * game.multiplier);
  game.detonatedCellIndex = Number.isInteger(Number(game.detonatedCellIndex)) ? Number(game.detonatedCellIndex) : -1;
  game.cells = game.cells.map((cell, index) => ({
    ...cell,
    detonatedAtIndex: Number.isInteger(Number(cell?.detonatedAtIndex)) ? Number(cell.detonatedAtIndex) : (index === game.detonatedCellIndex ? index : -1)
  }));
  game.resultSummary ||= "";
  return game;
}

function revealMinesCell(gameState, cellIndex) {
  const game = normalizeMinesState(gameState);
  if (game.status !== "playing") return null;
  const cell = game.cells[cellIndex];
  if (!cell || cell.revealed) return null;

  game.revision += 1;
  cell.revealed = true;

  if (cell.isMine) {
    game.status = "lost";
    game.detonatedCellIndex = cellIndex;
    cell.detonatedAtIndex = cellIndex;
    game.resultSummary = "KAYBETTIN ☠️";
    revealAllMines(game.cells);
    return game;
  }

  game.revealedSafeCount += 1;
  game.multiplier = calculateMinesMultiplier(game.revealedSafeCount, game.mineCount, game.cells.length || MINES_GRID_SIZE);
  game.collectible = roundCoinValue(game.baseStake * game.multiplier);

  const safeCells = (game.cells.length || MINES_GRID_SIZE) - game.mineCount;
  if (game.revealedSafeCount >= safeCells) {
    game.status = "won";
    game.resultSummary = "KAZANDIN 👑";
    revealAllMines(game.cells);
  }

  return game;
}

function collectMinesWinnings(gameState) {
  const game = normalizeMinesState(gameState);
  game.revision += 1;
  game.status = "cashed_out";
  game.resultSummary = "KAZANDIN 👑";
  revealAllMines(game.cells);
  return game;
}

function createDragonGameState() {
  return normalizeDragonState({
    game: "dragon",
    ownerId: state.currentUser.id,
    ownerName: state.currentUser.displayName,
    revision: 1,
    status: "lobby",
    baseStake: DRAGON_BASE_STAKE,
    launchAtMs: Date.now() + 5000,
    startedAtMs: Date.now() + 5000,
    crashAtMultiplier: generateDragonCrashMultiplier(),
    finalMultiplier: 1,
    collectible: 0,
    resultSummary: "",
    participants: [
      {
        id: state.currentUser.id,
        name: state.currentUser.displayName,
        status: "joined",
        cashoutMultiplier: 0,
        cashoutValue: 0
      }
    ]
  });
}

function normalizeDragonState(content) {
  const game = typeof content === "string" ? JSON.parse(content) : cloneData(content);
  game.game ||= "dragon";
  game.ownerId ||= state.currentUser.id;
  game.ownerName ||= state.currentUser.displayName;
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.status ||= "lobby";
  game.baseStake = Number(game.baseStake) > 0 ? Number(game.baseStake) : DRAGON_BASE_STAKE;
  game.launchAtMs = Number(game.launchAtMs) > 0 ? Number(game.launchAtMs) : Date.now() + 5000;
  game.startedAtMs = Number(game.startedAtMs) > 0 ? Number(game.startedAtMs) : Date.now();
  game.crashAtMultiplier = Number(game.crashAtMultiplier) > 1 ? Number(game.crashAtMultiplier) : generateDragonCrashMultiplier();
  game.finalMultiplier = Number(game.finalMultiplier) > 0 ? Number(game.finalMultiplier) : 1;
  game.collectible = Number(game.collectible) >= 0 ? Number(game.collectible) : game.baseStake;
  game.participants = Array.isArray(game.participants) ? game.participants.map((entry) => ({
    id: entry?.id || uid(),
    name: entry?.name || "Oyuncu",
    status: entry?.status || "joined",
    cashoutMultiplier: Number(entry?.cashoutMultiplier) > 0 ? Number(entry.cashoutMultiplier) : 0,
    cashoutValue: Number(entry?.cashoutValue) > 0 ? Number(entry.cashoutValue) : 0
  })) : [];
  game.resultSummary ||= "";
  return game;
}

function createBlackjackGameState() {
  const deck = createShuffledDeck(6);
  const hands = [
    createBlackjackHand([drawVisibleCard(deck), drawVisibleCard(deck)])
  ];
  const dealer = {
    cards: [drawVisibleCard(deck), drawHiddenCard(deck)],
    resultLabel: ""
  };

  const game = {
    game: "blackjack",
    ownerId: state.currentUser.id,
    ownerName: state.currentUser.displayName,
    revision: 1,
    status: "playing",
    summary: `${state.currentUser.displayName} blackjack oynuyor`,
    resultSummary: "",
    deck,
    dealer,
    hands,
    activeHandIndex: 0
  };

  resolveInitialBlackjack(game);
  return game;
}

function normalizeBlackjackState(content) {
  const game = typeof content === "string" ? JSON.parse(content) : cloneData(content);
  game.deck ||= [];
  game.hands ||= [];
  game.dealer ||= { cards: [] };
  game.status ||= "playing";
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.summary ||= `${game.ownerName || "Oyuncu"} blackjack oynuyor`;
  game.resultSummary ||= "";
  return game;
}

function applyBlackjackAction(gameState, action) {
  const game = cloneData(gameState);
  game.revision = Number(game.revision || 1) + 1;
  const hand = game.hands[game.activeHandIndex];
  if (!hand) return null;

  const actions = getBlackjackActions(game, hand);
  if (!actions[action]) return null;

  if (action === "hit") {
    hand.cards.push(drawVisibleCard(game.deck));
    if (hand.isSplitAces || calculateHandTotals(hand.cards).best >= 21) {
      finalizePlayerHand(game, hand, calculateHandTotals(hand.cards).best > 21 ? "Bust" : "Bekliyor");
      return advanceBlackjackTurn(game);
    }
  }

  if (action === "stand") {
    finalizePlayerHand(game, hand, "Stand");
    return advanceBlackjackTurn(game);
  }

  if (action === "double") {
    hand.doubled = true;
    hand.cards.push(drawVisibleCard(game.deck));
    finalizePlayerHand(game, hand, calculateHandTotals(hand.cards).best > 21 ? "Bust" : "Double");
    return advanceBlackjackTurn(game);
  }

  if (action === "split") {
    splitBlackjackHand(game, game.activeHandIndex);
    return advanceBlackjackTurn(game, true);
  }

  game.summary = `${game.ownerName} blackjack oynuyor`;
  return game;
}

function advanceBlackjackTurn(game, afterSplit = false) {
  if (afterSplit) {
    const activeHand = game.hands[game.activeHandIndex];
    if (activeHand?.isSplitAces && activeHand.completed) {
      return advanceBlackjackTurn(game, false);
    }
    game.summary = `${game.ownerName} el ${game.activeHandIndex + 1} icin karar veriyor`;
    return game;
  }

  while (game.activeHandIndex < game.hands.length && game.hands[game.activeHandIndex].completed) {
    game.activeHandIndex += 1;
  }

  if (game.activeHandIndex >= game.hands.length) {
    resolveDealerAndOutcome(game);
    return game;
  }

  game.summary = `${game.ownerName} el ${game.activeHandIndex + 1} icin karar veriyor`;
  return game;
}

function splitBlackjackHand(game, handIndex) {
  const hand = game.hands[handIndex];
  const [leftCard, rightCard] = hand.cards;
  const splitAces = leftCard.rank === "A" && rightCard.rank === "A";

  const leftHand = createBlackjackHand([leftCard, drawVisibleCard(game.deck)], {
    isSplitHand: true,
    isSplitAces: splitAces
  });
  const rightHand = createBlackjackHand([rightCard, drawVisibleCard(game.deck)], {
    isSplitHand: true,
    isSplitAces: splitAces
  });

  if (splitAces) {
    finalizePlayerHand(leftHand, leftHand, "Split As");
    finalizePlayerHand(rightHand, rightHand, "Split As");
  }

  game.hands.splice(handIndex, 1, leftHand, rightHand);
}

function resolveInitialBlackjack(game) {
  const playerHand = game.hands[0];
  const playerBlackjack = isNaturalBlackjack(playerHand);
  const dealerBlackjack = isNaturalBlackjack({
    cards: game.dealer.cards.map((card) => ({ ...card, hidden: false })),
    isSplitHand: false,
    isSplitAces: false
  });

  if (!playerBlackjack && !dealerBlackjack) {
    game.summary = `${game.ownerName} blackjack oynuyor`;
    return;
  }

  revealDealerCards(game.dealer.cards);
  if (playerBlackjack && dealerBlackjack) {
    playerHand.completed = true;
    playerHand.resultLabel = "Push";
    game.dealer.resultLabel = "Blackjack";
    game.status = "finished";
    game.resultSummary = "Push: iki taraf da blackjack yapti.";
    game.summary = `${game.ownerName} push yapti`;
    return;
  }

  if (playerBlackjack) {
    playerHand.completed = true;
    playerHand.resultLabel = "Blackjack";
    game.status = "finished";
    game.resultSummary = `${game.ownerName} natural blackjack yapti.`;
    game.summary = `${game.ownerName} blackjack yapti`;
    return;
  }

  playerHand.completed = true;
  playerHand.resultLabel = "Kayip";
  game.dealer.resultLabel = "Blackjack";
  game.status = "finished";
  game.resultSummary = "Kasa blackjack yapti.";
  game.summary = `${game.ownerName} kaybetti`;
}

function resolveDealerAndOutcome(game) {
  revealDealerCards(game.dealer.cards);
  if (game.hands.every((hand) => calculateHandTotals(hand.cards).best > 21)) {
    game.dealer.resultLabel = `Toplam ${calculateHandTotals(game.dealer.cards).best}`;
    for (const hand of game.hands) {
      hand.resultLabel = "Kayip";
      hand.completed = true;
    }
    game.status = "finished";
    game.resultSummary = summarizeBlackjackOutcome(game);
    game.summary = `${game.ownerName} blackjack elini bitirdi`;
    return;
  }

  while (shouldDealerHit(game.dealer.cards)) {
    game.dealer.cards.push(drawVisibleCard(game.deck));
  }

  const dealerTotals = calculateHandTotals(game.dealer.cards);
  game.dealer.resultLabel = dealerTotals.best > 21 ? "Bust" : `Toplam ${dealerTotals.best}`;

  for (const hand of game.hands) {
    resolveBlackjackHandOutcome(hand, game.dealer.cards);
  }

  game.status = "finished";
  game.resultSummary = summarizeBlackjackOutcome(game);
  game.summary = `${game.ownerName} blackjack elini bitirdi`;
}

function resolveBlackjackHandOutcome(hand, dealerCards) {
  const handTotals = calculateHandTotals(hand.cards);
  const dealerTotals = calculateHandTotals(dealerCards);
  const dealerBlackjack = isNaturalBlackjack({ cards: dealerCards, isSplitHand: false, isSplitAces: false });
  const playerBlackjack = isNaturalBlackjack(hand);

  hand.completed = true;
  if (handTotals.best > 21) {
    hand.resultLabel = "Bust";
    return;
  }

  if (playerBlackjack && !dealerBlackjack) {
    hand.resultLabel = "Blackjack";
    return;
  }

  if (dealerBlackjack && !playerBlackjack) {
    hand.resultLabel = "Kayip";
    return;
  }

  if (dealerTotals.best > 21) {
    hand.resultLabel = "Kazandi";
    return;
  }

  if (handTotals.best > dealerTotals.best) {
    hand.resultLabel = "Kazandi";
    return;
  }

  if (handTotals.best < dealerTotals.best) {
    hand.resultLabel = "Kayip";
    return;
  }

  hand.resultLabel = "Push";
}

function summarizeBlackjackOutcome(game) {
  return game.hands.map((hand, index) => {
    const label = game.hands.length > 1 ? `El ${index + 1}` : "El";
    return `${label}: ${formatBlackjackResultLabel(hand.resultLabel)}`;
  }).join(" • ");
}

function getBlackjackActions(game, hand) {
  const playing = game.status === "playing" && hand && !hand.completed;
  const totals = hand ? calculateHandTotals(hand.cards) : { best: 0 };
  const canAct = playing && totals.best < 21;

  return {
    hit: Boolean(canAct && !hand.isSplitAces),
    stand: Boolean(playing),
    double: Boolean(canAct && hand.cards.length === 2 && !hand.doubled && !hand.isSplitAces),
    split: Boolean(
      playing
      && hand.cards.length === 2
      && game.hands.length < 4
      && getSplitValue(hand.cards[0]) === getSplitValue(hand.cards[1])
    )
  };
}

function calculateHandTotals(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (card.hidden) continue;
    if (card.rank === "A") {
      aces += 1;
      total += 11;
      continue;
    }

    if (["K", "Q", "J"].includes(card.rank)) {
      total += 10;
      continue;
    }

    total += Number(card.rank);
  }

  let best = total;
  while (best > 21 && aces > 0) {
    best -= 10;
    aces -= 1;
  }

  return {
    best,
    soft: aces > 0
  };
}

function isNaturalBlackjack(hand) {
  if (!hand || hand.isSplitHand || hand.isSplitAces || hand.cards.length !== 2) return false;
  return calculateHandTotals(hand.cards).best === 21;
}

function shouldDealerHit(cards) {
  const totals = calculateHandTotals(cards);
  if (totals.best < 17) return true;
  return false;
}

function createBlackjackHand(cards, extra = {}) {
  return {
    id: uid(),
    cards,
    completed: false,
    doubled: false,
    resultLabel: "",
    isSplitHand: false,
    isSplitAces: false,
    ...extra
  };
}

function finalizePlayerHand(gameOrHand, handMaybe, label) {
  const hand = handMaybe || gameOrHand;
  hand.completed = true;
  hand.resultLabel = label;
}

function createShuffledDeck(deckCount = 6) {
  const deck = [];
  for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
    for (const suit of BLACKJACK_SUITS) {
      for (const rank of BLACKJACK_RANKS) {
        deck.push({
          id: uid(),
          rank,
          suit: suit.key,
          hidden: false
        });
      }
    }
  }

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function drawVisibleCard(deck) {
  const card = deck.shift();
  return { ...card, hidden: false };
}

function drawHiddenCard(deck) {
  const card = deck.shift();
  return { ...card, hidden: true };
}

function revealDealerCards(cards) {
  cards.forEach((card) => {
    card.hidden = false;
  });
}

function renderDealerTotal(game) {
  if (game.status !== "finished" && game.dealer.cards.some((card) => card.hidden)) {
    return "Toplam: ?";
  }

  return `Toplam: ${calculateHandTotals(game.dealer.cards).best}`;
}

function getMinesStats(game) {
  return {
    collectable: game.collectible,
    multiplier: game.multiplier
  };
}

function getNextMinesMultipliers(game) {
  const totalCells = game.cells.length || MINES_GRID_SIZE;
  const safeCells = totalCells - game.mineCount;
  const values = [game.multiplier];
  for (let step = game.revealedSafeCount + 1; step <= Math.min(safeCells, game.revealedSafeCount + 4); step += 1) {
    values.push(calculateMinesMultiplier(step, game.mineCount, totalCells));
  }
  return values;
}

function calculateMinesMultiplier(revealedSafeCount, mineCount, totalCells = MINES_GRID_SIZE) {
  const safeCells = totalCells - mineCount;
  if (revealedSafeCount <= 0) return 1;

  let multiplier = 1;
  for (let index = 0; index < revealedSafeCount; index += 1) {
    multiplier *= (totalCells - index) / (safeCells - index);
  }
  return multiplier;
}

function countRevealedMinesSafeCells(cells) {
  return (cells || []).filter((cell) => cell.revealed && !cell.isMine).length;
}

function revealAllMines(cells) {
  for (const cell of cells || []) {
    if (cell.isMine) {
      cell.revealed = true;
    }
  }
}

function formatMultiplier(value) {
  return `${Number(value || 1).toFixed(2)}x`;
}

function formatCoinValue(value) {
  return `${roundCoinValue(value)} coin`;
}

function roundCoinValue(value) {
  return Math.round(Number(value || 0));
}

function renderMinesTitle(game) {
  if (game.status === "lost") return "KAYBETTIN ☠️";
  if (game.status === "won" || game.status === "cashed_out") return "KAZANDIN 👑";
  return "";
}

function getMinesResultTone(status) {
  if (status === "lost") return "loss";
  if (status === "won" || status === "cashed_out") return "win";
  return "";
}

function shuffle(values) {
  const list = [...values];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
}

function decorateBlackjackSummary(summary) {
  return String(summary || "")
    .replaceAll("Kayip", "KAYBETTIN ☠️")
    .replaceAll("Kazandi", "KAZANDIN 👑");
}

function formatBlackjackResultLabel(label) {
  if (label === "Kayip") return "KAYBETTIN ☠️";
  if (label === "Kazandi") return "KAZANDIN 👑";
  return label || "";
}

function renderBlackjackResultTitle(label) {
  const value = String(label || "").toLocaleLowerCase();
  if (value.includes("kazandi") || value.includes("blackjack")) return "KAZANDIN 👑";
  if (value.includes("kayip") || value.includes("bust")) return "KAYBETTIN ☠️";
  if (value.includes("push")) return "PUSH";
  return "";
}

function getBlackjackResultTone(label) {
  const value = String(label || "").toLocaleLowerCase();
  if (value.includes("kayip") || value.includes("bust")) return "loss";
  if (value.includes("kazandi") || value.includes("blackjack")) return "win";
  if (value.includes("push")) return "push";
  return "";
}

function getSplitValue(card) {
  if (!card) return "";
  if (card.rank === "A") return "A";
  if (["10", "J", "Q", "K"].includes(card.rank)) return "10";
  return card.rank;
}

function collectGameAnimationKeys(previousByChannel, nextByChannel) {
  const keys = [];
  for (const [channelId, messages] of Object.entries(nextByChannel || {})) {
    const previousMessages = previousByChannel?.[channelId] || [];
    for (const message of messages) {
      if (message.type !== "blackjack") continue;
      const previousMessage = previousMessages.find((entry) => entry.id === message.id);
      keys.push(...collectBlackjackCardChanges(previousMessage, message));
    }
  }
  return [...new Set(keys)];
}

function collectBlackjackCardChanges(previousMessage, nextMessage) {
  if (!nextMessage || nextMessage.type !== "blackjack") return [];

  const previousCards = flattenBlackjackCards(previousMessage?.content);
  const nextCards = flattenBlackjackCards(nextMessage.content);
  const previousMap = new Map(previousCards.map((card) => [card.id, card]));
  const keys = [];

  for (const card of nextCards) {
    const previousCard = previousMap.get(card.id);
    if (!previousCard || previousCard.hidden !== card.hidden) {
      keys.push(`${nextMessage.id}:${card.id}`);
    }
  }

  return keys;
}

function getAllBlackjackCardKeys(message) {
  if (!message || message.type !== "blackjack") return [];
  return flattenBlackjackCards(message.content).map((card) => `${message.id}:${card.id}`);
}

function flattenBlackjackCards(content) {
  const game = typeof content === "string" ? JSON.parse(content) : (content || {});
  const dealerCards = game.dealer?.cards || [];
  const handCards = (game.hands || []).flatMap((hand) => hand.cards || []);
  return [...dealerCards, ...handCards];
}

function markAnimatingCards(keys) {
  if (!keys.length) return;
  state.animatingCardKeys = [...new Set([...state.animatingCardKeys, ...keys])];
  window.setTimeout(() => {
    state.animatingCardKeys = state.animatingCardKeys.filter((key) => !keys.includes(key));
    for (const key of keys) {
      const [, cardId] = key.split(":");
      const card = document.querySelector(`[data-card-id="${cssEscape(cardId)}"]`);
      if (card) {
        card.classList.remove("flip-in");
      }
    }
  }, 550);
}

function findMessageById(messageId) {
  for (const messages of Object.values(state.messagesByChannel)) {
    const message = messages.find((entry) => entry.id === messageId);
    if (message) return message;
  }
  return null;
}

function clearPendingUpdatedMessageIfCurrent(message) {
  const pending = state.pendingUpdatedMessages[message.id];
  if (!pending) return;
  if (getMessageRevision(pending) <= getMessageRevision(message)) {
    delete state.pendingUpdatedMessages[message.id];
  }
}

function getMessageRevision(message) {
  if (!message?.content) return 0;
  try {
    const content = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
    return Number(content?.revision) || 0;
  } catch {
    return 0;
  }
}

function hasMeaningfulMessageDifference(currentMessage, nextMessage) {
  if (!currentMessage || !nextMessage) return true;
  return JSON.stringify(currentMessage) !== JSON.stringify(nextMessage);
}

function hasActiveBlackjackInteraction() {
  return Object.keys(state.interactiveActionLocks || {}).length > 0 || Object.keys(state.pendingUpdatedMessages || {}).length > 0;
}

function getVisibleMessagesForChannel(channelId) {
  if (!channelId) return [];
  return applyLocalMessageFilters(state.messagesByChannel[channelId] || [], channelId);
}

function findActiveMinesMessageForCurrentUser() {
  const messages = getVisibleMessagesForChannel(selectedChannel()?.id);
  return messages.find((message) => {
    if (message?.type !== "mines") return false;
    const game = normalizeMinesState(message.content);
    return game.ownerId === state.currentUser.id && game.status === "playing";
  }) || null;
}

function findActiveDragonMessageForCurrentUser() {
  const messages = getVisibleMessagesForChannel(selectedChannel()?.id);
  return messages.find((message) => {
    if (message?.type !== "dragon") return false;
    const game = normalizeDragonState(message.content);
    const participant = getDragonParticipant(game, state.currentUser.id);
    return participant && participant.status === "joined" && (getDragonPhase(game) === "lobby" || getDragonPhase(game) === "playing");
  }) || null;
}

function findVisibleActiveDragonMessage() {
  const messages = getVisibleMessagesForChannel(selectedChannel()?.id);
  return messages.find((message) => {
    if (message?.type !== "dragon") return false;
    const phase = getDragonPhase(message.content);
    return phase === "lobby" || phase === "playing";
  }) || null;
}

function openDragonModal(messageId) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "dragon") return;
  state.dragonModalMessageId = messageId;
  render();
}

function closeDragonModal() {
  state.dragonModalMessageId = "";
  stopDragonModalLoop();
  render();
}

function applyLocalMessageFilters(messages, channelId) {
  const clearedAt = getLocalClearTimestamp(state.scopeKey, channelId);
  if (!clearedAt) return messages;
  return (messages || []).filter((message) => normalizeMessageTimestamp(message) > clearedAt);
}

function isClearChatCommand(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  return normalized === "/clear" || normalized === "clear chat" || normalized === "/clear chat";
}

function clearCurrentChannelLocally() {
  const channelId = selectedChannel()?.id;
  if (!channelId) return;
  setLocalClearTimestamp(state.scopeKey, channelId, Date.now());
  state.forceScrollToBottom = true;
  render();
  showToast("Chat sadece senin ekranında temizlendi.");
}

function loadPreferredMineCount() {
  try {
    const value = Number(window.localStorage.getItem(LOCAL_MINES_MINE_COUNT_KEY));
    return MINES_MINE_OPTIONS.includes(value) ? value : MINES_MINE_COUNT;
  } catch {
    return MINES_MINE_COUNT;
  }
}

function savePreferredMineCount(value) {
  try {
    window.localStorage.setItem(LOCAL_MINES_MINE_COUNT_KEY, String(value));
  } catch {
    // Local preferences are best-effort.
  }
}

function getLocalClearTimestamp(scopeKey, channelId) {
  if (!scopeKey || !channelId) return 0;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_CLEAR_CHAT_KEY) || "{}");
    return Number(raw?.[scopeKey]?.[channelId]) || 0;
  } catch {
    return 0;
  }
}

function setLocalClearTimestamp(scopeKey, channelId, timestamp) {
  if (!scopeKey || !channelId) return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_CLEAR_CHAT_KEY) || "{}");
    raw[scopeKey] ||= {};
    raw[scopeKey][channelId] = timestamp;
    window.localStorage.setItem(LOCAL_CLEAR_CHAT_KEY, JSON.stringify(raw));
  } catch {
    // Local clear markers are best-effort.
  }
}

function normalizeMessageTimestamp(message) {
  const serverCreatedAtMs = Number(message?.serverCreatedAtMs);
  if (Number.isFinite(serverCreatedAtMs) && serverCreatedAtMs > 0) {
    return serverCreatedAtMs;
  }

  const createdAtMs = Number(message?.createdAtMs);
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
    return createdAtMs;
  }

  const parsed = Date.parse(String(message?.createdAt || ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 0;
}

function getDragonLiveMultiplier(gameState, now = Date.now()) {
  const game = normalizeDragonState(gameState);
  if (getDragonPhase(game, now) !== "playing") {
    return roundMultiplier(game.finalMultiplier || 1);
  }

  const elapsedSeconds = Math.max(0, now - game.startedAtMs) / 1000;
  const multiplier = 1 + (elapsedSeconds * 0.09) + (elapsedSeconds * elapsedSeconds * 0.03);
  return roundMultiplier(Math.min(game.crashAtMultiplier, multiplier));
}

function shouldDragonCrash(gameState, now = Date.now()) {
  const game = normalizeDragonState(gameState);
  if (getDragonPhase(game, now) !== "playing") return false;
  return getDragonLiveMultiplier(game, now) >= game.crashAtMultiplier;
}

function generateDragonCrashMultiplier() {
  const raw = 0.99 / Math.max(0.04, 1 - Math.random());
  return roundMultiplier(Math.max(1.15, Math.min(25, raw)));
}

function roundMultiplier(value) {
  return Math.round(Number(value || 1) * 100) / 100;
}

function startDragonTicker() {
  stopDragonTicker();
  state.dragonTickerHandle = window.setInterval(() => {
    const messages = getVisibleMessagesForChannel(selectedChannel()?.id).filter((message) => message?.type === "dragon");
    if (!messages.length) return;

    for (const message of messages) {
      const game = normalizeDragonState(message.content);
      const phase = getDragonPhase(game);
      if (phase === "finished" || game.status === "crashed") continue;
      if (state.interactiveActionLocks[message.id] || state.pendingUpdatedMessages[message.id]) continue;
      if (phase === "lobby" && Date.now() >= game.launchAtMs) {
        state.interactiveActionLocks[message.id] = true;
        void performDragonAction(message.id, "dragon_tick")
          .finally(() => {
            delete state.interactiveActionLocks[message.id];
          });
        continue;
      }
      if (!shouldDragonCrash(game)) continue;
      state.interactiveActionLocks[message.id] = true;
        void performDragonAction(message.id, "dragon_tick")
        .finally(() => {
          delete state.interactiveActionLocks[message.id];
        });
    }
  }, DRAGON_TICK_MS);
}

function stopDragonTicker() {
  if (!state.dragonTickerHandle) return;
  window.clearInterval(state.dragonTickerHandle);
  state.dragonTickerHandle = null;
}

function syncDragonModalLoop() {
  if (!state.dragonModalMessageId && !(isCasinoDragonView() && state.dragonSession)) {
    stopDragonModalLoop();
    return;
  }

  if (state.dragonModalRaf) return;

  const tick = () => {
    state.dragonModalRaf = 0;
    const message = state.dragonModalMessageId
      ? findMessageById(state.dragonModalMessageId)
      : state.dragonSession;
    if (!message || message.type !== "dragon_state" && message.type !== "dragon") {
      if (state.dragonModalMessageId) closeDragonModal();
      return;
    }

    const game = normalizeDragonState(message.content);
    const phase = getDragonPhase(game);
    const participant = getDragonParticipant(game, state.currentUser.id);
    const joinButton = document.querySelector("[data-dragon-join]");
    const collectButton = document.querySelector("[data-dragon-collect]");
    const shouldShowJoin = phase === "lobby";
    const shouldShowCollect = phase === "playing" || phase === "finished";
    if ((shouldShowJoin && !joinButton) || (shouldShowCollect && !collectButton)) {
      render();
      return;
    }
    const multiplierNode = document.querySelector("[data-dragon-live-multiplier]");
    const collectibleNode = document.querySelector("[data-dragon-live-collectible]");
    if (multiplierNode) {
      const multiplier = phase === "playing" ? getDragonLiveMultiplier(game) : roundMultiplier(game.finalMultiplier || 1);
      multiplierNode.textContent = formatMultiplier(multiplier);
    }
    if (collectibleNode) {
      const collectible = participant?.status === "cashed_out"
        ? participant.cashoutValue
        : phase === "playing" && participant?.status === "joined"
          ? roundCoinValue(game.baseStake * getDragonLiveMultiplier(game))
          : 0;
      collectibleNode.textContent = formatCoinValue(collectible);
    }

    state.dragonModalRaf = window.requestAnimationFrame(tick);
  };

  state.dragonModalRaf = window.requestAnimationFrame(tick);
}

function stopDragonModalLoop() {
  if (!state.dragonModalRaf) return;
  window.cancelAnimationFrame(state.dragonModalRaf);
  state.dragonModalRaf = 0;
}

function getDragonPhase(gameState, now = Date.now()) {
  const game = normalizeDragonState(gameState);
  if (game.status === "crashed") return "finished";
  if (now < game.launchAtMs) return "lobby";
  return "playing";
}

function getDragonParticipant(gameState, userId) {
  const game = normalizeDragonState(gameState);
  return (game.participants || []).find((entry) => entry.id === userId) || null;
}

function getSearchableMessageText(message) {
  if (message.type === "blackjack") {
    const game = normalizeBlackjackState(message.content);
    return [
      game.summary,
      game.resultSummary,
      ...(game.hands || []).map((hand) => hand.resultLabel),
      ...(game.hands || []).flatMap((hand) => (hand.cards || []).map((card) => `${card.rank} ${card.suit}`))
    ].join(" ");
  }

  if (message.type === "mines") {
    const game = normalizeMinesState(message.content);
    return [
      "mines",
      game.ownerName,
      game.resultSummary,
      formatCoinValue(game.collectible),
      formatMultiplier(game.multiplier)
    ].join(" ");
  }

  if (message.type === "dragon") {
    const game = normalizeDragonState(message.content);
    return [
      "ejderha",
      game.ownerName,
      game.resultSummary,
      formatCoinValue(game.collectible),
      formatMultiplier(game.finalMultiplier || getDragonLiveMultiplier(game))
    ].join(" ");
  }

  return typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/["\\]/g, "\\$&");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderAvatar(avatarUrl, label) {
  if (avatarUrl) {
    return `<img class="avatar avatar-image" src="${escapeAttr(avatarUrl)}" alt="${escapeAttr(label || "Avatar")}">`;
  }
  return `<span class="avatar">${initials(label)}</span>`;
}

function initials(value) {
  return Array.from(String(value || "?").replace(/\s+/g, "").trim()).slice(0, 2).join("").toUpperCase();
}

function mapDiscordParticipant(participant, index) {
  const id = participant?.id || participant?.user?.id || uid();
  const username =
    participant?.nick ||
    participant?.nickname ||
    participant?.global_name ||
    participant?.user?.global_name ||
    participant?.username ||
    participant?.user?.username ||
    `Oyuncu ${index + 1}`;
  const rawUsername = participant?.username || participant?.user?.username || username;

  return {
    id,
    username,
    avatar: username,
    avatarUrl: buildDiscordUserAvatarUrl(
      id,
      participant?.avatar || participant?.user?.avatar,
      participant?.discriminator || participant?.user?.discriminator
    ),
    status: "online",
    customStatus: rawUsername === username ? "" : `@${rawUsername}`
  };
}

function currentUserAsMember() {
  return {
    id: state.currentUser.id,
    username: state.currentUser.displayName,
    avatar: state.currentUser.displayName,
    avatarUrl: state.currentUser.avatarUrl,
    status: "online",
    customStatus: state.currentUser.tag
  };
}

function dedupeMembers(members) {
  const byId = new Map();
  for (const member of members) {
    byId.set(member.id, member);
  }

  byId.set(state.currentUser.id, currentUserAsMember());

  return [...byId.values()];
}

function buildDiscordUserAvatarUrl(userId, avatarHash, discriminator = "0") {
  if (!userId) return "";

  if (avatarHash) {
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
  }

  return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex(userId, discriminator)}.png`;
}

function buildDiscordGuildAvatarUrl(guildId, userId, avatarHash) {
  if (!guildId || !userId || !avatarHash) return "";
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=128`;
}

function defaultAvatarIndex(userId, discriminator = "0") {
  if (discriminator && discriminator !== "0") {
    return Number(discriminator) % 5;
  }

  try {
    return Number(BigInt(userId) >> 22n) % 6;
  } catch {
    return 0;
  }
}

function statusColor(status) {
  if (status === "online") return "var(--success)";
  if (status === "idle") return "var(--warning)";
  if (status === "dnd") return "var(--danger)";
  return "var(--offline)";
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase())
    .filter(Boolean);
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function icon(name, size = 24, className = "") {
  const cls = className ? ` class="${className}"` : "";
  const stroke = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  const map = {
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"></path><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>',
    pin: '<path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
    search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line>',
    plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"></rect><path d="M12 8v13"></path><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"></path><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"></path>',
    smile: '<circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line>',
    verified: '<path d="M21.801 10A10 10 0 1 1 17 3.335"></path><path d="m9 11 3 3L22 4"></path>',
    "chevron-down": '<path d="m6 9 6 6 6-6"></path>',
    "chevron-left": '<path d="m15 18-6-6 6-6"></path>',
    "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path>',
    check: '<path d="m5 12 5 5L20 7"></path>',
    close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
  };

  return `<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${stroke}>${map[name] || ""}</svg>`;
}









