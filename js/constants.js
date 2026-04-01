// ── Sabitler ve Yapılandırma ─────────────────────────────────────────
import { uid, parseCsv } from "./utils.js";
import { MINING_CHANNEL_ID } from "../shared/mining-core.js";

export const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID || "1481788345473302578";
export const PAGE_QUERY = new URLSearchParams(window.location.search);
export const MOCK_MODE = PAGE_QUERY.get("mock") === "1" || !DISCORD_CLIENT_ID;
export const MOCK_SCOPE_KEY = PAGE_QUERY.get("mockScope") || "local-preview";
export const MOCK_USER_ID = PAGE_QUERY.get("mockUser") || "local-user";
export const MOCK_USER_NAME = PAGE_QUERY.get("mockName") || "31check";
export const ADMIN_USER_IDS = parseCsv(import.meta.env.VITE_ACTIVITY_ADMIN_USER_IDS || "");
export const ADMIN_USERNAMES = parseCsv(import.meta.env.VITE_ACTIVITY_ADMIN_USERNAMES || "astrian");
export const OFFLINE_MODE = false;

export const DEFAULT_CHANNELS = [
  { id: "1", name: "🔥🍕-3️⃣ 1️⃣-🍕🔥", categoryId: "" },
  { id: "2", name: "📃-casino-1-📃", categoryId: "" },
  { id: "3", name: "📃-casino-2-📃", categoryId: "" },
  { id: "4", name: "📄-31check-yama-notlari", categoryId: "" },
  { id: "5", name: "📘-31check-wiki", categoryId: "" },
  { id: "6", name: "📢-31check-duyuru", categoryId: "" }
];

export const DEFAULT_MEMBERS = [
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

export const GAME_BUTTONS = [
  { id: "blackjack", label: "🃏 Blackjack", game: "blackjack" },
  { id: "mines", label: "💣 Mines", game: "mines" },
  { id: "dice", label: "🎲 Zar", game: "dice" },
  { id: "case", label: "🎁 Kasa", game: "case" }
];

export const CASINO_ITEMS = [
  { id: "casino:dragon", label: "🐉 Ejderha" },
  { id: MINING_CHANNEL_ID, label: "⛏️ Mining" }
];

export const FALLBACK_MESSAGE = {
  id: uid(),
  author: "31check",
  avatar: "31check",
  avatarUrl: "",
  time: "04:15",
  type: "text",
  content: "Peder\n\nTOPLAM 31 SÜRESİ: 11950\nTOPLAM 31 ADETİ: 273\nTEZGAH KAR/ZARAR: -888\nTOPLAM RNG: 39\nASUMAN KAR/ZARAR: 1773\nLEVEL: 236\nXP: 35\nPET: Azdırıan"
};

// ── Blackjack sabitleri ─────────────────────────────────────────────
export const BLACKJACK_SUITS = [
  { key: "spades", symbol: "♠", color: "black" },
  { key: "hearts", symbol: "♥", color: "red" },
  { key: "diamonds", symbol: "♦", color: "red" },
  { key: "clubs", symbol: "♣", color: "black" }
];
export const BLACKJACK_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// ── Mines sabitleri ─────────────────────────────────────────────────
export const MINES_GRID_SIZE = 9;
export const MINES_MINE_COUNT = 2;
export const MINES_BASE_STAKE = 100;
export const MINES_MINE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

// ── Dragon sabitleri ────────────────────────────────────────────────
export const DRAGON_BASE_STAKE = 100;
export const DRAGON_TICK_MS = 400;
export const DRAGON_SPEED_STAGES = [
  { multiplier: 1.5, speed: 0.45 },
  { multiplier: 1.75, speed: 0.5 },
  { multiplier: 2, speed: 0.6 },
  { multiplier: 2.5, speed: 0.8 },
  { multiplier: 3, speed: 1 },
  { multiplier: 4, speed: 1.25 },
  { multiplier: 5, speed: 1.5 }
];
export const DRAGON_ALL_CASHED_OUT_SPEED = 4;
export const DRAGON_CHANNEL_ID = "casino:dragon";

// ── Mining UI sabitleri ─────────────────────────────────────────────
export const MINING_ACTION_TICK_MS = 55;
export const MINING_MIN_ZOOM = 0.1;
export const MINING_MAX_ZOOM = 1.8;
export const MINING_DEFAULT_ZOOM = 0.7;
export const MINING_BASE_VISIBLE_TILES = 15.5;
export const MINING_FOW_ENABLED = true;

// ── localStorage key'leri ───────────────────────────────────────────
export const LOCAL_MINES_MINE_COUNT_KEY = "31check:mines:mine-count";
export const LOCAL_CLEAR_CHAT_KEY = "31check:clear-chat";
export const LOCAL_DRAGON_AUTO_CASHOUT_KEY = "31check:dragon:auto-cashout";
export const LOCAL_MINING_ZOOM_KEY = "31check:mining:zoom";
export const LOCAL_MINING_CONFIG_KEY = "31check:mining:config";
export const LOCAL_MINING_ADMIN_MODE_KEY = "31check:mining:admin-mode";

// ── Ağ yapılandırması ───────────────────────────────────────────────
export function normalizeBackendOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return "";
  }
}

export const GAME_BACKEND_URL = normalizeBackendOrigin(import.meta.env.VITE_GAME_BACKEND_URL || "");
export const FRONTEND_API_ORIGIN = normalizeBackendOrigin(import.meta.env.VITE_FRONTEND_API_ORIGIN || "");
