import { applyCors } from "../server/origin.js";

export default async function handler(req, res) {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

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

    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({
      error: "Token exchange request failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
