
import { state, isCasinoDragonView, isCasinoMiningView, hasActiveBlackjackInteraction, selectedChannel, initialChannelId } from './state.js';
import { 
  DEFAULT_CHANNELS, PAGE_QUERY, OFFLINE_MODE, 
  DRAGON_CHANNEL_ID, GAME_BACKEND_URL, FRONTEND_API_ORIGIN,
  DISCORD_CLIENT_ID, MOCK_MODE, MOCK_SCOPE_KEY, DEFAULT_MEMBERS, MOCK_USER_ID, MOCK_USER_NAME
} from './constants.js';
import { 
  uid, escapeHtml, cloneData, debounce, clamp, buildMessagesApiUrl, formatCoinValue, formatMultiplier, 
  parseCsv, truncateText, buildDiscordUserAvatarUrl, buildDiscordGuildAvatarUrl, shouldPreferLocalMessage 
} from './utils.js';
import { 
  renderBlackjackResult, renderBlackjackHand, renderBlackjackState, handleBlackjackAction
} from './blackjack.js';
import { 
  renderMinesState, handleMinesAction
} from './mines.js';
import { 
  startDragonTicker, syncDragonModalLoop, getDragonPhase, getDragonLiveMultiplier, renderDragonHistoryPill
} from './dragon.js';
import { 
  renderMiningRealtimeView, updateMiningActiveStageDom, renderMiningStageJoinAction,
  renderMiningSecondaryPanel, bindMiningActionButtons, handleMiningCanvasClick, 
  handleMiningCanvasGlobalMove, handleMiningCanvasGlobalUp, handleMiningCanvasHover, 
  handleMiningCanvasWheel, dispatchMiningCanvasIntent, startMiningUiTicker
} from './mining-ui.js';
import {
  authenticateWithDiscord, subscribeDiscordEvents, loadPersistedMessages, startMessageSync, 
  persistMessage, persistMessageUpdate, connectDragonRealtime, connectMiningRealtime, 
  closeRealtimeSocket, syncRemoteMessages
} from './transport.js';

import { DiscordSDK, Events } from "@discord/embedded-app-sdk";
import { DEFAULT_DRAGON_CONFIG, normalizeDragonConfig } from "../shared/dragon-config.js";
import {
  MINING_CHANNEL_ID,
  MINING_SHOP_ITEMS,
  MINING_SLOT_KEYS,
  MINING_TARGET_RUN_MS,
  MINING_TILE_SIZE,
  MINING_VIEW_RADIUS,
  advanceMiningSession,
  attackMiningMole,
  abandonMiningPlayer,
  extractMiningPlayer,
  getMiningCurrentPlayer,
  getMiningPhase,
  getMiningTile,
  getMiningVisibleTiles,
  mineMiningTile,
  moveMiningPlayer,
  normalizeMiningProfile,
  normalizeMiningSession,
  renderMiningTextState,
  createMiningSession,
  joinMiningSession,
  MINING_DEFAULT_CONFIG,
  normalizeMiningConfig
} from "../shared/mining-core.js";


const app = document.getElementById("app");

window.__31checkDebug = {
  getCurrentUser: () => cloneData(state.currentUser),
  getDragonSnapshot: () => cloneData({
    session: state.dragonSession,
    config: state.dragonConfig,
    recentResults: state.dragonRecentResults,
    serverNowMs: getDragonNow()
  }),
  getMiningSnapshot: () => cloneData({
    session: state.miningSession,
    profile: state.miningProfile,
    serverNowMs: getMiningNow()
  }),
  getMiningClientState: () => cloneData({
    targetTile: state.miningTargetTile,
    autoAction: state.miningAutoAction,
    miningLocked: Boolean(state.interactiveActionLocks["mining"])
  }),
  clickMiningTile: async (x, y) => {
    const targetX = Number(x) + 0.5;
    const targetY = Number(y) + 0.5;
    clearMiningQueuedActions();
    await dispatchMiningCanvasIntent({ targetX, targetY });
    return cloneData(window.__31checkDebug.getMiningClientState());
  }
};
let toastTimeoutHandle = 0;
const interactivePersistQueues = {};

bootstrap();

async function bootstrap() {
  bindStaticEvents();
  render();
  await initializeRuntime();
}

function snapshotRenderFocus() {
  const activeElement = document.activeElement;
  if (!activeElement || !(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)) {
    return null;
  }

  if (!activeElement.id) return null;

  return {
    id: activeElement.id,
    value: activeElement.value,
    selectionStart: activeElement.selectionStart,
    selectionEnd: activeElement.selectionEnd
  };
}

function restoreRenderFocus(snapshot) {
  if (!snapshot?.id) return;

  const nextElement = document.getElementById(snapshot.id);
  if (!nextElement || !(nextElement instanceof HTMLInputElement || nextElement instanceof HTMLTextAreaElement)) {
    return;
  }

  nextElement.focus({ preventScroll: true });
  if (typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number") {
    try {
      nextElement.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {
      // Some input types do not support selection restore.
    }
  }
}

function decorateStaticUi() {
  // No static UI to decorate after admin panel removal
}

function bindStaticEvents() {
  window.addEventListener("popstate", () => {
    state.selectedChannelId = initialChannelId();
    render();
  });
  window.addEventListener("beforeunload", () => {
    closeRealtimeSocket("dragon");
    closeRealtimeSocket("mining");
  });
}

async function initializeRuntime() {
  if (MOCK_MODE) {
    state.messagesByChannel["1"] = [FALLBACK_MESSAGE];
    state.membersLoading = false;
    const messageTask = loadPersistedMessages({ initial: true });
    startMessageSync();
    if (isDedicatedCasinoScreen()) {
      await initializeDedicatedCasinoViews();
      render();
      await messageTask;
    } else {
      await messageTask;
      await initializeDedicatedCasinoViews();
    }
    render();
    return;
  }

  try {
    state.discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
    state.runtimeNote = "Discord istemcisi hazirlaniyor...";
    render();
    await state.discordSdk.ready();

    state.runtimeNote = "Discord kullanicisi aliniyor...";
    render();
    const auth = await resolveDiscordIdentity();
    if (auth?.user) {
      hydrateCurrentUser(auth);
    }

    state.scopeKey = buildScopeKey();
    state.runtimeMode = "discord";
    state.runtimeNote = "Discord Activity bağlı";

    await subscribeDiscordEvents();
    await hydrateGuildMember(auth);
    await hydrateParticipants();
    const messageTask = loadPersistedMessages({ initial: true });
    startMessageSync();
    if (isDedicatedCasinoScreen()) {
      await initializeDedicatedCasinoViews();
      render();
      await messageTask;
    } else {
      await messageTask;
      await initializeDedicatedCasinoViews();
    }
    render();
  } catch (error) {
    console.error("Discord SDK bootstrap failed, falling back to preview mode.", error);
    state.runtimeMode = "mock";
    state.runtimeNote = `Discord bağlanamadı: ${String(error?.message || "önizleme modu")}`;
    state.scopeKey = MOCK_SCOPE_KEY;
    state.messagesByChannel["1"] = [FALLBACK_MESSAGE];
    state.members = [...DEFAULT_MEMBERS];
    state.membersLoading = false;
    const messageTask = loadPersistedMessages({ initial: true });
    startMessageSync();
    if (isDedicatedCasinoScreen()) {
      await initializeDedicatedCasinoViews();
      render();
      await messageTask;
    } else {
      await messageTask;
      await initializeDedicatedCasinoViews();
    }
    render();
  }
}

async function initializeDedicatedCasinoViews() {
  const dragonTask = initializeDragonTransport().catch((error) => {
    console.warn("Dragon transport bootstrap failed.", error);
  });
  const miningTask = initializeMiningTransport().catch((error) => {
    console.warn("Mining transport bootstrap failed.", error);
  });

  if (isCasinoMiningView()) {
    await miningTask;
    void dragonTask;
    return;
  }
  if (isCasinoDragonView()) {
    await dragonTask;
    void miningTask;
    return;
  }

  void dragonTask;
  void miningTask;
}

function isDedicatedCasinoScreen() {
  return isCasinoDragonView() || isCasinoMiningView();
}















export function render() {
  const previousMessagesPane = document.querySelector(".messages");
  const previousScrollTop = previousMessagesPane?.scrollTop || 0;
  if (previousMessagesPane) {
    state.messagePanePinnedToBottom = isNearBottom(previousMessagesPane);
  }

  const focusSnapshot = snapshotRenderFocus();
  const shouldRestoreComposerFocus = focusSnapshot?.id === "composerInput" || state.keepComposerFocus;
  const shouldRestoreSearchFocus = focusSnapshot?.id === "messageSearchInput";
  const shouldStickToBottom = state.messagePanePinnedToBottom || state.forceScrollToBottom;
  const isDragonView = isCasinoDragonView();
  const isMiningView = isCasinoMiningView();
  const isDedicatedCasinoView = isDragonView || isMiningView;
  const channel = selectedChannel();
  const rawMessages = isDedicatedCasinoView ? [] : applyLocalMessageFilters(state.messagesByChannel[channel?.id] || [], channel?.id).filter((message) => message.type !== "dragon");
  const messages = filterMessages(rawMessages, state.searchQuery);
  const composerDisabled = state.isMessagesLoading;

  app.className = `app ${state.sidebarCollapsed ? "sidebar-collapsed" : ""} ${isDragonView ? "is-dragon-view" : ""} ${isMiningView ? "is-mining-view" : ""} ${isDedicatedCasinoView ? "is-casino-view" : ""}`.trim();
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
        <div class="current-user">
          ${renderAvatar(state.currentUser.avatarUrl, state.currentUser.displayName)}
          <span class="user-meta">
            <span class="user-name">${escapeHtml(state.currentUser.displayName)}</span>
            <span class="user-tag">${escapeHtml(state.currentUser.tag)}</span>
          </span>
        </div>
      </div>
    </aside>
    <main class="main">
      <div class="main-panel">
        ${isDragonView ? `
        ${renderDragonRealtimeView()}
        <aside class="members">
          <div class="members-scroll">${renderMembers()}</div>
        </aside>` : isMiningView ? `
        ${renderMiningRealtimeView()}` : `
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
  if (!isMiningView) {
    stopMiningCanvasLoop();
  }
  syncDragonModalLoop();
  restoreRenderFocus(focusSnapshot);
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
  // Admin panel removed — config is now in config/game-config.js
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
  app.querySelectorAll("[data-mining-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.miningViewTab = button.dataset.miningTab || "entrance";
      render();
    });
  });
  bindMiningActionButtons(app);
  const miningCanvas = document.getElementById("miningCanvas");
  if (miningCanvas instanceof HTMLCanvasElement) {
    miningCanvas.addEventListener("pointerdown", handleMiningCanvasClick);
    miningCanvas.addEventListener("pointermove", handleMiningCanvasHover);
    miningCanvas.addEventListener("wheel", handleMiningCanvasWheel, { passive: false });
    miningCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("pointermove", handleMiningCanvasGlobalMove);
    window.addEventListener("pointerup", handleMiningCanvasGlobalUp);
    startMiningCanvasLoop();
    renderMiningCanvas(miningCanvas);
  } else {
    window.removeEventListener("pointermove", handleMiningCanvasGlobalMove);
    window.removeEventListener("pointerup", handleMiningCanvasGlobalUp);
    stopMiningCanvasLoop();
  }
  const dragonAutoInput = document.getElementById("dragonAutoCashoutInput");
  if (dragonAutoInput) {
    const syncDragonAutoInput = () => {
      const parsed = parseDragonAutoCashoutInput(dragonAutoInput.value);
      state.dragonAutoCashoutTarget = parsed;
      dragonAutoInput.value = formatDecimalInput(parsed);
      const autoTargetLabel = document.querySelector("[data-dragon-auto-target-label]");
      if (autoTargetLabel) {
        autoTargetLabel.textContent = formatMultiplier(parsed);
      }
      saveDragonAutoCashoutPreference();
    };
    dragonAutoInput.addEventListener("change", syncDragonAutoInput);
    dragonAutoInput.addEventListener("blur", syncDragonAutoInput);
  }
  const dragonAutoToggle = document.getElementById("dragonAutoCashoutToggle");
  if (dragonAutoToggle) {
    dragonAutoToggle.addEventListener("click", () => {
      state.dragonAutoCashoutEnabled = !state.dragonAutoCashoutEnabled;
      saveDragonAutoCashoutPreference();
      render();
    });
  }
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


// ── Admin panel removed ─────────────────────────────────────────────
// Oyun ayarları artık config/game-config.js dosyasından yönetilir.
// renderAdmin, renderUserModal, addChannel, addCategory fonksiyonları kaldırıldı.
function renderAdmin() {}
function renderUserModal() {}
function openAdminModal() {}
function closeAdminModal() {}
function openUserModal() {}
function closeUserModal() {}
function syncUserTag() {}


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

export function replaceLocalMessage(message, options = {}) {
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
  if (isCasinoMiningView(id)) {
    state.sidebarCollapsed = true;
  }
  syncUrl(id);
  render();
  if (isCasinoDragonView(id)) {
    void loadDragonSession();
    return;
  }
  if (isCasinoMiningView(id)) {
    void loadMiningState();
  }
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

function buildScopeKey() {
  const guildId = state.discordSdk?.guildId || "noguild";
  const channelId = state.discordSdk?.channelId || "nochannel";
  return `${guildId}:${channelId}`;
}

function buildEmptyMessageState() {
  return Object.fromEntries(DEFAULT_CHANNELS.map((channel) => [channel.id, []]));
}



function getBlackjackRevision(message) {
  if (message?.type !== "blackjack") return 0;
  const game = normalizeBlackjackState(message.content);
  const revision = Number(game?.revision);
  return Number.isFinite(revision) && revision > 0 ? revision : 1;
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

export function showToast(message) {
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
  const disabled = !enabled || !ownerCanPlay || Boolean(state.interactiveActionLocks[messageId]);
  const labels = {
    hit: "Hit",
    stand: "Stand",
    double: "2x Double",
    split: "Split"
  };
  return `<button type="button" class="btn blackjack-action is-${action}" data-bj-action="${action}" data-message-id="${escapeAttr(messageId)}" ${disabled ? "disabled" : ""}>${escapeHtml(labels[action] || action)}</button>`;
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
  const disabled = game.status !== "playing" || !ownerCanPlay;
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
  const multiplier = getDragonDisplayMultiplier(game, phase);
  const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - getDragonNow()) / 1000));
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
  const recentResults = Array.isArray(state.dragonRecentResults) ? state.dragonRecentResults : [];
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
  const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - getDragonNow()) / 1000));
  const multiplier = getDragonDisplayMultiplier(game, phase);
  const autoSettings = getDragonRoundAutoSettings(session);
  const autoTarget = normalizeDragonAutoCashoutTarget(autoSettings.target);
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
        ? `<button type="button" class="btn dragon-modal-action" data-dragon-hub-action="cashout" ${!joined || participant?.status !== "joined" ? "disabled" : ""}>${participant?.status === "cashed_out" ? formatMultiplier(participant.cashoutMultiplier) : "Cek"}</button>`
        : `<button type="button" class="btn dragon-modal-action" data-dragon-hub-action="start">Yeni Tur</button>`;

  return `
    <section class="dragon-screen">
      <div class="dragon-screen-inner">
        <div class="dragon-modal-header">
          <div>
            <div class="dragon-modal-title">Ejderha</div>
            <div class="dragon-modal-subtitle">Son 50 sonuc</div>
          </div>
        </div>
        <div class="dragon-history-strip" aria-label="Son 50 ejderha sonucu">
          ${recentResults.length ? recentResults.map((entry) => renderDragonHistoryPill(entry)).join("") : '<span class="dragon-history-empty">Henuz tamamlanan tur yok.</span>'}
        </div>
        <div class="dragon-modal-scene dragon-hub-scene ${phase === "playing" ? "is-live" : ""} ${game.status === "crashed" ? "is-crashed" : ""}">
          <div class="dragon-scene-badge" data-dragon-live-subtitle>${escapeHtml(phase === "lobby" ? `Baslangica ${secondsLeft}s var` : (game.resultSummary || "Ejderha oyunda"))}</div>
          <div class="dragon-modal-dragon dragon-hub-dragon">${game.status === "crashed" ? "💥" : "🐉"}</div>
          <div class="dragon-modal-fire" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          <div class="dragon-flame-meter">
            <div class="dragon-flame-core"></div>
            <div class="dragon-modal-multiplier dragon-scene-multiplier" data-dragon-live-multiplier>${escapeHtml(formatMultiplier(multiplier))}</div>
          </div>
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
        <div class="dragon-auto-panel">
          <div class="dragon-auto-copy">
            <span class="dragon-label">Oto su degerde cek</span>
            <strong data-dragon-auto-target-label>${escapeHtml(formatMultiplier(autoTarget))}</strong>
          </div>
          <div class="dragon-auto-controls">
            <input id="dragonAutoCashoutInput" class="dragon-auto-input" type="text" inputmode="decimal" value="${escapeAttr(formatDecimalInput(autoTarget))}" placeholder="2.00">
            <button type="button" class="btn dragon-auto-toggle ${state.dragonAutoCashoutEnabled ? "is-active" : ""}" id="dragonAutoCashoutToggle">${state.dragonAutoCashoutEnabled ? "Acik" : "Kapali"}</button>
          </div>
        </div>
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
  const multiplier = getDragonDisplayMultiplier(game, phase);
  const collectible = participant?.status === "cashed_out"
    ? participant.cashoutValue
    : phase === "playing" && participant?.status === "joined"
      ? roundCoinValue(game.baseStake * multiplier)
      : 0;
  const disabled = state.isMessagesLoading || Boolean(state.interactiveActionLocks[message.id]);
  const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - getDragonNow()) / 1000));
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

  const game = normalizeMinesState(message.content);
  if (game.ownerId !== state.currentUser.id || game.status !== "playing") return;

  const nextGame = revealMinesCell(game, cellIndex);
  if (!nextGame) return;

  await persistInteractiveGameUpdate(message, nextGame);
}

async function handleMinesCollect(messageId) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "mines") return;

  const game = normalizeMinesState(message.content);
  if (game.ownerId !== state.currentUser.id || game.status !== "playing" || game.revealedSafeCount === 0) return;

  const nextGame = collectMinesWinnings(game);
  await persistInteractiveGameUpdate(message, nextGame);
}

async function handleDragonCollect(messageId) {
  const message = findMessageById(messageId);
  if (!message || message.type !== "dragon") return;
  if (state.interactiveActionLocks[messageId]) return;

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
  if (state.interactiveActionLocks[messageId]) return;

  state.interactiveActionLocks[messageId] = true;
  try {
    await performDragonAction(messageId, "dragon_join");
  } finally {
    delete state.interactiveActionLocks[messageId];
  }
}

export async function performDragonAction(messageId, actionType) {
  const response = await fetch(buildMessagesApiUrl(), {
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

export async function handleDragonHubAction(action, options = {}) {
  if (state.interactiveActionLocks[DRAGON_CHANNEL_ID]) return;
  state.interactiveActionLocks[DRAGON_CHANNEL_ID] = true;
  try {
    const clientMultiplier = action === "cashout" && state.dragonSession
      ? getDragonLiveMultiplier(state.dragonSession.content)
      : null;
    if (action === "cashout" && state.dragonSession) {
      const optimisticSession = applyOptimisticDragonCashout(state.dragonSession, state.currentUser.id, clientMultiplier);
      if (optimisticSession) {
        state.dragonSession = optimisticSession;
        render();
      }
    }
    const response = await fetch(buildGameApiUrl("/api/dragon"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeKey: state.scopeKey,
        action,
        config: options.config,
        clientMultiplier,
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
    applyDragonTransportPayload(payload, { forceRender: true });
  } catch (error) {
    console.warn("Dragon hub action failed.", error);
  } finally {
    delete state.interactiveActionLocks[DRAGON_CHANNEL_ID];
  }
}


async function saveDragonConfig() {
  if (!state.currentUser.isAdmin || state.interactiveActionLocks["dragon-config"]) return;
  state.interactiveActionLocks["dragon-config"] = true;
  try {
    const config = normalizeDragonConfig(state.dragonConfigDraft);
    const response = await fetch(buildGameApiUrl("/api/dragon"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeKey: state.scopeKey,
        action: "save_config",
        config,
        actor: {
          id: state.currentUser.id,
          name: state.currentUser.displayName
        }
      })
    });
    if (!response.ok) {
      throw new Error("Dragon config save failed.");
    }
    const payload = await response.json();
    applyDragonTransportPayload(payload, { forceRender: false, overwriteDraft: true });
    showToast("Ejderha ayarlari kaydedildi.");
    closeUserModal();
  } catch (error) {
    console.warn("Dragon config save failed.", error);
    showToast("Ejderha ayarlari kaydedilemedi.");
  } finally {
    delete state.interactiveActionLocks["dragon-config"];
  }
}


function getGameBackendOrigin() {
  if (GAME_BACKEND_URL) {
    return GAME_BACKEND_URL;
  }

  const { hostname, port, origin } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "5173") {
    return "http://127.0.0.1:3001";
  }

  return origin.replace(/\/+$/, "");
}

function getFrontendApiOrigin() {
  if (FRONTEND_API_ORIGIN) {
    return FRONTEND_API_ORIGIN;
  }

  const { hostname, port, origin } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "5173") {
    return origin.replace(/\/+$/, "");
  }
  if (/\.vercel\.app$/i.test(hostname)) {
    return origin.replace(/\/+$/, "");
  }
  return "https://31check-2-0.vercel.app";
}

function isDiscordProxyHost(hostname = window.location.hostname) {
  return /\.discordsays\.com$/i.test(hostname) || /\.discordsez\.com$/i.test(hostname);
}




function buildFrontendApiUrl(path, query = {}) {
  const normalizedPath = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
  const relativePath = isDiscordProxyHost() ? `/.proxy${normalizedPath}` : normalizedPath;
  const url = new URL(relativePath, `${getFrontendApiOrigin()}/`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  if (isDiscordProxyHost() || (!FRONTEND_API_ORIGIN && window.location.origin === getFrontendApiOrigin())) {
    return `${url.pathname}${url.search}`;
  }
  return url.toString();
}

function buildBackendApiUrl(path, query = {}) {
  const url = new URL(path, `${getGameBackendOrigin()}/`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}






async function initializeDragonTransport() {
  await loadDragonSession({ initial: true });
  startDragonSessionSync();
  connectRealtimeSocket("dragon", state.scopeKey, {
    onHeartbeat: syncDragonServerClock,
    onSnapshot: (payload) => {
      applyDragonTransportPayload(payload);
    },
    onStatusChange: () => startDragonSessionSync()
  });
}



async function initializeMiningTransport() {
  await loadMiningState({ initial: true });
  startMiningSessionSync();
  startMiningUiTicker();
  window.advanceTime = (ms) => new Promise((resolve) => window.setTimeout(resolve, Number(ms || 0)));

  if (OFFLINE_MODE) {
    state.miningRealtimeReady = true;
    return;
  }

  connectRealtimeSocket("mining", getMiningScopeKey(), {
    onHeartbeat: syncMiningServerClock,
    onSnapshot: (payload) => {
      applyMiningTransportPayload(payload);
    },
    onMessage: (message) => {
      if (message.type === "mining_position" && message.actorId !== state.currentUser.id) {
        const visual = (state.miningVisualPlayers || {})[message.actorId];
        if (visual) {
          visual.targetX = Number(message.targetX ?? message.x);
          visual.targetY = Number(message.targetY ?? message.y);
          visual.serverX = Number(message.x);
          visual.serverY = Number(message.y);
          visual.speed = Number(message.speed || 4.0);
          visual.facing = message.facing || visual.facing;
        }
        const session = state.miningSession?.content;
        if (session) {
          const corePlayer = getMiningCurrentPlayer(session, message.actorId);
          if (corePlayer) {
            corePlayer.targetX = Number(message.targetX ?? message.x);
            corePlayer.targetY = Number(message.targetY ?? message.y);
            corePlayer.x = Number(message.x);
            corePlayer.y = Number(message.y);
            corePlayer.speed = Number(message.speed || corePlayer.speed);
            corePlayer.facing = message.facing || corePlayer.facing;
            corePlayer.lastMovedAtMs = Date.now();
          }
        }
      }
      if (message.type === "mining_action" && message.actorId !== state.currentUser.id) {
        const session = state.miningSession?.content;
        if (session && session.status === "active") {
          const actionName = message.action;
          const data = message.data || {};
          if (actionName === "mine") {
            const res = mineMiningTile(session, message.actorId, Math.round(Number(data.x)), Math.round(Number(data.y)), Date.now());
            if (res.changed && res.tileBroken) {
              updateMiningDiscovery(Math.round(Number(data.x)), Math.round(Number(data.y)), session.config?.mineRevealRadius || 1);
            }
          } else if (actionName === "attack") {
            attackMiningMole(session, message.actorId, data.targetId, Date.now());
          } else if (actionName === "extract") {
            extractMiningPlayer(session, message.actorId, Date.now());
          } else if (actionName === "abandon") {
            abandonMiningPlayer(session, message.actorId, Date.now());
          }
          requestMiningCanvasFrame();
        }
      }
    },
    onStatusChange: () => startMiningSessionSync()
  });
}

export function getMiningScopeKey() {
  return `mining:${state.scopeKey}:v2`;
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

export function findMessageById(messageId) {
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


export function getVisibleMessagesForChannel(channelId) {
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

function loadMiningConfigPreference() {
  try {
    const raw = window.localStorage.getItem(LOCAL_MINING_CONFIG_KEY);
    return raw ? JSON.parse(raw) : MINING_DEFAULT_CONFIG;
  } catch {
    return MINING_DEFAULT_CONFIG;
  }
}

function saveMiningConfigPreference(config) {
  try {
    window.localStorage.setItem(LOCAL_MINING_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn("Mining config save failed.", error);
  }
}

function loadMiningAdminModePreference() {
  try {
    return window.localStorage.getItem(LOCAL_MINING_ADMIN_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveMiningAdminModePreference(value) {
  try {
    window.localStorage.setItem(LOCAL_MINING_ADMIN_MODE_KEY, String(value));
  } catch {
    // Local preferences are best-effort.
  }
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

export function closeDragonModal() {
  state.dragonModalMessageId = "";
  stopDragonModalLoop();
  render();
}
























function syncMiningServerClock(serverNowMs) {
  const numeric = Number(serverNowMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  const localNow = getDragonMonotonicLocalNow();
  const currentEstimate = getMiningNow(localNow);
  const nextServerNow = state.miningServerClockServerMs > 0
    ? Math.max(numeric, currentEstimate)
    : numeric;
  state.miningServerClockLocalMs = localNow;
  state.miningServerClockServerMs = nextServerNow;
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



function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", " ");
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









