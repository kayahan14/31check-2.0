import { state, isCasinoMiningView, saveMiningAdminModePreference, saveMiningZoomPreference } from './state.js';
import { cloneData, uid, escapeHtml, formatCoinValue, clamp, formatDurationLabel, parseCsv } from './utils.js';
import {
  MINING_ACTION_TICK_MS, MINING_MIN_ZOOM, MINING_MAX_ZOOM, MINING_DEFAULT_ZOOM,
  MINING_BASE_VISIBLE_TILES, MINING_FOW_ENABLED, MINING_SHOP_ITEMS, MINING_SLOT_KEYS,
  OFFLINE_MODE
} from './constants.js';
import {
  MINING_CHANNEL_ID,
  MINING_TARGET_RUN_MS,
  MINING_TILE_SIZE,
  MINING_VIEW_RADIUS,
  advanceMiningSession, attackMiningMole, abandonMiningPlayer, extractMiningPlayer,
  getMiningCurrentPlayer, getMiningPhase, getMiningTile, getMiningVisibleTiles,
  mineMiningTile, moveMiningPlayer, normalizeMiningProfile, normalizeMiningSession,
  renderMiningTextState, createMiningSession, joinMiningSession, MINING_DEFAULT_CONFIG,
  normalizeMiningConfig
} from '../shared/mining-core.js';
import {
  render, showToast, buildGameApiUrl, getMiningScopeKey
} from './app.js';

export function stopMiningSessionSync() {
  if (!state.miningSessionSyncHandle) return;
  window.clearInterval(state.miningSessionSyncHandle);
  state.miningSessionSyncHandle = null;
}

export function startMiningUiTicker() {
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

export function stopMiningUiTicker() {
  if (!state.miningUiTickerHandle) return;
  window.clearInterval(state.miningUiTickerHandle);
  state.miningUiTickerHandle = null;
}

export function applyMiningTransportPayload(payload, options = {}) {
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
  if (nextSession?.content?.config) {
    state.miningConfig = normalizeMiningConfig(nextSession.content.config);
  }
  if (MINING_FOW_ENABLED && nextSession) {
    if (nextSession.id !== state.miningDiscoverySessionId) {
      state.miningDiscovery = new Set();
      state.miningDiscoverySessionId = nextSession.id;
      state.miningDiscoveryInitialized = false;
    }
    if (!state.miningDiscoveryInitialized && nextSession.content?.map?.size > 0) {
      const center = Math.floor(nextSession.content.map.size / 2);
      updateMiningDiscovery(center, center, state.miningConfig.spawnRevealRadius || 8);
      state.miningDiscoveryInitialized = true;
    }
  }
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

export function syncMiningVisualState(session, now = getMiningNow()) {
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
  // Camera smooth logic was moved to tickMiningCanvasFrame for 60fps tracking.
}

export function startMiningCanvasLoop() {
  if (state.miningCanvasRaf) return;
  state.miningCanvasLastFrameAtMs = 0;
  state.miningCanvasRaf = window.requestAnimationFrame(tickMiningCanvasFrame);
}

export function stopMiningCanvasLoop() {
  if (!state.miningCanvasRaf) return;
  window.cancelAnimationFrame(state.miningCanvasRaf);
  state.miningCanvasRaf = 0;
  state.miningCanvasLastFrameAtMs = 0;
}

export function requestMiningCanvasFrame() {
  const canvas = document.getElementById("miningCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  startMiningCanvasLoop();
}

export function updateMiningDiscovery(centerX, centerY, radius) {
  if (!MINING_FOW_ENABLED || !state.miningDiscovery) return;
  const r = Math.floor(radius);
  const cx = Math.floor(centerX);
  const cy = Math.floor(centerY);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      state.miningDiscovery.add(`${x},${y}`);
    }
  }
}

export function tickMiningCanvasFrame(frameAtMs) {
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

  const session = state.miningSession?.content;
  if (session && getMiningPhase(session) === "active") {
    advanceMiningSession(session, getMiningNow());

    const localPlayer = getMiningCurrentPlayer(session, state.currentUser.id);
    const localVisual = state.miningVisualPlayers?.[state.currentUser.id];
    if (localPlayer && localVisual) {
      // Smoothly interpolate the visual position instead of snapping
      const ease = 1 - Math.exp(-deltaMs / 40);
      localVisual.x += (localPlayer.x - localVisual.x) * ease;
      localVisual.y += (localPlayer.y - localVisual.y) * ease;

      localVisual.targetX = localPlayer.targetX;
      localVisual.targetY = localPlayer.targetY;
      localVisual.facing = localPlayer.facing;

      localVisual.lastAction = localPlayer.lastAction;
      if (localPlayer.lastActionAtMs > (localVisual.lastActionAtMs || 0)) {
        localVisual.lastActionAtMs = localPlayer.lastActionAtMs;
      }
    }
  }

  advanceMiningVisualState(deltaMs);

  // Smooth 60fps+ camera follow
  const currentVisual = state.miningVisualPlayers?.[state.currentUser.id];
  if (currentVisual) {
    const deadzone = 1.0;
    const dx = currentVisual.x - state.miningCameraX;
    const dy = currentVisual.y - state.miningCameraY;
    const cameraEase = 1 - Math.exp(-deltaMs / 120); // Smooth glide

    if (Math.abs(dx) > deadzone) {
      state.miningCameraX += (dx - Math.sign(dx) * deadzone) * cameraEase;
    }
    if (Math.abs(dy) > deadzone) {
      state.miningCameraY += (dy - Math.sign(dy) * deadzone) * cameraEase;
    }
  }

  renderMiningCanvas(canvas);
  state.miningCanvasRaf = window.requestAnimationFrame(tickMiningCanvasFrame);
}

export function advanceMiningVisualState(deltaMs) {
  for (const entry of Object.values(state.miningVisualPlayers || {})) {
    if (!entry) continue;

    if (entry.id === state.currentUser.id) continue;

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

    if (entry.id !== state.currentUser.id) {
      const serverDx = Number(entry.serverX ?? entry.x) - entry.x;
      const serverDy = Number(entry.serverY ?? entry.y) - entry.y;
      const serverDist = Math.sqrt(serverDx * serverDx + serverDy * serverDy);
      if (serverDist > 0.5 && serverDist < 5) {
        const correction = 1 - Math.exp(-deltaMs / 250);
        entry.x += serverDx * correction;
        entry.y += serverDy * correction;
      }
    }
  }

  const localVisual = state.miningVisualPlayers[state.currentUser.id] || null;
  if (!localVisual) return;

  if (state.miningAutoAction) {
    const aa = state.miningAutoAction;
    const tileCX = (aa.tileX ?? aa.x) + 0.5;
    const tileCY = (aa.tileY ?? aa.y) + 0.5;
    const distToTarget = Math.sqrt((localVisual.x - tileCX) ** 2 + ((localVisual.y + 0.24) - tileCY) ** 2);
    if (distToTarget <= 1.6) {
      const action = aa.type;
      const session = state.miningSession?.content;

      if (action === "mine") {
        const tile = session.map ? getMiningTile(session.map, aa.tileX, aa.tileY) : null;
        if (!tile || tile.kind !== "wall") {
          state.miningAutoAction = null;
          return;
        }
      } else if (action === "attack") {
        const mole = (session.moles || []).find(m => m.id === aa.targetId);
        if (!mole || mole.hp <= 0) {
          state.miningAutoAction = null;
          return;
        }
      }

      const meta = action === "mine" ? { x: aa.x, y: aa.y } : { targetId: aa.targetId };
      const now = Date.now();
      if (!localVisual.lastActionAtMs || now - localVisual.lastActionAtMs > 250) { // Throttle client-side
        void performMiningAction(action, meta, { silent: true });
        localVisual.lastActionAtMs = now;
      }
      if (action === "extract") state.miningAutoAction = null;
    }
  }

}

export function getMiningTransportRenderKey(sessionRecord, profile) {
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

export async function handleMiningUiAction(action) {
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
  if (action === "toggle-admin-mode") {
    state.miningAdminMode = !state.miningAdminMode;
    saveMiningAdminModePreference(state.miningAdminMode);
    const session = state.miningSession?.content;
    const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
    if (player) player.isAdminMode = state.miningAdminMode;
    render();
    return;
  }
  if (action === "start_lobby" || action === "join_lobby" || action === "extract") {
    await performMiningAction(action);
  }
  if (action === "enter-map") {
    state.miningViewTab = "map";
    render();
    return;
  }
  if (action === "leave_session") {
    await performMiningAction("extract");
  }
}

export async function performMiningAction(action, meta = {}, options = {}) {
  const { silent = false } = options;

  if (action === "start_lobby" || action === "join_lobby") {
    if (OFFLINE_MODE) {
      if (action === "start_lobby") {
        const session = { id: "local-session", content: normalizeMiningSession(createMiningSession(state.currentUser, state.miningProfile, state.miningConfig)) };
        state.miningSession = session;
        if (MINING_FOW_ENABLED) {
          state.miningDiscovery = new Set();
          state.miningDiscoverySessionId = session.id;
          const mapSize = session.content.map?.size || 0;
          if (mapSize > 0) {
            const center = Math.floor(mapSize / 2);
            updateMiningDiscovery(center, center, session.content.config?.spawnRevealRadius || 5);
          }
        }
      } else if (action === "join_lobby" && state.miningSession?.content) {
        joinMiningSession(state.miningSession.content, state.currentUser, state.miningProfile?.loadout, Date.now());
      }
      syncMiningVisualState(state.miningSession?.content);
      if (!silent) showToast(action === "start_lobby" ? "Maden olusturuldu (Offline)" : "Kaziya katildin (Offline)");
      render();
      return { session: state.miningSession };
    }

    try {
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
          config: state.miningConfig,
          ...meta
        })
      });
      if (!response.ok) throw new Error("Mining action failed.");
      const payload = await response.json();
      applyMiningTransportPayload(payload, { forceRender: true });
      if (payload.errorCode) {
        const label = translateMiningError(payload.errorCode);
        // if (label && !silent) showToast(label); // Removed showToast as per instruction
      }
      return payload;
    } catch (error) {
      console.warn("Mining action failed.", error);
      if (!silent) showToast("Mining istegi basarisiz.");
      return null;
    }
  }

  const session = state.miningSession?.content;
  if (!session || session.status !== "active") {
    if (!silent) showToast("Aktif bir maden yok.");
    return null;
  }

  const playerId = state.currentUser.id;
  const now = Date.now();
  let changed = false;
  let errorCode = "";

  if (session) {
    const player = getMiningCurrentPlayer(session, playerId);
    if (player) player.isAdminMode = !!state.miningAdminMode;
  }

  advanceMiningSession(session, now);

  if (action === "move") {
    const result = moveMiningPlayer(session, playerId, Number(meta.targetX ?? 0), Number(meta.targetY ?? 0), now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (changed) {
      const player = getMiningCurrentPlayer(session, playerId);
      if (player) {
        sendMiningWs("mining_position", {
          x: player.x,
          y: player.y,
          targetX: player.targetX,
          targetY: player.targetY,
          facing: player.facing,
          speed: player.speed
        });
      }
    }
  } else if (action === "mine") {
    const result = mineMiningTile(session, playerId, Math.round(Number(meta.x ?? 0)), Math.round(Number(meta.y ?? 0)), now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (changed) {
      if (result.tileBroken) {
        updateMiningDiscovery(Math.round(Number(meta.x ?? 0)), Math.round(Number(meta.y ?? 0)), session.config?.mineRevealRadius || 1);
      }
      sendMiningWs("mining_action", { action: "mine", data: { x: meta.x, y: meta.y } });
    }
  } else if (action === "attack") {
    const result = attackMiningMole(session, playerId, meta.targetId, now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (changed) {
      sendMiningWs("mining_action", { action: "attack", data: { targetId: meta.targetId } });
    }
  } else if (action === "extract") {
    const result = extractMiningPlayer(session, playerId, now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (changed) {
      sendMiningWs("mining_action", { action: "extract", data: {} });
    }
  } else if (action === "abandon") {
    const result = abandonMiningPlayer(session, playerId, now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (changed) {
      sendMiningWs("mining_action", { action: "abandon", data: {} });
    }
  }

  if (errorCode) {
    const label = translateMiningError(errorCode);
    if (label) {
      if (!silent || (errorCode !== "cooldown" && errorCode !== "range" && errorCode !== "invalid-target")) {
        showToast(label);
      }
    }
  }

  if (changed) {
    syncMiningVisualState(session);
    requestMiningCanvasFrame();
    if (!updateMiningActiveStageDom({ repaintCanvas: true })) {
      render();
    }
  }

  const bufferedInput = state.miningBufferedInput;
  if (bufferedInput) {
    state.miningBufferedInput = null;
    window.setTimeout(() => {
      void dispatchMiningCanvasIntent(bufferedInput);
    }, 0);
  }

  return { ok: true };
}

export function sendMiningWs(type, payload) {
  const socket = state.miningRealtimeSocket;
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type, ...payload }));
}

export function translateMiningError(errorCode) {
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

export function renderMiningStageJoinAction(player) {
  const canJoin = !player && !["escaped", "collapsed"].includes(String(player?.status || ""));
  return canJoin
    ? `<button type="button" class="btn dragon-modal-action mining-join-action" data-mining-action="join_lobby">Katil</button>`
    : "";
}

export function renderMiningStageHudPills(session, activePlayer, now = getMiningNow()) {
  const joinedCount = session?.players?.length || 0;
  const collapseMsLeft = session?.collapseAtMs ? Math.max(0, session.collapseAtMs - now) : 0;
  const hardMsLeft = session?.hardCollapseAtMs ? Math.max(0, session.hardCollapseAtMs - now) : MINING_TARGET_RUN_MS;
  return `
    <span class="mining-pill">Toplanan ${escapeHtml(formatCoinValue(activePlayer?.runCoins || 0))}</span>
    <span class="mining-pill">Katilim ${escapeHtml(String(joinedCount))}</span>
    <span class="mining-pill">Cikis ${escapeHtml(String((session?.discoveredExitIds || []).length))}/2</span>
    <span class="mining-pill">Hedef ${escapeHtml(formatDurationLabel(hardMsLeft))}</span>
    <span class="mining-pill ${session?.collapseAtMs ? "is-danger" : ""}">${escapeHtml(session?.collapseAtMs ? `Cokus ${formatDurationLabel(collapseMsLeft)}` : "Cikis araniyor")}</span>
  `;
}

export function renderMiningSummaryText(session, now = getMiningNow()) {
  if (session?.currentEvent) {
    return `${session.currentEvent.label} ${formatDurationLabel(session.currentEvent.expiresAtMs - now)}`;
  }
  return session?.summary || "Magarada ilerle, damarlari kir, cikis ara.";
}

export function bindMiningActionButtons(root = document) {
  root.querySelectorAll("[data-mining-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.miningAction;
      if (!action) return;
      await handleMiningUiAction(action);
    });
  });
}

export function updateMiningActiveStageDom({ repaintCanvas = false } = {}) {
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

  const healthContainer = document.getElementById("miningHealthBarContainer");
  const healthFill = document.getElementById("miningHealthBarFill");
  const healthText = document.getElementById("miningHealthBarText");
  if (healthContainer) {
    if (activePlayer) {
      healthContainer.style.display = "flex";
      const hp = Math.max(0, Math.round(Number(activePlayer.integrity ?? 100)));
      if (healthFill) {
        healthFill.style.width = `${hp}%`;
        healthFill.style.background = hp <= 30 ? "#f04747" : (hp <= 60 ? "#faa61a" : "#43b581");
      }
      if (healthText) healthText.textContent = `${hp}%`;
    } else {
      healthContainer.style.display = "none";
    }
  }

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

export function renderMiningRealtimeView() {
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

  const showMap = isActiveRun && tab === "map";

  const menu = !showMap ? `
    <div class="mining-menu-switch">
      <button type="button" class="mining-menu-tab ${tab === "entrance" || tab === "map" ? "active" : ""}" data-mining-action="show-entrance">Magara</button>
      <button type="button" class="mining-menu-tab ${tab === "inventory" ? "active" : ""}" data-mining-action="show-inventory">Envanter</button>
      <button type="button" class="mining-menu-tab ${tab === "shop" ? "active" : ""}" data-mining-action="show-shop">Dukkan</button>
    </div>
  ` : "";

  if (!session || isFinished || !showMap) {
    const isLoss = phase === "collapsed";
    const isWin = phase === "finished";

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
              ${tab === "entrance" || tab === "map" ? `
                <div class="mining-hero-copy">
                  <strong>${isActiveRun ? "Aktif magara acik" : "Yeni magara hazirla"}</strong>
                  <p>${isActiveRun ? "Su an iceride devam eden bir kazi var. Hemen katilabilirsin." : "Magara kapanmadan cikabilirsen coinler cebe gider. Cikis bulunduğu anda geri sayim baslar."}</p>
                </div>
                ${isActiveRun ? `
                  <button type="button" class="btn btn-primary" data-mining-action="enter-map">Magaraya Gir</button>
                ` : `
                  <button type="button" class="btn dragon-modal-action" data-mining-action="start_lobby">Magarayi Ac</button>
                `}
                ${session && isFinished ? `<div class="mining-summary-chip ${isLoss ? "is-loss" : "is-win"}">${escapeHtml(session.summary || "Son seans tamamlandi.")}</div>` : ""}
              ` : `
                ${renderMiningSecondaryPanel(tab, profile)}
              `}
            </div>
            <div class="mining-card">
              ${tab === "entrance" || tab === "map" ? renderMiningSecondaryPanel("info", profile) : renderMiningSecondaryPanel("info", profile)}
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
              <div id="miningHealthBarContainer" class="mining-health-container" style="${activePlayer ? 'display:flex;' : 'display:none;'}">
                <div class="mining-health-fill-bg">
                  <div id="miningHealthBarFill" class="mining-health-fill" style="width: ${activePlayer?.integrity ?? 100}%; background: ${activePlayer?.integrity <= 30 ? '#f04747' : ((activePlayer?.integrity ?? 100) <= 60 ? '#faa61a' : '#43b581')};"></div>
                </div>
                <span id="miningHealthBarText">${Math.round(activePlayer?.integrity ?? 100)}%</span>
              </div>
              <div id="miningStageSubtitle" class="mining-stage-subtitle">${escapeHtml(activePlayer ? "Tikladigin hedefe akici sekilde ilerle. Damara vurunca kendin kazmaya devam edersin." : "Aktif magara acik. Istedigin an iceri dalabilirsin.")}</div>
              <div id="miningRoster" class="mining-roster compact">${renderMiningRoster(session.players || [])}</div>
            </div>
            <div class="mining-stage-overlay mining-stage-overlay-right">
              <div id="miningStageHud" class="mining-stage-hud">${renderMiningStageHudPills(session, activePlayer)}</div>
              <div id="miningJoinActionHost">${joinAction}</div>
              <button type="button" class="btn ${state.miningAdminMode ? 'btn-primary' : 'mining-exit-btn'} admin-toggle-btn" data-mining-action="toggle-admin-mode" title="Admin Modunu Acar/Kapatir">${state.miningAdminMode ? 'Admin: ON' : 'Admin: OFF'}</button>
              <button type="button" class="btn mining-exit-btn" data-mining-action="leave_session">Cikis</button>
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

export function renderMiningSecondaryPanel(tab, profile) {
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

export function renderMiningRoster(players) {
  if (!players.length) {
    return '<div class="mining-roster-empty">Henuz madenci yok.</div>';
  }
  return players.map((entry) => {
    const tone = entry.status === "escaped" ? "is-win" : entry.status === "collapsed" ? "is-loss" : "";
    return `<span class="mining-roster-pill ${tone}">${escapeHtml(entry.name)} · ${escapeHtml(entry.status === "queued" ? "hazir" : entry.status === "active" ? `${entry.runCoins}c` : entry.status)}</span>`;
  }).join("");
}

export function renderMiningCanvas(canvas) {
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

  // Kamera takibi: Takip aktifse Manuel pozisyonu oyuncuyla senkronize et
  if (state.miningCameraFollowPlayer && player) {
    state.miningCameraManualX = player.x;
    state.miningCameraManualY = player.y;
  }

  const metrics = getMiningCanvasMetrics(canvas, session, player);

  drawMiningBackdrop(context, metrics, now);

  const startX = Math.floor(metrics.worldStartX) - 1;
  const startY = Math.floor(metrics.worldStartY) - 1;
  const endX = Math.ceil(metrics.worldStartX + metrics.visibleWidthTiles) + 1;
  const endY = Math.ceil(metrics.worldStartY + metrics.visibleHeightTiles) + 1;

  // Draw exit light glows underneath tiles
  for (let ty = startY; ty <= endY; ty++) {
    for (let tx = startX; tx <= endX; tx++) {
      const tile = getMiningTile(map, tx, ty);
      if (tile && (tile.kind === "exit" || tile.hiddenExitId)) {
        const rect = getMiningTileScreenRect(metrics, tx, ty);
        if (rect) {
          context.save();
          // Increase radius from 2.5 to 5.0 for 10x10 area
          const radius = rect.size * 5.0;
          const gradient = context.createRadialGradient(
            rect.centerX, rect.centerY, 0,
            rect.centerX, rect.centerY, radius
          );
          gradient.addColorStop(0, "rgba(255, 255, 255, 0.45)");
          gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(rect.centerX, rect.centerY, radius, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }
      }
    }
  }

  for (let tileY = startY; tileY <= endY; tileY += 1) {
    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const tile = getMiningTile(map, tileX, tileY);
      if (!tile) continue;
      if (tile.kind === "wall" && tile.oreId) {
        drawMiningWallTile(context, metrics, tileX, tileY, tile, now);
      } else if (tile.kind === "exit" || (state.miningAdminMode && tile.hiddenExitId)) {
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

  if (!state.miningAdminMode && MINING_FOW_ENABLED && state.miningDiscovery) {
    if (player) {
      updateMiningDiscovery(Math.floor(player.x), Math.floor(player.y), state.miningConfig?.moveRevealRadius || 1);
    }
    context.save();
    const tilePx = metrics.tilePx;
    context.fillStyle = "#17131a"; // Solid block color

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        if (!state.miningDiscovery.has(`${tx},${ty}`)) {
          const sx = (tx - metrics.worldStartX) * tilePx;
          const sy = (ty - metrics.worldStartY) * tilePx;
          context.fillRect(sx - 0.5, sy - 0.5, tilePx + 1, tilePx + 1);
        }
      }
    }
    context.restore();
  }
}

export function handleMiningCanvasClick(event) {
  event.preventDefault();
  const canvas = event.currentTarget;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session || !player || player.status !== "active" || !session.map) return;

  const isRightClick = event.button === 2;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  const localX = (event.clientX - rect.left) * scaleX;
  const localY = (event.clientY - rect.top) * scaleY;

  if (isRightClick) {
    state.miningDragging = true;
    state.miningDragMoved = false;
    state.miningDragStartX = event.clientX;
    state.miningDragStartY = event.clientY;
    state.miningDragStartAtMs = getMiningNow();

    // Su anki manuel kamerayi baslangic olarak al
    state.miningDragStartCamX = state.miningCameraManualX;
    state.miningDragStartCamY = state.miningCameraManualY;

    // Sag tiklandigi anda takibi durdur
    state.miningCameraFollowPlayer = false;
    return;
  }

  const metrics = getMiningCanvasMetrics(canvas, session, player);
  const worldX = metrics.worldStartX + (localX / metrics.tilePx);
  const clickWorldY = metrics.worldStartY + (localY / metrics.tilePx);
  const tileX = Math.floor(worldX);
  const tileY = Math.floor(clickWorldY);

  const targetX = worldX;
  const targetY = clickWorldY - 0.24; // karakterin merkezini degil ayaklarini hizala

  const dx = player.x - (tileX + 0.5);
  const dy = (player.y + 0.24) - (tileY + 0.5);
  const distToTile = Math.sqrt(dx * dx + dy * dy);

  state.miningClickRipple = { x: worldX, y: clickWorldY, startMs: getMiningNow() };

  const tile = getMiningTile(session.map, tileX, tileY);
  if (!tile) return;

  const mole = (session.moles || []).find((m) => m.x === tileX && m.y === tileY);

  if (mole) {
    state.miningAutoAction = { type: "attack", targetId: mole.id, tileX, tileY };
    if (distToTile > 1.6) void performMiningAction("move", { targetX, targetY }, { silent: true });
  } else if (tile.kind === "wall") {
    state.miningAutoAction = { type: "mine", x: tileX, y: tileY, tileX, tileY };
    if (distToTile > 1.6) void performMiningAction("move", { targetX, targetY }, { silent: true });
  } else if (tile.kind === "exit") {
    state.miningAutoAction = { type: "extract", x: tileX, y: tileY, tileX, tileY };
    if (distToTile > 1.6) void performMiningAction("move", { targetX, targetY }, { silent: true });
  } else {
    state.miningAutoAction = null;
    void performMiningAction("move", { targetX, targetY }, { silent: true });
  }
}

export function handleMiningCanvasGlobalMove(event) {
  if (!state.miningDragging) return;
  const dx = event.clientX - state.miningDragStartX;
  const dy = event.clientY - state.miningDragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    state.miningDragMoved = true;
  }

  const canvas = document.getElementById("miningCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session) return;

  const metrics = getMiningCanvasMetrics(canvas, session, player);
  const worldDx = dx / metrics.tilePx;
  const worldDy = dy / metrics.tilePx;

  state.miningCameraManualX = state.miningDragStartCamX - worldDx;
  state.miningCameraManualY = state.miningDragStartCamY - worldDy;
  state.miningCameraFollowPlayer = false;
  requestMiningCanvasFrame();
}

export function handleMiningCanvasGlobalUp(event) {
  if (!state.miningDragging) return;
  const elapsed = getMiningNow() - state.miningDragStartAtMs;
  state.miningDragging = false;

  // Eger cok kisa sureli basildiysa VE hic kaydirilmadiysa (tiklama): Takibi ac
  if (elapsed < 300 && !state.miningDragMoved) {
    state.miningCameraFollowPlayer = true;
    requestMiningCanvasFrame();
  }
}

export function handleMiningCanvasHover(event) {
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

export function handleMiningCanvasWheel(event) {
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


export function applyOptimisticMiningMove(targetX, targetY) {
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


export function clearMiningQueuedActions() {
  state.miningClickRipple = null;
  state.miningAutoAction = null;
}

export async function dispatchMiningCanvasIntent(intent) {
  // Kept for buffered input compatibility
  if (!intent) return;
  const session = state.miningSession?.content ? normalizeMiningSession(state.miningSession.content) : null;
  const player = session ? getMiningCurrentPlayer(session, state.currentUser.id) : null;
  if (!session || !player || player.status !== "active" || !session.map) return;
  const targetX = Number(intent?.targetX ?? 0);
  const targetY = Number(intent?.targetY ?? 0);
  void performMiningAction("move", { targetX, targetY });
}

export function getMiningViewport(session, player) {
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


export function drawMiningQueuedPath(context, metrics) {
  if (!state.miningClickRipple) return;
  const { x, y, startMs } = state.miningClickRipple;
  const elapsed = getMiningNow() - startMs;
  if (elapsed > 400) {
    state.miningClickRipple = null;
    return;
  }
  const progress = elapsed / 400;
  const screenX = (x - metrics.worldStartX) * metrics.tilePx;
  const screenY = (y - metrics.worldStartY) * metrics.tilePx;
  if (screenX < -40 || screenY < -40 || screenX > metrics.canvas.width + 40 || screenY > metrics.canvas.height + 40) return;
  const maxRadius = metrics.tilePx * 0.35;
  const radius = maxRadius * progress;
  const alpha = 1.0 - progress;
  context.save();
  context.globalAlpha = alpha * 0.7;
  context.strokeStyle = "#fff8b4";
  context.lineWidth = Math.max(1.5, metrics.tilePx * 0.03 * (1 - progress));
  context.beginPath();
  context.arc(screenX, screenY, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

export function drawMiningPickaxe(context, px, py, size, facing = "right", swing = 0) {
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

export function getMiningTileColor(tile) {
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

export function syncMiningCanvasResolution(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * window.devicePixelRatio));
  const height = Math.max(1, Math.round(rect.height * window.devicePixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

export function getMiningCanvasMetrics(canvas, session, player) {
  const map = session?.map || null;
  const zoom = clamp(state.miningZoom, MINING_MIN_ZOOM, MINING_MAX_ZOOM);
  const shortestEdge = Math.max(1, Math.min(canvas.width, canvas.height));
  const visibleShortEdgeTiles = MINING_BASE_VISIBLE_TILES / zoom;
  const tilePx = shortestEdge / visibleShortEdgeTiles;
  const visibleWidthTiles = canvas.width / tilePx;
  const visibleHeightTiles = canvas.height / tilePx;

  const camX = state.miningCameraFollowPlayer ? (player ? player.x : Math.floor(Number(map?.size || 0) / 2)) : state.miningCameraManualX;
  const camY = state.miningCameraFollowPlayer ? (player ? player.y : Math.floor(Number(map?.size || 0) / 2)) : state.miningCameraManualY;

  const rawCameraX = Number.isFinite(camX) ? camX : (player ? player.x : Math.floor(Number(map?.size || 0) / 2));
  const rawCameraY = Number.isFinite(camY) ? camY : (player ? player.y : Math.floor(Number(map?.size || 0) / 2));

  const bounds = getMiningCameraBounds(map, visibleWidthTiles, visibleHeightTiles);
  const cameraX = clamp(rawCameraX, bounds.minX, bounds.maxX);
  const cameraY = clamp(rawCameraY, bounds.minY, bounds.maxY);

  // Vizuel cikti icin gecici state
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

export function getMiningCameraBounds(map, visibleWidthTiles, visibleHeightTiles) {
  const originX = Number(map?.originX || 0);
  const originY = Number(map?.originY || 0);
  const windowSize = Math.max(1, Number(map?.windowSize || map?.size || 1));

  // Allow camera center to move significantly outside the map for "empty space" padding
  const padding = 15;
  const minX = originX - padding;
  const maxX = originX + windowSize + padding;
  const minY = originY - padding;
  const maxY = originY + windowSize + padding;

  return { minX, maxX, minY, maxY };
}

export function getMiningTileScreenRect(metrics, tileX, tileY) {
  const x = (tileX - metrics.worldStartX) * metrics.tilePx;
  const y = (tileY - metrics.worldStartY) * metrics.tilePx;
  const size = metrics.tilePx;
  if ((x + size) < -size || (y + size) < -size || x > metrics.canvas.width + size || y > metrics.canvas.height + size) {
    return null;
  }
  return { x, y, size, centerX: x + (size / 2), centerY: y + (size / 2) };
}

export function drawMiningBackdrop(context, metrics, now) {
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

export function drawMiningWallTile(context, metrics, tileX, tileY, tile, now) {
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

export function drawMiningExitTile(context, metrics, tileX, tileY, now) {
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

export function drawMiningRockBlobPath(context, radius, tileX, tileY, salt) {
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

export function drawMiningCracks(context, size, damageRatio, color) {
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

export function drawMiningEffects(context, metrics, effects, now) {
  for (const effect of effects || []) {
    const age = Math.max(0, now - Number(effect.atMs || 0));
    const progress = clamp(age / 900, 0, 1);
    const rect = getMiningTileScreenRect(metrics, effect.x, effect.y);
    if (!rect) continue;
    context.save();

    // Smooth positions (characters) translate to x,y while locked grid effects center on tile
    const isGridLocked = effect.type === "mine-hit" || effect.type === "mine-break" || effect.type === "mole-break";
    context.translate(isGridLocked ? rect.centerX : rect.x, isGridLocked ? rect.centerY : rect.y);

    if (effect.type === "mine-hit") {
      const radius = rect.size * (0.22 + (progress * 0.34));
      context.strokeStyle = `rgba(255, 225, 170, ${0.45 * (1 - progress)})`;
      context.lineWidth = Math.max(2, rect.size * 0.04);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
    }

    if (effect.type === "mine-break" || effect.type === "mole-break") {
      // Ease-out cubic curve so explosion bursts fast then slows smoothly
      const easeOut = 1 - Math.pow(1 - progress, 3);
      for (let index = 0; index < 6; index += 1) {
        const angle = ((Math.PI * 2) / 6) * index;
        const distance = rect.size * (0.06 + (easeOut * 0.38));
        const px = Math.cos(angle) * distance;
        const py = Math.sin(angle) * distance;
        context.fillStyle = `rgba(255, 218, 163, ${0.45 * (1 - easeOut)})`;
        context.beginPath();
        context.arc(px, py, rect.size * (0.06 + ((1 - easeOut) * 0.04)), 0, Math.PI * 2);
        context.fill();
      }
    }

    if (effect.type === "mole-hit" || effect.type === "player-hit") {
      context.strokeStyle = effect.type === "player-hit"
        ? `rgba(255, 60, 60, ${0.9 * (1 - progress)})`
        : `rgba(255, 238, 180, ${0.55 * (1 - progress)})`;
      context.lineWidth = effect.type === "player-hit" ? Math.max(4, rect.size * 0.06) : Math.max(2, rect.size * 0.035);
      context.beginPath();
      // Shift down slightly for player hits to wrap around the physical sprite footprint
      const circleY = effect.type === "player-hit" ? rect.size * 0.24 : 0;
      context.arc(0, circleY, rect.size * (0.2 + (progress * 0.35)), 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }
}

export function drawMiningMoleSprite(context, metrics, mole, now) {
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

export function drawMiningPlayerSprite(context, metrics, entry, now) {
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
  context.translate(rect.x, rect.y + bob);
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

export function drawMiningPlayerName(context, rect, name, isLocal) {
  const label = String(name || "Oyuncu");
  context.save();
  context.font = `800 ${Math.max(10, rect.size * 0.15)}px Trebuchet MS`;
  context.textAlign = "center";
  context.textBaseline = "top";
  const textY = rect.y + (rect.size * 0.98);
  context.fillStyle = isLocal ? "#f7fbff" : "rgba(240, 247, 255, 0.92)";
  context.strokeStyle = "rgba(0, 0, 0, 0.38)";
  context.lineWidth = Math.max(1, rect.size * 0.014);
  context.strokeText(label, rect.x, textY);
  context.fillText(label, rect.x, textY);
  context.restore();
}

export function getMiningEffectStrength(metrics, tileX, tileY, type, now) {
  const effect = (state.miningSession?.content?.effects || []).find((entry) => entry.type === type && entry.x === tileX && entry.y === tileY);
  if (!effect) return 0;
  return clamp(1 - ((now - Number(effect.atMs || 0)) / 220), 0, 1);
}

export function getMiningOrePalette(oreId) {
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

export function hashMiningNoise(x, y, salt = "") {
  let hash = 2166136261;
  const input = `${x}:${y}:${salt}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

export function getMiningSlotLabel(slot) {
  const labels = {
    armor: "Zirh",
    boots: "Ayakkabi",
    bag: "Canta",
    tool: "Alet",
    pickaxe: "Kazma"
  };
  return labels[slot] || slot;
}

export function formatDurationLabel(ms) {
  const safeMs = Math.max(0, Math.round(Number(ms || 0)));
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}dk ${String(seconds).padStart(2, "0")}sn` : `${seconds}sn`;
}

