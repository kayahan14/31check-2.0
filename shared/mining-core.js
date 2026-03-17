export const MINING_CHANNEL_ID = "casino:mining";
export const MINING_TYPE = "mining_session";
export const MINING_PROFILE_TYPE = "mining_profile";
export const MINING_SLOT_KEYS = ["armor", "boots", "bag", "tool", "pickaxe"];
export const MINING_JOIN_WINDOW_MS = 0;
export const MINING_TARGET_RUN_MS = 12 * 60 * 1000;
export const MINING_EXIT_COLLAPSE_MS = 90 * 1000;
export const MINING_TIMEOUT_COLLAPSE_MS = 75 * 1000;
export const MINING_EVENT_LIFETIME_MS = 75 * 1000;
export const MINING_VIEW_RADIUS = 13;
export const MINING_TILE_SIZE = 34;
export const MINING_DEFAULT_WALLET_COINS = 500;

const FLOOR_TILE = { kind: "floor", oreId: "", hp: 0, maxHp: 0, reward: 0, requiredTier: 0, moleChance: 0 };

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
  stone: { id: "stone", label: "Tas", color: "#5b6270", reward: 6, hardness: 1, requiredTier: 1, moleChance: 0.04 },
  coal: { id: "coal", label: "Komur", color: "#424750", reward: 10, hardness: 1, requiredTier: 1, moleChance: 0.05 },
  copper: { id: "copper", label: "Bakir", color: "#b56d42", reward: 18, hardness: 2, requiredTier: 1, moleChance: 0.06 },
  iron: { id: "iron", label: "Demir", color: "#88919f", reward: 28, hardness: 2, requiredTier: 1, moleChance: 0.08 },
  amber: { id: "amber", label: "Amber", color: "#da8c2e", reward: 44, hardness: 3, requiredTier: 2, moleChance: 0.1 },
  sapphire: { id: "sapphire", label: "Safir", color: "#4e81ff", reward: 76, hardness: 4, requiredTier: 2, moleChance: 0.14 },
  ruby: { id: "ruby", label: "Yakut", color: "#e55366", reward: 120, hardness: 5, requiredTier: 3, moleChance: 0.18 },
  starsteel: { id: "starsteel", label: "Yildiz Cevheri", color: "#7ff0ff", reward: 180, hardness: 5, requiredTier: 2, moleChance: 0.22 }
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
    moles: [],
    players: [createLobbyPlayer(actor, normalizedProfile.loadout)],
    sessionSeed: Math.floor(Math.random() * 1_000_000_000)
  };
  startMiningRun(session, now);
  return session;
}

export function normalizeMiningSession(content, now = Date.now()) {
  const game = structuredClone(content || {});
  game.game = "mining";
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
  game.moles = Array.isArray(game.moles) ? game.moles.map((entry) => normalizeMiningMole(entry)).filter(Boolean) : [];
  game.players = Array.isArray(game.players) ? game.players.map((entry) => normalizeMiningPlayer(entry)).filter(Boolean) : [];

  if (game.status === "lobby") {
    game.joinDeadlineMs = now;
    startMiningRun(game, now);
  }

  if (game.status === "active") {
    simulateMiningSession(game, now);
  }

  return game;
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
  const originX = Math.max(0, player.x - radius);
  const originY = Math.max(0, player.y - radius);
  const maxX = Math.min(map.size - 1, player.x + radius);
  const maxY = Math.min(map.size - 1, player.y + radius);
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

export function moveMiningPlayer(game, playerId, dx, dy, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  if (!player || player.status !== "active") return { changed: false, reason: "inactive" };
  if (Math.abs(dx) + Math.abs(dy) !== 1) return { changed: false, reason: "invalid" };
  if (now < Number(player.nextActionAtMs || 0)) return { changed: false, reason: "cooldown" };
  const nextTile = getMiningTile(game.map, player.x + dx, player.y + dy);
  if (!nextTile || (nextTile.kind !== "floor" && nextTile.kind !== "exit")) {
    return { changed: false, reason: "blocked" };
  }

  player.x += dx;
  player.y += dy;
  player.lastAction = "move";
  player.nextActionAtMs = now + getMoveCooldownMs(player);
  if (nextTile.kind === "exit") {
    const extraction = extractMiningPlayer(game, playerId, now);
    return {
      changed: Boolean(extraction.changed),
      reason: extraction.reason || "",
      player,
      extracted: Boolean(extraction.changed),
      awardedCoins: Math.max(0, Math.round(Number(extraction.awardedCoins || 0)))
    };
  }
  game.summary = `${player.name} ilerliyor.`;
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
  if (manhattan(player.x, player.y, targetX, targetY) !== 1) return { changed: false, reason: "range" };
  if (now < Number(player.nextActionAtMs || 0)) return { changed: false, reason: "cooldown" };
  if (getPickaxeTier(player) < Number(tile.requiredTier || 1)) return { changed: false, reason: "pick-tier" };

  tile.hp = Math.max(0, Number(tile.hp || tile.maxHp || 1) - getPickaxePower(player));
  player.lastAction = "mine";
  player.nextActionAtMs = now + getMineCooldownMs(player, tile);

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
  game.summary = `${player.name} ${reward} coin topladi.${spawnedMole ? " Bir kostebek homurdanmasi duyuldu." : ""}`;
  game.revision += 1;
  return { changed: true, reason: "", player, tileBroken: true, foundExit: false, reward, spawnedMole };
}

export function attackMiningMole(game, playerId, targetId, now = Date.now()) {
  const player = getMiningCurrentPlayer(game, playerId);
  const mole = (game?.moles || []).find((entry) => entry.id === String(targetId || ""));
  if (!player || player.status !== "active" || !mole) return { changed: false, reason: "invalid" };
  if (manhattan(player.x, player.y, mole.x, mole.y) !== 1) return { changed: false, reason: "range" };
  if (now < Number(player.nextActionAtMs || 0)) return { changed: false, reason: "cooldown" };

  mole.hp = Math.max(0, Number(mole.hp || 0) - 18);
  player.nextActionAtMs = now + 650;
  player.lastAction = "attack";
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
  const tile = player ? getMiningTile(game.map, player.x, player.y) : null;
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
  game.moles = [];
  game.summary = "Kazilar basladi. Iki gizli cikis dis halkalarda sakli.";
  game.revision += 1;
}

function simulateMiningSession(game, now) {
  if (!game.map) return;

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
  for (let tick = lastTick + 1; tick <= nextTick; tick += 1) {
    simulateMoleTick(game, tick * 1000);
  }
  game.lastSimulatedAtMs = now;

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
    const distance = manhattan(mole.x, mole.y, target.x, target.y);
    if (distance <= 1) {
      if (now >= Number(mole.nextAttackAtMs || 0)) {
        target.integrity = Math.max(0, Number(target.integrity || 100) - Number(mole.damage || 8));
        const stolenCoins = Math.min(target.runCoins, Math.max(4, Math.round((mole.damage || 8) * 1.6)));
        target.runCoins -= stolenCoins;
        target.totalWeight = computePlayerWeight(target);
        mole.nextAttackAtMs = now + 1400;
        if (target.integrity <= 0) {
          target.status = "collapsed";
          game.summary = `${target.name} kostebeklere yenildi.`;
          game.revision += 1;
        }
      }
      continue;
    }

    const step = stepToward(mole, target);
    const nextTile = getMiningTile(game.map, mole.x + step.dx, mole.y + step.dy);
    const occupied = (game.players || []).some((entry) => entry.status === "active" && entry.x === mole.x + step.dx && entry.y === mole.y + step.dy);
    if (nextTile && nextTile.kind === "floor" && !occupied) {
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
  const distance = Math.max(1, manhattan(player.x, player.y, mole.x, mole.y));
  return (player.runCoins * 1.2) + ((100 - player.integrity) * 3) + (120 / distance);
}

function getMoveCooldownMs(player) {
  return 230 + Math.min(820, Math.round(player.runCoins * 1.2));
}

function getMineCooldownMs(player, tile) {
  return 360 + (Number(tile.maxHp || tile.hp || 1) * 260) + Math.min(600, Math.round(player.runCoins * 0.8));
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
    integrity: 100,
    runCoins: 0,
    totalWeight: 0,
    nextActionAtMs: 0,
    extractedAtMs: 0,
    lastAction: "",
    loadout: normalizeLoadout(loadout)
  };
}

function normalizeMiningPlayer(player) {
  if (!player) return null;
  return {
    id: String(player.id || "user"),
    name: String(player.name || "Oyuncu"),
    status: String(player.status || "queued"),
    x: Math.max(0, Math.round(Number(player.x || 0))),
    y: Math.max(0, Math.round(Number(player.y || 0))),
    integrity: Math.max(0, Math.round(Number(player.integrity ?? 100))),
    runCoins: Math.max(0, Math.round(Number(player.runCoins || 0))),
    totalWeight: Math.max(0, Math.round(Number(player.totalWeight || computePlayerWeight(player)))),
    nextActionAtMs: Math.max(0, Math.round(Number(player.nextActionAtMs || 0))),
    extractedAtMs: Math.max(0, Math.round(Number(player.extractedAtMs || 0))),
    lastAction: String(player.lastAction || ""),
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
    nextAttackAtMs: Math.max(0, Math.round(Number(mole.nextAttackAtMs || 0)))
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
  if (!map || !Array.isArray(map.tiles) || !Number.isInteger(map.size)) return null;
  return {
    size: map.size,
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

function generateMiningMap(playerCount) {
  const size = Math.min(321, 241 + (Math.max(1, playerCount) * 16));
  const center = Math.floor(size / 2);
  const spawnRadius = 4;
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
    { x: center, y: center },
    { x: center + 1, y: center },
    { x: center, y: center + 1 },
    { x: center - 1, y: center },
    { x: center, y: center - 1 }
  ];
  const occupied = new Set((players || [])
    .filter((entry) => entry.status === "active")
    .map((entry) => `${entry.x}:${entry.y}`));

  for (let index = 0; index < preferred.length; index += 1) {
    const candidate = preferred[(spawnIndex + index) % preferred.length];
    const tile = getMiningTile(map, candidate.x, candidate.y);
    if (tile?.kind === "floor" && !occupied.has(`${candidate.x}:${candidate.y}`)) {
      return candidate;
    }
  }

  for (let radius = 2; radius <= 8; radius += 1) {
    for (let y = center - radius; y <= center + radius; y += 1) {
      for (let x = center - radius; x <= center + radius; x += 1) {
        const tile = getMiningTile(map, x, y);
        if (tile?.kind === "floor" && !occupied.has(`${x}:${y}`)) {
          return { x, y };
        }
      }
    }
  }

  return { x: center, y: center };
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

function randomInt(min, max) {
  return Math.floor(Math.random() * ((max - min) + 1)) + min;
}
