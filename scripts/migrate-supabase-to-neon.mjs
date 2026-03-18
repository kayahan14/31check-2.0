import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "");

if (!supabaseUrl || !supabaseServiceRoleKey || !databaseUrl) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ve DATABASE_URL gerekli.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  max: 3
});

const schemaSql = await fs.readFile(path.join(__dirname, "..", "neon", "schema.sql"), "utf8");
await pool.query(schemaSql);

const batchSize = 1000;
let offset = 0;
let total = 0;

while (true) {
  const { data, error } = await supabase
    .from("messages")
    .select([
      "id",
      "scope_key",
      "channel_id",
      "author_name",
      "avatar_label",
      "avatar_url",
      "content",
      "message_type",
      "created_at",
      "created_at_ms",
      "server_created_at",
      "server_created_at_ms"
    ].join(","))
    .order("server_created_at_ms", { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    break;
  }

  await upsertMessages(pool, data);
  total += data.length;
  offset += data.length;
  console.log(`messages migrated: ${total}`);
}

console.log(`done: ${total} message row migrated`);
await pool.end();

function normalizeDatabaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  url.searchParams.delete("channel_binding");
  return url.toString();
}

async function upsertMessages(db, rows) {
  const values = [];
  const placeholders = rows.map((row, index) => {
    const base = index * 12;
    values.push(
      row.id,
      row.scope_key,
      row.channel_id,
      row.author_name,
      row.avatar_label || "",
      row.avatar_url || "",
      typeof row.content === "string" ? row.content : JSON.stringify(row.content ?? null),
      row.message_type,
      row.created_at,
      row.created_at_ms,
      row.server_created_at,
      row.server_created_at_ms
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
  });

  await db.query(`
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
    ) values ${placeholders.join(",")}
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
  `, values);
}
