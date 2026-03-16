import { appendMessage, listScopeChannels, updateMessage } from "../server/storage.js";

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (req.method === "GET") {
      const scopeKey = String(req.query.scopeKey || "local-preview");
      const channels = await listScopeChannels(scopeKey);

      res.status(200).json({
        scopeKey,
        channels
      });
      return;
    }

    if (req.method === "POST") {
      const { scopeKey = "local-preview", channelId, message } = req.body || {};

      if (!channelId || !message || !message.id) {
        res.status(400).json({ error: "channelId and message are required." });
        return;
      }

      const storedMessage = await appendMessage(scopeKey, channelId, message);

      res.status(201).json({ ok: true, message: storedMessage });
      return;
    }

    if (req.method === "PATCH") {
      const { scopeKey = "local-preview", messageId, message, actionType, actor } = req.body || {};

      if (actionType) {
        if (!messageId) {
          res.status(400).json({ error: "messageId is required." });
          return;
        }

        const storedMessage = await applyInteractiveAction(scopeKey, messageId, actionType, actor);
        res.status(200).json({ ok: true, message: storedMessage });
        return;
      }

      if (!messageId || !message || !message.id) {
        res.status(400).json({ error: "messageId and message are required." });
        return;
      }

      const storedMessage = await updateMessage(scopeKey, messageId, message);

      res.status(200).json({ ok: true, message: storedMessage });
      return;
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({
      error: "Message storage failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function applyInteractiveAction(scopeKey, messageId, actionType, actor) {
  const channels = await listScopeChannels(scopeKey);
  const currentMessage = Object.values(channels || {}).flat().find((entry) => entry?.id === messageId);
  if (!currentMessage) {
    throw new Error("Message not found.");
  }

  if (currentMessage.type !== "dragon") {
    return currentMessage;
  }

  const nextMessage = {
    ...currentMessage,
    content: applyDragonAction(currentMessage.content, actionType, actor)
  };

  return updateMessage(scopeKey, messageId, nextMessage);
}

function applyDragonAction(content, actionType, actor) {
  const game = normalizeDragonState(content);
  const currentActor = normalizeActor(actor);
  const now = Date.now();
  let changed = false;

  if (game.status !== "crashed" && now >= game.launchAtMs) {
    game.status = "playing";
    changed = true;
  }

  if (game.status === "playing" && shouldDragonCrash(game, now)) {
    game.status = "crashed";
    game.finalMultiplier = roundMultiplier(game.crashAtMultiplier);
    game.collectible = 0;
    game.resultSummary = "EJDERHA PATLADI 💥";
    game.participants = game.participants.map((entry) => (
      entry.status === "joined"
        ? { ...entry, status: "crashed", cashoutMultiplier: 0, cashoutValue: 0 }
        : entry
    ));
    changed = true;
  }

  if (actionType === "dragon_join") {
    if (game.status === "lobby" && !game.participants.some((entry) => entry.id === currentActor.id)) {
      game.participants.push({
        id: currentActor.id,
        name: currentActor.name,
        status: "joined",
        cashoutMultiplier: 0,
        cashoutValue: 0
      });
      changed = true;
    }
  }

  if (actionType === "dragon_collect") {
    const participant = game.participants.find((entry) => entry.id === currentActor.id);
    if (participant && participant.status === "joined" && game.status === "playing" && !shouldDragonCrash(game, now)) {
      const multiplier = getDragonLiveMultiplier(game, now);
      participant.status = "cashed_out";
      participant.cashoutMultiplier = multiplier;
      participant.cashoutValue = roundCoinValue(game.baseStake * multiplier);
      changed = true;
    }
  }

  if (!changed) {
    return game;
  }

  game.revision = Number(game.revision || 0) + 1;
  return game;
}

function normalizeDragonState(content) {
  const game = typeof content === "string" ? JSON.parse(content) : structuredClone(content || {});
  game.game ||= "dragon";
  game.revision = Number(game.revision) > 0 ? Number(game.revision) : 1;
  game.status ||= "lobby";
  game.baseStake = Number(game.baseStake) > 0 ? Number(game.baseStake) : 100;
  game.launchAtMs = Number(game.launchAtMs) > 0 ? Number(game.launchAtMs) : Date.now() + 5000;
  game.startedAtMs = Number(game.startedAtMs) > 0 ? Number(game.startedAtMs) : game.launchAtMs;
  game.crashAtMultiplier = Number(game.crashAtMultiplier) > 1 ? Number(game.crashAtMultiplier) : 1.5;
  game.finalMultiplier = Number(game.finalMultiplier) > 0 ? Number(game.finalMultiplier) : 1;
  game.collectible = Number(game.collectible) >= 0 ? Number(game.collectible) : 0;
  game.resultSummary ||= "";
  game.participants = Array.isArray(game.participants) ? game.participants.map((entry) => ({
    id: entry?.id || "user",
    name: entry?.name || "Oyuncu",
    status: entry?.status || "joined",
    cashoutMultiplier: Number(entry?.cashoutMultiplier) > 0 ? Number(entry.cashoutMultiplier) : 0,
    cashoutValue: Number(entry?.cashoutValue) > 0 ? Number(entry.cashoutValue) : 0
  })) : [];
  return game;
}

function normalizeActor(actor) {
  return {
    id: String(actor?.id || "user"),
    name: String(actor?.name || "Oyuncu")
  };
}

function getDragonLiveMultiplier(gameState, now = Date.now()) {
  const game = normalizeDragonState(gameState);
  if (now < game.launchAtMs) {
    return 1;
  }
  const elapsedSeconds = Math.max(0, now - game.startedAtMs) / 1000;
  const multiplier = 1 + (elapsedSeconds * 0.18) + (elapsedSeconds * elapsedSeconds * 0.06);
  return roundMultiplier(Math.min(game.crashAtMultiplier, multiplier));
}

function shouldDragonCrash(gameState, now = Date.now()) {
  const game = normalizeDragonState(gameState);
  if (game.status !== "playing") return false;
  return getDragonLiveMultiplier(game, now) >= game.crashAtMultiplier;
}

function roundMultiplier(value) {
  return Math.round(Number(value || 1) * 100) / 100;
}

function roundCoinValue(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
