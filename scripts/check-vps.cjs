const { Client } = require("ssh2");

const conn = new Client();
conn.on("ready", () => {
  console.log("[ssh] Connected to VPS");
  const commands = [
    // Clear old logs and get fresh ones
    "pm2 flush 31check-mining",
    "pm2 restart 31check-mining",
    "sleep 3",
    "cat /root/.pm2/logs/31check-mining-out.log",
    "echo '=== STDERR ==='",
    "cat /root/.pm2/logs/31check-mining-error.log",
    // Also test the health endpoint
    "echo '=== HEALTH ==='",
    "curl -s http://localhost:3001/api/health",
    "echo",
    "echo ===DONE==="
  ].join(" && ");

  conn.exec(commands, (err, stream) => {
    if (err) { console.error("exec error:", err); conn.end(); return; }
    stream.on("data", (data) => process.stdout.write(data));
    stream.stderr.on("data", (data) => process.stderr.write(data));
    stream.on("close", () => conn.end());
  });
});
conn.on("error", (err) => {
  console.error("SSH error:", err.message);
  process.exit(1);
});
conn.connect({
  host: "46.62.159.126",
  port: 22,
  username: "root",
  password: "gXetKiFFbarE",
  readyTimeout: 15000
});
