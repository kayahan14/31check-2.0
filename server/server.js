import dotenv from "dotenv";
import express from "express";
import { appendMessage, listScopeChannels } from "./storage.js";

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
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

app.listen(port, () => {
  console.log(`Discord Activity backend listening on http://localhost:${port}`);
});
