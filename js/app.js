import { DiscordSDK, Events } from "@discord/embedded-app-sdk";

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "1481788345473302578";
const MOCK_MODE = new URLSearchParams(window.location.search).get("mock") === "1" || !DISCORD_CLIENT_ID;

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

const DEFAULT_BUTTONS = [
  { id: uid(), label: "🃏 Blackjack", kind: "game", game: "blackjack" },
  { id: uid(), label: "💣 Mines", kind: "game", game: "mines" },
  { id: uid(), label: "🎲 Zar", kind: "game", game: "dice" },
  { id: uid(), label: "🎁 Kasa", kind: "game", game: "case" }
];

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
  composerDraft: "",
  searchQuery: "",
  keepComposerFocus: false,
  messagePanePinnedToBottom: true,
  forceScrollToBottom: false,
  highlightedMessageId: "",
  pendingMessagesByChannel: buildEmptyMessageState(),
  currentUser: {
    id: "local-user",
    username: "31check",
    displayName: "31check",
    tag: "@31check",
    discriminator: "0001",
    avatarUrl: "",
    guildId: "",
    isAdmin: true
  },
  categories: [],
  channels: [...DEFAULT_CHANNELS],
  selectedChannelId: initialChannelId(),
  messagesByChannel: buildEmptyMessageState(),
  actionButtons: [...DEFAULT_BUTTONS],
  members: [...DEFAULT_MEMBERS],
  activeAdminTab: "channels",
  editingActionId: null,
  tempAction: { label: "", message: "" }
};

const app = document.getElementById("app");
const adminBackdrop = document.getElementById("adminBackdrop");
const userBackdrop = document.getElementById("userBackdrop");
const channelList = document.getElementById("channelList");
const channelCategory = document.getElementById("channelCategory");
const quickActionList = document.getElementById("quickActionList");
const categoryList = document.getElementById("categoryList");
const userModalTag = document.getElementById("userModalTag");
const tabs = [...document.querySelectorAll(".tab")];

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
  document.getElementById("addQuickActionButton").innerHTML = `${icon("plus", 16)}Ekle`;
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
  document.getElementById("quickActionForm").addEventListener("submit", addActionButton);
  document.getElementById("categoryForm").addEventListener("submit", addCategory);

  window.addEventListener("popstate", () => {
    state.selectedChannelId = initialChannelId();
    render();
  });
}

async function initializeRuntime() {
  if (MOCK_MODE) {
    state.messagesByChannel["1"] = [FALLBACK_MESSAGE];
    await loadPersistedMessages();
    startMessageSync();
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
    await loadPersistedMessages();
    startMessageSync();
    render();
    renderUserModal();
  } catch (error) {
    console.error("Discord SDK bootstrap failed, falling back to preview mode.", error);
    state.runtimeMode = "mock";
    state.runtimeNote = `Discord bağlanamadı: ${String(error?.message || "önizleme modu")}`;
    state.scopeKey = "local-preview";
    state.messagesByChannel["1"] = [FALLBACK_MESSAGE];
    await loadPersistedMessages();
    startMessageSync();
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
  state.currentUser = {
    ...state.currentUser,
    id: user.id || state.currentUser.id,
    username,
    displayName,
    tag: username ? `@${username}` : state.currentUser.tag,
    discriminator: user.discriminator || "0000",
    avatarUrl: buildDiscordUserAvatarUrl(user.id, user.avatar, user.discriminator),
    guildId: state.discordSdk?.guildId || "",
    isAdmin: true
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
    console.warn("Could not fetch connected Discord participants.", error);
  }
}

function syncParticipants(participants) {
  if (!Array.isArray(participants)) return;

  const mapped = participants.map((participant, index) => mapDiscordParticipant(participant, index));
  state.members = mapped.length ? dedupeMembers(mapped) : [currentUserAsMember()];
}

async function loadPersistedMessages() {
  const response = await fetch(`/api/messages?scopeKey=${encodeURIComponent(state.scopeKey)}&ts=${Date.now()}`, {
    cache: "no-store"
  });
  if (!response.ok) return;

  const payload = await response.json();
  syncRemoteMessages(payload.channels || {});
}

function startMessageSync() {
  stopMessageSync();
  if (!state.scopeKey) return;

  state.messageSyncHandle = window.setInterval(() => {
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
}

function handleVisibilitySync() {
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

  const previousSnapshot = JSON.stringify(state.messagesByChannel);
  const nextSnapshot = JSON.stringify(nextMessages);
  if (previousSnapshot === nextSnapshot) return;

  state.messagesByChannel = nextMessages;
  render();
}

function render() {
  const previousMessagesPane = document.querySelector(".messages");
  if (previousMessagesPane) {
    state.messagePanePinnedToBottom = isNearBottom(previousMessagesPane);
  }

  const shouldRestoreComposerFocus = document.activeElement?.id === "composerInput" || state.keepComposerFocus;
  const shouldRestoreSearchFocus = document.activeElement?.id === "messageSearchInput";
  const shouldStickToBottom = state.messagePanePinnedToBottom || state.forceScrollToBottom;
  const channel = selectedChannel();
  const rawMessages = state.messagesByChannel[channel?.id] || [];
  const messages = filterMessages(rawMessages, state.searchQuery);

  app.className = "app";
  app.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-scroll">
        <div class="runtime-banner">${escapeHtml(state.runtimeNote)}</div>
        ${renderChannelSections()}
      </div>
      <div class="sidebar-footer">
        <button type="button" class="current-user" id="openUserButton">
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
        <section class="chat">
          <header class="chat-header">
            <div class="chat-header-left">
              ${icon("hash", 24, "icon-muted")}
              <span class="chat-title">${escapeHtml(channel?.name || "")}</span>
            </div>
            <div class="chat-header-right">
              <button type="button" class="icon-muted" aria-label="Bildirim">${icon("bell", 20)}</button>
              <button type="button" class="icon-muted" aria-label="Pin">${icon("pin", 20)}</button>
              <button type="button" class="icon-muted" aria-label="Üyeler">${icon("users", 20)}</button>
              <label class="search" aria-label="Ara">
                <input id="messageSearchInput" type="text" value="${escapeAttr(state.searchQuery)}" placeholder="Mesajlarda ara">
                ${icon("search", 16)}
              </label>
            </div>
          </header>
          <div class="messages">
            ${messages.length ? renderMessages(messages) : renderEmptyMessageState(channel)}
          </div>
          <div class="composer-wrap">
            <div class="quick-actions" id="actionButtons">${renderActionButtons()}</div>
            <form class="composer" id="composerForm">
              <button type="button" class="icon-muted" id="openAdminButton" aria-label="Admin">${icon("plus", 24)}</button>
              <input id="composerInput" type="text" value="${escapeAttr(state.composerDraft)}" placeholder="${escapeAttr((channel?.name || "") + " kanalına mesaj gönder")}" autocomplete="off">
              <button type="submit" class="btn btn-primary composer-send">Gönder</button>
              <div class="composer-actions">
                <button type="button" class="icon-muted">${icon("gift", 20)}</button>
                <button type="button" class="icon-muted">${icon("hash", 20)}</button>
                <button type="button" class="icon-muted">${icon("smile", 20)}</button>
              </div>
            </form>
          </div>
        </section>
        <aside class="members">
          <div class="members-scroll">${renderMembers()}</div>
        </aside>
      </div>
    </main>
  `;

  bindRuntimeUi();
  if (shouldRestoreComposerFocus) {
    focusComposer();
  }
  if (shouldRestoreSearchFocus) {
    focusSearch();
  }
  if (shouldStickToBottom) {
    scrollMessagesToBottom();
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
            <button type="button" class="section-add open-admin" aria-label="Admin">${icon("plus", 16)}</button>
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
        <button type="button" class="section-add open-admin" aria-label="Admin">${icon("plus", 16)}</button>
      </div>
      ${rootItems}
    </div>
    <div class="section"></div>`;
}

function renderChannelLink(channel) {
  return `<a class="channel ${channel.id === state.selectedChannelId ? "active" : ""}" href="${channelHref(channel.id)}" data-channel-id="${channel.id}">${icon("hash", 20)}<span>${escapeHtml(channel.name)}</span></a>`;
}

function renderMessages(messages) {
  return `<div class="message-stack">${messages.map((message) => `
      <article class="message ${message.type === "game" ? "message-game" : ""} ${message.id === state.highlightedMessageId ? "message-highlighted" : ""} ${state.searchQuery.trim() ? "message-search-hit" : ""}" data-message-id="${escapeAttr(message.id)}">
        ${renderAvatar(message.avatarUrl, message.avatar || message.author)}
        <div class="message-body">
          <div class="message-meta">
            <span class="message-author">${highlightText(message.author, state.searchQuery)}</span>
            <span class="verified">${icon("verified", 16)}</span>
            <span class="message-time">${escapeHtml(formatMessageTime(message))}</span>
          </div>
          <div class="message-text">${highlightMultilineText(message.content, state.searchQuery)}</div>
        </div>
      </article>`).join("")}</div>`;
}

function renderActionButtons() {
  return state.actionButtons.map((button) => `<button type="button" data-action-id="${button.id}">${escapeHtml(button.label)}</button>`).join("");
}

function renderMembers() {
  if (state.runtimeMode === "discord") {
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
  app.querySelectorAll("[data-channel-id]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    selectChannel(link.dataset.channelId);
  }));

  app.querySelectorAll(".open-admin").forEach((button) => button.addEventListener("click", openAdminModal));
  app.querySelectorAll(".category-toggle").forEach((button) => button.addEventListener("click", () => {
    state.categories = state.categories.map((item) => item.id === button.dataset.categoryId ? { ...item, collapsed: !item.collapsed } : item);
    render();
  }));

  document.getElementById("openUserButton").addEventListener("click", openUserModal);
  document.getElementById("openAdminButton").addEventListener("click", openAdminModal);

  document.querySelectorAll("[data-action-id]").forEach((button) => button.addEventListener("click", async () => {
    const config = state.actionButtons.find((item) => item.id === button.dataset.actionId);
    if (!config) return;
    if (config.kind === "game") {
      await sendGameMessage(config.game, config.label);
      return;
    }
    await submitMessage(config.message || config.label);
  }));

  const form = document.getElementById("composerForm");
  const input = document.getElementById("composerInput");
  const searchInput = document.getElementById("messageSearchInput");
  const messagesPane = document.querySelector(".messages");
  if (messagesPane) {
    messagesPane.addEventListener("scroll", () => {
      state.messagePanePinnedToBottom = isNearBottom(messagesPane);
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
      if (!state.searchQuery.trim()) return;
      focusMessage(messageRow.dataset.messageId);
    });
  });
  input.addEventListener("input", () => {
    state.composerDraft = input.value;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
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
  document.getElementById("channelsPanel").classList.toggle("active", state.activeAdminTab === "channels");
  document.getElementById("actionsPanel").classList.toggle("active", state.activeAdminTab === "actions");

  channelCategory.innerHTML = `<option value="">Kategori Seç (Opsiyonel)</option>${state.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("")}`;

  channelList.innerHTML = state.channels.map((channel) => `
      <div class="item">
        <span class="item-name">${escapeHtml(channel.name)}</span>
        <button type="button" class="icon-danger" data-delete-channel-id="${channel.id}" aria-label="Sil">${icon("trash", 16)}</button>
      </div>`).join("");

  quickActionList.innerHTML = state.actionButtons.map((item) => {
    if (state.editingActionId === item.id) {
      return `
          <div class="item">
            <div class="grow stack-lg">
              <input class="field" id="editActionLabel" type="text" value="${escapeAttr(state.tempAction.label)}">
              <textarea class="field textarea" id="editActionMessage" rows="2">${escapeHtml(state.tempAction.message)}</textarea>
              <div class="inline-actions">
                <button type="button" class="btn btn-green" data-save-action-id="${item.id}">${icon("check", 12)}Kaydet</button>
                <button type="button" class="btn btn-secondary" id="cancelActionEdit">İptal</button>
              </div>
            </div>
          </div>`;
    }

    return `
        <div class="item">
          <div class="grow">
            <div class="item-title">${escapeHtml(item.label)}</div>
            <div class="item-subtext">${escapeHtml(item.kind === "game" ? `${item.game} mini oyunu` : item.message || "")}</div>
          </div>
          <div class="inline-actions">
            <button type="button" data-edit-action-id="${item.id}" aria-label="Düzenle">${icon("edit", 16)}</button>
            <button type="button" class="icon-danger" data-delete-action-id="${item.id}" aria-label="Sil">${icon("trash", 16)}</button>
          </div>
        </div>`;
  }).join("");

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

  quickActionList.querySelectorAll("[data-delete-action-id]").forEach((button) => button.addEventListener("click", () => {
    state.actionButtons = state.actionButtons.filter((item) => item.id !== button.dataset.deleteActionId);
    render();
    renderAdmin();
  }));

  quickActionList.querySelectorAll("[data-edit-action-id]").forEach((button) => button.addEventListener("click", () => {
    const item = state.actionButtons.find((entry) => entry.id === button.dataset.editActionId);
    if (!item) return;
    state.editingActionId = item.id;
    state.tempAction = { label: item.label, message: item.message || "" };
    renderAdmin();
  }));

  const save = quickActionList.querySelector("[data-save-action-id]");
  const cancel = document.getElementById("cancelActionEdit");
  if (save) {
    save.addEventListener("click", () => {
      const label = document.getElementById("editActionLabel").value.trim();
      const message = document.getElementById("editActionMessage").value.trim();
      if (!label) return;
      state.actionButtons = state.actionButtons.map((item) => item.id === save.dataset.saveActionId ? { ...item, label, message, kind: "text" } : item);
      state.editingActionId = null;
      state.tempAction = { label: "", message: "" };
      render();
      renderAdmin();
    });
  }

  if (cancel) {
    cancel.addEventListener("click", () => {
      state.editingActionId = null;
      state.tempAction = { label: "", message: "" };
      renderAdmin();
    });
  }
}

function renderUserModal() {
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

function addActionButton(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const label = String(form.get("quickActionLabel") || "").trim();
  const message = String(form.get("quickActionMessage") || "").trim();
  if (!label || !message) return;

  state.actionButtons.push({ id: uid(), label, message, kind: "text" });
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
  const message = makeMessage({ type: "game", content: buildGameMessage(game, label) });
  appendLocalMessage(message);
  await persistMessage(message);
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

function makeMessage({ type, content }) {
  const createdAtMs = Date.now();
  return {
    id: uid(),
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
  if (!state.channels.find((channel) => channel.id === id)) return;
  state.selectedChannelId = id;
  syncUrl(id);
  render();
}

function selectedChannel() {
  return state.channels.find((channel) => channel.id === state.selectedChannelId) || state.channels[0] || null;
}

function initialChannelId() {
  const fromHash = window.location.hash.match(/channel\/(\d+)/);
  const fromPath = window.location.pathname.match(/channel\/(\d+)/);
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
  adminBackdrop.classList.add("open");
  adminBackdrop.setAttribute("aria-hidden", "false");
}

function closeAdminModal() {
  adminBackdrop.classList.remove("open");
  adminBackdrop.setAttribute("aria-hidden", "true");
}

function openUserModal() {
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

function syncUserTag() {
  userModalTag.textContent = `${state.currentUser.displayName} (${state.currentUser.tag})`;
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

function scrollMessagesToBottom() {
  const pane = document.querySelector(".messages");
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
      message.content,
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
    "chevron-right": '<path d="m9 18 6-6-6-6"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path>',
    check: '<path d="m5 12 5 5L20 7"></path>',
    close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
  };

  return `<svg${cls} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${stroke}>${map[name] || ""}</svg>`;
}









