import { appendMessage, listScopeChannels } from "../server/storage.js";

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

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(500).json({
      error: "Message storage failed.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
