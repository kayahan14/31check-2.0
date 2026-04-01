// ── Merkezi State Yönetimi ───────────────────────────────────────────
import { cloneData, uid } from "./utils.js";
import {
  MOCK_MODE, MOCK_SCOPE_KEY, MOCK_USER_ID, MOCK_USER_NAME,
  DEFAULT_CHANNELS, DEFAULT_MEMBERS, MINING_DEFAULT_ZOOM,
  DRAGON_CHANNEL_ID
} from "./constants.js";
import { DEFAULT_DRAGON_CONFIG, normalizeDragonConfig } from "../shared/dragon-config.js";
import {
  MINING_CHANNEL_ID,
  normalizeMiningConfig,
  MINING_DEFAULT_CONFIG
} from "../shared/mining-core.js";

// ── localStorage Helpers (state init öncesi çağırılır) ──────────────

import {
  LOCAL_MINES_MINE_COUNT_KEY, MINES_MINE_OPTIONS, MINES_MINE_COUNT,
  LOCAL_MINING_ZOOM_KEY, MINING_MIN_ZOOM, MINING_MAX_ZOOM,
  LOCAL_DRAGON_AUTO_CASHOUT_KEY, LOCAL_MINING_CONFIG_KEY,
  LOCAL_MINING_ADMIN_MODE_KEY
} from "./constants.js";
import { clamp } from "./utils.js";

export function loadPreferredMineCount() {
  try {
    const value = Number(window.localStorage.getItem(LOCAL_MINES_MINE_COUNT_KEY));
    return MINES_MINE_OPTIONS.includes(value) ? value : MINES_MINE_COUNT;
  } catch { return MINES_MINE_COUNT; }
}

export function savePreferredMineCount(value) {
  try { window.localStorage.setItem(LOCAL_MINES_MINE_COUNT_KEY, String(value)); } catch {}
}

export function loadMiningZoomPreference() {
  try {
    const value = Number(window.localStorage.getItem(LOCAL_MINING_ZOOM_KEY) || MINING_DEFAULT_ZOOM);
    return Number.isFinite(value) ? clamp(value, MINING_MIN_ZOOM, MINING_MAX_ZOOM) : MINING_DEFAULT_ZOOM;
  } catch { return MINING_DEFAULT_ZOOM; }
}

export function saveMiningZoomPreference() {
  try { window.localStorage.setItem(LOCAL_MINING_ZOOM_KEY, String(clamp(state.miningZoom, MINING_MIN_ZOOM, MINING_MAX_ZOOM))); } catch {}
}

export function loadMiningConfigPreference() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_MINING_CONFIG_KEY) || "null");
    return raw ? normalizeMiningConfig(raw) : MINING_DEFAULT_CONFIG;
  } catch { return MINING_DEFAULT_CONFIG; }
}

export function saveMiningConfigPreference(config) {
  try { window.localStorage.setItem(LOCAL_MINING_CONFIG_KEY, JSON.stringify(config)); } catch {}
}

export function loadMiningAdminModePreference() {
  try { return window.localStorage.getItem(LOCAL_MINING_ADMIN_MODE_KEY) === "1"; } catch { return false; }
}

export function saveMiningAdminModePreference(value) {
  try { window.localStorage.setItem(LOCAL_MINING_ADMIN_MODE_KEY, value ? "1" : "0"); } catch {}
}

function normalizeDragonAutoCashoutTarget(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 1.01 ? num : 2;
}

export function loadDragonAutoCashoutPreference() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_DRAGON_AUTO_CASHOUT_KEY) || "{}");
    return {
      enabled: Boolean(raw?.enabled),
      target: normalizeDragonAutoCashoutTarget(raw?.target)
    };
  } catch {
    return { enabled: false, target: 2 };
  }
}

export function saveDragonAutoCashoutPreference() {
  try {
    window.localStorage.setItem(LOCAL_DRAGON_AUTO_CASHOUT_KEY, JSON.stringify({
      enabled: state.dragonAutoCashoutEnabled,
      target: state.dragonAutoCashoutTarget
    }));
  } catch {}
}

export function parseDragonAutoCashoutInput(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 1.01 ? num : null;
}

export { normalizeDragonAutoCashoutTarget };

// ── Başlangıç fonksiyonları ─────────────────────────────────────────

export function initialChannelId() {
  const fromHash = window.location.hash.match(/channel\/([^/?#]+)/);
  const fromPath = window.location.pathname.match(/channel\/([^/?#]+)/);
  return fromHash?.[1] || fromPath?.[1] || MINING_CHANNEL_ID;
}

export function buildEmptyMessageState() {
  return Object.fromEntries(DEFAULT_CHANNELS.map((channel) => [channel.id, []]));
}

export function isDedicatedCasinoScreen() {
  return isCasinoDragonView() || isCasinoMiningView();
}

export function isCasinoDragonView(id = state.selectedChannelId) {
  return id === DRAGON_CHANNEL_ID;
}

export function isCasinoMiningView(id = state.selectedChannelId) {
  return id === MINING_CHANNEL_ID;
}

// ── State ───────────────────────────────────────────────────────────

const dragonAutoCashoutPref = loadDragonAutoCashoutPreference();

export const state = {
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
  miningConfig: normalizeMiningConfig(loadMiningConfigPreference()),
  miningConfigDraft: normalizeMiningConfig(loadMiningConfigPreference()),
  miningAdminMode: false,
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
  miningCameraManualX: 0,
  miningCameraManualY: 0,
  miningCameraFollowPlayer: true,
  miningDragging: false,
  miningDragStartX: 0,
  miningDragStartY: 0,
  miningDragStartCamX: 0,
  miningDragStartCamY: 0,
  miningDragMoved: false,
  miningDragStartAtMs: 0,
  miningVisualPlayers: {},
  miningDiscovery: new Set(),
  miningDiscoverySessionId: null,
  miningDiscoveryInitialized: false,
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
  dragonAutoCashoutEnabled: dragonAutoCashoutPref.enabled,
  dragonAutoCashoutTarget: dragonAutoCashoutPref.target,
  dragonRoundAutoCashoutEnabled: dragonAutoCashoutPref.enabled,
  dragonRoundAutoCashoutTarget: dragonAutoCashoutPref.target,
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
  members: MOCK_MODE ? [...DEFAULT_MEMBERS] : []
};

// ── Debug Interface ─────────────────────────────────────────────────
// __31checkDebug is set up in app.js after all modules load

// ── State helpers ───────────────────────────────────────────────────

export function currentUserAsMember() {
  return {
    id: state.currentUser.id,
    username: state.currentUser.displayName,
    avatar: state.currentUser.displayName,
    avatarUrl: state.currentUser.avatarUrl,
    status: "online",
    customStatus: state.currentUser.tag
  };
}

export function dedupeMembers(members) {
  const byId = new Map();
  for (const member of members) {
    byId.set(member.id, member);
  }
  byId.set(state.currentUser.id, currentUserAsMember());
  return [...byId.values()];
}

export function computeIsAdmin(user) {
  if (MOCK_MODE) return true;
  const userId = String(user?.id || "");
  const username = String(user?.username || "").toLocaleLowerCase();
  return ADMIN_USER_IDS.includes(userId) || ADMIN_USERNAMES.includes(username);
}

import { ADMIN_USER_IDS, ADMIN_USERNAMES } from "./constants.js";
