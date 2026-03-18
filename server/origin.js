export function isTrustedOrigin(origin, extraAllowedOrigins = []) {
  const normalized = String(origin || "").trim();
  if (!normalized) return true;
  if (normalized === "null") return true;
  if (Array.isArray(extraAllowedOrigins) && extraAllowedOrigins.includes(normalized)) return true;
  if (/^https:\/\/31check-2-0(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(normalized)) return true;
  if (/^https:\/\/46-62-159-126\.sslip\.io$/i.test(normalized)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*discord\.com$/i.test(normalized)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*discordapp\.com$/i.test(normalized)) return true;
  if (/^https:\/\/[a-z0-9.-]+\.discordsays\.com$/i.test(normalized)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) return true;
  return false;
}

export function applyCors(req, res, extraAllowedOrigins = []) {
  const origin = String(req?.headers?.origin || "").trim();
  if (origin && isTrustedOrigin(origin, extraAllowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (origin === "null") {
    res.setHeader("Access-Control-Allow-Origin", "null");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");

  if (String(req?.method || "").toUpperCase() === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
