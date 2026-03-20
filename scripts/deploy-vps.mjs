#!/usr/bin/env node
import { Client } from "ssh2";

const VPS_HOST = "46.62.159.126";
const VPS_USER = "root";
const VPS_PASS = process.env.VPS_PASS || process.argv[2] || "";
const DEPLOY_COMMANDS = [
  "cd /opt/31check",
  "git pull",
  "npm install --omit=dev",
  "pm2 restart 31check-mining --update-env",
  "echo DEPLOY_OK"
].join(" && ");

if (!VPS_PASS) {
  console.error("Usage: node scripts/deploy-vps.mjs <password>");
  console.error("   or: VPS_PASS=xxx node scripts/deploy-vps.mjs");
  process.exit(1);
}

const conn = new Client();
conn.on("ready", () => {
  console.log("[deploy] SSH connected. Running deploy commands...");
  conn.exec(DEPLOY_COMMANDS, (err, stream) => {
    if (err) { console.error("[deploy] exec error:", err); conn.end(); return; }
    stream.on("close", (code) => {
      console.log(`[deploy] finished with exit code ${code}`);
      conn.end();
      process.exit(code || 0);
    });
    stream.on("data", (data) => process.stdout.write(data));
    stream.stderr.on("data", (data) => process.stderr.write(data));
  });
});
conn.on("error", (err) => {
  console.error("[deploy] SSH connection error:", err.message);
  process.exit(1);
});
conn.connect({
  host: VPS_HOST,
  port: 22,
  username: VPS_USER,
  password: VPS_PASS,
  readyTimeout: 15000
});
