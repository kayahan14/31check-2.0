import { WebSocketServer } from "ws";

const HEARTBEAT_INTERVAL_MS = 1000;
const LIVENESS_INTERVAL_MS = 15000;

globalThis.__activityRealtimeProviders ||= new Map();
globalThis.__activityRealtimeHub ||= null;

function getRealtimeProviders() {
  return globalThis.__activityRealtimeProviders;
}

function getActiveHub() {
  return globalThis.__activityRealtimeHub;
}

function setActiveHub(hub) {
  globalThis.__activityRealtimeHub = hub;
}

function createClientContext(requestUrl, origin) {
  return {
    id: crypto.randomUUID(),
    stream: String(requestUrl.searchParams.get("stream") || "").trim(),
    scopeKey: String(requestUrl.searchParams.get("scopeKey") || "local-preview").trim() || "local-preview",
    actorId: String(requestUrl.searchParams.get("actorId") || "").trim(),
    actorName: String(requestUrl.searchParams.get("actorName") || "Oyuncu").trim() || "Oyuncu",
    origin,
    isAlive: true,
    socket: null
  };
}

function sendJson(socket, payload) {
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function normalizeOriginList(origins) {
  return [...new Set((origins || []).map((origin) => String(origin || "").trim()).filter(Boolean))];
}

export function registerRealtimeProvider(stream, provider) {
  const normalizedStream = String(stream || "").trim();
  if (!normalizedStream || typeof provider !== "function") return;
  getRealtimeProviders().set(normalizedStream, provider);
}

export function attachRealtimeServer(server, options = {}) {
  const existingHub = getActiveHub();
  if (existingHub?.server === server) {
    return existingHub;
  }

  const allowedOrigins = normalizeOriginList(options.allowedOrigins);
  const allowOrigin = typeof options.allowOrigin === "function" ? options.allowOrigin : null;
  const providers = getRealtimeProviders();
  const clients = new Set();
  const wss = new WebSocketServer({ noServer: true });

  async function sendSnapshot(client, reason = "sync", meta = {}) {
    const provider = providers.get(client.stream);
    if (!provider || !client.socket || client.socket.readyState !== client.socket.OPEN) {
      return;
    }

    try {
      const payload = await provider({
        scopeKey: client.scopeKey,
        actor: client.actorId
          ? {
            id: client.actorId,
            name: client.actorName
          }
          : null,
        reason,
        meta
      });

      if (!payload) return;

      sendJson(client.socket, {
        type: "snapshot",
        stream: client.stream,
        scopeKey: client.scopeKey,
        reason,
        payload: {
          ...payload,
          serverNowMs: Number(payload?.serverNowMs || Date.now())
        }
      });
    } catch (error) {
      console.warn(`[realtime] ${client.stream} snapshot failed`, error);
    }
  }

  async function broadcast(stream, scopeKey, meta = {}) {
    const normalizedStream = String(stream || "").trim();
    const normalizedScopeKey = String(scopeKey || "local-preview").trim() || "local-preview";
    const reason = String(meta.reason || "mutation");
    const matchingClients = [...clients].filter((client) => client.stream === normalizedStream && client.scopeKey === normalizedScopeKey);
    await Promise.allSettled(matchingClients.map((client) => sendSnapshot(client, reason, meta)));
  }

  server.on("upgrade", (request, socket, head) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    } catch {
      socket.destroy();
      return;
    }

    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const origin = String(request.headers.origin || "").trim();
    const originAllowed = allowOrigin
      ? allowOrigin(origin)
      : (!origin || !allowedOrigins.length || allowedOrigins.includes(origin));
    if (!originAllowed) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const client = createClientContext(requestUrl, origin);
    if (!client.stream || !providers.has(client.stream)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, client);
    });
  });

  wss.on("connection", (socket, _request, client) => {
    client.socket = socket;
    client.isAlive = true;
    clients.add(client);

    socket.on("pong", () => {
      client.isAlive = true;
    });

    socket.on("message", (raw) => {
      try {
        const payload = JSON.parse(String(raw || ""));
        if (payload?.type === "refresh") {
          void sendSnapshot(client, "refresh");
        }
      } catch {
        // Ignore malformed client messages.
      }
    });

    socket.on("close", () => {
      clients.delete(client);
    });

    socket.on("error", () => {
      clients.delete(client);
    });

    sendJson(socket, {
      type: "hello",
      stream: client.stream,
      scopeKey: client.scopeKey,
      serverNowMs: Date.now()
    });
    void sendSnapshot(client, "connect");
  });

  const heartbeatHandle = setInterval(() => {
    const serverNowMs = Date.now();
    for (const client of clients) {
      sendJson(client.socket, {
        type: "heartbeat",
        stream: client.stream,
        scopeKey: client.scopeKey,
        serverNowMs
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  const livenessHandle = setInterval(() => {
    for (const client of [...clients]) {
      if (!client.socket || client.socket.readyState !== client.socket.OPEN) {
        clients.delete(client);
        continue;
      }
      if (!client.isAlive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.socket.ping();
    }
  }, LIVENESS_INTERVAL_MS);

  const hub = {
    server,
    wss,
    clients,
    allowedOrigins,
    sendSnapshot,
    broadcast
  };

  wss.on("close", () => {
    clearInterval(heartbeatHandle);
    clearInterval(livenessHandle);
  });

  setActiveHub(hub);
  return hub;
}

export async function broadcastRealtime(stream, scopeKey, meta = {}) {
  const hub = getActiveHub();
  if (!hub) return;
  await hub.broadcast(stream, scopeKey, meta);
}
