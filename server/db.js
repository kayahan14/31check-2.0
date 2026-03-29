// ── PostgreSQL Connection Pool ───────────────────────────────────────
import pg from "pg";
const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.LOCAL_DATABASE_URL ||
  "";

let pool = null;

/**
 * Lazy-initialize the connection pool.
 * Returns the pg.Pool instance, or null if DATABASE_URL is not configured.
 */
export function getPool() {
  if (pool) return pool;
  if (!DATABASE_URL) {
    console.warn("[db] DATABASE_URL not set — running without persistence.");
    return null;
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  pool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err.message);
  });

  console.log("[db] Pool created.");
  return pool;
}

/**
 * Convenience query wrapper.
 * Returns { rows } on success.
 * Returns { rows: [] } on failure (logs the error, does not throw).
 */
export async function query(text, params = []) {
  const p = getPool();
  if (!p) return { rows: [] };

  try {
    return await p.query(text, params);
  } catch (err) {
    console.error("[db] query error:", err.message, "SQL:", text.slice(0, 120));
    return { rows: [] };
  }
}

/**
 * Run schema.sql to ensure tables and indexes exist.
 * Safe to call on every startup (IF NOT EXISTS).
 */
export async function ensureTables() {
  const p = getPool();
  if (!p) return;

  try {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, "..", "database", "schema.sql");
    const sql = readFileSync(schemaPath, "utf-8");
    await p.query(sql);
    console.log("[db] Schema ensured.");
  } catch (err) {
    console.error("[db] ensureTables failed:", err.message);
  }
}

/**
 * Gracefully close all pool connections.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[db] Pool closed.");
  }
}
