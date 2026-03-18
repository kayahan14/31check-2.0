import {
  MINING_CHANNEL_ID,
  MINING_PROFILE_TYPE,
  MINING_SHOP_ITEMS,
  MINING_TYPE,
  attackMiningMole,
  createMiningTransportSession,
  createMiningProfile,
  createMiningSession,
  extractMiningPlayer,
  getMiningCurrentPlayer,
  joinMiningSession,
  mineMiningTile,
  moveMiningPlayer,
  normalizeMiningProfile,
  normalizeMiningSession
} from "../shared/mining-core.js";
import { appendMessage, listScopeMessages, updateMessage } from "../server/storage.js";

globalThis.__miningQueues ||= {};

function normalizeMiningScopeKey(scopeKey) {
  const normalized = String(scopeKey || "local-preview");
  return normalized.startsWith("mining:") ? normalized : `mining:${normalized}:v2`;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

    if (req.method === "GET") {
      const scopeKey = normalizeMiningScopeKey(req.query.scopeKey);
      const actor = {
        id: String(req.query.actorId || ""),
        name: String(req.query.actorName || "Oyuncu")
      };
      const snapshot = await withMiningQueue(scopeKey, async () => getMiningSnapshot(scopeKey, actor));
      res.status(200).json({
        ok: true,
        session: snapshot.session,
        profile: snapshot.profile,
        shopItems: MINING_SHOP_ITEMS,
        serverNowMs: snapshot.serverNowMs
      });
      return;
    }

    if (req.method === "POST") {
      const { action, actor, x, y, direction, targetId } = req.body || {};
      const scopeKey = normalizeMiningScopeKey(req.body?.scopeKey);
      if (!action) {
        res.status(400).json({ error: "action is required." });
        return;
      }

      const result = await withMiningQueue(scopeKey, async () => mutateMiningState(scopeKey, action, actor, {
        x,
        y,
        direction,
        targetId
      }));

      res.status(200).json({
        ok: true,
        session: result.session,
        profile: result.profile,
        shopItems: MINING_SHOP_ITEMS,
        serverNowMs: result.serverNowMs,
        errorCode: result.errorCode || ""
      });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({
      error: "Mining session failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function withMiningQueue(scopeKey, worker) {
  const key = String(scopeKey || "local-preview");
  const previous = globalThis.__miningQueues[key] || Promise.resolve();
  const next = previous.catch(() => null).then(worker);
  globalThis.__miningQueues[key] = next.finally(() => {
    if (globalThis.__miningQueues[key] === next) {
      delete globalThis.__miningQueues[key];
    }
  });
  return next;
}

async function getMiningSnapshot(scopeKey, actor) {
  const now = Date.now();
  const session = await syncMiningSessionRecord(scopeKey, now);
  const profile = actor?.id ? await ensureMiningProfileRecord(scopeKey, actor, now) : null;
  return {
    session: session ? { ...session, content: createMiningTransportSession(session.content, now, actor?.id || "") } : null,
    profile: profile ? normalizeMiningProfile(profile.content, actor) : null,
    serverNowMs: now
  };
}

async function mutateMiningState(scopeKey, action, actor, meta = {}) {
  const now = Date.now();
  const normalizedActor = {
    id: String(actor?.id || "user"),
    name: String(actor?.name || "Oyuncu")
  };
  const profileRecord = await ensureMiningProfileRecord(scopeKey, normalizedActor, now);
  const profile = normalizeMiningProfile(profileRecord.content, normalizedActor);
  const sessionRecord = await syncMiningSessionRecord(scopeKey, now);

  if (action === "start_lobby") {
    if (sessionRecord && (sessionRecord.content.status === "lobby" || sessionRecord.content.status === "active")) {
      const joined = joinMiningSession(sessionRecord.content, normalizedActor, profile.loadout, now);
      const nextSession = joined.changed ? await writeMiningSession(scopeKey, sessionRecord, sessionRecord.content, now) : sessionRecord;
      return makeResult(nextSession, profile, now, joined.reason || "", normalizedActor.id);
    }

    const session = createMiningSession(normalizedActor, profile, now);
    const created = await appendMessage(scopeKey, MINING_CHANNEL_ID, {
      id: crypto.randomUUID(),
      channelId: MINING_CHANNEL_ID,
      author: normalizedActor.name,
      avatar: normalizedActor.name,
      avatarUrl: "",
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      type: MINING_TYPE,
      content: session
    });
    return makeResult(created, profile, now, "", normalizedActor.id);
  }

  if (action === "join_lobby") {
    if (!sessionRecord || (sessionRecord.content.status !== "lobby" && sessionRecord.content.status !== "active")) {
      return makeResult(sessionRecord, profile, now, "inactive", normalizedActor.id);
    }
    const joined = joinMiningSession(sessionRecord.content, normalizedActor, profile.loadout, now);
    const nextSession = joined.changed ? await writeMiningSession(scopeKey, sessionRecord, sessionRecord.content, now) : sessionRecord;
    return makeResult(nextSession, profile, now, joined.reason || "", normalizedActor.id);
  }

  if (!sessionRecord || sessionRecord.content.status !== "active") {
    return makeResult(sessionRecord, profile, now, "inactive", normalizedActor.id);
  }

  const session = sessionRecord.content;
  let changed = false;
  let errorCode = "";

  if (action === "move") {
    const delta = normalizeDirection(meta.direction);
    const result = moveMiningPlayer(session, normalizedActor.id, delta.dx, delta.dy, now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (result.changed && result.extracted) {
      const nextProfile = normalizeMiningProfile({
        ...profile,
        walletCoins: profile.walletCoins + Math.max(0, Math.round(Number(result.awardedCoins || 0))),
        stats: {
          ...profile.stats,
          runs: profile.stats.runs + 1,
          escapes: profile.stats.escapes + 1,
          bestRunCoins: Math.max(profile.stats.bestRunCoins, Math.round(Number(result.awardedCoins || 0)))
        }
      }, normalizedActor);
      const storedProfile = await updateMiningProfileRecord(scopeKey, profileRecord, nextProfile, normalizedActor, now);
      const nextSession = await writeMiningSession(scopeKey, sessionRecord, session, now);
      return makeResult(nextSession, normalizeMiningProfile(storedProfile.content, normalizedActor), now, errorCode, normalizedActor.id);
    }
  } else if (action === "mine") {
    const result = mineMiningTile(session, normalizedActor.id, Math.round(Number(meta.x)), Math.round(Number(meta.y)), now);
    changed = result.changed;
    errorCode = result.reason || "";
  } else if (action === "attack") {
    const result = attackMiningMole(session, normalizedActor.id, meta.targetId, now);
    changed = result.changed;
    errorCode = result.reason || "";
  } else if (action === "extract") {
    const result = extractMiningPlayer(session, normalizedActor.id, now);
    changed = result.changed;
    errorCode = result.reason || "";
    if (result.changed) {
      const nextProfile = normalizeMiningProfile({
        ...profile,
        walletCoins: profile.walletCoins + Math.max(0, Math.round(Number(result.awardedCoins || 0))),
        stats: {
          ...profile.stats,
          runs: profile.stats.runs + 1,
          escapes: profile.stats.escapes + 1,
          bestRunCoins: Math.max(profile.stats.bestRunCoins, Math.round(Number(result.awardedCoins || 0)))
        }
      }, normalizedActor);
      const storedProfile = await updateMiningProfileRecord(scopeKey, profileRecord, nextProfile, normalizedActor, now);
      const nextSession = changed ? await writeMiningSession(scopeKey, sessionRecord, session, now) : sessionRecord;
      return makeResult(nextSession, normalizeMiningProfile(storedProfile.content, normalizedActor), now, errorCode, normalizedActor.id);
    }
  }

  const currentPlayer = getMiningCurrentPlayer(session, normalizedActor.id);
  if (session.status === "collapsed" && currentPlayer?.status === "collapsed") {
    const collapsedProfile = normalizeMiningProfile({
      ...profile,
      stats: {
        ...profile.stats,
        runs: profile.stats.runs + 1,
        collapses: profile.stats.collapses + 1
      }
    }, normalizedActor);
    const storedProfile = await updateMiningProfileRecord(scopeKey, profileRecord, collapsedProfile, normalizedActor, now);
    const nextSession = changed ? await writeMiningSession(scopeKey, sessionRecord, session, now) : sessionRecord;
    return makeResult(nextSession, normalizeMiningProfile(storedProfile.content, normalizedActor), now, errorCode, normalizedActor.id);
  }

  const nextSession = changed ? await writeMiningSession(scopeKey, sessionRecord, session, now) : sessionRecord;
  return makeResult(nextSession, profile, now, errorCode, normalizedActor.id);
}

async function syncMiningSessionRecord(scopeKey, now = Date.now()) {
  const latest = await getCurrentMiningSessionRecord(scopeKey);
  if (!latest) return null;

  const normalized = normalizeMiningSession(latest.content, now);
  if (JSON.stringify(normalized) === JSON.stringify(latest.content)) {
    return { ...latest, content: normalized };
  }

  return writeMiningSession(scopeKey, latest, normalized, now);
}

async function getCurrentMiningSessionRecord(scopeKey) {
  const sessions = await listScopeMessages(scopeKey, {
    channelId: MINING_CHANNEL_ID,
    messageTypes: [MINING_TYPE],
    limit: 1
  });

  if (!sessions.length) return null;

  return [...sessions].sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))[0];
}

async function ensureMiningProfileRecord(scopeKey, actor, now = Date.now()) {
  const latest = await getMiningProfileRecord(scopeKey, actor.id);
  if (!latest) {
    return appendMessage(scopeKey, MINING_CHANNEL_ID, {
      id: crypto.randomUUID(),
      channelId: MINING_CHANNEL_ID,
      author: actor.name,
      avatar: actor.name,
      avatarUrl: "",
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      type: MINING_PROFILE_TYPE,
      content: createMiningProfile(actor)
    });
  }

  const normalized = normalizeMiningProfile(latest.content, actor);
  if (JSON.stringify(normalized) === JSON.stringify(latest.content)) {
    return { ...latest, content: normalized };
  }

  return updateMiningProfileRecord(scopeKey, latest, normalized, actor, now);
}

async function getMiningProfileRecord(scopeKey, userId) {
  const profiles = (await listScopeMessages(scopeKey, {
    channelId: MINING_CHANNEL_ID,
    messageTypes: [MINING_PROFILE_TYPE],
    limit: 20
  }))
    .filter((message) => String(message?.content?.userId || "") === String(userId || ""));

  if (!profiles.length) return null;

  return [...profiles].sort((left, right) => Number(right.serverCreatedAtMs || 0) - Number(left.serverCreatedAtMs || 0))[0];
}

async function updateMiningProfileRecord(scopeKey, record, profile, actor, now) {
  return updateMessage(scopeKey, record.id, {
    ...record,
    author: actor.name,
    avatar: actor.name,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    serverCreatedAt: new Date(now).toISOString(),
    serverCreatedAtMs: now,
    content: normalizeMiningProfile(profile, actor)
  });
}

async function writeMiningSession(scopeKey, record, session, now) {
  return updateMessage(scopeKey, record.id, {
    ...record,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    serverCreatedAt: new Date(now).toISOString(),
    serverCreatedAtMs: now,
    content: normalizeMiningSession(session, now)
  });
}

function makeResult(sessionRecord, profile, now, errorCode = "", playerId = "") {
  return {
    session: sessionRecord ? { ...sessionRecord, content: createMiningTransportSession(sessionRecord.content, now, playerId) } : null,
    profile,
    serverNowMs: now,
    errorCode
  };
}

function normalizeDirection(direction) {
  switch (String(direction || "").toLowerCase()) {
    case "up":
      return { dx: 0, dy: -1 };
    case "down":
      return { dx: 0, dy: 1 };
    case "left":
      return { dx: -1, dy: 0 };
    case "right":
      return { dx: 1, dy: 0 };
    default:
      return { dx: 0, dy: 0 };
  }
}
