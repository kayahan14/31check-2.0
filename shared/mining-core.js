export const MINING_CHANNEL_ID = "casino:mining";
export const MINING_TYPE = "mining_session";
export const MINING_PROFILE_TYPE = "mining_profile";
export const MINING_SLOT_KEYS = ["armor", "boots", "bag", "tool", "pickaxe"];
export const MINING_JOIN_WINDOW_MS = 3 * 60 * 1000;
export const MINING_TARGET_RUN_MS = 10 * 60 * 1000;
export const MINING_EXIT_COLLAPSE_MS = 90 * 1000;
export const MINING_TIMEOUT_COLLAPSE_MS = 75 * 1000;
export const MINING_EVENT_LIFETIME_MS = 75 * 1000;
export const MINING_VIEW_RADIUS = 11;
export const MINING_TILE_SIZE = 36;
export const MINING_DEFAULT_WALLET_COINS = 500;
const MINING_MAX_SIMULATION_STEPS = 24;
const MINING_MAP_BASE_SIZE = 155;
const MINING_MAP_PLAYER_GROWTH = 10;
const MINING_MAP_MAX_SIZE = 205;
const MINING_EFFECT_LIFETIME_MS = 900;
const MINING_PLAYER_RADIUS = 0.35;
const MINING_BASE_SPEED = 4.0;
const MINING_MIN_SPEED = 1.5;
const MINING_MINE_RANGE = 1.4;
const MINING_ATTACK_RANGE = 1.4;
const MINING_MOVE_STEP = 0.05;

const FLOOR_TILE = { kind: "floor", oreId: "", hp: 0, maxHp: 0, reward: 0, requiredTier: 0, moleChance: 0 };
const MINING_TRANSPORT_MAP_VERSION = 1;
const MINING_TILE_TOKEN_SIZE = 3;
const MINING_TRANSPORT_FLOOR_CODE = ".";
const MINING_TRANSPORT_EXIT_CODE = "X";
const MINING_TRANSPORT_ORE_CODES = {
  stone: "1",
  coal: "2",
  copper: "3",
  iron: "4",
  amber: "5",
  sapphire: "6",
  ruby: "7",
  starsteel: "8"
};
const MINING_TRANSPORT_ORE_BY_CODE = Object.fromEntries(
  Object.entries(MINING_TRANSPORT_ORE_CODES).map(([oreId, code]) => [code, oreId])
);

const PICKAXE_CATALOG = {
  "starter-pick": { id: "starter-pick", label: "Demir Kazma", tier: 2, miningPower: 1 },
  "deep-pick": { id: "deep-pick", label: "Derin Maden Kazmasi", tier: 3, miningPower: 1 }
};

const STARTER_LOADOUT = {
  armor: { id: "starter-helmet", label: "Madenci Bareti", tier: 1 },
  boots: { id: "starter-boots", label: "Isci Botu", tier: 1 },
  bag: { id: "starter-bag", label: "Bez Canta", tier: 1 },
  tool: { id: "starter-lamp", label: "Fener", tier: 1 },
  pickaxe: PICKAXE_CATALOG["starter-pick"]
};

export const MINING_SHOP_ITEMS = [
  { id: "shop-helmet", label: "Kompozit Baret", price: 900, note: "Yakinda: cokme hasarina karsi koruma", available: false },
  { id: "shop-boots", label: "Hafif Bot", price: 1100, note: "Yakinda: agirlik yavaslamasini azaltir", available: false },
  { id: "shop-bag", label: "Derin Canta", price: 1350, note: "Yakinda: daha guvenli tasima", available: false },
  { id: "shop-pick", label: "Derin Maden Kazmasi", price: 2000, note: "Yakinda: tier 3 damarlar icin", available: false },
  { id: "shop-tool", label: "Sismik Sensor", price: 1500, note: "Yakinda: gizli cikis sezisi", available: false }
];

export const MINING_ORE_DEFS = {
  stone: { id: "stone", label: "Tas", color: "#5b6270", reward: 6, hardness: 5, requiredTier: 1, moleChance: 0.04 },
  coal: { id: "coal", label: "Komur", color: "#424750", reward: 10, hardness: 5, requiredTier: 1, moleChance: 0.05 },
  copper: { id: "copper", label: "Bakir", color: "#b56d42", reward: 18, hardness: 6, requiredTier: 1, moleChance: 0.06 },
  iron: { id: "iron", label: "Demir", color: "#88919f", reward: 28, hardness: 7, requiredTier: 1, moleChance: 0.08 },
  amber: { id: "amber", label: "Amber", color: "#da8c2e", reward: 44, hardness: 8, requiredTier: 2, moleChance: 0.1 },
  sapphire: { id: "sapphire", label: "Safir", color: "#4e81ff", reward: 76, hardness: 9, requiredTier: 2, moleChance: 0.14 },
  ruby: { id: "ruby", label: "Yakut", color: "#e55366", reward: 120, hardness: 11, requiredTier: 3, moleChance: 0.18 },
  starsteel: { id: "starsteel", label: "Yildiz Cevheri", color: "#7ff0ff", reward: 180, hardness: 12, requiredTier: 2, moleChance: 0.22 }
};

export function createMiningProfile(user) {
  return {
    userId: String(user?.id || "user"),
    displayName: String(user?.name || "Oyuncu"),
    walletCoins: MINING_DEFAULT_WALLET_COINS,
    loadout: cloneLoadout(STARTER_LOADOUT),
    stats: {
      runs: 0,
      escapes: 0,
      collapses: 0,
      bestRunCoins: 0
    }
  };
}

export function normalizeMiningProfile(profile, user = null) {
  const next = structuredClone(profile || {});
  const fallback = createMiningProfile(user);
  next.userId = String(next.userId || fallback.userId);
  next.displayName = String(next.displayName || user?.name || fallback.displayName);
  next.walletCoins = Math.max(0, Math.round(Number(next.walletCoins ?? fallback.walletCoins)));
  next.loadout = normalizeLoadout(next.loadout || fallback.loadout);
  next.stats = {
    runs: Math.max(0, Math.round(Number(next.stats?.runs || fallback.stats.runs))),
    escapes: Math.max(0, Math.round(Number(next.stats?.escapes || fallback.stats.escapes))),
    collapses: Math.max(0, Math.round(Number(next.stats?.collapses || fallback.stats.collapses))),
    bestRunCoins: Math.max(0, Math.round(Number(next.stats?.bestRunCoins || fallback.stats.bestRunCoins)))
  };
  return next;
}

export function createMiningSession(actor, profile, now = Date.now()) {
  const normalizedProfile = normalizeMiningProfile(profile, actor);
  const session = {
    game: "mining",
    revision: 1,
    status: "lobby",
    createdAtMs: now,
    joinDeadlineMs: now + MINING_JOIN_WINDOW_MS,
    startedAtMs: 0,
    hardCollapseAtMs: 0,
    collapseAtMs: 0,
    collapseReason: "",
    lastSimulatedAtMs: now,
    nextEventAtMs: 0,
    currentEvent: null,
    summary: "Magara lobisi acildi.",
    discoveredExitIds: [],
    activeExitId: "",
    map: null,
    effects: [],
    moles: [],
    players: [createLobbyPlayer(actor, normalizedProfile.loadout)],
    sessionSeed: Math.floor(Math.random() * 1_000_000_000)
  };
  startMiningRun(session, now);
  return session;
}

export function hydrateMiningRuntimeSession(content, now = Date.now()) {
  const game = structuredClone(content || {});
  game.game = "mining";
  game.isTransportSnapshot = Boolean(game.isTransportSnapshot);
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.status ||= "lobby";
  game.createdAtMs = Number(game.createdAtMs) > 0 ? Number(game.createdAtMs) : now;
  game.joinDeadlineMs = Number(game.joinDeadlineMs) > 0 ? Number(game.joinDeadlineMs) : game.createdAtMs + MINING_JOIN_WINDOW_MS;
  game.startedAtMs = Number(game.startedAtMs) > 0 ? Number(game.startedAtMs) : 0;
  game.hardCollapseAtMs = Number(game.hardCollapseAtMs) > 0 ? Number(game.hardCollapseAtMs) : 0;
  game.collapseAtMs = Number(game.collapseAtMs) > 0 ? Number(game.collapseAtMs) : 0;
  game.collapseReason = String(game.collapseReason || "");
  game.lastSimulatedAtMs = Number(game.lastSimulatedAtMs) > 0 ? Number(game.lastSimulatedAtMs) : now;
  game.nextEventAtMs = Number(game.nextEventAtMs) > 0 ? Number(game.nextEventAtMs) : 0;
  game.summary = String(game.summary || "");
  game.activeExitId = String(game.activeExitId || "");
  game.sessionSeed = Number(game.sessionSeed) > 0 ? Number(game.sessionSeed) : Math.floor(Math.random() * 1_000_000_000);
  game.discoveredExitIds = Array.isArray(game.discoveredExitIds) ? game.discoveredExitIds.map((entry) => String(entry)) : [];
  game.currentEvent = normalizeMiningEvent(game.currentEvent, now);
  game.map = normalizeMiningMap(game.map);
  game.effects = Array.isArray(game.effects) ? game.effects.map((entry) => normalizeMiningEffect(entry, now)).filter(Boolean) : [];
  game.moles = Array.isArray(game.moles) ? game.moles.map((entry) => normalizeMiningMole(entry)).filter(Boolean) : [];
  game.players = Array.isArray(game.players) ? game.players.map((entry) => normalizeMiningPlayer(entry)).filter(Boolean) : [];

  if (!game.isTransportSnapshot && game.status === "lobby") {
    game.joinDeadlineMs = now;
    startMiningRun(game, now);
  }

  if (!game.isTransportSnapshot && game.status === "active") {
    simulateMiningSession(game, now);
  }

  if (!game.isTransportSnapshot) {
    game._runtimeHydrated = true;
  }

  return game;
}

export function advanceMiningSession(content, now = Date.now()) {
  if (!content) return null;
  const game = content._runtimeHydrated && !content.isTransportSnapshot
    ? content
    : hydrateMiningRuntimeSession(content, now);

  if (game.status === "lobby") {
    game.joinDeadlineMs = now;
    startMiningRun(game, now);
  }

  if (game.status === "active") {
    simulateMiningSession(game, now);
  }

  game._runtimeHydrated = true;
  return game;
}

export function normalizeMiningSession(content, now = Date.now()) {
  const game = hydrateMiningRuntimeSession(content, now);
  game.isTransportSnapshot = false;
  game._runtimeHydrated = true;
  return game;
}

export function createMiningTransportSession(session, now = Date.now(), playerId = "") {
  const game = advanceMiningSession(session, now);
  if (!game) return null;
  return {
    ...game,
    isTransportSnapshot: true,
    map: serializeMiningTransportMap(game.map, getMiningTransportWindow(game, playerId))
  };
}

export function getMiningCurrentPlayer(game, playerId) {
  return (game?.players || []).find((entry) => entry.id === String(playerId || "")) || null;
}

export function getMiningPhase(game, now = Date.now()) {
  const session = game?.game === "mining" ? game : normalizeMiningSession(game, now);
  if (!session) return "idle";
  if (session.status === "lobby") return "lobby";
  if (session.status === "active") return "active";
  if (session.status === "collapsed") return "collapsed";
  if (session.status === "finished") return "finished";
  return "idle";
}

export function getMiningTile(map, x, y) {
  if (!map || !Array.isArray(map.tiles) || !Number.isInteger(map.size)) return null;
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return null;
  if (Number.isInteger(map.windowSize) && map.windowSize > 0) {
    if (x < map.originX || y < map.originY || x >= map.originX + map.windowSize || y >= map.originY + map.windowSize) {
      return null;
    }
    return map.tiles[((y - map.originY) * map.windowSize) + (x - map.originX)] || null;
  }
  return map.tiles[(y * map.size) + x] || null;
}

export function setMiningTile(map, x, y, tile) {
  if (!map || !Array.isArray(map.tiles) || !Number.isInteger(map.size)) return;
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return;
  map.tiles[(y * map.size) + x] = normalizeMiningTile(tile);
}

export function getMiningVisibleTiles(game, playerId, radius = MINING_VIEW_RADIUS) {
  const player = getMiningCurrentPlayer(game, playerId);
  const map = game?.map;
  if (!player || !map) {
    return { originX: 0, originY: 0, size: 0, tiles: [] };
  }

  const tiles = [];
  const originX = Math.max(0, Math.floor(player.x) - radius);
  const originY = Math.max(0, Math.floor(player.y) - radius);
  const maxX = Math.min(map.size - 1, Math.ceil(player.x) + radius);
  const maxY = Math.min(map.size - 1, Math.ceil(player.y) + radius);
  for (let y = originY; y <= maxY; y += 1) {
    for (let x = originX; x <= maxX; x += 1) {
      tiles.push({
        x,
        y,
        tile: getMiningTile(map, x, y)
      });
    }
  }

  return {
    originX,
    originY,
    size: (maxX - originX) + 1,
    tiles
  };
}

export function moveMiningPlayer(game, playerId, targetX, targetY, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  if (!player || player.status !== "active") return { changed: false, reason: "inactive" };

  player.targetX = Math.max(0, Math.min(game.map.size - 0.01, targetX));
  player.targetY = Math.max(0, Math.min(game.map.size - 0.01, targetY));
  if (!player.lastMovedAtMs) player.lastMovedAtMs = now;

  const dx = targetX - player.x;
  const dy = targetY - player.y;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
    player.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  }

  player.lastAction = "move";
  player.lastActionAtMs = now;
  player.speed = getPlayerSpeed(player);

  const currentTile = getMiningTile(game.map, Math.floor(player.x), Math.floor(player.y));
  if (currentTile?.kind === "exit") {
    const extraction = extractMiningPlayer(game, playerId, now);
    return {
      changed: true,
      reason: extraction.reason || "",
      player,
      extracted: Boolean(extraction.changed),
      awardedCoins: Math.max(0, Math.round(Number(extraction.awardedCoins || 0)))
    };
  }

  game.revision += 1;
  return { changed: true, reason: "", player };
}

export function joinMiningSession(game, actor, loadout, now = Date.now()) {
  if (!game || (game.status !== "active" && game.status !== "lobby")) {
    return { changed: false, reason: "inactive" };
  }
  if ((game.players || []).some((entry) => entry.id === String(actor?.id || ""))) {
    return { changed: false, reason: "already-joined" };
  }

  const player = createLobbyPlayer(actor, loadout);
  game.players.push(player);

  if (game.status === "active") {
    spawnMiningPlayer(game, player, now);
    game.summary = `${player.name} kaziya katildi.`;
  } else {
    game.summary = `${player.name} lobiye katildi.`;
  }

  game.revision += 1;
  return { changed: true, reason: "", player };
}

export function mineMiningTile(game, playerId, targetX, targetY, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  const tile = getMiningTile(game.map, targetX, targetY);
  if (!player || player.status !== "active") return { changed: false, reason: "inactive" };
  if (!tile || tile.kind !== "wall") return { changed: false, reason: "invalid-target" };
  const tileCenterX = Math.round(Number(targetX)) + 0.5;
  const tileCenterY = Math.round(Number(targetY)) + 0.5;
  if (euclidean(player.x, player.y, tileCenterX, tileCenterY) > MINING_MINE_RANGE) return { changed: false, reason: "range" };

  const pTileX = Math.floor(player.x);
  const pTileY = Math.floor(player.y);
  if (pTileX !== targetX && pTileY !== targetY) {
    const tile1 = getMiningTile(game.map, targetX, pTileY);
    const tile2 = getMiningTile(game.map, pTileX, targetY);
    if (tile1?.kind === "wall" && tile2?.kind === "wall") {
      return { changed: false, reason: "range" }; // Diagonally blocked
    }
  }
  if (now < Number(player.nextActionAtMs || 0)) return { changed: false, reason: "cooldown" };
  if (getPickaxeTier(player) < Number(tile.requiredTier || 1)) return { changed: false, reason: "pick-tier" };

  tile.hp = Math.max(0, Number(tile.hp || tile.maxHp || 1) - getPickaxePower(player));
  player.facing = getFacingFromDelta(targetX - player.x, targetY - player.y);
  player.lastAction = "mine";
  player.lastActionAtMs = now;
  player.lastActionTargetX = targetX;
  player.lastActionTargetY = targetY;
  player.nextActionAtMs = now + getMineCooldownMs(player, tile);
  pushMiningEffect(game, {
    type: "mine-hit",
    x: targetX,
    y: targetY,
    actorId: player.id,
    atMs: now
  }, now);

  if (tile.hp > 0) {
    game.summary = `${player.name} ${getOreLabel(tile.oreId)} damarini zorluyor.`;
    game.revision += 1;
    return { changed: true, reason: "", player, tileBroken: false };
  }

  if (tile.hiddenExitId) {
    tile.kind = "exit";
    tile.oreId = "";
    tile.reward = 0;
    tile.requiredTier = 0;
    if (!game.discoveredExitIds.includes(tile.hiddenExitId)) {
      game.discoveredExitIds.push(tile.hiddenExitId);
    }
    game.activeExitId ||= tile.hiddenExitId;
    if (!game.collapseAtMs) {
      game.collapseAtMs = now + MINING_EXIT_COLLAPSE_MS;
      game.collapseReason = "exit-found";
    }
    game.summary = `${player.name} cikis buldu. Magara huzursuzlandi.`;
    game.revision += 1;
    return { changed: true, reason: "", player, tileBroken: true, foundExit: true, reward: 0 };
  }

  tile.kind = "floor";
  const reward = Math.max(0, Math.round(Number(tile.reward || 0)));
  player.runCoins += reward;
  player.totalWeight = computePlayerWeight(player);
  const spawnedMole = maybeSpawnMole(game, tile, player, targetX, targetY, now);
  if (tile.eventId && game.currentEvent?.id === tile.eventId) {
    resolveMiningEventTile(game, tile.eventId, targetX, targetY);
  }
  tile.oreId = "";
  tile.reward = 0;
  tile.requiredTier = 0;
  tile.moleChance = 0;
  delete tile.eventId;
  delete tile.hiddenExitId;
  pushMiningEffect(game, {
    type: "mine-break",
    x: targetX,
    y: targetY,
    actorId: player.id,
    atMs: now
  }, now);
  game.summary = `${player.name} ${reward} coin topladi.${spawnedMole ? " Bir kostebek homurdanmasi duyuldu." : ""}`;
  game.revision += 1;
  return { changed: true, reason: "", player, tileBroken: true, foundExit: false, reward, spawnedMole };
}

export function attackMiningMole(game, playerId, targetId, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  const mole = (game?.moles || []).find((entry) => entry.id === String(targetId || ""));
  if (!player || player.status !== "active" || !mole) return { changed: false, reason: "invalid" };
  const moleCenterX = mole.x + 0.5;
  const moleCenterY = mole.y + 0.5;
  if (euclidean(player.x, player.y, moleCenterX, moleCenterY) > MINING_ATTACK_RANGE) return { changed: false, reason: "range" };

  const pTileX = Math.floor(player.x);
  const pTileY = Math.floor(player.y);
  if (pTileX !== mole.x && pTileY !== mole.y) {
    const tile1 = getMiningTile(game.map, mole.x, pTileY);
    const tile2 = getMiningTile(game.map, pTileX, mole.y);
    if (tile1?.kind === "wall" && tile2?.kind === "wall") {
      return { changed: false, reason: "range" }; // Diagonally blocked
    }
  }
  if (now < Number(player.nextActionAtMs || 0)) return { changed: false, reason: "cooldown" };

  mole.hp = Math.max(0, Number(mole.hp || 0) - 18);
  player.facing = getFacingFromDelta(mole.x - player.x, mole.y - player.y);
  player.nextActionAtMs = now + 650;
  player.lastAction = "attack";
  player.lastActionAtMs = now;
  player.lastActionTargetX = mole.x;
  player.lastActionTargetY = mole.y;
  mole.hurtAtMs = now;
  pushMiningEffect(game, {
    type: "attack-swing",
    x: player.x,
    y: player.y,
    actorId: player.id,
    atMs: now
  }, now);
  pushMiningEffect(game, {
    type: mole.hp <= 0 ? "mole-break" : "mole-hit",
    x: mole.x,
    y: mole.y,
    actorId: player.id,
    atMs: now
  }, now);
  if (mole.hp <= 0) {
    game.moles = game.moles.filter((entry) => entry.id !== mole.id);
    game.summary = `${player.name} bir kostebegi uzaklastirdi.`;
  } else {
    game.summary = `${player.name} kostebegi geri itti.`;
  }
  game.revision += 1;
  return { changed: true, reason: "", player };
}

export function extractMiningPlayer(game, playerId, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  const tile = player ? getMiningTile(game.map, Math.floor(player.x), Math.floor(player.y)) : null;
  if (!player || player.status !== "active") return { changed: false, reason: "inactive" };
  if (!tile || tile.kind !== "exit") return { changed: false, reason: "not-on-exit" };

  player.status = "escaped";
  player.extractedAtMs = now;
  player.nextActionAtMs = now;
  game.summary = `${player.name} magaradan cikti.`;
  if ((game.players || []).every((entry) => entry.status !== "active")) {
    game.status = "finished";
    game.finishedAtMs = now;
    game.summary = "Tum aktif madenciler cikti.";
  }
  game.revision += 1;
  return { changed: true, reason: "", player, awardedCoins: player.runCoins };
}

export function abandonMiningPlayer(game, playerId, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  if (!player || player.status !== "active") return { changed: false, reason: "inactive" };

  player.status = "collapsed";
  player.extractedAtMs = now;
  game.summary = `${player.name} madeni terk etti.`;
  if ((game.players || []).every((entry) => entry.status !== "active")) {
    game.status = "finished";
    game.finishedAtMs = now;
    game.summary = "Tum aktif madenciler kacti/cikti.";
  }
  game.revision += 1;
  return { changed: true, reason: "", player };
}

export function renderMiningTextState(game, playerId) {
  if (!game) {
    return JSON.stringify({ mode: "idle" });
  }
  const player = getMiningCurrentPlayer(game, playerId);
  const visible = player ? getMiningVisibleTiles(game, playerId) : { originX: 0, originY: 0, size: 0, tiles: [] };
  return JSON.stringify({
    mode: getMiningPhase(game),
    mapSize: Number(game?.map?.size || 0),
    player: player ? {
      id: player.id,
      x: player.x,
      y: player.y,
      coins: player.runCoins,
      integrity: player.integrity,
      status: player.status
    } : null,
    exitsFound: [...(game.discoveredExitIds || [])],
    currentEvent: game.currentEvent ? {
      oreId: game.currentEvent.oreId,
      remainingMs: Math.max(0, game.currentEvent.expiresAtMs - Date.now())
    } : null,
    moles: (game.moles || []).map((entry) => ({ x: entry.x, y: entry.y, hp: entry.hp })),
    visibleOrigin: { x: visible.originX, y: visible.originY, size: visible.size },
    visibleTiles: visible.tiles.map((entry) => ({
      x: entry.x,
      y: entry.y,
      kind: entry.tile?.kind || "void",
      oreId: entry.tile?.oreId || ""
    })),
    note: "Origin top-left, x sag, y asagi."
  });
}

function startMiningRun(game, now) {
  const activePlayers = (game.players || []).filter((entry) => entry.status === "queued");
  const map = generateMiningMap(activePlayers.length || 1);
  activePlayers.forEach((player, index) => {
    spawnMiningPlayer(game, player, now, map, index);
  });

  game.map = map;
  game.status = "active";
  game.startedAtMs = now;
  game.hardCollapseAtMs = now + MINING_TARGET_RUN_MS;
  game.collapseAtMs = 0;
  game.collapseReason = "";
  game.lastSimulatedAtMs = now;
  game.nextEventAtMs = now + randomInt(120000, 180000);
  game.currentEvent = null;
  game.effects = [];
  game.moles = [];
  game.summary = "Kazilar basladi. Iki gizli cikis dis halkalarda sakli.";
  game.revision += 1;
}

function simulateMiningSession(game, now) {
  if (!game.map) return;
  pruneMiningEffects(game, now);

  if (game.currentEvent && now >= Number(game.currentEvent.expiresAtMs || 0)) {
    clearExpiredMiningEvent(game);
  }

  if (!game.collapseAtMs && now >= Number(game.hardCollapseAtMs || 0)) {
    game.collapseAtMs = now + MINING_TIMEOUT_COLLAPSE_MS;
    game.collapseReason = "timeout";
    game.summary = "Magara sallanmaya basladi. Cikis bulup kacmaniz gerekiyor.";
    game.revision += 1;
  }

  if (!game.currentEvent && game.nextEventAtMs && now >= game.nextEventAtMs) {
    spawnMiningEvent(game, now);
  }

  const startTick = Math.max(Number(game.lastSimulatedAtMs || now), Number(game.startedAtMs || now));
  const lastTick = Math.floor(startTick / 1000);
  const nextTick = Math.floor(now / 1000);
  const cappedLastTick = Math.max(lastTick, nextTick - MINING_MAX_SIMULATION_STEPS);
  for (let tick = cappedLastTick + 1; tick <= nextTick; tick += 1) {
    simulateMoleTick(game, tick * 1000);
  }
  game.lastSimulatedAtMs = now;

  advanceAllPlayerPositions(game, now);

  if (game.collapseAtMs && now >= game.collapseAtMs) {
    game.status = "collapsed";
    game.players = game.players.map((entry) => entry.status === "active" ? { ...entry, status: "collapsed" } : entry);
    game.summary = "Magara coktu. Iceride kalanlar her seyini kaybetti.";
    game.revision += 1;
  } else if ((game.players || []).every((entry) => entry.status !== "active")) {
    game.status = "finished";
    game.finishedAtMs = now;
    game.summary = game.summary || "Seans tamamlandi.";
    game.revision += 1;
  }
}

function spawnMiningEvent(game, now) {
  if (!game.map) return;
  const candidates = game.map.tiles
    .map((tile, index) => ({ tile, index }))
    .filter((entry) => entry.tile.kind === "wall" && !entry.tile.hiddenExitId && Number(entry.tile.requiredTier || 0) <= 2);
  if (!candidates.length) return;

  const anchor = candidates[randomInt(0, candidates.length - 1)];
  const anchorX = anchor.index % game.map.size;
  const anchorY = Math.floor(anchor.index / game.map.size);
  const cluster = [
    { x: anchorX, y: anchorY },
    { x: anchorX + 1, y: anchorY },
    { x: anchorX, y: anchorY + 1 }
  ].filter((entry) => {
    const tile = getMiningTile(game.map, entry.x, entry.y);
    return tile && tile.kind === "wall" && !tile.hiddenExitId;
  });
  if (!cluster.length) return;

  const eventId = `event-${Math.random().toString(36).slice(2, 9)}`;
  cluster.forEach((entry) => {
    const tile = getMiningTile(game.map, entry.x, entry.y);
    if (!tile) return;
    tile.oreId = "starsteel";
    tile.maxHp = MINING_ORE_DEFS.starsteel.hardness;
    tile.hp = tile.maxHp;
    tile.reward = MINING_ORE_DEFS.starsteel.reward;
    tile.requiredTier = MINING_ORE_DEFS.starsteel.requiredTier;
    tile.moleChance = MINING_ORE_DEFS.starsteel.moleChance;
    tile.eventId = eventId;
  });

  game.currentEvent = {
    id: eventId,
    oreId: "starsteel",
    label: "Yildiz Cevheri",
    tiles: cluster,
    expiresAtMs: now + MINING_EVENT_LIFETIME_MS
  };
  game.nextEventAtMs = now + randomInt(130000, 190000);
  game.summary = "Nadir bir damar titresti: Yildiz Cevheri ortaya cikti.";
  game.revision += 1;
}

function clearExpiredMiningEvent(game) {
  const eventId = game.currentEvent?.id;
  if (!eventId || !game.map) {
    game.currentEvent = null;
    return;
  }
  for (const tile of game.map.tiles) {
    if (tile.eventId !== eventId || tile.kind !== "wall") continue;
    const fallback = getOreForDepth(Math.random() * 0.6 + 0.2);
    tile.oreId = fallback.id;
    tile.maxHp = fallback.hardness;
    tile.hp = fallback.hardness;
    tile.reward = fallback.reward;
    tile.requiredTier = fallback.requiredTier;
    tile.moleChance = fallback.moleChance;
    delete tile.eventId;
  }
  game.currentEvent = null;
  game.summary = "Nadir damar zamaninda kirilamadi ve dagildi.";
  game.revision += 1;
}

function resolveMiningEventTile(game, eventId, x, y) {
  if (!game.currentEvent || game.currentEvent.id !== eventId) return;
  const remainingTiles = game.currentEvent.tiles.filter((entry) => !(entry.x === x && entry.y === y));
  game.currentEvent.tiles = remainingTiles;
  if (!remainingTiles.length) {
    game.currentEvent = null;
    game.summary = "Nadir damar tamamen parcalandi.";
  }
}

function maybeSpawnMole(game, tile, player, x, y, now) {
  const chance = Math.min(0.65, Number(tile.moleChance || 0) + Math.min(0.25, player.runCoins / 3000));
  if (Math.random() >= chance) return false;
  const spot = findNearestFloor(game.map, x, y);
  if (!spot) return false;
  game.moles.push({
    id: `mole-${Math.random().toString(36).slice(2, 9)}`,
    x: spot.x,
    y: spot.y,
    hp: 38 + Math.round(chance * 60),
    damage: 6 + Math.round(chance * 12),
    nextAttackAtMs: now + 1000
  });
  return true;
}

function simulateMoleTick(game, now) {
  if (!Array.isArray(game.moles) || !game.moles.length) return;
  for (const mole of game.moles) {
    const target = pickMoleTarget(game.players, mole);
    if (!target) continue;
    const distance = euclidean(mole.x + 0.5, mole.y + 0.5, target.x, target.y);
    if (distance <= 1.2) {
      if (now >= Number(mole.nextAttackAtMs || 0)) {
        target.integrity = Math.max(0, Number(target.integrity || 100) - Number(mole.damage || 8));
        const stolenCoins = Math.min(target.runCoins, Math.max(4, Math.round((mole.damage || 8) * 1.6)));
        target.runCoins -= stolenCoins;
        target.totalWeight = computePlayerWeight(target);
        target.lastHurtAtMs = now;
        target.facing = getFacingFromDelta(target.x - mole.x, target.y - mole.y) || target.facing;
        mole.lastAttackAtMs = now;
        mole.nextAttackAtMs = now + 1400;
        pushMiningEffect(game, {
          type: "player-hit",
          x: target.x,
          y: target.y,
          actorId: target.id,
          atMs: now
        }, now);
        if (target.integrity <= 0) {
          target.status = "collapsed";
          game.summary = `${target.name} kostebeklere yenildi.`;
          game.revision += 1;
        }
      }
      continue;
    }

    const step = stepToward({ x: mole.x + 0.5, y: mole.y + 0.5 }, target);
    const nextTile = getMiningTile(game.map, mole.x + step.dx, mole.y + step.dy);
    const nextCX = mole.x + step.dx + 0.5;
    const nextCY = mole.y + step.dy + 0.5;
    const occupied = (game.players || []).some((entry) => entry.status === "active" && euclidean(entry.x, entry.y, nextCX, nextCY) < 0.8);
    if (nextTile && nextTile.kind === "floor" && !occupied) {
      mole.facing = getFacingFromDelta(step.dx, step.dy);
      mole.x += step.dx;
      mole.y += step.dy;
    }
  }
}

function pickMoleTarget(players, mole) {
  return [...(players || [])]
    .filter((entry) => entry.status === "active")
    .sort((left, right) => {
      const leftThreat = getPlayerThreat(left, mole);
      const rightThreat = getPlayerThreat(right, mole);
      return rightThreat - leftThreat;
    })[0] || null;
}

function getPlayerThreat(player, mole) {
  const distance = Math.max(1, euclidean(player.x, player.y, mole.x + 0.5, mole.y + 0.5));
  return (player.runCoins * 1.2) + ((100 - player.integrity) * 3) + (120 / distance);
}

function getPlayerSpeed(player) {
  const coinPenalty = Math.min(MINING_BASE_SPEED - MINING_MIN_SPEED, (player.runCoins || 0) * 0.003);
  return Math.max(MINING_MIN_SPEED, MINING_BASE_SPEED - coinPenalty);
}

function advancePlayerPosition(player, map, now) {
  if (player.targetX === undefined || player.targetY === undefined) return;
  const dx = player.targetX - player.x;
  const dy = player.targetY - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) {
    player.x = player.targetX;
    player.y = player.targetY;
    player.lastMovedAtMs = now;
    return;
  }

  const elapsed = Math.max(0, Math.min(1, (now - (player.lastMovedAtMs || now)) / 1000));
  if (elapsed <= 0) { player.lastMovedAtMs = now; return; }

  const speed = getPlayerSpeed(player);
  const maxDist = elapsed * speed;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const moveDist = Math.min(maxDist, dist);

  let px = player.x;
  let py = player.y;

  const newX = px + dirX * moveDist;
  const newY = py + dirY * moveDist;

  if (canOccupy(map, newX, newY)) {
    px = newX;
    py = newY;
  } else if (canOccupy(map, newX, py)) {
    px = newX;
  } else if (canOccupy(map, px, newY)) {
    py = newY;
  }

  // If physics stuck completely, clear target lock
  if (Math.abs(px - player.x) < 0.001 && Math.abs(py - player.y) < 0.001) {
    player.targetX = px;
    player.targetY = py;
  }

  player.x = px;
  player.y = py;
  player.lastMovedAtMs = now;
  player.speed = speed;
}

function advanceAllPlayerPositions(game, now) {
  for (const player of (game.players || [])) {
    if (player.status !== "active") continue;
    advancePlayerPosition(player, game.map, now);
    const tile = getMiningTile(game.map, Math.floor(player.x), Math.floor(player.y));
    if (tile?.kind === "exit") {
      extractMiningPlayer(game, player.id, now);
    }
  }
}

function canOccupy(map, px, py) {
  const r = MINING_PLAYER_RADIUS;
  const minTX = Math.floor(px - r);
  const maxTX = Math.floor(px + r);
  const minTY = Math.floor(py - r);
  const maxTY = Math.floor(py + r);
  for (let tx = minTX; tx <= maxTX; tx++) {
    for (let ty = minTY; ty <= maxTY; ty++) {
      const tile = getMiningTile(map, tx, ty);
      if (!tile || tile.kind === "wall") return false;
    }
  }
  return true;
}

function euclidean(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function getMineCooldownMs(player, tile) {
  return 170 + (Number(tile.maxHp || tile.hp || 1) * 52) + Math.min(180, Math.round(player.runCoins * 0.14));
}

function getPickaxeTier(player) {
  return Number(player?.loadout?.pickaxe?.tier || 1);
}

function getPickaxePower(player) {
  return Math.max(1, Number(player?.loadout?.pickaxe?.miningPower || 1));
}

function createLobbyPlayer(actor, loadout) {
  return {
    id: String(actor?.id || "user"),
    name: String(actor?.name || "Oyuncu"),
    status: "queued",
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    speed: MINING_BASE_SPEED,
    lastMovedAtMs: 0,
    integrity: 100,
    runCoins: 0,
    totalWeight: 0,
    nextActionAtMs: 0,
    extractedAtMs: 0,
    lastAction: "",
    lastActionAtMs: 0,
    lastActionTargetX: 0,
    lastActionTargetY: 0,
    lastHurtAtMs: 0,
    facing: "right",
    loadout: normalizeLoadout(loadout)
  };
}

function normalizeMiningPlayer(player) {
  if (!player) return null;
  return {
    id: String(player.id || "user"),
    name: String(player.name || "Oyuncu"),
    status: String(player.status || "queued"),
    x: Math.max(0, Number(player.x || 0)),
    y: Math.max(0, Number(player.y || 0)),
    targetX: Number(player.targetX ?? player.x ?? 0),
    targetY: Number(player.targetY ?? player.y ?? 0),
    speed: Math.max(0, Number(player.speed || MINING_BASE_SPEED)),
    lastMovedAtMs: Math.max(0, Math.round(Number(player.lastMovedAtMs || 0))),
    integrity: Math.max(0, Math.round(Number(player.integrity ?? 100))),
    runCoins: Math.max(0, Math.round(Number(player.runCoins || 0))),
    totalWeight: Math.max(0, Math.round(Number(player.totalWeight || computePlayerWeight(player)))),
    nextActionAtMs: Math.max(0, Math.round(Number(player.nextActionAtMs || 0))),
    extractedAtMs: Math.max(0, Math.round(Number(player.extractedAtMs || 0))),
    lastAction: String(player.lastAction || ""),
    lastActionAtMs: Math.max(0, Math.round(Number(player.lastActionAtMs || 0))),
    lastActionTargetX: Math.max(0, Number((player.lastActionTargetX ?? player.x) || 0)),
    lastActionTargetY: Math.max(0, Number((player.lastActionTargetY ?? player.y) || 0)),
    lastHurtAtMs: Math.max(0, Math.round(Number(player.lastHurtAtMs || 0))),
    facing: normalizeFacing(player.facing),
    loadout: normalizeLoadout(player.loadout)
  };
}

function normalizeMiningMole(mole) {
  if (!mole) return null;
  return {
    id: String(mole.id || `mole-${Math.random().toString(36).slice(2, 8)}`),
    x: Math.max(0, Math.round(Number(mole.x || 0))),
    y: Math.max(0, Math.round(Number(mole.y || 0))),
    hp: Math.max(1, Math.round(Number(mole.hp || 40))),
    damage: Math.max(1, Math.round(Number(mole.damage || 8))),
    nextAttackAtMs: Math.max(0, Math.round(Number(mole.nextAttackAtMs || 0))),
    lastAttackAtMs: Math.max(0, Math.round(Number(mole.lastAttackAtMs || 0))),
    hurtAtMs: Math.max(0, Math.round(Number(mole.hurtAtMs || 0))),
    facing: normalizeFacing(mole.facing)
  };
}

function normalizeMiningEffect(effect, now) {
  if (!effect) return null;
  const atMs = Math.max(0, Math.round(Number(effect.atMs || now)));
  if ((now - atMs) > MINING_EFFECT_LIFETIME_MS) {
    return null;
  }
  return {
    type: String(effect.type || ""),
    x: Math.max(0, Math.round(Number(effect.x || 0))),
    y: Math.max(0, Math.round(Number(effect.y || 0))),
    actorId: String(effect.actorId || ""),
    atMs
  };
}

function normalizeMiningEvent(event, now) {
  if (!event) return null;
  return {
    id: String(event.id || ""),
    oreId: String(event.oreId || "starsteel"),
    label: String(event.label || "Nadir Damar"),
    tiles: Array.isArray(event.tiles) ? event.tiles.map((entry) => ({
      x: Math.max(0, Math.round(Number(entry.x || 0))),
      y: Math.max(0, Math.round(Number(entry.y || 0)))
    })) : [],
    expiresAtMs: Math.max(now, Math.round(Number(event.expiresAtMs || now + MINING_EVENT_LIFETIME_MS)))
  };
}

function normalizeMiningMap(map) {
  if (!map) return null;
  if (typeof map.tilesEncoded === "string" && Number.isInteger(map.size)) {
    return decodeMiningTransportMap(map);
  }
  if (!Array.isArray(map.tiles) || !Number.isInteger(map.size)) return null;
  return {
    size: map.size,
    originX: Math.max(0, Math.round(Number(map.originX || 0))),
    originY: Math.max(0, Math.round(Number(map.originY || 0))),
    windowSize: Math.max(0, Math.round(Number(map.windowSize || 0))),
    tiles: map.tiles.map((entry) => normalizeMiningTile(entry))
  };
}

function normalizeMiningTile(tile) {
  if (!tile) return structuredClone(FLOOR_TILE);
  return {
    kind: String(tile.kind || "wall"),
    oreId: String(tile.oreId || ""),
    hp: Math.max(0, Math.round(Number(tile.hp || 0))),
    maxHp: Math.max(0, Math.round(Number(tile.maxHp || tile.hp || 0))),
    reward: Math.max(0, Math.round(Number(tile.reward || 0))),
    requiredTier: Math.max(0, Math.round(Number(tile.requiredTier || 0))),
    moleChance: Math.max(0, Number(tile.moleChance || 0)),
    hiddenExitId: tile.hiddenExitId ? String(tile.hiddenExitId) : "",
    eventId: tile.eventId ? String(tile.eventId) : ""
  };
}

function serializeMiningTransportMap(map, visibleWindow = null) {
  if (!map || !Array.isArray(map.tiles) || !Number.isInteger(map.size)) return null;
  const originX = Math.max(0, Math.round(Number(visibleWindow?.originX || 0)));
  const originY = Math.max(0, Math.round(Number(visibleWindow?.originY || 0)));
  const windowSize = Math.max(1, Math.round(Number(visibleWindow?.size || map.size)));
  const encodedTiles = [];
  for (let y = originY; y < Math.min(map.size, originY + windowSize); y += 1) {
    for (let x = originX; x < Math.min(map.size, originX + windowSize); x += 1) {
      encodedTiles.push(encodeMiningTransportTile(getMiningTile(map, x, y)));
    }
  }
  return {
    size: map.size,
    originX,
    originY,
    windowSize,
    transportVersion: MINING_TRANSPORT_MAP_VERSION,
    tilesEncoded: encodedTiles.join("")
  };
}

function decodeMiningTransportMap(map) {
  const encoded = String(map?.tilesEncoded || "");
  const size = Math.max(0, Math.round(Number(map?.size || 0)));
  const originX = Math.max(0, Math.round(Number(map?.originX || 0)));
  const originY = Math.max(0, Math.round(Number(map?.originY || 0)));
  const windowSize = Math.max(1, Math.round(Number(map?.windowSize || size)));
  if (!size || !encoded) return null;
  const tiles = [];
  for (let index = 0; index < encoded.length; index += MINING_TILE_TOKEN_SIZE) {
    tiles.push(decodeMiningTransportTile(encoded.slice(index, index + MINING_TILE_TOKEN_SIZE)));
  }
  return {
    size,
    originX,
    originY,
    windowSize,
    tiles
  };
}

function encodeMiningTransportTile(tile) {
  const normalized = normalizeMiningTile(tile);
  if (normalized.kind === "floor") {
    return `${MINING_TRANSPORT_FLOOR_CODE}00`;
  }
  if (normalized.kind === "exit") {
    return `${MINING_TRANSPORT_EXIT_CODE}00`;
  }
  const oreCode = MINING_TRANSPORT_ORE_CODES[normalized.oreId] || MINING_TRANSPORT_ORE_CODES.stone;
  return `${oreCode}${toBase36Digit(normalized.hp)}${toBase36Digit(normalized.maxHp)}`;
}

function decodeMiningTransportTile(token) {
  const safeToken = String(token || "").padEnd(MINING_TILE_TOKEN_SIZE, "0");
  const kindCode = safeToken[0];
  if (kindCode === MINING_TRANSPORT_FLOOR_CODE) {
    return structuredClone(FLOOR_TILE);
  }
  if (kindCode === MINING_TRANSPORT_EXIT_CODE) {
    return {
      ...structuredClone(FLOOR_TILE),
      kind: "exit"
    };
  }
  const oreId = MINING_TRANSPORT_ORE_BY_CODE[kindCode] || "stone";
  return {
    kind: "wall",
    oreId,
    hp: fromBase36Digit(safeToken[1]),
    maxHp: fromBase36Digit(safeToken[2]),
    reward: 0,
    requiredTier: 0,
    moleChance: 0,
    hiddenExitId: "",
    eventId: ""
  };
}

function toBase36Digit(value) {
  return Math.max(0, Math.min(35, Math.round(Number(value || 0)))).toString(36);
}

function fromBase36Digit(value) {
  const parsed = parseInt(String(value || "0"), 36);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMiningTransportWindow(game, playerId = "") {
  const focusPlayer = getMiningCurrentPlayer(game, playerId)
    || (game?.players || []).find((entry) => entry.status === "active")
    || null;
  if (focusPlayer) {
    return getMiningVisibleTiles(game, focusPlayer.id, MINING_VIEW_RADIUS);
  }

  const mapSize = Math.max(1, Math.round(Number(game?.map?.size || 1)));
  const size = Math.min(mapSize, (MINING_VIEW_RADIUS * 2) + 1);
  const center = Math.floor(mapSize / 2);
  const maxOrigin = Math.max(0, mapSize - size);
  return {
    originX: Math.max(0, Math.min(maxOrigin, center - Math.floor(size / 2))),
    originY: Math.max(0, Math.min(maxOrigin, center - Math.floor(size / 2))),
    size,
    tiles: []
  };
}

function generateMiningMap(playerCount) {
  const size = Math.min(MINING_MAP_MAX_SIZE, MINING_MAP_BASE_SIZE + (Math.max(1, playerCount) * MINING_MAP_PLAYER_GROWTH));
  const center = Math.floor(size / 2);
  const spawnRadius = 1;
  const tiles = [];
  const exitCandidates = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.max(Math.abs(x - center), Math.abs(y - center));
      if (distance <= spawnRadius) {
        tiles.push(structuredClone(FLOOR_TILE));
        continue;
      }

      const normalizedDepth = Math.min(1, distance / center);
      const ore = getOreForDepth(normalizedDepth);
      const tile = {
        kind: "wall",
        oreId: ore.id,
        hp: ore.hardness,
        maxHp: ore.hardness,
        reward: ore.reward,
        requiredTier: ore.requiredTier,
        moleChance: ore.moleChance
      };
      tiles.push(tile);

      if (distance >= center - 2 && ore.requiredTier <= 2) {
        exitCandidates.push({ x, y });
      }
    }
  }

  const chosenExits = pickUnique(exitCandidates, 2, (left, right) => manhattan(left.x, left.y, right.x, right.y) > Math.floor(size / 2));
  chosenExits.forEach((entry, index) => {
    const tile = tiles[(entry.y * size) + entry.x];
    tile.hiddenExitId = `exit-${index + 1}`;
  });

  return { size, tiles };
}

function spawnMiningPlayer(game, player, now, explicitMap = null, spawnIndex = 0) {
  const map = explicitMap || game.map;
  if (!map || !player) return;
  const spawn = findAvailableSpawn(map, game.players || [], spawnIndex);
  player.x = spawn.x;
  player.y = spawn.y;
  player.targetX = spawn.x;
  player.targetY = spawn.y;
  player.speed = MINING_BASE_SPEED;
  player.lastMovedAtMs = now;
  player.status = "active";
  player.integrity = 100;
  player.runCoins = 0;
  player.totalWeight = 0;
  player.nextActionAtMs = now;
  player.extractedAtMs = 0;
}

function findAvailableSpawn(map, players, spawnIndex = 0) {
  const center = Math.floor(map.size / 2);
  const preferred = [
    { x: center + 0.5, y: center + 0.5 },
    { x: center + 1.5, y: center + 0.5 },
    { x: center + 0.5, y: center + 1.5 },
    { x: center - 0.5, y: center + 0.5 },
    { x: center + 0.5, y: center - 0.5 }
  ];
  const activePlayers = (players || []).filter((entry) => entry.status === "active");

  for (let index = 0; index < preferred.length; index += 1) {
    const candidate = preferred[(spawnIndex + index) % preferred.length];
    const tile = getMiningTile(map, Math.floor(candidate.x), Math.floor(candidate.y));
    const tooClose = activePlayers.some((entry) => euclidean(entry.x, entry.y, candidate.x, candidate.y) < 0.8);
    if (tile?.kind === "floor" && !tooClose) {
      return candidate;
    }
  }

  for (let radius = 2; radius <= 8; radius += 1) {
    for (let y = center - radius; y <= center + radius; y += 1) {
      for (let x = center - radius; x <= center + radius; x += 1) {
        const tile = getMiningTile(map, x, y);
        const cx = x + 0.5;
        const cy = y + 0.5;
        const tooClose = activePlayers.some((entry) => euclidean(entry.x, entry.y, cx, cy) < 0.8);
        if (tile?.kind === "floor" && !tooClose) {
          return { x: cx, y: cy };
        }
      }
    }
  }

  return { x: center + 0.5, y: center + 0.5 };
}

function getOreForDepth(normalizedDepth) {
  if (normalizedDepth < 0.24) {
    return weightedOre([
      ["stone", 54],
      ["coal", 28],
      ["copper", 18]
    ]);
  }
  if (normalizedDepth < 0.45) {
    return weightedOre([
      ["stone", 28],
      ["coal", 24],
      ["copper", 28],
      ["iron", 20]
    ]);
  }
  if (normalizedDepth < 0.68) {
    return weightedOre([
      ["copper", 26],
      ["iron", 28],
      ["amber", 26],
      ["sapphire", 20]
    ]);
  }
  return weightedOre([
    ["iron", 24],
    ["amber", 28],
    ["sapphire", 28],
    ["ruby", 20]
  ]);
}

function weightedOre(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [oreId, weight] of entries) {
    roll -= weight;
    if (roll <= 0) {
      return MINING_ORE_DEFS[oreId];
    }
  }
  return MINING_ORE_DEFS[entries[entries.length - 1][0]];
}

function normalizeLoadout(loadout) {
  const next = {};
  for (const slot of MINING_SLOT_KEYS) {
    const value = loadout?.[slot];
    if (slot === "pickaxe") {
      const pick = PICKAXE_CATALOG[value?.id] || PICKAXE_CATALOG["starter-pick"];
      next[slot] = { ...pick };
      continue;
    }
    const fallback = STARTER_LOADOUT[slot];
    next[slot] = {
      id: String(value?.id || fallback.id),
      label: String(value?.label || fallback.label),
      tier: Math.max(1, Math.round(Number(value?.tier || fallback.tier || 1)))
    };
  }
  return next;
}

function cloneLoadout(loadout) {
  return normalizeLoadout(loadout);
}

function computePlayerWeight(player) {
  return Math.round(Number(player?.runCoins || 0) / 12);
}

function getOreLabel(oreId) {
  return MINING_ORE_DEFS[oreId]?.label || "damar";
}

function findNearestFloor(map, x, y) {
  const offsets = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1]
  ];
  for (const [dx, dy] of offsets) {
    const tile = getMiningTile(map, x + dx, y + dy);
    if (tile?.kind === "floor") {
      return { x: x + dx, y: y + dy };
    }
  }
  return null;
}

function pickUnique(list, count, validator = () => true) {
  const pool = [...list];
  const chosen = [];
  while (pool.length && chosen.length < count) {
    const index = randomInt(0, pool.length - 1);
    const [candidate] = pool.splice(index, 1);
    if (chosen.every((entry) => validator(entry, candidate))) {
      chosen.push(candidate);
    }
  }
  return chosen;
}

function stepToward(from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
    return { dx, dy: 0 };
  }
  return { dx: 0, dy };
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function normalizeFacing(value) {
  const facing = String(value || "").toLowerCase();
  if (["up", "down", "left", "right"].includes(facing)) {
    return facing;
  }
  return "right";
}

function getFacingFromDelta(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > 0) return "right";
    if (dx < 0) return "left";
  }
  if (dy > 0) return "down";
  if (dy < 0) return "up";
  return "";
}

function pushMiningEffect(game, effect, now = Date.now()) {
  game.effects ||= [];
  const normalized = normalizeMiningEffect(effect, now);
  if (!normalized) return;
  game.effects.push(normalized);
  pruneMiningEffects(game, now);
}

function pruneMiningEffects(game, now = Date.now()) {
  game.effects = (game.effects || []).filter((entry) => entry && (now - Number(entry.atMs || 0)) <= MINING_EFFECT_LIFETIME_MS);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * ((max - min) + 1)) + min;
}
