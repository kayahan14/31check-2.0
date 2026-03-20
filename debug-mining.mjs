import { normalizeMiningSession, advanceMiningSession } from './shared/mining-core.js';

let rawSession = { game: "mining", isTransportSnapshot: true, status: "active", players: [{ id: "1", x: 10.5, y: 10.5, targetX: 10.7, targetY: 10.5, status: "active", lastMovedAtMs: Date.now(), speed: 4.0, runCoins: 0 }], map: { size: 20, tiles: [] } };
for(let i=0; i<20; i++) {
  for(let j=0; j<20; j++) {
    rawSession.map.tiles.push({ x: i, y: j, kind: 'floor' });
  }
}
let session = normalizeMiningSession(rawSession);

let now = Date.now();
for(let i=0; i<5; i++) {
  now += 16;
  advanceMiningSession(session, now);
  const p = session.players[0];
  console.log('Frame ' + i + ': mutating actual session? ' + (session.players[0].x !== 10.5) + ', x=' + p.x);
}
