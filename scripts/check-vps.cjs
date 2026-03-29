const { Client } = require("ssh2");

const conn = new Client();
conn.on("ready", () => {
  console.log("[ssh] Connected to VPS");
  const commands = [
    "cd /opt/31check",
    "git pull",
    "npm install --omit=dev",
    "pm2 restart 31check-mining --update-env",
    "sleep 2",
    "pm2 logs 31check-mining --lines 15 --nostream",
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
