import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourceUrl = normalizeDatabaseUrl(process.env.SOURCE_DATABASE_URL || process.env.NEON_DATABASE_URL || "");
const targetUrl = normalizeDatabaseUrl(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.LOCAL_DATABASE_URL || "");

if (!sourceUrl || !targetUrl) {
  console.error("SOURCE_DATABASE_URL ve DATABASE_URL gerekli.");
  process.exit(1);
}

const source = new Pool({
  connectionString: sourceUrl,
  ssl: sourceUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  max: 3
});

const target = new Pool({
  connectionString: targetUrl,
  ssl: targetUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  max: 3
});

const schemaSql = await fs.readFile(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
await target.query(schemaSql);

await migrateMessages();
await migrateMiningSessions();
await migrateMiningProfiles();

await source.end();
await target.end();
console.log("Postgres migration done.");

async function migrateMessages() {
  const { rows } = await source.query(`
    select id,
           scope_key,
           channel_id,
           author_name,
           avatar_label,
           avatar_url,
           content,
           message_type,
           created_at,
           created_at_ms,
           server_created_at,
           server_created_at_ms
    from messages
    order by server_created_at_ms asc, id asc
  `);

  if (!rows.length) {
    console.log("messages: 0");
    return;
  }

  for (const row of rows) {
    await target.query(`
      insert into messages (
        id,
        scope_key,
        channel_id,
        author_name,
        avatar_label,
        avatar_url,
        content,
        message_type,
        created_at,
        created_at_ms,
        server_created_at,
        server_created_at_ms
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      on conflict (id) do update set
        scope_key = excluded.scope_key,
        channel_id = excluded.channel_id,
        author_name = excluded.author_name,
        avatar_label = excluded.avatar_label,
        avatar_url = excluded.avatar_url,
        content = excluded.content,
        message_type = excluded.message_type,
        created_at = excluded.created_at,
        created_at_ms = excluded.created_at_ms,
        server_created_at = excluded.server_created_at,
        server_created_at_ms = excluded.server_created_at_ms
    `, [
      row.id,
      row.scope_key,
      row.channel_id,
      row.author_name,
      row.avatar_label || "",
      row.avatar_url || "",
      row.content,
      row.message_type,
      row.created_at,
      row.created_at_ms,
      row.server_created_at,
      row.server_created_at_ms
    ]);
  }

  console.log(`messages: ${rows.length}`);
}

async function migrateMiningSessions() {
  const { rows } = await safeSelect(source, `
    select scope_key, record, updated_at
    from mining_sessions
    order by updated_at asc
  `);
  if (!rows.length) {
    console.log("mining_sessions: 0");
    return;
  }

  for (const row of rows) {
    await target.query(`
      insert into mining_sessions (scope_key, record, updated_at)
      values ($1, $2::jsonb, $3)
      on conflict (scope_key) do update set
        record = excluded.record,
        updated_at = excluded.updated_at
    `, [row.scope_key, JSON.stringify(row.record || {}), row.updated_at]);
  }

  console.log(`mining_sessions: ${rows.length}`);
}

async function migrateMiningProfiles() {
  const { rows } = await safeSelect(source, `
    select scope_key, user_id, record, updated_at
    from mining_profiles
    order by updated_at asc
  `);
  if (!rows.length) {
    console.log("mining_profiles: 0");
    return;
  }

  for (const row of rows) {
    await target.query(`
      insert into mining_profiles (scope_key, user_id, record, updated_at)
      values ($1, $2, $3::jsonb, $4)
      on conflict (scope_key, user_id) do update set
        record = excluded.record,
        updated_at = excluded.updated_at
    `, [row.scope_key, row.user_id, JSON.stringify(row.record || {}), row.updated_at]);
  }

  console.log(`mining_profiles: ${rows.length}`);
}

async function safeSelect(pool, query) {
  try {
    return await pool.query(query);
  } catch (error) {
    if (String(error?.code || "") === "42P01") {
      return { rows: [] };
    }
    throw error;
  }
}

function normalizeDatabaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  return url.toString();
}
