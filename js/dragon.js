import { state, isCasinoDragonView, normalizeDragonAutoCashoutTarget } from "./state.js";
import { cloneData, formatMultiplier, escapeHtml, roundCoinValue, uid } from "./utils.js";
import {
  DRAGON_BASE_STAKE, DRAGON_SPEED_STAGES, DRAGON_ALL_CASHED_OUT_SPEED,
  DRAGON_TICK_MS, DRAGON_CHANNEL_ID
} from "./constants.js";
import { DEFAULT_DRAGON_CONFIG, normalizeDragonConfig } from "../shared/dragon-config.js";
// To avoid circular dependency initially, these will be injected or imported from app.js
import { render, getVisibleMessagesForChannel, selectedChannel, performDragonAction, handleDragonHubAction, findMessageById, closeDragonModal } from "./app.js";


// ── State Yönetimi ─────────────────────────────────────────────────

export function createDragonGameState() {
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

export function normalizeDragonState(content) {
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

// ── Sunucu/Hesaplama Mantığı ───────────────────────────────────────

export function getDragonPhase(gameState, now = getDragonNow()) {
  const game = normalizeDragonState(gameState);
  if (game.status === "crashed") return "finished";
  if (now < game.launchAtMs) return "lobby";
  if (shouldDragonCrash(game, now)) return "finished";
  return "playing";
}

export function getDragonParticipant(gameState, userId) {
  const game = normalizeDragonState(gameState);
  return (game.participants || []).find((entry) => entry.id === userId) || null;
}

export function getDragonLiveMultiplier(gameState, now = getDragonNow()) {
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

export function getDragonDisplayMultiplier(gameState, phase = getDragonPhase(gameState)) {
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

export function applyOptimisticDragonCashout(session, userId, multiplier) {
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

export function shouldDragonCrash(gameState, now = getDragonNow()) {
  const game = normalizeDragonState(gameState);
  if (game.status === "crashed" || now < game.launchAtMs) return false;

  const effectiveElapsed = getDragonEffectiveElapsed(game, now);
  const multiplier = 1 + (effectiveElapsed * 0.09) + (effectiveElapsed * effectiveElapsed * 0.03);
  return multiplier >= game.crashAtMultiplier;
}

export function generateDragonCrashMultiplier(config = DEFAULT_DRAGON_CONFIG) {
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

export function getDragonCrashChance(config, multiplier, boosted = false) {
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

export function roundMultiplier(value) {
  return Math.round(Number(value || 1) * 100) / 100;
}

export function getDragonEffectiveElapsedForMultiplier(targetMultiplier) {
  const safeTarget = Math.max(1, Number(targetMultiplier || 1));
  const discriminant = (0.09 * 0.09) + (4 * 0.03 * (safeTarget - 1));
  return Math.max(0, (-0.09 + Math.sqrt(discriminant)) / (2 * 0.03));
}

export function getDragonBaseEffectiveElapsed(game, elapsedSeconds) {
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

export function getDragonEffectiveElapsed(game, now = getDragonNow()) {
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

export function getDragonSessionRenderKey(session) {
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

// ── Sunucu/Eşzamanlama ─────────────────────────────────────────────

export function syncDragonConfigFromServer(config, { overwriteDraft = true, updatedAtMs = 0 } = {}) {
  const nextUpdatedAtMs = Number(updatedAtMs || 0);
  if (nextUpdatedAtMs && nextUpdatedAtMs < Number(state.dragonConfigUpdatedAtMs || 0)) {
    return;
  }

  const normalized = normalizeDragonConfig(config);
  state.dragonConfig = normalized;
  if (nextUpdatedAtMs) {
    state.dragonConfigUpdatedAtMs = nextUpdatedAtMs;
  }
  if (overwriteDraft) {
    state.dragonConfigDraft = normalizeDragonConfig(normalized);
  }
}

export function mergeDragonSessionWithLocal(currentSession, incomingSession) {
  if (!currentSession || !incomingSession || currentSession.id !== incomingSession.id) {
    return incomingSession;
  }

  const currentGame = normalizeDragonState(currentSession.content);
  const incomingGame = normalizeDragonState(incomingSession.content);
  const currentRevision = Number(currentGame.revision || 0);
  const incomingRevision = Number(incomingGame.revision || 0);

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

export function applyDragonTransportPayload(payload, options = {}) {
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

export function syncDragonServerClock(serverNowMs) {
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

export function getDragonMonotonicLocalNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function getDragonNow(localNow = getDragonMonotonicLocalNow()) {
  const anchorLocalMs = Number(state.dragonServerClockLocalMs || 0);
  const anchorServerMs = Number(state.dragonServerClockServerMs || 0);
  if (anchorLocalMs > 0 && anchorServerMs > 0) {
    return anchorServerMs + Math.max(0, localNow - anchorLocalMs);
  }
  return Date.now();
}

export function getDragonRoundAutoSettings(session = state.dragonSession) {
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

// ── Geçmiş ve UI Yardımcıları ──────────────────────────────────────

export function normalizeDragonHistoryEntry(entry) {
  return {
    sessionId: String(entry?.sessionId || ""),
    multiplier: roundMultiplier(entry?.multiplier),
    crashed: Boolean(entry?.crashed),
    createdAtMs: Number(entry?.createdAtMs) || 0
  };
}

export function renderDragonHistoryPill(entry) {
  const item = normalizeDragonHistoryEntry(entry);
  return `<span class="dragon-history-pill ${dragonHistoryBandClass(item.multiplier)}">${escapeHtml(formatMultiplier(item.multiplier))}</span>`;
}

export function dragonHistoryBandClass(multiplier) {
  const value = Number(multiplier) || 1;
  if (value < 1.1) return "is-band-red";
  if (value < 1.5) return "is-band-amber";
  if (value < 2) return "is-band-yellow";
  if (value < 3) return "is-band-green";
  if (value < 10) return "is-band-cyan";
  return "is-band-violet";
}

// ── Zamanlayıcı (Tick) ve Modal Looop ────────────────────────────────

export function startDragonTicker() {
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

export function stopDragonTicker() {
  if (!state.dragonTickerHandle) return;
  window.clearInterval(state.dragonTickerHandle);
  state.dragonTickerHandle = null;
}

export function syncDragonModalLoop() {
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
      collectibleNode.textContent = `${collectible} coin`;
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

export function stopDragonModalLoop() {
  if (!state.dragonModalRaf) return;
  window.cancelAnimationFrame(state.dragonModalRaf);
  state.dragonModalRaf = 0;
}
