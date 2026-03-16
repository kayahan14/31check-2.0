import { appendMessage, listScopeChannels, updateMessage } from "../server/storage.js";

const DRAGON_CHANNEL_ID = "casino:dragon";
const DRAGON_TYPE = "dragon_state";
const DRAGON_CONFIG_TYPE = "dragon_config";
const BASE_STAKE = 100;
const LOBBY_MS = 10000;
const DEFAULT_DRAGON_CONFIG = {
  lobbyMs: LOBBY_MS,
  speedFactor: 1,
  testMode: false,
  testMaxMultiplier: 10
};

globalThis.__dragonQueues ||= {};

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if (req.method === "GET") {
      const scopeKey = String(req.query.scopeKey || "local-preview");
      const session = await getCurrentDragonSession(scopeKey);
      const config = await getDragonConfig(scopeKey);
      res.status(200).json({ ok: true, session, config });
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
        config: result.config
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
  const currentConfig = await getDragonConfig(scopeKey);
  const normalizedActor = {
    id: String(actor?.id || "user"),
    name: String(actor?.name || "Oyuncu")
  };
  const now = Date.now();

  if (action === "save_config") {
    const nextConfig = normalizeDragonConfig(meta.config);
    await saveDragonConfig(scopeKey, nextConfig, normalizedActor, now);
    return {
      session: current,
      config: nextConfig
    };
  }

  if (!current || getDragonPhase(current.content, now) === "finished") {
    if (action !== "start") {
      return {
        session: current,
        config: currentConfig
      };
    }

    const message = makeDragonMessage(normalizedActor, now, currentConfig);
    const session = await appendMessage(scopeKey, DRAGON_CHANNEL_ID, message);
    return {
      session,
      config: currentConfig
    };
  }

  const game = normalizeDragonState(current.content, now);

  if (action === "start") {
    if (getDragonPhase(game, now) === "lobby" && !game.participants.some((entry) => entry.id === normalizedActor.id)) {
      game.participants.push(makeParticipant(normalizedActor));
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return {
        session,
        config: currentConfig
      };
    }

    return {
      session: current,
      config: currentConfig
    };
  }

  if (action === "join") {
    if (getDragonPhase(game, now) !== "lobby") {
      return {
        session: { ...current, content: game },
        config: currentConfig
      };
    }

    if (!game.participants.some((entry) => entry.id === normalizedActor.id)) {
      game.participants.push(makeParticipant(normalizedActor));
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return {
        session,
        config: currentConfig
      };
    }

    return {
      session: { ...current, content: game },
      config: currentConfig
    };
  }

  if (action === "cashout") {
    if (getDragonPhase(game, now) !== "playing") {
      return {
        session: { ...current, content: game },
        config: currentConfig
      };
    }

    const participant = game.participants.find((entry) => entry.id === normalizedActor.id);
    if (!participant || participant.status !== "joined") {
      return {
        session: { ...current, content: game },
        config: currentConfig
      };
    }

    if (shouldDragonCrash(game, now)) {
      game.status = "crashed";
      game.finalMultiplier = roundMultiplier(game.crashAtMultiplier);
      game.resultSummary = "EJDERHA PATLADI 💥";
      game.participants = game.participants.map((entry) => entry.status === "joined" ? { ...entry, status: "crashed" } : entry);
      game.revision += 1;
      const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
      return {
        session,
        config: currentConfig
      };
    }

    const liveMultiplier = getDragonLiveMultiplier(game, now);
    const requestedMultiplier = Number(meta.clientMultiplier);
    const multiplier = Number.isFinite(requestedMultiplier) && requestedMultiplier >= 1
      ? roundMultiplier(Math.min(liveMultiplier, requestedMultiplier))
      : liveMultiplier;

    participant.status = "cashed_out";
    participant.cashoutMultiplier = multiplier;
    participant.cashoutValue = roundCoinValue(game.baseStake * multiplier);
    game.revision += 1;

    const session = await updateMessage(scopeKey, current.id, { ...current, content: game });
    return {
      session,
      config: currentConfig
    };
  }

  return {
    session: { ...current, content: game },
    config: currentConfig
  };
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

async function getDragonConfig(scopeKey) {
  const channels = await listScopeChannels(scopeKey);
  const configs = Object.values(channels || {})
    .flat()
    .filter((message) => message?.channelId === DRAGON_CHANNEL_ID && message?.type === DRAGON_CONFIG_TYPE);

  if (!configs.length) {
    return normalizeDragonConfig(DEFAULT_DRAGON_CONFIG);
  }

  const latest = [...configs].sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))[0];
  return normalizeDragonConfig(latest.content);
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

function normalizeDragonConfig(config) {
  const next = config || {};
  return {
    lobbyMs: Math.min(60000, Math.max(1000, Math.round(Number(next.lobbyMs ?? DEFAULT_DRAGON_CONFIG.lobbyMs)))),
    speedFactor: Math.min(5, Math.max(0.1, Math.round(Number(next.speedFactor ?? DEFAULT_DRAGON_CONFIG.speedFactor) * 100) / 100)),
    testMode: Boolean(next.testMode),
    testMaxMultiplier: Math.min(100, Math.max(1.1, Math.round(Number(next.testMaxMultiplier ?? DEFAULT_DRAGON_CONFIG.testMaxMultiplier) * 100) / 100))
  };
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

  const elapsedSeconds = Math.max(0, now - game.startedAtMs) / 1000;
  const effectiveElapsed = elapsedSeconds * game.config.speedFactor;
  const multiplier = 1 + (effectiveElapsed * 0.09) + (effectiveElapsed * effectiveElapsed * 0.03);
  return roundMultiplier(Math.min(game.crashAtMultiplier, multiplier));
}

function shouldDragonCrash(gameState, now = Date.now()) {
  return hasDragonCrashedByNow(gameState, now);
}

function hasDragonCrashedByNow(gameState, now = Date.now()) {
  const game = typeof gameState?.game === "string" ? gameState : normalizeDragonState(gameState, now);
  if (game.status === "crashed" || now < game.launchAtMs) return false;

  const elapsedSeconds = Math.max(0, now - game.startedAtMs) / 1000;
  const effectiveElapsed = elapsedSeconds * game.config.speedFactor;
  const multiplier = 1 + (effectiveElapsed * 0.09) + (effectiveElapsed * effectiveElapsed * 0.03);
  return multiplier >= game.crashAtMultiplier;
}

function generateDragonCrashMultiplier(config = DEFAULT_DRAGON_CONFIG) {
  const normalizedConfig = normalizeDragonConfig(config);
  if (normalizedConfig.testMode) {
    const range = Math.max(0.05, normalizedConfig.testMaxMultiplier - 1);
    return roundMultiplier(1 + Math.random() * range);
  }

  const raw = 0.99 / Math.max(0.04, 1 - Math.random());
  return roundMultiplier(Math.max(1.15, Math.min(25, raw)));
}

function roundMultiplier(value) {
  return Math.round(Number(value || 1) * 100) / 100;
}

function roundCoinValue(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
