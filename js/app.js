import { DiscordSDK, Events } from "@discord/embedded-app-sdk";
import { DEFAULT_DRAGON_CONFIG, normalizeDragonConfig } from "../shared/dragon-config.js";
import {
  MINING_CHANNEL_ID,
  MINING_SHOP_ITEMS,
  MINING_SLOT_KEYS,
  MINING_TARGET_RUN_MS,
  MINING_TILE_SIZE,
  MINING_VIEW_RADIUS,
  getMiningCurrentPlayer,
  getMiningPhase,
  getMiningTile,
  getMiningVisibleTiles,
  normalizeMiningProfile,
  normalizeMiningSession,
  renderMiningTextState
} from "../shared/mining-core.js";

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "1481788345473302578";
const GAME_BACKEND_URL = normalizeBackendOrigin(import.meta.env.VITE_GAME_BACKEND_URL || "");
const FRONTEND_API_ORIGIN = normalizeBackendOrigin(import.meta.env.VITE_FRONTEND_API_ORIGIN || "");
const PAGE_QUERY = new URLSearchParams(window.location.search);
const MOCK_MODE = PAGE_QUERY.get("mock") === "1" || !DISCORD_CLIENT_ID;
const MOCK_SCOPE_KEY = PAGE_QUERY.get("mockScope") || "local-preview";
const MOCK_USER_ID = PAGE_QUERY.get("mockUser") || "local-user";
const MOCK_USER_NAME = PAGE_QUERY.get("mockName") || "31check";
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
  { id: "casino:dragon", label: "🐉 Ejderha" },
  { id: MINING_CHANNEL_ID, label: "⛏️ Mining" }
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
const DRAGON_SPEED_STAGES = [
  { multiplier: 1.5, speed: 0.45 },
  { multiplier: 1.75, speed: 0.5 },
  { multiplier: 2, speed: 0.6 },
  { multiplier: 2.5, speed: 0.8 },
  { multiplier: 3, speed: 1 },
  { multiplier: 4, speed: 1.25 },
  { multiplier: 5, speed: 1.5 }
];
const DRAGON_ALL_CASHED_OUT_SPEED = 4;
const MINING_ACTION_TICK_MS = 55;
const MINING_MIN_ZOOM = 1;
const MINING_MAX_ZOOM = 1.8;
const MINING_DEFAULT_ZOOM = 1.3;
const MINING_BASE_VISIBLE_TILES = 15.5;
const LOCAL_MINES_MINE_COUNT_KEY = "31check:mines:mine-count";
const LOCAL_CLEAR_CHAT_KEY = "31check:clear-chat";
const LOCAL_DRAGON_AUTO_CASHOUT_KEY = "31check:dragon:auto-cashout";
const LOCAL_MINING_ZOOM_KEY = "31check:mining:zoom";
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

const dragonAutoCashoutPreference = loadDragonAutoCashoutPreference();

const state = {
  discordSdk: null,
  runtimeMode: MOCK_MODE ? "mock" : "discord",
  runtimeNote: MOCK_MODE ? "Tarayıcı önizleme modu" : "Discord Activity başlatılıyor...",
  scopeKey: MOCK_SCOPE_KEY,
  messageSyncHandle: null,
  dragonTickerHandle: null,
  dragonRealtimeSocket: null,
  dragonSession: null,
  dragonStateLoading: true,
  dragonSessionSyncHandle: null,
  dragonServerClockLocalMs: 0,
  dragonServerClockServerMs: 0,
  dragonRealtimeReady: false,
  dragonRealtimeReconnectHandle: null,
  dragonConfig: normalizeDragonConfig(DEFAULT_DRAGON_CONFIG),
  dragonConfigDraft: normalizeDragonConfig(DEFAULT_DRAGON_CONFIG),
  dragonConfigUpdatedAtMs: 0,
  dragonRecentResults: [],
  miningRealtimeSocket: null,
  miningRealtimeReady: false,
  miningRealtimeReconnectHandle: null,
  miningServerClockLocalMs: 0,
  miningServerClockServerMs: 0,
  miningSession: null,
  miningProfile: null,
  miningStateLoading: true,
  miningSessionSyncHandle: null,
  miningUiTickerHandle: null,
  miningUiLastRenderAtMs: 0,
  miningCanvasRaf: 0,
  miningCanvasLastFrameAtMs: 0,
  miningCameraX: 0,
  miningCameraY: 0,
  miningVisualPlayers: {},
  miningZoom: loadMiningZoomPreference(),
  miningViewTab: "entrance",
  miningTargetTile: null,
  miningAutoAction: null,
  miningBufferedInput: null,
  isMessagesLoading: true,
  membersLoading: !MOCK_MODE,
  composerDraft: "",
  searchQuery: "",
  sidebarCollapsed: initialChannelId() === MINING_CHANNEL_ID,
  minesSetupOpen: false,
  dragonModalMessageId: "",
  dragonModalRaf: 0,
  preferredMineCount: loadPreferredMineCount(),
  dragonAutoCashoutEnabled: dragonAutoCashoutPreference.enabled,
  dragonAutoCashoutTarget: dragonAutoCashoutPreference.target,
  dragonRoundAutoCashoutEnabled: dragonAutoCashoutPreference.enabled,
  dragonRoundAutoCashoutTarget: dragonAutoCashoutPreference.target,
  dragonRoundSessionId: "",
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
  userModalView: "categories",
  userGameConfigView: "dragon",
  currentUser: {
    id: MOCK_MODE ? MOCK_USER_ID : "",
    username: MOCK_MODE ? MOCK_USER_NAME : "discord",
    displayName: MOCK_MODE ? MOCK_USER_NAME : "Discord",
    tag: MOCK_MODE ? `@${MOCK_USER_NAME}` : "@discord",
    discriminator: MOCK_MODE ? "0001" : "0000",
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
const userModalTag = document.getElementById("userModalTag");
const adminBadge = document.getElementById("adminBadge");
const tabs = [...document.querySelectorAll(".tab")];
let toastTimeoutHandle = 0;
let userBackdropClickArmed = false;
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
  document.getElementById("userViewCategories").addEventListener("click", () => {
    state.userModalView = "categories";
    renderUserModal();
  });
  document.getElementById("userViewDragon").addEventListener("click", () => {
    state.userModalView = "dragon";
    state.userGameConfigView = "dragon";
    state.dragonConfigDraft = normalizeDragonConfig(state.dragonConfig);
    renderUserModal();
  });
  document.getElementById("userConfigDragon").addEventListener("click", () => {
    state.userGameConfigView = "dragon";
    renderUserModal();
  });
  document.getElementById("userConfigBlackjack").addEventListener("click", () => {
    state.userGameConfigView = "blackjack";
    renderUserModal();
  });
  document.getElementById("userConfigMines").addEventListener("click", () => {
    state.userGameConfigView = "mines";
    renderUserModal();
  });
  document.getElementById("dragonLobbyInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      lobbyMs: Number(event.currentTarget.value) * 1000
    });
    renderUserModal();
  });
  document.getElementById("dragonSpeedInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      speedFactor: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonLuckyChanceInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      luckyChancePercent: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonLuckyCrashInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      luckyCrashPerThousand: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonLowCapInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      lowCapMultiplier: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonLowChanceInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      lowCrashPerThousand: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonMidCapInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      midCapMultiplier: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonMidChanceInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      midCrashPerThousand: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonHighCapInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      highCapMultiplier: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonHighChanceInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      highCrashPerThousand: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonUltraChanceInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      ultraCrashPerThousand: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonTestCapInput").addEventListener("change", (event) => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      testMaxMultiplier: Number(event.currentTarget.value)
    });
    renderUserModal();
  });
  document.getElementById("dragonTestToggleButton").addEventListener("click", () => {
    state.dragonConfigDraft = normalizeDragonConfig({
      ...state.dragonConfigDraft,
      testMode: !state.dragonConfigDraft.testMode
    });
    renderUserModal();
  });
  document.getElementById("dragonSaveButton").addEventListener("click", () => {
    void saveDragonConfig();
  });

  adminBackdrop.addEventListener("click", (event) => {
    if (event.target === adminBackdrop) closeAdminModal();
  });
  const userModalRoot = userBackdrop.querySelector(".modal");
  if (userModalRoot) {
    userModalRoot.addEventListener("pointerdown", () => {
      userBackdropClickArmed = false;
    });
  }
  userBackdrop.addEventListener("pointerdown", (event) => {
    userBackdropClickArmed = event.target === userBackdrop;
  });
  userBackdrop.addEventListener("click", (event) => {
    if (event.target === userBackdrop && userBackdropClickArmed) {
      closeUserModal();
    }
    userBackdropClickArmed = false;
  });

  document.getElementById("channelForm").addEventListener("submit", addChannel);
  document.getElementById("categoryForm").addEventListener("submit", addCategory);

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
    renderUserModal();
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

async function authenticateWithDiscord() {
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

async function resolveDiscordIdentity() {
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

async function waitForDiscordCurrentUser(timeoutMs = 2000) {
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

async function subscribeDiscordEvents() {
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
  stopDragonSessionSync();
  stopDragonModalLoop();
  stopMiningSessionSync();
  stopMiningCanvasLoop();
  closeRealtimeSocket("dragon");
  closeRealtimeSocket("mining");
}

function handleVisibilitySync() {
  if (hasActiveBlackjackInteraction()) return;
  if (document.visibilityState === "visible") {
    void loadPersistedMessages();
    void loadDragonSession();
    void loadMiningState();
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
    startMiningCanvasLoop();
    renderMiningCanvas(miningCanvas);
  } else {
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
  const categoriesTab = document.getElementById("userViewCategories");
  const dragonTab = document.getElementById("userViewDragon");
  const categoriesPanel = document.getElementById("userCategoriesPanel");
  const dragonPanel = document.getElementById("userDragonPanel");
  const dragonLobbyInput = document.getElementById("dragonLobbyInput");
  const dragonSpeedInput = document.getElementById("dragonSpeedInput");
  const dragonLuckyChanceInput = document.getElementById("dragonLuckyChanceInput");
  const dragonLuckyCrashInput = document.getElementById("dragonLuckyCrashInput");
  const dragonLowCapInput = document.getElementById("dragonLowCapInput");
  const dragonLowChanceInput = document.getElementById("dragonLowChanceInput");
  const dragonMidCapInput = document.getElementById("dragonMidCapInput");
  const dragonMidChanceInput = document.getElementById("dragonMidChanceInput");
  const dragonHighCapInput = document.getElementById("dragonHighCapInput");
  const dragonHighChanceInput = document.getElementById("dragonHighChanceInput");
  const dragonUltraChanceInput = document.getElementById("dragonUltraChanceInput");
  const dragonTestCapInput = document.getElementById("dragonTestCapInput");
  const dragonTestToggleButton = document.getElementById("dragonTestToggleButton");
  const dragonConfigTab = document.getElementById("userConfigDragon");
  const blackjackConfigTab = document.getElementById("userConfigBlackjack");
  const minesConfigTab = document.getElementById("userConfigMines");
  const dragonConfigPanel = document.getElementById("dragonConfigPanel");
  const blackjackConfigPanel = document.getElementById("blackjackConfigPanel");
  const minesConfigPanel = document.getElementById("minesConfigPanel");

  const isDragonView = state.currentUser.isAdmin && state.userModalView === "dragon";
  categoriesTab.classList.toggle("active", !isDragonView);
  dragonTab.classList.toggle("active", isDragonView);
  dragonTab.hidden = !state.currentUser.isAdmin;
  categoriesPanel.hidden = isDragonView;
  dragonPanel.hidden = !isDragonView;
  dragonConfigTab?.classList.toggle("active", state.userGameConfigView === "dragon");
  blackjackConfigTab?.classList.toggle("active", state.userGameConfigView === "blackjack");
  minesConfigTab?.classList.toggle("active", state.userGameConfigView === "mines");
  if (dragonConfigPanel) {
    dragonConfigPanel.hidden = state.userGameConfigView !== "dragon";
  }
  if (blackjackConfigPanel) {
    blackjackConfigPanel.hidden = state.userGameConfigView !== "blackjack";
  }
  if (minesConfigPanel) {
    minesConfigPanel.hidden = state.userGameConfigView !== "mines";
  }

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

  if (dragonLobbyInput) {
    dragonLobbyInput.value = String(Math.round(state.dragonConfigDraft.lobbyMs / 1000));
  }
  if (dragonSpeedInput) {
    dragonSpeedInput.value = state.dragonConfigDraft.speedFactor.toFixed(2);
  }
  if (dragonLuckyChanceInput) {
    dragonLuckyChanceInput.value = String(state.dragonConfigDraft.luckyChancePercent);
  }
  if (dragonLuckyCrashInput) {
    dragonLuckyCrashInput.value = String(state.dragonConfigDraft.luckyCrashPerThousand);
  }
  if (dragonLowCapInput) {
    dragonLowCapInput.value = state.dragonConfigDraft.lowCapMultiplier.toFixed(2);
  }
  if (dragonLowChanceInput) {
    dragonLowChanceInput.value = String(state.dragonConfigDraft.lowCrashPerThousand);
  }
  if (dragonMidCapInput) {
    dragonMidCapInput.value = state.dragonConfigDraft.midCapMultiplier.toFixed(2);
  }
  if (dragonMidChanceInput) {
    dragonMidChanceInput.value = String(state.dragonConfigDraft.midCrashPerThousand);
  }
  if (dragonHighCapInput) {
    dragonHighCapInput.value = state.dragonConfigDraft.highCapMultiplier.toFixed(2);
  }
  if (dragonHighChanceInput) {
    dragonHighChanceInput.value = String(state.dragonConfigDraft.highCrashPerThousand);
  }
  if (dragonUltraChanceInput) {
    dragonUltraChanceInput.value = String(state.dragonConfigDraft.ultraCrashPerThousand);
  }
  if (dragonTestCapInput) {
    dragonTestCapInput.value = state.dragonConfigDraft.testMaxMultiplier.toFixed(2);
  }
  if (dragonTestToggleButton) {
    dragonTestToggleButton.textContent = state.dragonConfigDraft.testMode ? "Test Acik" : "Test Kapali";
    dragonTestToggleButton.classList.toggle("btn-primary", state.dragonConfigDraft.testMode);
    dragonTestToggleButton.classList.toggle("btn-secondary", !state.dragonConfigDraft.testMode);
  }
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

  async function persistMessageUpdate(message) {
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

function selectedChannel() {
  return state.channels.find((channel) => channel.id === state.selectedChannelId) || null;
}

function isCasinoDragonView(id = state.selectedChannelId) {
  return id === DRAGON_CHANNEL_ID;
}

function isCasinoMiningView(id = state.selectedChannelId) {
  return id === MINING_CHANNEL_ID;
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
  const disabled = !enabled || !ownerCanPlay || Boolean(state.interactiveActionLocks[messageId]);
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

  async function performDragonAction(messageId, actionType) {
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

async function handleDragonHubAction(action, options = {}) {
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

async function loadDragonSession({ initial = false } = {}) {
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

function normalizeBackendOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin.replace(/\/+$/, "");
  } catch {
    return "";
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

function hasDirectRealtimeBackend() {
  if (GAME_BACKEND_URL) return true;
  const { hostname, port } = window.location;
  return (hostname === "localhost" || hostname === "127.0.0.1") && port === "5173";
}

  function buildGameApiUrl(path, query = {}) {
  return buildFrontendApiUrl(path, query);
  }

  function buildMessagesApiUrl(query = {}) {
    return buildFrontendApiUrl("/api/messages", query);
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

function buildGameSocketUrl(stream, scopeKey) {
  const url = new URL("/ws", `${getGameBackendOrigin()}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("stream", String(stream || ""));
  url.searchParams.set("scopeKey", String(scopeKey || "local-preview"));
  url.searchParams.set("actorId", String(state.currentUser.id || ""));
  url.searchParams.set("actorName", String(state.currentUser.displayName || state.currentUser.username || "Oyuncu"));
  return url.toString();
}

function getRealtimeSocketState(kind) {
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

function closeRealtimeSocket(kind) {
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

function scheduleRealtimeReconnect(kind, connect) {
  const keys = getRealtimeSocketState(kind);
  if (state[keys.reconnectKey]) return;
  state[keys.reconnectKey] = window.setTimeout(() => {
    state[keys.reconnectKey] = null;
    connect();
  }, 1200);
}

function connectRealtimeSocket(kind, scopeKey, handlers) {
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

function startDragonSessionSync() {
  stopDragonSessionSync();
  if (!state.scopeKey) return;

  state.dragonSessionSyncHandle = window.setInterval(() => {
    if (state.dragonRealtimeReady && !isCasinoDragonView()) return;
    if (!state.dragonSession && !isCasinoDragonView()) return;
    void loadDragonSession();
  }, state.dragonRealtimeReady ? 5000 : 1000);
}

function stopDragonSessionSync() {
  if (!state.dragonSessionSyncHandle) return;
  window.clearInterval(state.dragonSessionSyncHandle);
  state.dragonSessionSyncHandle = null;
}

async function initializeMiningTransport() {
  await loadMiningState({ initial: true });
  startMiningSessionSync();
  startMiningUiTicker();
  window.advanceTime = (ms) => new Promise((resolve) => window.setTimeout(resolve, Number(ms || 0)));
  connectRealtimeSocket("mining", getMiningScopeKey(), {
    onHeartbeat: syncMiningServerClock,
    onSnapshot: (payload) => {
      applyMiningTransportPayload(payload);
    },
    onStatusChange: () => startMiningSessionSync()
  });
}

function getMiningScopeKey() {
  return `mining:${state.scopeKey}:v2`;
}

async function loadMiningState({ initial = false } = {}) {
  if (initial) {
    state.miningStateLoading = true;
    if (isCasinoMiningView()) render();
  }

  try {
    const response = await fetch(buildGameApiUrl("/api/mining", {
      scopeKey: getMiningScopeKey(),
      actorId: state.currentUser.id,
      actorName: state.currentUser.displayName,
      ts: Date.now()
    }), {
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    applyMiningTransportPayload(payload, { forceRender: initial });
  } catch (error) {
    console.warn("Mining state load failed.", error);
  } finally {
    state.miningStateLoading = false;
    if (initial && isCasinoMiningView()) render();
  }
}

function startMiningSessionSync() {
  stopMiningSessionSync();
  if (!state.scopeKey) return;

  state.miningSessionSyncHandle = window.setInterval(() => {
    if (state.miningRealtimeReady && !isCasinoMiningView()) return;
    if (!state.miningSession && !isCasinoMiningView()) return;
    void loadMiningState();
  }, isCasinoMiningView() ? 140 : (state.miningRealtimeReady ? 2500 : 500));
}

function stopMiningSessionSync() {
  if (!state.miningSessionSyncHandle) return;
  window.clearInterval(state.miningSessionSyncHandle);
  state.miningSessionSyncHandle = null;
}

function startMiningUiTicker() {
  stopMiningUiTicker();
  state.miningUiTickerHandle = window.setInterval(() => {
    if (!isCasinoMiningView()) return;
    const phase = state.miningSession?.content ? getMiningPhase(state.miningSession.content) : "idle";
    const now = getMiningNow();
    if (phase === "active" && (now - state.miningUiLastRenderAtMs) >= 300) {
      state.miningUiLastRenderAtMs = Date.now();
      if (!updateMiningActiveStageDom({ repaintCanvas: false })) {
        render();
      }
    }
  }, MINING_ACTION_TICK_MS);
}

function stopMiningUiTicker() {
  if (!state.miningUiTickerHandle) return;
  window.clearInterval(state.miningUiTickerHandle);
  state.miningUiTickerHandle = null;
}

function applyMiningTransportPayload(payload, options = {}) {
  const { forceRender = false } = options;
  const previousPhase = state.miningSession?.content ? getMiningPhase(state.miningSession.content) : "idle";
  const previousKey = getMiningTransportRenderKey(state.miningSession, state.miningProfile);
  syncMiningServerClock(payload?.serverNowMs);
  const nextSession = payload?.session
    ? {
      ...payload.session,
      content: normalizeMiningSession(payload.session.content)
    }
    : null;
  const nextProfile = normalizeMiningProfile(payload?.profile, {
    id: state.currentUser.id,
    name: state.currentUser.displayName
  });
  state.miningSession = nextSession;
  state.miningProfile = nextProfile;
  syncMiningVisualState(nextSession?.content || null);
  const phase = state.miningSession?.content ? getMiningPhase(state.miningSession.content) : "idle";
  const player = state.miningSession?.content ? getMiningCurrentPlayer(state.miningSession.content, state.currentUser.id) : null;
  if (phase !== "active" || !player || player.status !== "active") {
    clearMiningQueuedActions();
    state.miningBufferedInput = null;
  }
  window.render_game_to_text = () => renderMiningTextState(state.miningSession?.content || null, state.currentUser.id);
  if (forceRender || previousKey !== getMiningTransportRenderKey(state.miningSession, nextProfile)) {
    if (isCasinoMiningView()) {
      state.miningUiLastRenderAtMs = Date.now();
      if (previousPhase === "active" && phase === "active" && updateMiningActiveStageDom({ repaintCanvas: true })) {
        requestMiningCanvasFrame();
        return;
      }
      render();
      requestMiningCanvasFrame();
    }
  }
}

function syncMiningVisualState(session, now = getMiningNow()) {
  if (!session) {
    state.miningVisualPlayers = {};
    state.miningCameraX = 0;
    state.miningCameraY = 0;
    return;
  }

  const previousVisuals = state.miningVisualPlayers || {};
  const previousLocal = previousVisuals[state.currentUser.id] || null;
  const nextVisuals = {};
  for (const player of session.players || []) {
    const previous = previousVisuals[player.id] || null;
    const serverX = Number(player.x);
    const serverY = Number(player.y);
    const teleported = previous && (Math.sqrt((previous.x - serverX) ** 2 + (previous.y - serverY) ** 2) > 5);

    nextVisuals[player.id] = {
      id: player.id,
      name: player.name,
      x: !previous || teleported || player.status !== "active" ? serverX : previous.x,
      y: !previous || teleported || player.status !== "active" ? serverY : previous.y,
      targetX: Number(player.targetX ?? serverX),
      targetY: Number(player.targetY ?? serverY),
      serverX,
      serverY,
      speed: Number(player.speed || 4.0),
      status: player.status,
      facing: player.facing || previous?.facing || "right",
      integrity: Number(player.integrity || 0),
      runCoins: Number(player.runCoins || 0),
      lastAction: player.lastAction || "",
      lastActionAtMs: Number(player.lastActionAtMs || 0),
      lastActionTargetX: Number(player.lastActionTargetX ?? player.x),
      lastActionTargetY: Number(player.lastActionTargetY ?? player.y),
      lastHurtAtMs: Number(player.lastHurtAtMs || 0)
    };
  }

  state.miningVisualPlayers = nextVisuals;
  const localVisual = nextVisuals[state.currentUser.id] || null;
  if (!localVisual) return;

  const shouldSnapCamera = !previousLocal
    || !Number.isFinite(state.miningCameraX)
    || !Number.isFinite(state.miningCameraY)
    || (Math.sqrt((state.miningCameraX - localVisual.x) ** 2 + (state.miningCameraY - localVisual.y) ** 2) > 10);
  if (shouldSnapCamera) {
    state.miningCameraX = localVisual.x;
    state.miningCameraY = localVisual.y;
  }
}

function startMiningCanvasLoop() {
  if (state.miningCanvasRaf) return;
  state.miningCanvasLastFrameAtMs = 0;
  state.miningCanvasRaf = window.requestAnimationFrame(tickMiningCanvasFrame);
}

function stopMiningCanvasLoop() {
  if (!state.miningCanvasRaf) return;
  window.cancelAnimationFrame(state.miningCanvasRaf);
  state.miningCanvasRaf = 0;
  state.miningCanvasLastFrameAtMs = 0;
}

function requestMiningCanvasFrame() {
  const canvas = document.getElementById("miningCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  startMiningCanvasLoop();
}

function tickMiningCanvasFrame(frameAtMs) {
  state.miningCanvasRaf = 0;
  if (!isCasinoMiningView()) {
    stopMiningCanvasLoop();
    return;
  }
  const canvas = document.getElementById("miningCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    stopMiningCanvasLoop();
    return;
  }

  const deltaMs = state.miningCanvasLastFrameAtMs ? Math.min(34, Math.max(8, frameAtMs - state.miningCanvasLastFrameAtMs)) : 16;
  state.miningCanvasLastFrameAtMs = frameAtMs;
  advanceMiningVisualState(deltaMs);
  renderMiningCanvas(canvas);
  state.miningCanvasRaf = window.requestAnimationFrame(tickMiningCanvasFrame);
}

function advanceMiningVisualState(deltaMs) {
  for (const entry of Object.values(state.miningVisualPlayers || {})) {
    if (!entry) continue;
    const speed = Number(entry.speed || 4.0);
    const tx = Number(entry.targetX ?? entry.serverX ?? entry.x);
    const ty = Number(entry.targetY ?? entry.serverY ?? entry.y);
    const dx = tx - entry.x;
    const dy = ty - entry.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.005) {
      const maxMove = speed * (deltaMs / 1000);
      if (maxMove >= dist) {
        entry.x = tx;
        entry.y = ty;
      } else {
        entry.x += (dx / dist) * maxMove;
        entry.y += (dy / dist) * maxMove;
      }
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        entry.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      }
    }

    const serverDx = Number(entry.serverX ?? entry.x) - entry.x;
    const serverDy = Number(entry.serverY ?? entry.y) - entry.y;
    const serverDist = Math.sqrt(serverDx * serverDx + serverDy * serverDy);
    if (serverDist > 0.5 && serverDist < 5) {
      const correction = 1 - Math.exp(-deltaMs / 250);
      entry.x += serverDx * correction;
      entry.y += serverDy * correction;
    }
  }

  const localVisual = state.miningVisualPlayers[state.currentUser.id] || null;
  if (!localVisual) return;

  if (state.miningAutoAction && !state.interactiveActionLocks["mining"]) {
    const aa = state.miningAutoAction;
    const tileCX = (aa.tileX ?? aa.x) + 0.5;
    const tileCY = (aa.tileY ?? aa.y) + 0.5;
    const distToTarget = Math.sqrt((localVisual.x - tileCX) ** 2 + (localVisual.y - tileCY) ** 2);
    if (distToTarget <= 1.4) {
      const action = aa.type;
      const meta = action === "mine" ? { x: aa.x, y: aa.y } : { targetId: aa.targetId };
      state.miningAutoAction = null;
      void performMiningAction(action, meta);
    }
  }

  const cameraBlend = 1 - Math.exp(-deltaMs / 105);
  state.miningCameraX += (localVisual.x - state.miningCameraX) * cameraBlend;
  state.miningCameraY += (localVisual.y - state.miningCameraY) * cameraBlend;
}

function getMiningTransportRenderKey(sessionRecord, profile) {
  const session = sessionRecord?.content || null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  return [
    sessionRecord?.id || "none",
    Number(sessionRecord?.serverCreatedAtMs || sessionRecord?.createdAtMs || 0),
    Number(session?.revision || 0),
    String(session?.status || "idle"),
    Number(player?.x ?? -1),
    Number(player?.y ?? -1),
    Number(player?.integrity ?? -1),
    Number(player?.runCoins ?? -1),
    Number(profile?.walletCoins ?? -1)
  ].join("|");
}

async function handleMiningUiAction(action) {
  if (action === "show-entrance") {
    state.miningViewTab = "entrance";
    render();
    return;
  }
  if (action === "show-inventory") {
    state.miningViewTab = "inventory";
    render();
    return;
  }
  if (action === "show-shop") {
    state.miningViewTab = "shop";
    render();
    return;
  }
  if (action === "start_lobby" || action === "join_lobby" || action === "extract") {
    await performMiningAction(action);
  }
}

async function performMiningAction(action, meta = {}, options = {}) {
  const { silent = false } = options;
  if (state.interactiveActionLocks["mining"]) return;
  state.interactiveActionLocks["mining"] = true;
  try {
    if (action === "move" && meta.targetX !== undefined && meta.targetY !== undefined) {
      applyOptimisticMiningMove(meta.targetX, meta.targetY);
    }
    const response = await fetch(buildGameApiUrl("/api/mining"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scopeKey: getMiningScopeKey(),
        action,
        actor: {
          id: state.currentUser.id,
          name: state.currentUser.displayName
        },
        ...meta
      })
    });
    if (!response.ok) {
      throw new Error("Mining action failed.");
    }
    const payload = await response.json();
    applyMiningTransportPayload(payload, { forceRender: true });
    if (payload.errorCode) {
      const label = translateMiningError(payload.errorCode);
      if (label && !silent) showToast(label);
    }
    return payload;
  } catch (error) {
    console.warn("Mining action failed.", error);
    if (!silent) showToast("Mining istegi basarisiz.");
    return null;
  } finally {
    delete state.interactiveActionLocks["mining"];
    const bufferedInput = state.miningBufferedInput;
    if (bufferedInput) {
      state.miningBufferedInput = null;
      window.setTimeout(() => {
        void dispatchMiningCanvasIntent(bufferedInput);
      }, 0);
    }
  }
}

function translateMiningError(errorCode) {
  if (!errorCode) return "";
  const map = {
    cooldown: "Biraz nefeslen, hareket sirada.",
    blocked: "Orasi kapali.",
    "pick-tier": "Bu damar icin daha iyi kazma lazim.",
    range: "Hedef bir adim uzakta degil.",
    "not-on-exit": "Cikis karesine ulasman lazim.",
    inactive: "Su an aktif bir maden yok.",
    "already-joined": "Zaten seanstasin."
  };
  return map[errorCode] || "";
}

function renderMiningStageJoinAction(player) {
  const canJoin = !player && !["escaped", "collapsed"].includes(String(player?.status || ""));
  return canJoin
    ? `<button type="button" class="btn dragon-modal-action mining-join-action" data-mining-action="join_lobby">Katil</button>`
    : "";
}

function renderMiningStageHudPills(session, activePlayer, now = getMiningNow()) {
  const joinedCount = session?.players?.length || 0;
  const collapseMsLeft = session?.collapseAtMs ? Math.max(0, session.collapseAtMs - now) : 0;
  const hardMsLeft = session?.hardCollapseAtMs ? Math.max(0, session.hardCollapseAtMs - now) : MINING_TARGET_RUN_MS;
  return `
    <span class="mining-pill">Toplanan ${escapeHtml(formatCoinValue(activePlayer?.runCoins || 0))}</span>
    <span class="mining-pill">Butunluk ${escapeHtml(`${Math.round(Number(activePlayer?.integrity ?? 100))}%`)}</span>
    <span class="mining-pill">Katilim ${escapeHtml(String(joinedCount))}</span>
    <span class="mining-pill">Cikis ${escapeHtml(String((session?.discoveredExitIds || []).length))}/2</span>
    <span class="mining-pill">Hedef ${escapeHtml(formatDurationLabel(hardMsLeft))}</span>
    <span class="mining-pill ${session?.collapseAtMs ? "is-danger" : ""}">${escapeHtml(session?.collapseAtMs ? `Cokus ${formatDurationLabel(collapseMsLeft)}` : "Cikis araniyor")}</span>
  `;
}

function renderMiningSummaryText(session, now = getMiningNow()) {
  if (session?.currentEvent) {
    return `${session.currentEvent.label} ${formatDurationLabel(session.currentEvent.expiresAtMs - now)}`;
  }
  return session?.summary || "Magarada ilerle, damarlari kir, cikis ara.";
}

function bindMiningActionButtons(root = document) {
  root.querySelectorAll("[data-mining-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.miningAction;
      if (!action) return;
      await handleMiningUiAction(action);
    });
  });
}

function updateMiningActiveStageDom({ repaintCanvas = false } = {}) {
  if (!isCasinoMiningView()) return false;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session || getMiningPhase(session) !== "active") return false;

  const subtitle = document.getElementById("miningStageSubtitle");
  const roster = document.getElementById("miningRoster");
  const hud = document.getElementById("miningStageHud");
  const joinHost = document.getElementById("miningJoinActionHost");
  const summary = document.getElementById("miningSummaryChip");
  const canvas = document.getElementById("miningCanvas");

  if (!subtitle || !roster || !hud || !joinHost || !summary || !(canvas instanceof HTMLCanvasElement)) {
    return false;
  }

  const activePlayer = player && player.status === "active" ? player : null;
  subtitle.textContent = activePlayer
    ? "Tikladigin hedefe akici sekilde ilerle. Damara vurunca kendin kazmaya devam edersin."
    : "Aktif magara acik. Istedigin an iceri dalabilirsin.";
  roster.innerHTML = renderMiningRoster(session.players || []);
  hud.innerHTML = renderMiningStageHudPills(session, activePlayer);
  joinHost.innerHTML = renderMiningStageJoinAction(player);
  bindMiningActionButtons(joinHost);
  summary.textContent = renderMiningSummaryText(session);

  if (repaintCanvas) {
    renderMiningCanvas(canvas);
  }

  return true;
}

function renderMiningRealtimeView() {
  const profile = normalizeMiningProfile(state.miningProfile, {
    id: state.currentUser.id,
    name: state.currentUser.displayName
  });
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const phase = session ? getMiningPhase(session) : "idle";
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  const tab = state.miningViewTab || "entrance";
  const isActiveRun = phase === "active";
  const isFinished = phase === "finished" || phase === "collapsed";

  if (state.miningStateLoading) {
    return `<section class="mining-screen"><div class="chat-loading"><div class="chat-loading-spinner"></div><div class="chat-loading-text">Mining yukleniyor...</div></div></section>`;
  }

  const menu = !isActiveRun ? `
    <div class="mining-menu-switch">
      <button type="button" class="mining-menu-tab ${tab === "entrance" ? "active" : ""}" data-mining-action="show-entrance">Magara</button>
      <button type="button" class="mining-menu-tab ${tab === "inventory" ? "active" : ""}" data-mining-action="show-inventory">Envanter</button>
      <button type="button" class="mining-menu-tab ${tab === "shop" ? "active" : ""}" data-mining-action="show-shop">Dukkan</button>
    </div>
  ` : "";

  if (!session || isFinished) {
    return `
      <section class="mining-screen">
        <div class="mining-shell">
          <div class="mining-header">
            <div>
              <div class="mining-title">Mining</div>
              <div class="mining-subtitle">Tek aktif magara, 10-15 dk risk-reward kosusu ve gizli iki cikis.</div>
            </div>
            <div class="mining-wallet">${escapeHtml(formatCoinValue(profile.walletCoins))}</div>
          </div>
          ${menu}
          <div class="mining-main-grid">
            <div class="mining-card mining-hero">
              <div class="mining-hero-copy">
                <strong>Yeni magara hazirla</strong>
                <p>Magara kapanmadan cikabilirsen coinler cebe gider. Cikis bulunduğu anda geri sayim baslar.</p>
              </div>
              <button type="button" class="btn dragon-modal-action" data-mining-action="start_lobby">Magaayi Ac</button>
              ${session ? `<div class="mining-summary-chip ${phase === "collapsed" ? "is-loss" : "is-win"}">${escapeHtml(session.summary || "Son seans tamamlandi.")}</div>` : ""}
            </div>
            <div class="mining-card">
              ${renderMiningSecondaryPanel(tab, profile)}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  const activePlayer = player && player.status === "active" ? player : null;
  const joinAction = renderMiningStageJoinAction(player);
  const summaryPill = renderMiningSummaryText(session);
  return `
    <section class="mining-screen mining-screen-active">
      <div class="mining-shell mining-shell-active">
        <div class="mining-active-grid">
          <div class="mining-stage-card mining-stage-card-full">
            <div class="mining-stage-overlay mining-stage-overlay-left">
              <div class="mining-stage-brand">Mining</div>
              <div id="miningStageSubtitle" class="mining-stage-subtitle">${escapeHtml(activePlayer ? "Tikladigin hedefe akici sekilde ilerle. Damara vurunca kendin kazmaya devam edersin." : "Aktif magara acik. Istedigin an iceri dalabilirsin.")}</div>
              <div id="miningRoster" class="mining-roster compact">${renderMiningRoster(session.players || [])}</div>
            </div>
            <div class="mining-stage-overlay mining-stage-overlay-right">
              <div id="miningStageHud" class="mining-stage-hud">${renderMiningStageHudPills(session, activePlayer)}</div>
              <div id="miningJoinActionHost">${joinAction}</div>
            </div>
            <canvas id="miningCanvas" class="mining-canvas" width="${MINING_TILE_SIZE * ((MINING_VIEW_RADIUS * 2) + 1)}" height="${MINING_TILE_SIZE * ((MINING_VIEW_RADIUS * 2) + 1)}"></canvas>
            <div class="mining-stage-overlay mining-stage-overlay-bottom">
              <div id="miningSummaryChip" class="mining-summary-chip">${escapeHtml(summaryPill)}</div>
              <div class="mining-stage-legend">
                <span>Tikla: hedefe yurur</span>
                <span>Damar: otomatik kaz</span>
                <span>Kostebek: yakinsan vur</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMiningSecondaryPanel(tab, profile) {
  if (tab === "shop") {
    return `
      <div class="mining-panel-title">Dukkan</div>
      <div class="mining-shop-list">
        ${MINING_SHOP_ITEMS.map((item) => `
          <div class="mining-shop-item">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(formatCoinValue(item.price))}</span>
            <small>${escapeHtml(item.note)}</small>
            <button type="button" class="btn btn-secondary" disabled>Yakinda</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  if (tab === "inventory") {
    return `
      <div class="mining-panel-title">Envanter / Slotlar</div>
      <div class="mining-slot-grid">
        ${MINING_SLOT_KEYS.map((slot) => `
          <div class="mining-slot-card">
            <span>${escapeHtml(getMiningSlotLabel(slot))}</span>
            <strong>${escapeHtml(profile.loadout?.[slot]?.label || "Bos")}</strong>
          </div>
        `).join("")}
      </div>
      <p class="mining-slot-note">Slot sistemi hazir. Ekipman etkileri sonraki adimda acilacak.</p>
    `;
  }

  return `
    <div class="mining-panel-title">Magara Bilgisi</div>
    <div class="mining-info-stack">
      <div class="mining-info-row"><span>Katilim</span><strong>Her an acik</strong></div>
      <div class="mining-info-row"><span>Tur Hedefi</span><strong>10-15 dk</strong></div>
      <div class="mining-info-row"><span>Cikis Bulununca</span><strong>90 sn cokme</strong></div>
      <div class="mining-info-row"><span>Rare Event</span><strong>Yildiz Cevheri</strong></div>
      <div class="mining-info-row"><span>Kostebek Tehdidi</span><strong>Coin ve agirlikla artar</strong></div>
    </div>
  `;
}

function renderMiningRoster(players) {
  if (!players.length) {
    return '<div class="mining-roster-empty">Henuz madenci yok.</div>';
  }
  return players.map((entry) => {
    const tone = entry.status === "escaped" ? "is-win" : entry.status === "collapsed" ? "is-loss" : "";
    return `<span class="mining-roster-pill ${tone}">${escapeHtml(entry.name)} · ${escapeHtml(entry.status === "queued" ? "hazir" : entry.status === "active" ? `${entry.runCoins}c` : entry.status)}</span>`;
  }).join("");
}

function renderMiningCanvas(canvas) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  const map = session?.map;
  syncMiningCanvasResolution(canvas);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#17131a";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (!session || !map) {
    context.fillStyle = "#f5e8c8";
    context.font = "700 28px Trebuchet MS";
    context.textAlign = "center";
    context.fillText("Mining", canvas.width / 2, canvas.height / 2 - 10);
    context.font = "14px Trebuchet MS";
    context.fillText("Lobi acildiginda harita burada canlanacak.", canvas.width / 2, canvas.height / 2 + 20);
    return;
  }

  const now = getMiningNow();
  const metrics = getMiningCanvasMetrics(canvas, session, player);

  drawMiningBackdrop(context, metrics, now);

  const startX = Math.floor(metrics.worldStartX) - 1;
  const startY = Math.floor(metrics.worldStartY) - 1;
  const endX = Math.ceil(metrics.worldStartX + metrics.visibleWidthTiles) + 1;
  const endY = Math.ceil(metrics.worldStartY + metrics.visibleHeightTiles) + 1;

  for (let tileY = startY; tileY <= endY; tileY += 1) {
    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const tile = getMiningTile(map, tileX, tileY);
      if (!tile) continue;
      if (tile.kind === "wall" && tile.oreId) {
        drawMiningWallTile(context, metrics, tileX, tileY, tile, now);
      } else if (tile.kind === "exit") {
        drawMiningExitTile(context, metrics, tileX, tileY, now);
      }
    }
  }

  drawMiningEffects(context, metrics, session.effects || [], now);

  for (const mole of session.moles || []) {
    drawMiningMoleSprite(context, metrics, mole, now);
  }

  for (const entry of session.players || []) {
    drawMiningPlayerSprite(context, metrics, entry, now);
  }

  drawMiningQueuedPath(context, metrics);
}

function handleMiningCanvasClick(event) {
  event.preventDefault();
  const canvas = event.currentTarget;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session || !player || player.status !== "active" || !session.map) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  const localX = (event.clientX - rect.left) * scaleX;
  const localY = (event.clientY - rect.top) * scaleY;
  const metrics = getMiningCanvasMetrics(canvas, session, player);
  const worldX = metrics.worldStartX + (localX / metrics.tilePx);
  const worldY = metrics.worldStartY + (localY / metrics.tilePx);
  const tileX = Math.floor(worldX);
  const tileY = Math.floor(worldY);

  state.miningTargetTile = { x: worldX, y: worldY };
  requestMiningCanvasFrame();

  const tile = getMiningTile(session.map, tileX, tileY);
  if (!tile) return;

  const tileCenterX = tileX + 0.5;
  const tileCenterY = tileY + 0.5;
  const distToTile = Math.sqrt((player.x - tileCenterX) ** 2 + (player.y - tileCenterY) ** 2);

  const mole = (session.moles || []).find((m) => m.x === tileX && m.y === tileY);

  if (mole) {
    if (distToTile <= 1.4) {
      void performMiningAction("attack", { targetId: mole.id });
    } else {
      state.miningAutoAction = { type: "attack", targetId: mole.id, tileX, tileY };
      void performMiningAction("move", { targetX: worldX, targetY: worldY });
    }
    return;
  }

  if (tile.kind === "wall") {
    if (distToTile <= 1.4) {
      void performMiningAction("mine", { x: tileX, y: tileY });
    } else {
      state.miningAutoAction = { type: "mine", x: tileX, y: tileY };
      void performMiningAction("move", { targetX: worldX, targetY: worldY });
    }
    return;
  }

  if (tile.kind === "floor" || tile.kind === "exit") {
    state.miningAutoAction = null;
    void performMiningAction("move", { targetX: worldX, targetY: worldY });
  }
}

function handleMiningCanvasHover(event) {
  const canvas = event.currentTarget;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session || !player || player.status !== "active" || !session.map) {
    canvas.style.cursor = "default";
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  const localX = (event.clientX - rect.left) * scaleX;
  const localY = (event.clientY - rect.top) * scaleY;
  const metrics = getMiningCanvasMetrics(canvas, session, player);
  const worldX = metrics.worldStartX + (localX / metrics.tilePx);
  const worldY = metrics.worldStartY + (localY / metrics.tilePx);
  const tileX = Math.floor(worldX);
  const tileY = Math.floor(worldY);
  const tile = getMiningTile(session.map, tileX, tileY);
  const mole = (session.moles || []).find((m) => m.x === tileX && m.y === tileY);
  canvas.style.cursor = (tile && (tile.kind === "wall" || tile.kind === "exit")) || mole ? "pointer" : "default";
}

function handleMiningCanvasWheel(event) {
  event.preventDefault();
  const nextZoom = clamp(
    state.miningZoom + (event.deltaY < 0 ? 0.08 : -0.08),
    MINING_MIN_ZOOM,
    MINING_MAX_ZOOM
  );
  if (Math.abs(nextZoom - state.miningZoom) < 0.001) return;
  state.miningZoom = nextZoom;
  saveMiningZoomPreference();
  requestMiningCanvasFrame();
}


function applyOptimisticMiningMove(targetX, targetY) {
  const localVisual = state.miningVisualPlayers[state.currentUser.id];
  if (!localVisual) return;
  localVisual.targetX = targetX;
  localVisual.targetY = targetY;
  const dx = targetX - localVisual.x;
  const dy = targetY - localVisual.y;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    localVisual.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  }
}


function clearMiningQueuedActions() {
  state.miningTargetTile = null;
  state.miningAutoAction = null;
}

async function dispatchMiningCanvasIntent(intent) {
  // Kept for buffered input compatibility
  if (!intent) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session || !player || player.status !== "active" || !session.map) return;
  const targetX = Number(intent?.targetX ?? 0);
  const targetY = Number(intent?.targetY ?? 0);
  void performMiningAction("move", { targetX, targetY });
}

function getMiningViewport(session, player) {
  const mapSize = Number(session?.map?.size || 0);
  const visibleSize = (MINING_VIEW_RADIUS * 2) + 1;
  const fallback = Math.max(0, Math.floor(mapSize / 2) - MINING_VIEW_RADIUS);
  if (Number.isInteger(session?.map?.originX) && Number.isInteger(session?.map?.originY) && Number.isInteger(session?.map?.windowSize) && session.map.windowSize > 0) {
    return {
      originX: session.map.originX,
      originY: session.map.originY,
      visibleSize: session.map.windowSize
    };
  }
  if (!mapSize) {
    return { originX: fallback, originY: fallback, visibleSize };
  }
  if (!player) {
    return {
      originX: Number.isInteger(session?.map?.originX) ? session.map.originX : fallback,
      originY: Number.isInteger(session?.map?.originY) ? session.map.originY : fallback,
      visibleSize: Number.isInteger(session?.map?.windowSize) && session.map.windowSize > 0 ? session.map.windowSize : visibleSize
    };
  }
  return {
    originX: clamp(Math.floor(player.x) - MINING_VIEW_RADIUS, 0, Math.max(0, mapSize - visibleSize)),
    originY: clamp(Math.floor(player.y) - MINING_VIEW_RADIUS, 0, Math.max(0, mapSize - visibleSize)),
    visibleSize
  };
}


function drawMiningQueuedPath(context, metrics) {
  if (!state.miningTargetTile) return;
  const { x, y } = state.miningTargetTile;
  const screenX = (x - metrics.worldStartX) * metrics.tilePx;
  const screenY = (y - metrics.worldStartY) * metrics.tilePx;
  if (screenX < -20 || screenY < -20 || screenX > metrics.canvas.width + 20 || screenY > metrics.canvas.height + 20) return;
  const pulse = 0.5 + (Math.sin(getMiningNow() / 120) * 0.5);
  const radius = metrics.tilePx * 0.12;
  const armLen = metrics.tilePx * 0.22;
  context.save();
  context.globalAlpha = 0.5 + (pulse * 0.4);
  context.strokeStyle = "#fff8b4";
  context.lineWidth = Math.max(2, metrics.tilePx * 0.04);
  context.beginPath();
  context.moveTo(screenX - armLen, screenY);
  context.lineTo(screenX - radius, screenY);
  context.moveTo(screenX + radius, screenY);
  context.lineTo(screenX + armLen, screenY);
  context.moveTo(screenX, screenY - armLen);
  context.lineTo(screenX, screenY - radius);
  context.moveTo(screenX, screenY + radius);
  context.lineTo(screenX, screenY + armLen);
  context.stroke();
  context.beginPath();
  context.arc(screenX, screenY, radius * 0.35, 0, Math.PI * 2);
  context.fillStyle = "#fff8b4";
  context.fill();
  context.restore();
}

function drawMiningPickaxe(context, px, py, size, facing = "right", swing = 0) {
  context.save();
  const direction = facing === "left" ? -1 : 1;
  context.translate(px, py);
  context.scale(direction, 1);
  context.rotate((-0.78 + (swing * 0.95)) * direction);
  context.strokeStyle = "#6f4d32";
  context.lineWidth = Math.max(2, size * 0.08);
  context.beginPath();
  context.moveTo(0, -size * 0.05);
  context.lineTo(0, size * 0.32);
  context.stroke();
  context.fillStyle = "#dee8f6";
  context.beginPath();
  context.moveTo(-size * 0.26, -size * 0.12);
  context.quadraticCurveTo(-size * 0.06, -size * 0.26, size * 0.2, -size * 0.04);
  context.lineTo(size * 0.1, size * 0.02);
  context.quadraticCurveTo(-size * 0.08, -size * 0.12, -size * 0.28, 0);
  context.closePath();
  context.fill();
  context.restore();
}

function getMiningTileColor(tile) {
  if (!tile) return "#1e2641";
  if (tile.kind === "floor") return "#20385a";
  if (tile.kind === "exit") return "#6fd28a";
  const oreColors = {
    stone: "#7b86a0",
    coal: "#475066",
    copper: "#ff9360",
    iron: "#b6c7de",
    amber: "#ffca63",
    sapphire: "#5e8eff",
    ruby: "#ff637c",
    starsteel: "#71f4ff"
  };
  return oreColors[tile.oreId] || "#525867";
}

function syncMiningCanvasResolution(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
  const height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function getMiningCanvasMetrics(canvas, session, player) {
  const map = session?.map || null;
  const zoom = clamp(state.miningZoom, MINING_MIN_ZOOM, MINING_MAX_ZOOM);
  const shortestEdge = Math.max(1, Math.min(canvas.width, canvas.height));
  const visibleShortEdgeTiles = MINING_BASE_VISIBLE_TILES / zoom;
  const tilePx = shortestEdge / visibleShortEdgeTiles;
  const visibleWidthTiles = canvas.width / tilePx;
  const visibleHeightTiles = canvas.height / tilePx;
  const fallbackX = player ? player.x : Math.floor(Number(map?.size || 0) / 2);
  const fallbackY = player ? player.y : Math.floor(Number(map?.size || 0) / 2);
  const rawCameraX = Number.isFinite(state.miningCameraX) ? state.miningCameraX : fallbackX;
  const rawCameraY = Number.isFinite(state.miningCameraY) ? state.miningCameraY : fallbackY;
  const bounds = getMiningCameraBounds(map, visibleWidthTiles, visibleHeightTiles);
  const cameraX = clamp(rawCameraX, bounds.minX, bounds.maxX);
  const cameraY = clamp(rawCameraY, bounds.minY, bounds.maxY);
  state.miningCameraX = cameraX;
  state.miningCameraY = cameraY;
  return {
    canvas,
    map,
    tilePx,
    zoom,
    cameraX,
    cameraY,
    visibleWidthTiles,
    visibleHeightTiles,
    worldStartX: cameraX - (visibleWidthTiles / 2),
    worldStartY: cameraY - (visibleHeightTiles / 2),
    worldEndX: cameraX + (visibleWidthTiles / 2),
    worldEndY: cameraY + (visibleHeightTiles / 2)
  };
}

function getMiningCameraBounds(map, visibleWidthTiles, visibleHeightTiles) {
  const originX = Number(map?.originX || 0);
  const originY = Number(map?.originY || 0);
  const windowSize = Math.max(1, Number(map?.windowSize || map?.size || 1));
  const halfWidth = visibleWidthTiles / 2;
  const halfHeight = visibleHeightTiles / 2;
  const minX = originX + halfWidth;
  const maxX = originX + windowSize - halfWidth;
  const minY = originY + halfHeight;
  const maxY = originY + windowSize - halfHeight;
  return {
    minX: minX > maxX ? originX + (windowSize / 2) : minX,
    maxX: minX > maxX ? originX + (windowSize / 2) : maxX,
    minY: minY > maxY ? originY + (windowSize / 2) : minY,
    maxY: minY > maxY ? originY + (windowSize / 2) : maxY
  };
}

function getMiningTileScreenRect(metrics, tileX, tileY) {
  const x = (tileX - metrics.worldStartX) * metrics.tilePx;
  const y = (tileY - metrics.worldStartY) * metrics.tilePx;
  const size = metrics.tilePx;
  if ((x + size) < -size || (y + size) < -size || x > metrics.canvas.width + size || y > metrics.canvas.height + size) {
    return null;
  }
  return { x, y, size, centerX: x + (size / 2), centerY: y + (size / 2) };
}

function drawMiningBackdrop(context, metrics, now) {
  const gradient = context.createLinearGradient(0, 0, 0, metrics.canvas.height);
  gradient.addColorStop(0, "#3f2b20");
  gradient.addColorStop(0.45, "#241717");
  gradient.addColorStop(1, "#140f14");
  context.fillStyle = gradient;
  context.fillRect(0, 0, metrics.canvas.width, metrics.canvas.height);

  const glow = context.createRadialGradient(
    metrics.canvas.width * 0.5,
    metrics.canvas.height * 0.48,
    metrics.tilePx * 0.4,
    metrics.canvas.width * 0.5,
    metrics.canvas.height * 0.48,
    metrics.canvas.width * 0.58
  );
  glow.addColorStop(0, "rgba(246, 204, 122, 0.18)");
  glow.addColorStop(0.65, "rgba(110, 63, 38, 0.08)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, metrics.canvas.width, metrics.canvas.height);

  const dustOffset = (now / 38) % metrics.tilePx;
  context.save();
  context.strokeStyle = "rgba(255, 231, 182, 0.03)";
  context.lineWidth = Math.max(1, metrics.tilePx * 0.015);
  for (let x = -metrics.tilePx; x <= metrics.canvas.width + metrics.tilePx; x += metrics.tilePx * 1.6) {
    context.beginPath();
    context.moveTo(x + dustOffset, 0);
    context.lineTo(x - (dustOffset * 0.3), metrics.canvas.height);
    context.stroke();
  }
  context.restore();
}

function drawMiningWallTile(context, metrics, tileX, tileY, tile, now) {
  const rect = getMiningTileScreenRect(metrics, tileX, tileY);
  if (!rect) return;
  const colors = getMiningOrePalette(tile.oreId);
  const damageRatio = tile.maxHp > 0 ? 1 - (tile.hp / tile.maxHp) : 0;
  const wobble = getMiningEffectStrength(metrics, tileX, tileY, "mine-hit", now) * 0.08;

  context.save();
  context.translate(rect.centerX, rect.centerY);
  context.scale(1 + wobble, 1 - (wobble * 0.6));

  context.fillStyle = "rgba(0, 0, 0, 0.24)";
  context.beginPath();
  context.ellipse(0, rect.size * 0.18, rect.size * 0.38, rect.size * 0.18, 0, 0, Math.PI * 2);
  context.fill();

  drawMiningRockBlobPath(context, rect.size * 0.39, tileX, tileY, tile.oreId);
  context.fillStyle = colors.base;
  context.fill();
  context.lineWidth = Math.max(3, rect.size * 0.05);
  context.strokeStyle = colors.edge;
  context.stroke();

  drawMiningRockBlobPath(context, rect.size * 0.26, tileX + 7, tileY + 3, `${tile.oreId}-inner`);
  context.fillStyle = colors.highlight;
  context.globalAlpha = 0.65;
  context.fill();
  context.globalAlpha = 1;

  if (damageRatio > 0.02) {
    drawMiningCracks(context, rect.size, damageRatio, colors.crack);
  }

  context.restore();
}

function drawMiningExitTile(context, metrics, tileX, tileY, now) {
  const rect = getMiningTileScreenRect(metrics, tileX, tileY);
  if (!rect) return;
  const pulse = 0.75 + (Math.sin((now / 240) + tileX + tileY) * 0.12);

  context.save();
  context.translate(rect.centerX, rect.centerY);
  context.fillStyle = "rgba(0,0,0,0.22)";
  context.beginPath();
  context.ellipse(0, rect.size * 0.2, rect.size * 0.34, rect.size * 0.16, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffd88f";
  context.beginPath();
  context.moveTo(-rect.size * 0.24, rect.size * 0.28);
  context.lineTo(-rect.size * 0.12, -rect.size * 0.2);
  context.lineTo(rect.size * 0.12, -rect.size * 0.2);
  context.lineTo(rect.size * 0.24, rect.size * 0.28);
  context.closePath();
  context.fill();

  context.fillStyle = `rgba(255, 248, 202, ${0.3 * pulse})`;
  context.beginPath();
  context.arc(0, -rect.size * 0.05, rect.size * 0.28 * pulse, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "rgba(255, 253, 240, 0.92)";
  context.lineWidth = Math.max(3, rect.size * 0.05);
  context.stroke();
  context.restore();
}

function drawMiningRockBlobPath(context, radius, tileX, tileY, salt) {
  const points = 9;
  context.beginPath();
  for (let index = 0; index <= points; index += 1) {
    const angle = (Math.PI * 2 * index) / points;
    const variance = 0.82 + (hashMiningNoise(tileX, tileY, `${salt}:${index}`) * 0.34);
    const px = Math.cos(angle) * radius * variance;
    const py = Math.sin(angle) * radius * (0.84 + (hashMiningNoise(tileX, tileY, `${salt}:y:${index}`) * 0.28));
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}

function drawMiningCracks(context, size, damageRatio, color) {
  context.save();
  context.strokeStyle = color;
  context.lineCap = "round";
  context.lineWidth = Math.max(2, size * 0.045);
  context.beginPath();
  context.moveTo(-size * 0.16, -size * 0.2);
  context.lineTo(size * 0.02, -size * 0.02);
  context.lineTo(-size * 0.04, size * 0.22);
  if (damageRatio > 0.2) {
    context.moveTo(size * 0.08, -size * 0.18);
    context.lineTo(-size * 0.02, size * 0.02);
    context.lineTo(size * 0.14, size * 0.24);
  }
  if (damageRatio > 0.45) {
    context.moveTo(-size * 0.28, size * 0.02);
    context.lineTo(-size * 0.05, size * 0.06);
    context.lineTo(size * 0.18, size * 0.12);
  }
  if (damageRatio > 0.7) {
    context.moveTo(size * 0.18, -size * 0.08);
    context.lineTo(size * 0.28, size * 0.04);
  }
  context.stroke();
  context.restore();
}

function drawMiningEffects(context, metrics, effects, now) {
  for (const effect of effects || []) {
    const age = Math.max(0, now - Number(effect.atMs || 0));
    const progress = clamp(age / 900, 0, 1);
    const rect = getMiningTileScreenRect(metrics, effect.x, effect.y);
    if (!rect) continue;
    context.save();
    context.translate(rect.centerX, rect.centerY);

    if (effect.type === "mine-hit") {
      const radius = rect.size * (0.22 + (progress * 0.34));
      context.strokeStyle = `rgba(255, 225, 170, ${0.45 * (1 - progress)})`;
      context.lineWidth = Math.max(2, rect.size * 0.04);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
    }

    if (effect.type === "mine-break" || effect.type === "mole-break") {
      for (let index = 0; index < 6; index += 1) {
        const angle = ((Math.PI * 2) / 6) * index;
        const distance = rect.size * (0.06 + (progress * 0.34));
        const px = Math.cos(angle) * distance;
        const py = Math.sin(angle) * distance;
        context.fillStyle = `rgba(255, 218, 163, ${0.42 * (1 - progress)})`;
        context.beginPath();
        context.arc(px, py, rect.size * (0.05 + ((1 - progress) * 0.03)), 0, Math.PI * 2);
        context.fill();
      }
    }

    if (effect.type === "mole-hit" || effect.type === "player-hit") {
      context.strokeStyle = effect.type === "player-hit"
        ? `rgba(255, 128, 128, ${0.55 * (1 - progress)})`
        : `rgba(255, 238, 180, ${0.55 * (1 - progress)})`;
      context.lineWidth = Math.max(2, rect.size * 0.035);
      context.beginPath();
      context.arc(0, 0, rect.size * (0.2 + (progress * 0.28)), 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }
}

function drawMiningMoleSprite(context, metrics, mole, now) {
  const rect = getMiningTileScreenRect(metrics, mole.x, mole.y);
  if (!rect) return;
  const hurtStrength = clamp(1 - ((now - Number(mole.hurtAtMs || 0)) / 220), 0, 1);
  const attackStrength = clamp(1 - ((now - Number(mole.lastAttackAtMs || 0)) / 260), 0, 1);
  const bob = Math.sin((now / 170) + mole.x + mole.y) * rect.size * 0.02;
  const direction = mole.facing === "left" ? -1 : 1;

  context.save();
  context.translate(rect.centerX, rect.centerY + bob);
  context.scale(direction, 1);

  context.fillStyle = "rgba(0,0,0,0.24)";
  context.beginPath();
  context.ellipse(0, rect.size * 0.22, rect.size * 0.28, rect.size * 0.12, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = hurtStrength > 0 ? "#ff8b8b" : "#5d4337";
  context.beginPath();
  context.ellipse(0, 0, rect.size * 0.22, rect.size * 0.18, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#7a6255";
  context.beginPath();
  context.ellipse(rect.size * 0.16, rect.size * 0.02, rect.size * 0.14, rect.size * 0.12, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#e6c2ad";
  context.beginPath();
  context.ellipse(rect.size * 0.23, rect.size * (attackStrength ? -0.04 : 0.02), rect.size * 0.09, rect.size * 0.07, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#2d1d18";
  context.lineWidth = Math.max(2, rect.size * 0.03);
  context.beginPath();
  context.moveTo(-rect.size * 0.1, rect.size * 0.16);
  context.lineTo(-rect.size * 0.18, rect.size * 0.26);
  context.moveTo(rect.size * 0.02, rect.size * 0.16);
  context.lineTo(-rect.size * 0.02, rect.size * 0.28);
  context.stroke();

  context.fillStyle = "#241819";
  context.beginPath();
  context.arc(rect.size * 0.22, -rect.size * 0.02, rect.size * 0.015, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawMiningPlayerSprite(context, metrics, entry, now) {
  const visual = state.miningVisualPlayers[entry.id] || {
    x: entry.x,
    y: entry.y,
    targetX: entry.x,
    targetY: entry.y,
    facing: entry.facing || "right",
    lastAction: entry.lastAction || "",
    lastActionAtMs: Number(entry.lastActionAtMs || 0),
    lastActionTargetX: Number(entry.lastActionTargetX ?? entry.x),
    lastActionTargetY: Number(entry.lastActionTargetY ?? entry.y),
    lastHurtAtMs: Number(entry.lastHurtAtMs || 0)
  };

  const rect = getMiningTileScreenRect(metrics, visual.x, visual.y);
  if (!rect) return;
  const moving = Math.abs((visual.targetX ?? visual.x) - visual.x) + Math.abs((visual.targetY ?? visual.y) - visual.y) > 0.003;
  const bob = moving ? Math.sin(now / 88) * rect.size * 0.04 : 0;
  const hurtStrength = clamp(1 - ((now - Number(visual.lastHurtAtMs || 0)) / 260), 0, 1);
  const swingStrength = (visual.lastAction === "mine" || visual.lastAction === "attack")
    ? clamp(1 - ((now - Number(visual.lastActionAtMs || 0)) / 240), 0, 1)
    : 0;
  const facing = visual.facing || "right";
  const direction = facing === "left" ? -1 : 1;

  context.save();
  context.translate(rect.centerX, rect.centerY + bob);
  if (hurtStrength > 0) {
    context.translate(direction * -rect.size * 0.04 * hurtStrength, 0);
  }

  context.fillStyle = "rgba(0,0,0,0.25)";
  context.beginPath();
  context.ellipse(0, rect.size * 0.24, rect.size * 0.2, rect.size * 0.1, 0, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.scale(direction, 1);
  context.fillStyle = entry.id === state.currentUser.id ? "#55c9ff" : "#88e18c";
  context.fillRect(-rect.size * 0.12, -rect.size * 0.02, rect.size * 0.24, rect.size * 0.24);
  context.fillStyle = "#20334a";
  context.fillRect(-rect.size * 0.14, rect.size * 0.18, rect.size * 0.1, rect.size * 0.16);
  context.fillRect(rect.size * 0.04, rect.size * 0.18, rect.size * 0.1, rect.size * 0.16);

  context.fillStyle = hurtStrength > 0 ? "#ffad99" : "#ffd2aa";
  context.beginPath();
  context.arc(0, -rect.size * 0.14, rect.size * 0.14, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#ffcc42";
  context.beginPath();
  context.arc(0, -rect.size * 0.22, rect.size * 0.16, Math.PI, Math.PI * 2);
  context.fill();
  context.fillRect(-rect.size * 0.16, -rect.size * 0.22, rect.size * 0.32, rect.size * 0.06);

  context.fillStyle = "#5d3d27";
  context.fillRect(-rect.size * 0.16, -rect.size * 0.02, rect.size * 0.06, rect.size * 0.18);
  context.fillRect(rect.size * 0.1, -rect.size * 0.02, rect.size * 0.06, rect.size * 0.18);
  drawMiningPickaxe(context, rect.size * 0.17, -rect.size * 0.02, rect.size * 0.62, facing, swingStrength);
  context.restore();
  context.restore();
  drawMiningPlayerName(context, rect, entry.name, entry.id === state.currentUser.id);
}

function drawMiningPlayerName(context, rect, name, isLocal) {
  const label = String(name || "Oyuncu");
  context.save();
  context.font = `800 ${Math.max(10, rect.size * 0.15)}px Trebuchet MS`;
  context.textAlign = "center";
  context.textBaseline = "top";
  const textY = rect.y + (rect.size * 0.98);
  context.fillStyle = isLocal ? "#f7fbff" : "rgba(240, 247, 255, 0.92)";
  context.strokeStyle = "rgba(0, 0, 0, 0.38)";
  context.lineWidth = Math.max(1, rect.size * 0.014);
  context.strokeText(label, rect.centerX, textY);
  context.fillText(label, rect.centerX, textY);
  context.restore();
}

function getMiningEffectStrength(metrics, tileX, tileY, type, now) {
  const effect = (state.miningSession?.content?.effects || []).find((entry) => entry.type === type && entry.x === tileX && entry.y === tileY);
  if (!effect) return 0;
  return clamp(1 - ((now - Number(effect.atMs || 0)) / 220), 0, 1);
}

function getMiningOrePalette(oreId) {
  const palettes = {
    stone: { base: "#8e8378", edge: "#554942", highlight: "#bfb2a3", crack: "rgba(252, 246, 236, 0.72)" },
    coal: { base: "#53565f", edge: "#272932", highlight: "#81838e", crack: "rgba(229, 234, 244, 0.72)" },
    copper: { base: "#b16b44", edge: "#683a25", highlight: "#d9976c", crack: "rgba(255, 231, 206, 0.74)" },
    iron: { base: "#9aa4b3", edge: "#5e6776", highlight: "#c8d1de", crack: "rgba(255, 255, 255, 0.78)" },
    amber: { base: "#cb8b2e", edge: "#774d12", highlight: "#f5bf58", crack: "rgba(255, 239, 176, 0.76)" },
    sapphire: { base: "#5384ff", edge: "#2542a0", highlight: "#87afff", crack: "rgba(223, 239, 255, 0.76)" },
    ruby: { base: "#d35d73", edge: "#7f2638", highlight: "#f39baa", crack: "rgba(255, 229, 236, 0.78)" },
    starsteel: { base: "#6ee6ea", edge: "#1b8f98", highlight: "#b7fcff", crack: "rgba(233, 255, 255, 0.82)" }
  };
  return palettes[oreId] || palettes.stone;
}

function hashMiningNoise(x, y, salt = "") {
  let hash = 2166136261;
  const input = `${x}:${y}:${salt}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function getMiningSlotLabel(slot) {
  const labels = {
    armor: "Zirh",
    boots: "Ayakkabi",
    bag: "Canta",
    tool: "Alet",
    pickaxe: "Kazma"
  };
  return labels[slot] || slot;
}

function formatDurationLabel(ms) {
  const safeMs = Math.max(0, Math.round(Number(ms || 0)));
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}dk ${String(seconds).padStart(2, "0")}sn` : `${seconds}sn`;
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
  const config = normalizeDragonConfig(state.dragonConfig);
  const now = getDragonNow();
  return normalizeDragonState({
    game: "dragon",
    ownerId: state.currentUser.id,
    ownerName: state.currentUser.displayName,
    revision: 1,
    status: "lobby",
    baseStake: DRAGON_BASE_STAKE,
    config,
    launchAtMs: now + config.lobbyMs,
    startedAtMs: now + config.lobbyMs,
    crashAtMultiplier: generateDragonCrashMultiplier(config),
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
  game.config = normalizeDragonConfig(game.config || state.dragonConfig);
  game.launchAtMs = Number(game.launchAtMs) > 0 ? Number(game.launchAtMs) : getDragonNow() + game.config.lobbyMs;
  game.startedAtMs = Number(game.startedAtMs) > 0 ? Number(game.startedAtMs) : game.launchAtMs;
  game.crashAtMultiplier = Number(game.crashAtMultiplier) > 1 ? Number(game.crashAtMultiplier) : generateDragonCrashMultiplier(game.config);
  game.finalMultiplier = Number(game.finalMultiplier) > 0 ? Number(game.finalMultiplier) : 1;
  game.acceleratedAtMs = Number(game.acceleratedAtMs) > 0 ? Number(game.acceleratedAtMs) : 0;
  game.acceleratedFromEffectiveElapsed = Number(game.acceleratedFromEffectiveElapsed) > 0 ? Number(game.acceleratedFromEffectiveElapsed) : 0;
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

function loadMiningZoomPreference() {
  try {
    const value = Number(window.localStorage.getItem(LOCAL_MINING_ZOOM_KEY) || MINING_DEFAULT_ZOOM);
    return Number.isFinite(value) ? clamp(value, MINING_MIN_ZOOM, MINING_MAX_ZOOM) : MINING_DEFAULT_ZOOM;
  } catch {
    return MINING_DEFAULT_ZOOM;
  }
}

function saveMiningZoomPreference() {
  try {
    window.localStorage.setItem(LOCAL_MINING_ZOOM_KEY, String(clamp(state.miningZoom, MINING_MIN_ZOOM, MINING_MAX_ZOOM)));
  } catch {
    // Local preferences are best-effort.
  }
}

function loadDragonAutoCashoutPreference() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_DRAGON_AUTO_CASHOUT_KEY) || "{}");
    return {
      enabled: Boolean(raw?.enabled),
      target: normalizeDragonAutoCashoutTarget(raw?.target)
    };
  } catch {
    return {
      enabled: false,
      target: 2
    };
  }
}

function saveDragonAutoCashoutPreference() {
  try {
    window.localStorage.setItem(LOCAL_DRAGON_AUTO_CASHOUT_KEY, JSON.stringify({
      enabled: Boolean(state.dragonAutoCashoutEnabled),
      target: normalizeDragonAutoCashoutTarget(state.dragonAutoCashoutTarget)
    }));
  } catch {
    // Local preferences are best-effort.
  }
}

function normalizeDragonAutoCashoutTarget(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 2;
  return Math.min(25, Math.max(1.01, Math.round(numeric * 100) / 100));
}

function parseDragonAutoCashoutInput(value) {
  const normalized = String(value || "").trim().replace(",", ".");
  return normalizeDragonAutoCashoutTarget(normalized);
}

function formatDecimalInput(value) {
  return normalizeDragonAutoCashoutTarget(value).toFixed(2);
}

function getDragonEffectiveElapsedForMultiplier(targetMultiplier) {
  const safeTarget = Math.max(1, Number(targetMultiplier || 1));
  const discriminant = (0.09 * 0.09) + (4 * 0.03 * (safeTarget - 1));
  return Math.max(0, (-0.09 + Math.sqrt(discriminant)) / (2 * 0.03));
}

function getDragonBaseEffectiveElapsed(game, elapsedSeconds) {
  const baseSpeed = Math.max(0.1, Number(game?.config?.speedFactor || DEFAULT_DRAGON_CONFIG.speedFactor));
  const stages = [{ multiplier: 1, speed: baseSpeed }]
    .concat(DRAGON_SPEED_STAGES.map((stage) => ({
      multiplier: stage.multiplier,
      speed: Math.max(baseSpeed, stage.speed)
    })));

  let consumedSeconds = 0;
  let carriedEffective = 0;

  for (let index = 0; index < stages.length; index += 1) {
    const currentStage = stages[index];
    const nextStage = stages[index + 1];
    if (!nextStage) {
      return carriedEffective + ((elapsedSeconds - consumedSeconds) * currentStage.speed);
    }

    const currentEffective = getDragonEffectiveElapsedForMultiplier(currentStage.multiplier);
    const nextEffective = getDragonEffectiveElapsedForMultiplier(nextStage.multiplier);
    const stageDurationSeconds = (nextEffective - currentEffective) / currentStage.speed;

    if (elapsedSeconds <= consumedSeconds + stageDurationSeconds) {
      return carriedEffective + ((elapsedSeconds - consumedSeconds) * currentStage.speed);
    }

    consumedSeconds += stageDurationSeconds;
    carriedEffective = nextEffective;
  }

  return carriedEffective;
}

function getDragonEffectiveElapsed(game, now = getDragonNow()) {
  const startedAtMs = Number(game?.startedAtMs || game?.launchAtMs || now);
  const elapsedSeconds = Math.max(0, now - startedAtMs) / 1000;
  const acceleratedAtMs = Number(game?.acceleratedAtMs || 0);
  if (!acceleratedAtMs || acceleratedAtMs <= startedAtMs || now <= acceleratedAtMs) {
    return getDragonBaseEffectiveElapsed(game, elapsedSeconds);
  }

  const baseBeforeAcceleration = Number(game?.acceleratedFromEffectiveElapsed) > 0
    ? Number(game.acceleratedFromEffectiveElapsed)
    : getDragonBaseEffectiveElapsed(game, Math.max(0, acceleratedAtMs - startedAtMs) / 1000);
  const acceleratedSeconds = Math.max(0, now - acceleratedAtMs) / 1000;
  return baseBeforeAcceleration + (acceleratedSeconds * DRAGON_ALL_CASHED_OUT_SPEED);
}

function syncDragonConfigFromServer(config, { overwriteDraft = true, updatedAtMs = 0 } = {}) {
  const nextUpdatedAtMs = Number(updatedAtMs || 0);
  if (nextUpdatedAtMs && nextUpdatedAtMs < Number(state.dragonConfigUpdatedAtMs || 0)) {
    return;
  }

  const normalized = normalizeDragonConfig(config);
  const previousConfig = JSON.stringify(state.dragonConfig || {});
  const nextConfig = JSON.stringify(normalized);
  state.dragonConfig = normalized;
  if (nextUpdatedAtMs) {
    state.dragonConfigUpdatedAtMs = nextUpdatedAtMs;
  }
  if (overwriteDraft) {
    state.dragonConfigDraft = normalizeDragonConfig(normalized);
  }
  if (previousConfig !== nextConfig && userBackdrop.classList.contains("open")) {
    renderUserModal();
  }
}

function mergeDragonSessionWithLocal(currentSession, incomingSession) {
  if (!currentSession || !incomingSession || currentSession.id !== incomingSession.id) {
    return incomingSession;
  }

  const currentGame = normalizeDragonState(currentSession.content);
  const incomingGame = normalizeDragonState(incomingSession.content);
  const currentRevision = Number(currentGame.revision || 0);
  const incomingRevision = Number(incomingGame.revision || 0);

  // A server-side crash is authoritative and must override optimistic cashout state.
  if (incomingGame.status === "crashed") {
    return incomingSession;
  }

  if (currentRevision > incomingRevision) {
    return currentSession;
  }

  const currentParticipant = getDragonParticipant(currentGame, state.currentUser.id);
  const incomingParticipant = getDragonParticipant(incomingGame, state.currentUser.id);
  if (currentParticipant?.status === "cashed_out" && incomingParticipant?.status !== "cashed_out") {
    return currentSession;
  }

  if (currentGame.status === "crashed" && incomingGame.status !== "crashed") {
    return currentSession;
  }

  if (Number(currentGame.acceleratedAtMs || 0) > Number(incomingGame.acceleratedAtMs || 0)) {
    return currentSession;
  }

  if (Number(currentGame.acceleratedFromEffectiveElapsed || 0) > Number(incomingGame.acceleratedFromEffectiveElapsed || 0)) {
    return currentSession;
  }

  return incomingSession;
}

function getDragonSessionRenderKey(session) {
  if (!session?.content) return "none";
  const game = normalizeDragonState(session.content);
  return JSON.stringify({
    id: session.id,
    revision: Number(game.revision || 0),
    status: game.status,
    participants: (game.participants || []).map((entry) => ({
      id: entry.id,
      status: entry.status,
      cashoutMultiplier: entry.cashoutMultiplier,
      cashoutValue: entry.cashoutValue
    })),
    resultSummary: game.resultSummary,
    finalMultiplier: game.finalMultiplier,
    crashAtMultiplier: game.crashAtMultiplier
  });
}

function applyDragonTransportPayload(payload, options = {}) {
  const {
    forceRender = false,
    overwriteDraft = state.userModalView !== "dragon"
  } = options;
  const incomingSessionId = payload?.session?.id || "";
  const previousSessionKey = getDragonSessionRenderKey(state.dragonSession);
  const previousConfigKey = JSON.stringify(normalizeDragonConfig(state.dragonConfig));

  syncDragonServerClock(payload?.serverNowMs);
  state.dragonSession = mergeDragonSessionWithLocal(state.dragonSession, payload?.session || null);
  if (incomingSessionId && incomingSessionId !== state.dragonRoundSessionId) {
    state.dragonRoundSessionId = incomingSessionId;
    state.dragonRoundAutoCashoutEnabled = Boolean(state.dragonAutoCashoutEnabled);
    state.dragonRoundAutoCashoutTarget = normalizeDragonAutoCashoutTarget(state.dragonAutoCashoutTarget);
  }
  if (!incomingSessionId) {
    state.dragonRoundSessionId = "";
  }
  if (payload?.config) {
    syncDragonConfigFromServer(payload.config, {
      overwriteDraft,
      updatedAtMs: Number(payload?.configUpdatedAtMs || 0)
    });
  }
  if (Array.isArray(payload?.recentResults)) {
    state.dragonRecentResults = payload.recentResults.map((entry) => normalizeDragonHistoryEntry(entry));
  }

  const nextSessionKey = getDragonSessionRenderKey(state.dragonSession);
  const nextConfigKey = JSON.stringify(normalizeDragonConfig(state.dragonConfig));
  const shouldRenderDragonView = isCasinoDragonView() && (
    forceRender
    || previousSessionKey !== nextSessionKey
    || previousConfigKey !== nextConfigKey
  );

  if (shouldRenderDragonView) {
    render();
  }
}

function getDragonRoundAutoSettings(session = state.dragonSession) {
  const sessionId = session?.id || "";
  if (sessionId && sessionId === state.dragonRoundSessionId) {
    return {
      enabled: Boolean(state.dragonRoundAutoCashoutEnabled),
      target: normalizeDragonAutoCashoutTarget(state.dragonRoundAutoCashoutTarget)
    };
  }

  return {
    enabled: Boolean(state.dragonAutoCashoutEnabled),
    target: normalizeDragonAutoCashoutTarget(state.dragonAutoCashoutTarget)
  };
}

function syncDragonServerClock(serverNowMs) {
  const numeric = Number(serverNowMs);
  if (!Number.isFinite(numeric) || numeric <= 0) return;
  const localNow = getDragonMonotonicLocalNow();
  const currentEstimate = getDragonNow(localNow);
  const nextServerNow = state.dragonServerClockServerMs > 0
    ? Math.max(numeric, currentEstimate)
    : numeric;
  state.dragonServerClockLocalMs = localNow;
  state.dragonServerClockServerMs = nextServerNow;
}

function getDragonMonotonicLocalNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function getDragonNow(localNow = getDragonMonotonicLocalNow()) {
  const anchorLocalMs = Number(state.dragonServerClockLocalMs || 0);
  const anchorServerMs = Number(state.dragonServerClockServerMs || 0);
  if (anchorLocalMs > 0 && anchorServerMs > 0) {
    return anchorServerMs + Math.max(0, localNow - anchorLocalMs);
  }
  return Date.now();
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

function getMiningNow(localNow = getDragonMonotonicLocalNow()) {
  const anchorLocalMs = Number(state.miningServerClockLocalMs || 0);
  const anchorServerMs = Number(state.miningServerClockServerMs || 0);
  if (anchorLocalMs > 0 && anchorServerMs > 0) {
    return anchorServerMs + Math.max(0, localNow - anchorLocalMs);
  }
  return Date.now();
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

function getDragonLiveMultiplier(gameState, now = getDragonNow()) {
  const game = normalizeDragonState(gameState);
  if (game.status === "crashed") {
    return roundMultiplier(game.crashAtMultiplier || game.finalMultiplier || 1);
  }
  if (now < game.launchAtMs) {
    return 1;
  }

  const effectiveElapsed = getDragonEffectiveElapsed(game, now);
  const multiplier = 1 + (effectiveElapsed * 0.09) + (effectiveElapsed * effectiveElapsed * 0.03);
  return roundMultiplier(Math.min(game.crashAtMultiplier, multiplier));
}

function getDragonDisplayMultiplier(gameState, phase = getDragonPhase(gameState)) {
  const game = normalizeDragonState(gameState);
  if (phase === "playing") {
    return getDragonLiveMultiplier(game);
  }
  if (phase === "finished") {
    if (game.status === "crashed") {
      return roundMultiplier(game.crashAtMultiplier || game.finalMultiplier || 1);
    }
    if (Number(game.finalMultiplier) > 1) {
      return roundMultiplier(game.finalMultiplier);
    }
    return roundMultiplier(game.crashAtMultiplier || 1);
  }
  return roundMultiplier(game.finalMultiplier > 1 ? game.finalMultiplier : 1);
}

function applyOptimisticDragonCashout(session, userId, multiplier) {
  if (!session?.content) return null;
  const game = normalizeDragonState(session.content);
  const participant = (game.participants || []).find((entry) => entry.id === userId);
  if (!participant || participant.status !== "joined") return null;

  participant.status = "cashed_out";
  participant.cashoutMultiplier = roundMultiplier(multiplier || getDragonLiveMultiplier(game));
  participant.cashoutValue = roundCoinValue(game.baseStake * participant.cashoutMultiplier);
  game.revision += 1;
  game.finalMultiplier = participant.cashoutMultiplier;

  return {
    ...session,
    content: game
  };
}

function shouldDragonCrash(gameState, now = getDragonNow()) {
  const game = normalizeDragonState(gameState);
  if (game.status === "crashed" || now < game.launchAtMs) return false;

  const effectiveElapsed = getDragonEffectiveElapsed(game, now);
  const multiplier = 1 + (effectiveElapsed * 0.09) + (effectiveElapsed * effectiveElapsed * 0.03);
  return multiplier >= game.crashAtMultiplier;
}

function generateDragonCrashMultiplier(config = DEFAULT_DRAGON_CONFIG) {
  const normalizedConfig = normalizeDragonConfig(config);
  if (normalizedConfig.testMode) {
    const floorMultiplier = Math.min(10, Math.max(1.1, normalizedConfig.testMaxMultiplier));
    if (floorMultiplier >= 10) {
      return 10;
    }
    return roundMultiplier(floorMultiplier + Math.random() * (10 - floorMultiplier));
  }
  const boosted = Math.random() < (normalizedConfig.luckyChancePercent / 100);
  let multiplier = 1;
  while (multiplier < 1000) {
    const crashChance = getDragonCrashChance(normalizedConfig, multiplier, boosted);
    if (Math.random() < crashChance) {
      return roundMultiplier(multiplier);
    }
    multiplier = roundMultiplier(multiplier + 0.01);
  }
  return 1000;
}

function getDragonCrashChance(config, multiplier, boosted = false) {
  if (boosted) {
    return Math.min(0.999, config.luckyCrashPerThousand / 1000);
  }
  if (multiplier < config.lowCapMultiplier) {
    return Math.min(0.999, config.lowCrashPerThousand / 1000);
  }
  if (multiplier < config.midCapMultiplier) {
    return Math.min(0.999, config.midCrashPerThousand / 1000);
  }
  if (multiplier < config.highCapMultiplier) {
    return Math.min(0.999, config.highCrashPerThousand / 1000);
  }
  return Math.min(0.999, config.ultraCrashPerThousand / 1000);
}

function roundMultiplier(value) {
  return Math.round(Number(value || 1) * 100) / 100;
}

function normalizeDragonHistoryEntry(entry) {
  return {
    sessionId: String(entry?.sessionId || ""),
    multiplier: roundMultiplier(entry?.multiplier),
    crashed: Boolean(entry?.crashed),
    createdAtMs: Number(entry?.createdAtMs) || 0
  };
}

function renderDragonHistoryPill(entry) {
  const item = normalizeDragonHistoryEntry(entry);
  return `<span class="dragon-history-pill ${dragonHistoryBandClass(item.multiplier)}">${escapeHtml(formatMultiplier(item.multiplier))}</span>`;
}

function dragonHistoryBandClass(multiplier) {
  const value = Number(multiplier) || 1;
  if (value < 1.1) return "is-band-red";
  if (value < 1.5) return "is-band-amber";
  if (value < 2) return "is-band-yellow";
  if (value < 3) return "is-band-green";
  if (value < 10) return "is-band-cyan";
  return "is-band-violet";
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
      if (phase === "lobby" && getDragonNow() >= game.launchAtMs) {
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
    const isDedicatedDragonView = isCasinoDragonView() && !state.dragonModalMessageId;
    if (isDedicatedDragonView) {
      const expectedHubAction = phase === "lobby"
        ? (participant ? "noop" : "join")
        : phase === "playing"
          ? "cashout"
          : "start";
      const currentHubAction = document.querySelector("[data-dragon-hub-action]")?.dataset.dragonHubAction || "";
      if (currentHubAction !== expectedHubAction) {
        render();
        return;
      }
    } else {
      const joinButton = document.querySelector("[data-dragon-join]");
      const collectButton = document.querySelector("[data-dragon-collect]");
      const shouldShowJoin = phase === "lobby";
      const shouldShowCollect = phase === "playing" || phase === "finished";
      if ((shouldShowJoin && !joinButton) || (shouldShowCollect && !collectButton)) {
        render();
        return;
      }
    }
    const multiplierNode = document.querySelector("[data-dragon-live-multiplier]");
    const collectibleNode = document.querySelector("[data-dragon-live-collectible]");
    const subtitleNode = document.querySelector("[data-dragon-live-subtitle]");
    if (multiplierNode) {
      const multiplier = getDragonDisplayMultiplier(game, phase);
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
    if (
      isDedicatedDragonView
      && phase === "finished"
      && game.status !== "crashed"
      && !state.interactiveActionLocks[DRAGON_CHANNEL_ID]
    ) {
      void handleDragonHubAction("resolve");
    }
    if (
      isDedicatedDragonView
      && phase === "playing"
      && participant?.status === "joined"
      && getDragonRoundAutoSettings(message).enabled
      && getDragonLiveMultiplier(game) >= getDragonRoundAutoSettings(message).target
      && !state.interactiveActionLocks[DRAGON_CHANNEL_ID]
    ) {
      void handleDragonHubAction("cashout");
    }
    if (subtitleNode) {
      const secondsLeft = Math.max(0, Math.ceil((game.launchAtMs - getDragonNow()) / 1000));
      subtitleNode.textContent = phase === "lobby"
        ? `Baslangica ${secondsLeft}s var`
        : (game.resultSummary || "Ejderha oyunda");
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

function getDragonPhase(gameState, now = getDragonNow()) {
  const game = normalizeDragonState(gameState);
  if (game.status === "crashed") return "finished";
  if (now < game.launchAtMs) return "lobby";
  if (shouldDragonCrash(game, now)) return "finished";
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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









