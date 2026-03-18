import pg from "pg";

const { Pool } = pg;

globalThis.__activityDbPool ||= null;

function getDatabaseUrl() {
  return String(
    process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.LOCAL_DATABASE_URL
    || ""
  ).trim();
}

function normalizeDatabaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  return url.toString();
}

export function hasDatabaseConfig() {
  return Boolean(getDatabaseUrl());
}

export function getDatabasePool() {
  if (globalThis.__activityDbPool) {
    return globalThis.__activityDbPool;
  }

  const connectionString = normalizeDatabaseUrl(getDatabaseUrl());
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  globalThis.__activityDbPool = new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });
  globalThis.__activityDbPool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });
  return globalThis.__activityDbPool;
}

export async function runQuery(text, params = []) {
  return getDatabasePool().query(text, params);
}
