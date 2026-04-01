const { Client } = require("ssh2");

const conn = new Client();
conn.on("ready", () => {
  console.log("[ssh] Connected to VPS");
  const commands = [
    "echo '=== PM2 STATUS ==='",
    "pm2 list",
    "echo '=== HEALTH ==='",
    "curl -s http://localhost:3001/api/health",
    "echo",
    "echo '=== LAST 5 LOGS ==='",
    "pm2 logs 31check-mining --lines 5 --nostream",
    "echo '=== DB TABLES ==='",
    "PGPASSWORD='z7hHwSV3evOYt1XQj2E4yPbL' psql -U thirtyone_app -d thirtyone_db -h 127.0.0.1 -c \"SELECT tablename, (SELECT count(*) FROM public.messages) as msg_count FROM pg_tables WHERE schemaname='public' AND tablename='messages';\"",
    "PGPASSWORD='z7hHwSV3evOYt1XQj2E4yPbL' psql -U thirtyone_app -d thirtyone_db -h 127.0.0.1 -c \"SELECT count(*) as sessions FROM mining_sessions; SELECT count(*) as profiles FROM mining_profiles;\"",
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
