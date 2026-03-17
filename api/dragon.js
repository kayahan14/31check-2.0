import { DEFAULT_DRAGON_CONFIG, normalizeDragonConfig } from "../shared/dragon-config.js";
import { appendMessage, listScopeChannels, updateMessage } from "../server/storage.js";

const DRAGON_CHANNEL_ID = "casino:dragon";
const DRAGON_TYPE = "dragon_state";
const DRAGON_CONFIG_TYPE = "dragon_config";
const BASE_STAKE = 100;
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
globalThis.__dragonQueues ||= {};

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if (req.method === "GET") {
      const scopeKey = String(req.query.scopeKey || "local-preview");
      const serverNowMs = Date.now();
      const session = await getCurrentDragonSession(scopeKey);
      const { config, updatedAtMs: configUpdatedAtMs } = await getDragonConfigPayload(scopeKey);
      const recentResults = await getDragonRecentResults(scopeKey, serverNowMs);
      res.status(200).json({ ok: true, session, config, configUpdatedAtMs, recentResults, serverNowMs });
      return;
    }

    if (req.method === "POST") {
      const {
        scopeKey = "local-preview",
        action,
        actor,
        config,
        clientMultiplier
      } = req.body || {};

      if (!action) {
        res.status(400).json({ error: "action is required." });
        return;
      }

      const result = await withDragonQueue(scopeKey, async () => mutateDragonSession(scopeKey, action, actor, {
        config,
        clientMultiplier
      }));

      res.status(200).json({
        ok: true,
        session: result.session,
        config: result.config,
        configUpdatedAtMs: result.configUpdatedAtMs,
        recentResults: result.recentResults,
        serverNowMs: result.serverNowMs
      });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({
      error: "Dragon session failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function withDragonQueue(scopeKey, worker) {
  const key = String(scopeKey || "local-preview");
  const previous = globalThis.__dragonQueues[key] || Promise.resolve();
  const next = previous.catch(() => null).then(worker);
  globalThis.__dragonQueues[key] = next.finally(() => {
    if (globalThis.__dragonQueues[key] === next) {
      delete globalThis.__dragonQueues[key];
    }
  });
  return next;
}

async function mutateDragonSession(scopeKey, action, actor, meta = {}) {
  const current = await getCurrentDragonSession(scopeKey);
  const currentConfigPayload = await getDragonConfigPayload(scopeKey);
  const currentConfig = currentConfigPayload.config;
  const normalizedActor = {
    id: String(actor?.id || "user"),
    name: String(actor?.name || "Oyuncu")
  };
  const now = Date.now();
  const makeResult = async (session, config = currentConfig, configUpdatedAtMs = currentConfigPayload.updatedAtMs) => ({
    session,
    config,
    configUpdatedAtMs,
    recentResults: await getDragonRecentResults(scopeKey, now),
    serverNowMs: now
  });

  if (action === "save_config") {
    const nextConfig = normalizeDragonConfig(meta.config);
    const savedConfig = await saveDragonConfig(scopeKey, nextConfig, normalizedActor, now);
    return makeResult(current, nextConfig, Number(savedConfig?.serverCreatedAtMs || savedConfig?.createdAtMs || now));
  }

  if (!current || getDragonPhase(current.content, now) === "finished") {
    if (action !== "start") {
      return makeResult(current);
    }

    const message = makeDragonMessage(normalizedActor, now, currentConfig);
    const session = await appendMessage(scopeKey, DRAGON_CHANNEL_ID, message);
    return makeResult(session);
  }

  const game = normalizeDragonState(current.content, now);

  if (action === "start") {
    if (getDragonPhase(game, now) === "lobby" && !game.participants.some((entry) => entry.id === normalizedActor.id)) {
      game.participants.push(makeParticipant(normalizedActor));
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return makeResult(session);
    }

    return makeResult(current);
  }

  if (action === "join") {
    if (getDragonPhase(game, now) !== "lobby") {
      return makeResult({ ...current, content: game });
    }

    if (!game.participants.some((entry) => entry.id === normalizedActor.id)) {
      game.participants.push(makeParticipant(normalizedActor));
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return makeResult(session);
    }

    return makeResult({ ...current, content: game });
  }

  if (action === "cashout") {
    if (getDragonPhase(game, now) !== "playing") {
      return makeResult({ ...current, content: game });
    }

    const participant = game.participants.find((entry) => entry.id === normalizedActor.id);
    if (!participant || participant.status !== "joined") {
      return makeResult({ ...current, content: game });
    }

    if (shouldDragonCrash(game, now)) {
      game.status = "crashed";
      game.finalMultiplier = roundMultiplier(game.crashAtMultiplier);
      game.resultSummary = "EJDERHA PATLADI 💥";
      game.participants = game.participants.map((entry) => entry.status === "joined" ? { ...entry, status: "crashed" } : entry);
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return makeResult(session);
    }

    const liveMultiplier = getDragonLiveMultiplier(game, now);
    const requestedMultiplier = Number(meta.clientMultiplier);
    const multiplier = Number.isFinite(requestedMultiplier) && requestedMultiplier >= 1
      ? roundMultiplier(Math.min(liveMultiplier, requestedMultiplier))
      : liveMultiplier;

    participant.status = "cashed_out";
    participant.cashoutMultiplier = multiplier;
    participant.cashoutValue = roundCoinValue(game.baseStake * multiplier);
    if ((game.participants || []).every((entry) => entry.status !== "joined")) {
      game.acceleratedFromEffectiveElapsed = getDragonEffectiveElapsed(game, now);
      game.acceleratedAtMs = now;
    }
    game.revision += 1;

    const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
    return makeResult(session);
  }

  if (action === "resolve") {
    if (getDragonPhase(game, now) === "finished" && game.status !== "crashed") {
      game.status = "crashed";
      game.finalMultiplier = roundMultiplier(game.crashAtMultiplier);
      game.resultSummary = "EJDERHA PATLADI 💥";
      game.participants = game.participants.map((entry) => entry.status === "joined" ? { ...entry, status: "crashed" } : entry);
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return makeResult(session);
    }

    return makeResult({ ...current, content: game });
  }

  return makeResult({ ...current, content: game });
}

async function getCurrentDragonSession(scopeKey) {
  const channels = await listScopeChannels(scopeKey);
  const sessions = Object.values(channels || {})
    .flat()
    .filter((message) => message?.channelId === DRAGON_CHANNEL_ID && message?.type === DRAGON_TYPE);

  if (!sessions.length) return null;

  const latest = [...sessions].sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))[0];
  return {
    ...latest,
    content: normalizeDragonState(latest.content)
  };
}

async function getDragonConfigPayload(scopeKey) {
  const channels = await listScopeChannels(scopeKey);
  const configs = Object.values(channels || {})
    .flat()
    .filter((message) => message?.channelId === DRAGON_CHANNEL_ID && message?.type === DRAGON_CONFIG_TYPE);

  if (!configs.length) {
    return {
      config: normalizeDragonConfig(DEFAULT_DRAGON_CONFIG),
      updatedAtMs: 0
    };
  }

  const latest = [...configs].sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))[0];
  return {
    config: normalizeDragonConfig(latest.content),
    updatedAtMs: Number(latest.serverCreatedAtMs || latest.createdAtMs || 0)
  };
}

async function getDragonRecentResults(scopeKey, now = Date.now()) {
  const channels = await listScopeChannels(scopeKey);
  const sessions = Object.values(channels || {})
    .flat()
    .filter((message) => message?.channelId === DRAGON_CHANNEL_ID && message?.type === DRAGON_TYPE)
    .map((message) => ({
      ...message,
      content: normalizeDragonState(message.content, now)
    }))
    .filter((message) => getDragonPhase(message.content, now) === "finished")
    .sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))
    .slice(0, 50);

  return sessions.map((message) => {
    const game = message.content;
    return {
      sessionId: message.id,
      multiplier: roundMultiplier(game.crashAtMultiplier || game.finalMultiplier || 1),
      crashed: game.status === "crashed",
      createdAtMs: Number(message.serverCreatedAtMs || message.createdAtMs || now)
    };
  });
}

async function saveDragonConfig(scopeKey, config, actor, now) {
  const channels = await listScopeChannels(scopeKey);
  const configs = Object.values(channels || {})
    .flat()
    .filter((message) => message?.channelId === DRAGON_CHANNEL_ID && message?.type === DRAGON_CONFIG_TYPE);

  const latest = configs.length
    ? [...configs].sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))[0]
    : null;

  if (!latest) {
    return appendMessage(scopeKey, DRAGON_CHANNEL_ID, {
      id: crypto.randomUUID(),
      channelId: DRAGON_CHANNEL_ID,
      author: actor.name,
      avatar: actor.name,
      avatarUrl: "",
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      type: DRAGON_CONFIG_TYPE,
      content: normalizeDragonConfig(config)
    });
  }

  return updateMessage(scopeKey, latest.id, {
    ...latest,
    author: actor.name,
    avatar: actor.name,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    serverCreatedAt: new Date(now).toISOString(),
    serverCreatedAtMs: now,
    content: normalizeDragonConfig(config)
  });
}

function makeDragonMessage(actor, now, config) {
  const normalizedConfig = normalizeDragonConfig(config);
  return {
    id: crypto.randomUUID(),
    channelId: DRAGON_CHANNEL_ID,
    author: actor.name,
    avatar: actor.name,
    avatarUrl: "",
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    type: DRAGON_TYPE,
    content: {
      game: "dragon",
      revision: 1,
      status: "lobby",
      baseStake: BASE_STAKE,
      config: normalizedConfig,
      launchAtMs: now + normalizedConfig.lobbyMs,
      startedAtMs: now + normalizedConfig.lobbyMs,
      crashAtMultiplier: generateDragonCrashMultiplier(normalizedConfig),
      finalMultiplier: 1,
      resultSummary: "",
      participants: [makeParticipant(actor)]
    }
  };
}

function makeParticipant(actor) {
  return {
    id: actor.id,
    name: actor.name,
    status: "joined",
    cashoutMultiplier: 0,
    cashoutValue: 0
  };
}

function normalizeDragonState(content, now = Date.now()) {
  const game = typeof content === "string" ? JSON.parse(content) : structuredClone(content || {});
  game.game ||= "dragon";
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.status ||= "lobby";
  game.baseStake = Number(game.baseStake) > 0 ? Number(game.baseStake) : BASE_STAKE;
  game.config = normalizeDragonConfig(game.config);
  game.launchAtMs = Number(game.launchAtMs) > 0 ? Number(game.launchAtMs) : now + game.config.lobbyMs;
  game.startedAtMs = Number(game.startedAtMs) > 0 ? Number(game.startedAtMs) : game.launchAtMs;
  game.crashAtMultiplier = Number(game.crashAtMultiplier) > 1 ? Number(game.crashAtMultiplier) : generateDragonCrashMultiplier(game.config);
  game.finalMultiplier = Number(game.finalMultiplier) > 0 ? Number(game.finalMultiplier) : 1;
  game.acceleratedAtMs = Number(game.acceleratedAtMs) > 0 ? Number(game.acceleratedAtMs) : 0;
  game.acceleratedFromEffectiveElapsed = Number(game.acceleratedFromEffectiveElapsed) > 0 ? Number(game.acceleratedFromEffectiveElapsed) : 0;
  game.resultSummary ||= "";
  game.participants = Array.isArray(game.participants) ? game.participants.map((entry) => ({
    id: entry?.id || "user",
    name: entry?.name || "Oyuncu",
    status: entry?.status || "joined",
    cashoutMultiplier: Number(entry?.cashoutMultiplier) > 0 ? Number(entry.cashoutMultiplier) : 0,
    cashoutValue: Number(entry?.cashoutValue) > 0 ? Number(entry.cashoutValue) : 0
  })) : [];

  if (hasDragonCrashedByNow(game, now) && game.status !== "crashed") {
    game.status = "crashed";
    game.finalMultiplier = roundMultiplier(game.crashAtMultiplier);
    game.resultSummary = "EJDERHA PATLADI 💥";
    game.participants = game.participants.map((entry) => entry.status === "joined" ? { ...entry, status: "crashed" } : entry);
  }

  return game;
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

function getDragonEffectiveElapsed(game, now = Date.now()) {
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

function getDragonPhase(gameState, now = Date.now()) {
  const game = typeof gameState?.game === "string" ? gameState : normalizeDragonState(gameState, now);
  if (game.status === "crashed") return "finished";
  if (now < game.launchAtMs) return "lobby";
  if (hasDragonCrashedByNow(game, now)) return "finished";
  return "playing";
}

function getDragonLiveMultiplier(gameState, now = Date.now()) {
  const game = typeof gameState?.game === "string" ? gameState : normalizeDragonState(gameState, now);
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

function shouldDragonCrash(gameState, now = Date.now()) {
  return hasDragonCrashedByNow(gameState, now);
}

function hasDragonCrashedByNow(gameState, now = Date.now()) {
  const game = typeof gameState?.game === "string" ? gameState : normalizeDragonState(gameState, now);
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

function roundCoinValue(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
