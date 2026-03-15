import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataFile = path.join(rootDir, "data", "chat-history.json");

globalThis.__activityChatStore ||= { scopes: {} };

export async function readStore() {
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
  if (process.env.VERCEL) {
    globalThis.__activityChatStore = store;
    return;
  }

  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), "utf8");
}
