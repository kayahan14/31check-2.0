import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, put } from "@vercel/blob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataFile = path.join(rootDir, "data", "chat-history.json");
const blobPathname = "chat-history/store.json";

globalThis.__activityChatStore ||= { scopes: {} };

export async function readStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result = await get(blobPathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return { scopes: {} };
    }

    const raw = await new Response(result.stream).text();
    const parsed = JSON.parse(raw);
    parsed.scopes ||= {};
    return parsed;
  }

  if (process.env.VERCEL) {
    return globalThis.__activityChatStore;
  }

  try {
    const raw = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    parsed.scopes ||= {};
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { scopes: {} };
    }
    throw error;
  }
}

export async function writeStore(store) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await put(blobPathname, JSON.stringify(store, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });
    return;
  }

  if (process.env.VERCEL) {
    globalThis.__activityChatStore = store;
    return;
  }

  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), "utf8");
}
