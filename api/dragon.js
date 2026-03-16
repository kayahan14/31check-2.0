import { appendMessage, listScopeChannels, updateMessage } from "../server/storage.js";

const DRAGON_CHANNEL_ID = "casino:dragon";
const DRAGON_TYPE = "dragon_state";
const BASE_STAKE = 100;
const LOBBY_MS = 10000;

globalThis.__dragonQueues ||= {};

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if (req.method === "GET") {
      const scopeKey = String(req.query.scopeKey || "local-preview");
      const session = await getCurrentDragonSession(scopeKey);
      res.status(200).json({ ok: true, session });
      return;
    }

    if (req.method === "POST") {
      const { scopeKey = "local-preview", action, actor } = req.body || {};
      if (!action) {
        res.status(400).json({ error: "action is required." });
        return;
      }
      const session = await withDragonQueue(scopeKey, async () => mutateDragonSession(scopeKey, action, actor));
      res.status(200).json({ ok: true, session });
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

async function mutateDragonSession(scopeKey, action, actor) {
  const current = await getCurrentDragonSession(scopeKey);
  const normalizedActor = {
    id: String(actor?.id || "user"),
    name: String(actor?.name || "Oyuncu")
  };
  const now = Date.now();

  if (!current || getDragonPhase(current.content, now) === "finished") {
    if (action !== "start") {
      return current;
    }
    const message = makeDragonMessage(normalizedActor, now);
    return appendMessage(scopeKey, DRAGON_CHANNEL_ID, message);
  }

  const game = normalizeDragonState(current.content, now);

  if (action === "start") {
    if (getDragonPhase(game, now) === "lobby" && !game.participants.some((entry) => entry.id === normalizedActor.id)) {
      game.participants.push(makeParticipant(normalizedActor));
      game.revision += 1;
      return updateMessage(scopeKey, current.id, { ...current, content: game });
    }
    return current;
  }

  if (action === "join") {
    if (getDragonPhase(game, now) !== "lobby") return { ...current, content: game };
    if (!game.participants.some((entry) => entry.id === normalizedActor.id)) {
      game.participants.push(makeParticipant(normalizedActor));
      game.revision += 1;
      return updateMessage(scopeKey, current.id, { ...current, content: game });
    }
    return { ...current, content: game };
  }

  if (action === "cashout") {
    if (getDragonPhase(game, now) !== "playing") return { ...current, content: game };
    const participant = game.participants.find((entry) => entry.id === normalizedActor.id);
    if (!participant || participant.status !== "joined") {
      return { ...current, content: game };
    }
    if (shouldDragonCrash(game, now)) {
      game.status = "crashed";
      game.finalMultiplier = roundMultiplier(game.crashAtMultiplier);
      game.resultSummary = "EJDERHA PATLADI 💥";
      game.participants = game.participants.map((entry) => entry.status === "joined" ? { ...entry, status: "crashed" } : entry);
      game.revision += 1;
      return updateMessage(scopeKey, current.id, { ...current, content: game });
    }
    const multiplier = getDragonLiveMultiplier(game, now);
    participant.status = "cashed_out";
    participant.cashoutMultiplier = multiplier;
    participant.cashoutValue = roundCoinValue(game.baseStake * multiplier);
    game.revision += 1;
    return updateMessage(scopeKey, current.id, { ...current, content: game });
  }

  return { ...current, content: game };
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

function makeDragonMessage(actor, now) {
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
      launchAtMs: now + LOBBY_MS,
      startedAtMs: now + LOBBY_MS,
      crashAtMultiplier: generateDragonCrashMultiplier(),
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
  game.launchAtMs = Number(game.launchAtMs) > 0 ? Number(game.launchAtMs) : now + LOBBY_MS;
  game.startedAtMs = Number(game.startedAtMs) > 0 ? Number(game.startedAtMs) : game.launchAtMs;
  game.crashAtMultiplier = Number(game.crashAtMultiplier) > 1 ? Number(game.crashAtMultiplier) : generateDragonCrashMultiplier();
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
    return roundMultiplier(game.finalMultiplier || game.crashAtMultiplier || 1);
  }
  if (now < game.launchAtMs) {
    return 1;
  }
  const elapsedSeconds = Math.max(0, now - game.startedAtMs) / 1000;
  const multiplier = 1 + (elapsedSeconds * 0.09) + (elapsedSeconds * elapsedSeconds * 0.03);
  return roundMultiplier(Math.min(game.crashAtMultiplier, multiplier));
}

function shouldDragonCrash(gameState, now = Date.now()) {
  return hasDragonCrashedByNow(gameState, now);
}

function hasDragonCrashedByNow(gameState, now = Date.now()) {
  const game = typeof gameState?.game === "string" ? gameState : normalizeDragonState(gameState, now);
  if (game.status === "crashed" || now < game.launchAtMs) return false;

  const elapsedSeconds = Math.max(0, now - game.startedAtMs) / 1000;
  const multiplier = 1 + (elapsedSeconds * 0.09) + (elapsedSeconds * elapsedSeconds * 0.03);
  return multiplier >= game.crashAtMultiplier;
}

function generateDragonCrashMultiplier() {
  const raw = 0.99 / Math.max(0.04, 1 - Math.random());
  return roundMultiplier(Math.max(1.15, Math.min(25, raw)));
}

function roundMultiplier(value) {
  return Math.round(Number(value || 1) * 100) / 100;
}

function roundCoinValue(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
