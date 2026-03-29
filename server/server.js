import dotenv from "dotenv";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import dragonHandler, { getDragonTransportPayload } from "../api/dragon.js";
import miningHandler, { getMiningTransportPayload } from "../api/mining.js";
import { applyCors, isTrustedOrigin } from "./origin.js";
import { attachRealtimeServer, registerRealtimeProvider } from "./realtime.js";
import { appendMessage, listScopeChannels, updateMessage } from "./storage.js";
import { ensureTables, getPool } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });
const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = String(process.env.CORS_ORIGIN || "https://31check-2-0.vercel.app,http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  if (applyCors(req, res, allowedOrigins)) {
    return;
  }
  next();
});
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: getPool() ? "connected" : "in-memory" });
});

app.get("/api/messages", async (req, res) => {
  const scopeKey = String(req.query.scopeKey || "local-preview");
  const channels = await listScopeChannels(scopeKey);
  res.json({
    scopeKey,
    channels
  });
});

app.post("/api/messages", async (req, res) => {
  const {
    scopeKey = "local-preview",
    channelId,
    message
  } = req.body || {};

  if (!channelId || !message || !message.id) {
    res.status(400).json({ error: "channelId and message are required." });
    return;
  }

  await appendMessage(scopeKey, channelId, message);

  res.status(201).json({ ok: true });
});

app.patch("/api/messages", async (req, res) => {
  const {
    scopeKey = "local-preview",
    messageId,
    message
  } = req.body || {};

  if (!messageId || !message || !message.id) {
    res.status(400).json({ error: "messageId and message are required." });
    return;
  }

  const storedMessage = await updateMessage(scopeKey, messageId, message);

  res.status(200).json({ ok: true, message: storedMessage });
});

app.post("/api/token", async (req, res) => {
  const { code } = req.body || {};

  if (!code) {
    res.status(400).json({ error: "Missing OAuth code." });
    return;
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    res.status(500).json({ error: "Discord credentials are not configured on the server." });
    return;
  }

  try {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI || "https://127.0.0.1"
    });

    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });

    const payload = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: payload.error || "Discord token exchange failed.",
        details: payload
      });
      return;
    }

    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Token exchange request failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.all("/api/dragon", async (req, res) => {
  await dragonHandler(req, res);
});

app.all("/api/mining", async (req, res) => {
  await miningHandler(req, res);
});

const server = createServer(app);

registerRealtimeProvider("dragon", async ({ scopeKey }) => getDragonTransportPayload(scopeKey));
registerRealtimeProvider("mining", async ({ scopeKey, actor }) => getMiningTransportPayload(scopeKey, actor));
attachRealtimeServer(server, {
  allowedOrigins,
  allowOrigin: (origin) => isTrustedOrigin(origin, allowedOrigins)
});

server.listen(port, async () => {
  await ensureTables();
  console.log(`Discord Activity backend listening on http://localhost:${port}`);
});
