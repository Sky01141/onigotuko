'use strict';
// CHASE! server (Node.js). Serves client/ over HTTP and the game over WebSocket.
// The server owns roles, movement, capture, timer, events and win checks. Clients only send input.
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PORT = +process.env.PORT || 8080, DIR = path.join(__dirname, '..', 'client');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary' };

const server = http.createServer((q, s) => {
  let u; try { u = decodeURIComponent(q.url.split('?')[0]); } catch { u = '/'; }
  if (u === '/healthz') return s.end('ok');
  if (u === '/') u = '/index.html';
  const f = path.join(DIR, path.normalize(u));
  if (!f.startsWith(DIR + path.sep)) { s.statusCode = 404; return s.end('not found'); }
  fs.readFile(f, (e, d) => {
    if (e) { s.statusCode = 404; return s.end('not found'); }
    s.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); s.end(d);
  });
});

const MAXP = 8, DT = 0.05, rooms = new Map();
const bc = (r, o) => { const s = JSON.stringify(o); for (const p of r.p) if (p && !p.left && p.ws.readyState === 1) p.ws.send(s); };
const live = r => r.p.filter(p => p && !p.left);
const lobby = r => bc(r, { t: 'lobby', room: r.code, host: r.host, names: r.p.map(p => (p && !p.left ? p.name : '')) });
const fixHost = r => { if (!(r.p[r.host] && !r.p[r.host].left)) r.host = r.p.findIndex(p => p && !p.left); };

function startGame(r) {
  const ids = []; r.p.forEach((p, i) => { if (p && !p.left) ids.push(i); });
  if (ids.length < 2) return;
  const pick = () => ids[(Math.random() * ids.length) | 0];
  let h = pick(); if (h === r.last) h = pick();            // lower the odds of repeating the last first-HUNTER
  r.last = h;
  Object.assign(r, { state: 1, t: 180, prep: 6, prot: 3, ar: 30, spd: 1, regen: 1, ev: [0, 0, 0, 0] });
  const seed = 1 + ((Math.random() * 9998) | 0); let ri = 0;
  for (const i of ids) {
    const p = r.p[i];
    Object.assign(p, { hunter: i === h ? 1 : 0, caught: 0, st: 1, grace: 0, y: 0, vy: 0, ix: 0, iz: 0, dash: 0, jump: 0 });
    const a = p.hunter ? 0 : Math.PI * (0.6 + 0.8 * (ri++) / ids.length), rad = p.hunter ? 24 : 22;
    p.x = Math.cos(a) * rad; p.z = Math.sin(a) * rad;       // HUNTER and RUNNERs start on opposite sides
    p.ws.send(JSON.stringify({ t: 'start', you: i, hunter: p.hunter, seed, prep: 6 }));
  }
}
function snapshot(r) {
  bc(r, { t: 's', time: +r.t.toFixed(1), ar: +r.ar.toFixed(1), prep: Math.max(0, +r.prep.toFixed(1)),
    p: r.p.map(p => (p && !p.left ? [+p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2), +p.yaw.toFixed(2), p.hunter] : null)) });
}
function finish(r, w) {
  bc(r, { t: 'end', w }); r.state = 0;
  r.p.forEach((p, i) => { if (p && p.left) r.p[i] = null; });
  fixHost(r); lobby(r);
}
function tick(r) {
  if (r.state !== 1) return;
  if (r.prep > 0) { r.prep -= DT; return snapshot(r); }
  r.t -= DT; if (r.prot > 0) r.prot -= DT;
  const ev = (k, at, name, fn) => { if (!r.ev[k] && r.t <= at) { r.ev[k] = 1; if (fn) fn(); bc(r, { t: 'ev', n: name }); } };
  ev(0, 135, 'SPEED UP', () => { r.spd = 1.12; });
  ev(1, 90, 'NIGHT');
  ev(2, 75, 'AREA SHRINK');
  if (r.t <= 75 && r.t > 30) r.ar = 30 - ((75 - r.t) / 45) * 10;
  ev(3, 30, 'CHAOS TIME', () => { r.spd = 1.25; r.regen = 2.5; });
  for (const p of live(r)) {
    let m = Math.hypot(p.ix, p.iz), sp = (p.hunter ? 6.6 : 6.2) * r.spd;
    const dash = p.dash && p.st > 0.05 && m > 0.05;
    if (dash) { sp *= 1.6; p.st -= DT * 0.45; } else p.st = Math.min(1, p.st + DT * 0.2 * r.regen);
    if (m > 0.05) { if (m > 1) { p.ix /= m; p.iz /= m; } p.x += p.ix * sp * DT; p.z += p.iz * sp * DT; p.yaw = Math.atan2(p.ix, p.iz); }
    if (p.jump && p.y === 0) p.vy = 9; p.jump = 0;
    p.vy -= 24 * DT; p.y += p.vy * DT; if (p.y < 0) p.y = p.vy = 0;
    const d = Math.hypot(p.x, p.z); if (d > r.ar - 0.5) { p.x *= (r.ar - 0.5) / d; p.z *= (r.ar - 0.5) / d; }
    if (p.grace > 0) p.grace -= DT;
  }
  if (r.prot <= 0) {
    for (const h of live(r)) {
      if (!h.hunter || h.grace > 0) continue;
      for (const q of live(r)) {
        if (q.hunter || Math.hypot(h.x - q.x, h.z - q.z) > 1.15 || Math.abs(h.y - q.y) > 1.4) continue;
        q.hunter = 1; q.grace = 2; h.caught++;
        bc(r, { t: 'cap', id: r.p.indexOf(q), by: r.p.indexOf(h) });
      }
    }
  }
  if (!live(r).some(p => !p.hunter)) return finish(r, 'HUNTERS');
  if (r.t <= 0) return finish(r, 'RUNNERS');
  snapshot(r);
}
setInterval(() => rooms.forEach(tick), DT * 1000);

const clean = (s, n, d) => String(s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, n) || d;
function join(ws, m) {
  if (ws.pl) return;
  const code = clean(m.room, 7, 'LOBBY'), name = clean(m.name, 12, 'PLAYER');
  let r = rooms.get(code);
  if (!r && rooms.size < 8) { r = { code, state: 0, host: 0, last: -1, p: new Array(MAXP).fill(null) }; rooms.set(code, r); }
  const slot = r ? r.p.findIndex(p => !p) : -1;
  if (!r || r.state !== 0 || slot < 0) return ws.send('{"t":"err","m":"ROOM UNAVAILABLE"}');   // no mid-match joins
  const first = live(r).length === 0;
  r.p[slot] = { ws, name, left: 0, hunter: 0, x: 0, z: 0, y: 0, vy: 0, ix: 0, iz: 0, yaw: 0, st: 1, grace: 0, caught: 0, dash: 0, jump: 0 };
  ws.pl = { r, slot }; if (first) r.host = slot;
  ws.send(JSON.stringify({ t: 'joined', you: slot })); lobby(r);
}
function leave(ws) {
  if (!ws.pl) return;
  const { r, slot } = ws.pl; r.p[slot].left = 1; if (r.state === 0) r.p[slot] = null;
  if (!live(r).length) rooms.delete(r.code); else { fixHost(r); if (r.state === 0) lobby(r); }
}
const wss = new WebSocketServer({ server, maxPayload: 256 });
wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'j') return join(ws, m);
    if (!ws.pl) return;
    const { r, slot } = ws.pl, p = r.p[slot];
    if (m.t === 's' && r.state === 0 && slot === r.host) startGame(r);
    if (m.t === 'i' && Number.isFinite(m.x) && Number.isFinite(m.z)) { p.ix = m.x; p.iz = m.z; p.dash = m.d ? 1 : 0; if (m.j) p.jump = 1; }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});
server.listen(PORT, () => console.log('CHASE! server on :' + PORT));
