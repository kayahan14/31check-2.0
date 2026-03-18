import {
  MINING_CHANNEL_ID,
  MINING_PROFILE_TYPE,
  MINING_SHOP_ITEMS,
  MINING_TYPE,
  advanceMiningSession,
  attackMiningMole,
  createMiningTransportSession,
  createMiningProfile,
  createMiningSession,
  extractMiningPlayer,
  getMiningCurrentPlayer,
  hydrateMiningRuntimeSession,
  joinMiningSession,
  mineMiningTile,
  moveMiningPlayer,
  normalizeMiningProfile
} from "../shared/mining-core.js";
import {
  getMiningProfileRecord as getStoredMiningProfileRecord,
  getMiningSessionRecord as getStoredMiningSessionRecord,
  saveMiningProfileRecord,
  saveMiningSessionRecord
} from "../server/mining-storage.js";

globalThis.__miningQueues ||= {};
globalThis.__miningRuntimeStore ||= { scopes: {} };

const MINING_RUNTIME_TTL_MS = 15 * 60 * 1000;
const MINING_PERSIST_INTERVAL_MS = 400;
const MINING_CHECKPOINT_INTERVAL_MS = 2000;
const MINING_STORAGE_REFRESH_MS = 1500;

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

function getMiningRuntime(scopeKey, now = Date.now()) {
  const store = globalThis.__miningRuntimeStore;
  const key = String(scopeKey || "local-preview");
  pruneMiningRuntimeStore(now);
  store.scopes[key] ||= {
    sessionRecord: null,
    profileRecords: {},
    dirtySession: false,
    dirtyProfiles: {},
    lastPersistAtMs: 0,
    lastCheckpointAtMs: 0,
    lastSourceCheckAtMs: 0,
    lastAccessAtMs: now
  };
  store.scopes[key].lastAccessAtMs = now;
  return store.scopes[key];
}

function pruneMiningRuntimeStore(now = Date.now()) {
  const store = globalThis.__miningRuntimeStore;
  for (const [scopeKey, runtime] of Object.entries(store.scopes || {})) {
    if ((now - Number(runtime?.lastAccessAtMs || 0)) > MINING_RUNTIME_TTL_MS) {
      delete store.scopes[scopeKey];
    }
  }
}

function getRecordTimestamp(record) {
  return Number(record?.serverCreatedAtMs || record?.createdAtMs || 0);
}

function isRecordNewer(nextRecord, currentRecord) {
  return getRecordTimestamp(nextRecord) > getRecordTimestamp(currentRecord);
}

function markSessionDirty(runtime, now = Date.now()) {
  runtime.dirtySession = true;
  runtime.lastMutationAtMs = now;
}

function markProfileDirty(runtime, userId, now = Date.now()) {
  runtime.dirtyProfiles[String(userId || "")] = now;
  runtime.lastMutationAtMs = now;
}

async function ensureRuntimeSession(scopeKey, runtime, now = Date.now(), { forceRefresh = false } = {}) {
  if (!runtime.sessionRecord) {
    const stored = await getCurrentMiningSessionRecord(scopeKey);
    runtime.lastSourceCheckAtMs = now;
    if (stored) {
      runtime.sessionRecord = {
        ...stored,
        content: hydrateMiningRuntimeSession(stored.content, now)
      };
      runtime.lastCheckpointAtMs = now;
    }
  } else if (!runtime.dirtySession && (forceRefresh || (now - runtime.lastSourceCheckAtMs) >= MINING_STORAGE_REFRESH_MS)) {
    const stored = await getCurrentMiningSessionRecord(scopeKey);
    runtime.lastSourceCheckAtMs = now;
    if (isRecordNewer(stored, runtime.sessionRecord)) {
      runtime.sessionRecord = stored
        ? {
          ...stored,
          content: hydrateMiningRuntimeSession(stored.content, now)
        }
        : null;
      runtime.lastCheckpointAtMs = now;
    }
  }

  if (!runtime.sessionRecord?.content) return null;

  advanceMiningSession(runtime.sessionRecord.content, now);
  const activeSession = runtime.sessionRecord.content;
  if (activeSession.status === "active" && (now - runtime.lastCheckpointAtMs) >= MINING_CHECKPOINT_INTERVAL_MS) {
    markSessionDirty(runtime, now);
    runtime.lastCheckpointAtMs = now;
  }
  return runtime.sessionRecord;
}

async function ensureRuntimeProfile(scopeKey, runtime, actor, now = Date.now()) {
  const userId = String(actor?.id || "");
  if (!userId) return null;

  if (!runtime.profileRecords[userId]) {
    const stored = await getMiningProfileRecord(scopeKey, userId);
    if (stored) {
      runtime.profileRecords[userId] = {
        ...stored,
        content: normalizeMiningProfile(stored.content, actor)
      };
    } else {
      runtime.profileRecords[userId] = await saveMiningProfileRecord(scopeKey, userId, {
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
  } else {
    runtime.profileRecords[userId] = {
      ...runtime.profileRecords[userId],
      content: normalizeMiningProfile(runtime.profileRecords[userId].content, actor)
    };
  }

  return runtime.profileRecords[userId];
}

async function flushMiningRuntime(scopeKey, runtime, now = Date.now(), { force = false } = {}) {
  const shouldFlushSession = Boolean(runtime.dirtySession && runtime.sessionRecord && (force || (now - runtime.lastPersistAtMs) >= MINING_PERSIST_INTERVAL_MS));
  const dirtyProfileIds = Object.entries(runtime.dirtyProfiles)
    .filter(([, dirtyAtMs]) => force || (now - Number(dirtyAtMs || 0)) >= MINING_PERSIST_INTERVAL_MS)
    .map(([userId]) => userId);

  if (!shouldFlushSession && !dirtyProfileIds.length) {
    return;
  }

  if (shouldFlushSession && runtime.sessionRecord) {
    runtime.sessionRecord = await writeMiningSession(scopeKey, runtime.sessionRecord, runtime.sessionRecord.content, now);
    runtime.dirtySession = false;
  }

  for (const userId of dirtyProfileIds) {
    const record = runtime.profileRecords[userId];
    if (!record) {
      delete runtime.dirtyProfiles[userId];
      continue;
    }
    runtime.profileRecords[userId] = await saveMiningProfileRecord(scopeKey, userId, record);
    delete runtime.dirtyProfiles[userId];
  }

  runtime.lastPersistAtMs = now;
  runtime.lastSourceCheckAtMs = now;
}

async function getMiningSnapshot(scopeKey, actor) {
  const now = Date.now();
  const runtime = getMiningRuntime(scopeKey, now);
  const session = await ensureRuntimeSession(scopeKey, runtime, now);
  const profile = actor?.id ? await ensureRuntimeProfile(scopeKey, runtime, actor, now) : null;
  await flushMiningRuntime(scopeKey, runtime, now);
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
  const runtime = getMiningRuntime(scopeKey, now);
  const profileRecord = await ensureRuntimeProfile(scopeKey, runtime, normalizedActor, now);
  const profile = normalizeMiningProfile(profileRecord.content, normalizedActor);
  const sessionRecord = await ensureRuntimeSession(scopeKey, runtime, now, { forceRefresh: true });

  if (action === "start_lobby") {
    if (sessionRecord && (sessionRecord.content.status === "lobby" || sessionRecord.content.status === "active")) {
      const joined = joinMiningSession(sessionRecord.content, normalizedActor, profile.loadout, now);
      if (joined.changed) {
        runtime.sessionRecord = sessionRecord;
        markSessionDirty(runtime, now);
      }
      await flushMiningRuntime(scopeKey, runtime, now, { force: joined.changed });
      return makeResult(runtime.sessionRecord, profile, now, joined.reason || "", normalizedActor.id);
    }

    const session = createMiningSession(normalizedActor, profile, now);
    runtime.sessionRecord = {
      id: crypto.randomUUID(),
      channelId: MINING_CHANNEL_ID,
      author: normalizedActor.name,
      avatar: normalizedActor.name,
      avatarUrl: "",
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      type: MINING_TYPE,
      content: session
    };
    markSessionDirty(runtime, now);
    await flushMiningRuntime(scopeKey, runtime, now, { force: true });
    return makeResult(runtime.sessionRecord, profile, now, "", normalizedActor.id);
  }

  if (action === "join_lobby") {
    if (!sessionRecord || (sessionRecord.content.status !== "lobby" && sessionRecord.content.status !== "active")) {
      return makeResult(sessionRecord, profile, now, "inactive", normalizedActor.id);
    }
    const joined = joinMiningSession(sessionRecord.content, normalizedActor, profile.loadout, now);
    if (joined.changed) {
      runtime.sessionRecord = sessionRecord;
      markSessionDirty(runtime, now);
    }
    await flushMiningRuntime(scopeKey, runtime, now, { force: joined.changed });
    return makeResult(runtime.sessionRecord, profile, now, joined.reason || "", normalizedActor.id);
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
      runtime.profileRecords[normalizedActor.id] = buildMiningProfileRecord(profileRecord, nextProfile, normalizedActor, now);
      markProfileDirty(runtime, normalizedActor.id, now);
      runtime.sessionRecord = sessionRecord;
      markSessionDirty(runtime, now);
      await flushMiningRuntime(scopeKey, runtime, now, { force: true });
      return makeResult(runtime.sessionRecord, normalizeMiningProfile(runtime.profileRecords[normalizedActor.id].content, normalizedActor), now, errorCode, normalizedActor.id);
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
      runtime.profileRecords[normalizedActor.id] = buildMiningProfileRecord(profileRecord, nextProfile, normalizedActor, now);
      markProfileDirty(runtime, normalizedActor.id, now);
      runtime.sessionRecord = sessionRecord;
      if (changed) {
        markSessionDirty(runtime, now);
      }
      await flushMiningRuntime(scopeKey, runtime, now, { force: true });
      return makeResult(runtime.sessionRecord, normalizeMiningProfile(runtime.profileRecords[normalizedActor.id].content, normalizedActor), now, errorCode, normalizedActor.id);
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
    runtime.profileRecords[normalizedActor.id] = buildMiningProfileRecord(profileRecord, collapsedProfile, normalizedActor, now);
    markProfileDirty(runtime, normalizedActor.id, now);
    runtime.sessionRecord = sessionRecord;
    if (changed || session.status === "collapsed") {
      markSessionDirty(runtime, now);
    }
    await flushMiningRuntime(scopeKey, runtime, now, { force: true });
    return makeResult(runtime.sessionRecord, normalizeMiningProfile(runtime.profileRecords[normalizedActor.id].content, normalizedActor), now, errorCode, normalizedActor.id);
  }

  runtime.sessionRecord = sessionRecord;
  if (changed) {
    markSessionDirty(runtime, now);
  }
  await flushMiningRuntime(scopeKey, runtime, now);
  return makeResult(runtime.sessionRecord, profile, now, errorCode, normalizedActor.id);
}

async function getCurrentMiningSessionRecord(scopeKey) {
  return getStoredMiningSessionRecord(scopeKey);
}

async function getMiningProfileRecord(scopeKey, userId) {
  return getStoredMiningProfileRecord(scopeKey, userId);
}

function buildMiningProfileRecord(record, profile, actor, now) {
  return {
    ...record,
    author: actor.name,
    avatar: actor.name,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    serverCreatedAt: new Date(now).toISOString(),
    serverCreatedAtMs: now,
    content: normalizeMiningProfile(profile, actor)
  };
}

async function writeMiningSession(scopeKey, record, session, now) {
  return saveMiningSessionRecord(scopeKey, {
    ...record,
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    serverCreatedAt: new Date(now).toISOString(),
    serverCreatedAtMs: now,
    content: advanceMiningSession(session, now)
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
