// Tiro & Treta Online — servidor autoritativo para rede local (sem dependências).
// Uso sozinho: node tiro-e-treta/server.js   (porta 3000, ou PORT=8080 ...)
// Dentro do hub: o server.js da raiz monta este módulo em /tiro-e-treta/online/.
//
// O servidor roda a simulação (motor.js) e manda "fotos" do estado ~40x por segundo.
// Os navegadores só enviam quais botões estão apertados e desenham o que recebem.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const M = require("./motor.js");

let PORT = Number(process.env.PORT) || 3000;
let BASE = "/";
const SNAP_HZ = 40;
const MAX_SEATS = 4;
const KEYS = ["left", "right", "up", "down", "shoot", "melee", "grenade"];
const PRESS_KEYS = ["up", "shoot", "melee", "grenade"]; // toques rápidos não se perdem
const GUN_IDX = [null, ...Object.keys(M.GUNS)];
const ITEM_IDX = [...Object.keys(M.GUNS), "facao", "granadas", "vida"];

/* ---------- WebSocket mínimo (RFC 6455, só texto) ---------- */

function wsAccept(req, socket, onOpen) {
  const key = req.headers["sec-websocket-key"];
  if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") return socket.destroy();
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = {
    open: true, onmessage: () => {}, onclose: () => {},
    send(text) {
      if (!ws.open) return;
      if (socket.writableLength > 512 * 1024) return; // cliente lento: pula esta foto
      const data = Buffer.from(text);
      const n = data.length;
      const head = n < 126 ? Buffer.from([0x81, n])
        : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
        : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
      socket.write(Buffer.concat([head, data]));
    },
    close() {
      if (!ws.open) return;
      ws.open = false;
      try { socket.end(Buffer.from([0x88, 0])); } catch {}
      ws.onclose();
    },
  };
  let buf = Buffer.alloc(0);
  let frag = [], fragLen = 0;
  socket.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1], op = b0 & 15, fin = b0 & 128, masked = b1 & 128;
      let len = b1 & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) return socket.destroy();
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), total);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(total);
      if (op === 8) return ws.close();
      if (op === 9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 1 || op === 0) {
        frag.push(payload);
        fragLen += payload.length;
        if (fragLen > 64 * 1024) return socket.destroy();
        if (fin) { const text = Buffer.concat(frag).toString("utf8"); frag = []; fragLen = 0; try { ws.onmessage(text); } catch (e) { console.error(e); } }
      }
    }
  });
  socket.on("close", () => { if (ws.open) { ws.open = false; ws.onclose(); } });
  socket.on("error", () => {});
  onOpen(ws);
}

/* ---------- Sala ---------- */

const players = []; // { token, name, seat, ws, lastSeen, held, counters, forced }
const sockets = new Set();
let phase = "lobby"; // lobby | play | over
let hostToken = null;
let cfg = { bots: 2, diff: "medio", map: "rand", target: 3, drops: 1 };
let results = null;
let roster = [];
let lastNoHumans = 0;

const connected = p => p.ws && p.ws.open;
const byToken = t => players.find(p => p.token === t);

function fixHost() {
  const h = byToken(hostToken);
  if (h && connected(h) && h.seat >= 0) return;
  const next = players.find(p => connected(p) && p.seat >= 0) || players.find(connected);
  hostToken = next ? next.token : null;
}

function freeSeat() {
  for (let s = 0; s < MAX_SEATS; s++) if (!players.some(p => p.seat === s)) return s;
  return -1;
}

function cleanName(n, seat) {
  const s = String(n || "").replace(/[<>&"]/g, "").replace(/\s+/g, " ").trim().slice(0, 12);
  return s || (seat >= 0 ? `J${seat + 1}` : "Visitante");
}

function lobbyMsg(p) {
  return JSON.stringify({
    t: "lobby", phase, cfg, results,
    you: { seat: p ? p.seat : -1, host: !!p && p.token === hostToken, token: p && p.token },
    players: players.filter(x => x.seat >= 0).sort((a, b) => a.seat - b.seat)
      .map(x => ({ seat: x.seat, name: x.name, on: connected(x), host: x.token === hostToken })),
    specs: players.filter(x => x.seat < 0 && connected(x)).length,
    addresses: lanAddresses().map(ip => `http://${ip}:${PORT}${BASE}`),
  });
}
function broadcastLobby() {
  fixHost();
  for (const ws of sockets) ws.send(lobbyMsg(ws.player));
}

function startMatch() {
  const humans = players.filter(p => p.seat >= 0 && connected(p)).sort((a, b) => a.seat - b.seat);
  const nBots = Math.max(0, Math.min(cfg.bots, MAX_SEATS - humans.length));
  if (humans.length + nBots < 2) return "Precisa de pelo menos 2 lutadores: adicione bots.";
  const usedColors = new Set(humans.map(h => h.seat));
  const freeColors = [0, 1, 2, 3].filter(c => !usedColors.has(c));
  const names = M.shuffle(M.BOT_NAMES.slice());
  const slots = [
    ...humans.map(h => ({ type: "net", token: h.token, color: h.seat, name: h.name, seat: h.seat })),
    ...Array.from({ length: nBots }, (_, i) => ({ type: "bot-" + cfg.diff, color: freeColors[i], name: names[i] })),
  ];
  for (const p of players) { p.held = M.blankInput(); p.forced = new Set(); }
  phase = "play"; pendingEvents = [];
  M.startMatch({ slots, map: cfg.map, target: cfg.target, drops: cfg.drops }, false);
  roster = M.game.fighters.map(f => ({ name: f.name, color: f.ctrl.color, bot: f.isBot, seat: f.ctrl.seat ?? -1 }));
  results = null;
  lastSent = { banner: undefined, feedTop: undefined, feedLen: -1 };
  const msg = JSON.stringify({ t: "match", roster, target: cfg.target });
  for (const ws of sockets) ws.send(msg);
  broadcastLobby();
  console.log(`Partida começou: ${slots.map(s => s.name).join(", ")}`);
  return null;
}

M.hooks.matchEnd = () => {
  phase = "over";
  const g = M.game;
  results = g.fighters.map((f, i) => ({ name: f.name, color: f.ctrl.color, bot: f.isBot, w: g.scores[i], k: g.kills[i] }))
    .sort((a, b) => b.w - a.w || b.k - a.k);
  sendSnapshot();
  broadcastLobby();
};

/* ---------- Mensagens ---------- */

function onMessage(ws, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  const p = ws.player;

  if (m.t === "join") {
    let pl = byToken(m.token);
    if (pl) {
      if (pl.ws && pl.ws !== ws && pl.ws.open) { const old = pl.ws; old.player = null; old.close(); }
    } else {
      pl = { token: crypto.randomUUID(), seat: freeSeat(), held: M.blankInput(), counters: {}, forced: new Set() };
      players.push(pl);
      console.log(`${cleanName(m.name, pl.seat)} entrou ${pl.seat >= 0 ? `(lugar ${pl.seat + 1})` : "(assistindo)"}`);
    }
    if (pl.seat < 0 && phase !== "play") { const s = freeSeat(); if (s >= 0) pl.seat = s; }
    pl.name = cleanName(m.name, pl.seat);
    pl.ws = ws; pl.lastSeen = Date.now();
    ws.player = pl;
    if (phase !== "lobby") ws.send(JSON.stringify({ t: "match", roster, target: M.game.cfg?.target ?? cfg.target }));
    broadcastLobby();
    if (phase === "over") sendSnapshot();
    return;
  }
  if (!p) return;
  p.lastSeen = Date.now();

  if (m.t === "i") {
    const k = m.k | 0;
    KEYS.forEach((key, i) => { p.held[key] = !!(k & (1 << i)); });
    p.held.aim = typeof m.a === "number" && isFinite(m.a) ? m.a : null;
    if (Array.isArray(m.c)) PRESS_KEYS.forEach((key, i) => {
      const c = m.c[i] | 0;
      if (p.counters[key] !== undefined && c !== p.counters[key]) p.forced.add(key);
      p.counters[key] = c;
    });
    return;
  }
  if (m.t === "name") { p.name = cleanName(m.name, p.seat); broadcastLobby(); return; }

  const isHost = p.token === hostToken;
  const err = e => ws.send(JSON.stringify({ t: "err", msg: e }));
  if (m.t === "cfg") {
    if (!isHost || phase === "play") return;
    const c = m.cfg || {};
    if (Number.isInteger(c.bots) && c.bots >= 0 && c.bots <= 3) cfg.bots = c.bots;
    if (["facil", "medio", "dificil"].includes(c.diff)) cfg.diff = c.diff;
    if (c.map === "rand" || (Number.isInteger(+c.map) && +c.map >= 0 && +c.map < M.MAPS.length)) cfg.map = String(c.map);
    if ([1, 2, 3, 5, 7].includes(c.target)) cfg.target = c.target;
    if ([0.6, 1, 1.8].includes(c.drops)) cfg.drops = c.drops;
    broadcastLobby();
    return;
  }
  if (m.t === "start") {
    if (!isHost) return err("Só o anfitrião pode começar.");
    if (phase === "play") return;
    const e = startMatch();
    if (e) err(e);
    return;
  }
  if (m.t === "toLobby") {
    if (!isHost || phase !== "over") return;
    phase = "lobby"; results = null;
    // quem estava assistindo ganha lugar se houver
    for (const pl of players) if (pl.seat < 0 && connected(pl)) { const s = freeSeat(); if (s >= 0) pl.seat = s; }
    broadcastLobby();
  }
  if (m.t === "leave") { // sair de vez libera o lugar
    players.splice(players.indexOf(p), 1);
    ws.player = null;
    broadcastLobby();
  }
}

/* ---------- Simulação e fotos ---------- */

let pendingEvents = [];
let lastSent = { banner: undefined, feedTop: undefined, feedLen: -1 };
const r1 = v => Math.round(v);
const r2 = v => Math.round(v * 100) / 100;
M.setEmit((...ev) => {
  if (phase !== "play") return;
  pendingEvents.push(ev.map(v => (typeof v === "number" ? Math.round(v * 10) / 10 : v)));
});

function applyInputs() {
  for (const f of M.game.fighters) {
    if (f.ctrl.type !== "net") continue;
    const p = byToken(f.ctrl.token);
    if (!p || !connected(p)) { f.inp = M.blankInput(); continue; }
    const inp = { ...p.held, face: 0 };
    for (const k of p.forced) { inp[k] = true; f.prev[k] = false; }
    p.forced.clear();
    f.inp = inp;
  }
}

function sendSnapshot() {
  const g = M.game, L = g.level;
  const s = {
    t: "s", tm: Math.round(performance.now()), rd: g.round, mp: g.mapIdx,
    f: g.fighters.map(f => [r1(f.x), r1(f.y), f.h, r1(f.vx), f.dir,
      (f.alive ? 1 : 0) | (f.crouch ? 2 : 0) | (f.onGround ? 4 : 0) | (f.melee ? 8 : 0),
      Math.ceil(Math.max(0, f.hp)), GUN_IDX.indexOf(f.gun), f.ammo, f.grenades,
      r2(Math.max(0, f.meleeAnim)), r2(f.deadT), r2(f.anim), r2(Math.max(0, f.hurtT)), r2(Math.max(0, f.flash)),
      f.aim == null ? null : r2(f.aim)]),
    b: g.bullets.map(b => [b.id, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), r1(b.sx), r1(b.sy), b.tracer ? 1 : 0]),
    r: g.rockets.map(r => [r.id, r1(r.x), r1(r.y), r1(r.vx), r1(r.vy)]),
    g: g.grenades.map(n => [n.id, r1(n.x), r1(n.y), r2(n.fuse), r2(n.spin)]),
    p: g.pickups.map(p => [p.id, ITEM_IDX.indexOf(p.type), r1(p.x), r1(p.y), p.chute ? 1 : 0, r2(p.life)]),
    o: L.objs.map(o => (o.alive ? Math.max(1, Math.round(o.hp)) * (o.hurtT > 0 ? -1 : 1) : 0)),
    sc: g.scores, k: g.kills,
    x: (g.suddenDeath ? 1 : 0) | (g.ending ? 2 : 0) | (g.slowmo > 0 ? 4 : 0) | (phase === "over" ? 8 : 0),
    ev: pendingEvents,
  };
  if (g.banner !== lastSent.banner) {
    lastSent.banner = g.banner;
    s.bn = g.banner ? [g.banner.text, g.banner.sub || "", g.banner.color || "", g.banner.dur, r2(g.banner.t)] : 0;
  }
  if (g.feed[0] !== lastSent.feedTop || g.feed.length !== lastSent.feedLen) {
    lastSent.feedTop = g.feed[0]; lastSent.feedLen = g.feed.length;
    s.fd = g.feed.map(e => [e.text, r2(e.t)]);
  }
  pendingEvents = [];
  const text = JSON.stringify(s);
  for (const ws of sockets) ws.send(text);
}

let last = performance.now(), acc = 0, snapAcc = 0;
setInterval(() => {
  const now = performance.now();
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (phase !== "play") return;
  const g = M.game;
  const ts = g.slowmo > 0 ? 0.3 : 1;
  g.slowmo -= real;
  acc += real * ts;
  let n = 0;
  while (acc >= M.STEP && n < 30) { applyInputs(); M.step(M.STEP); acc -= M.STEP; n++; }
  if (n >= 30) acc = 0;
  M.roundFlow(real);
  if (phase !== "play") return; // a partida pode ter acabado agora
  snapAcc += real;
  if (snapAcc >= 1 / SNAP_HZ) { snapAcc %= 1 / SNAP_HZ; sendSnapshot(); }

  // todos os humanos saíram: volta para o lobby
  const anyHuman = g.fighters.some(f => f.ctrl.type === "net" && connected(byToken(f.ctrl.token) || {}));
  if (anyHuman) lastNoHumans = 0;
  else if (!lastNoHumans) lastNoHumans = now;
  else if (now - lastNoHumans > 5000) { phase = "lobby"; lastNoHumans = 0; broadcastLobby(); }
}, 1000 / 60);

// limpa quem saiu há tempo (fora de partida)
setInterval(() => {
  if (phase === "play") return;
  const before = players.length;
  for (let i = players.length - 1; i >= 0; i--)
    if (!connected(players[i]) && Date.now() - players[i].lastSeen > 15000) players.splice(i, 1);
  if (players.length !== before) broadcastLobby();
}, 3000);

/* ---------- HTTP ---------- */

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

const FILES = {
  "/": ["online.html", "text/html; charset=utf-8"],
  "/index.html": ["online.html", "text/html; charset=utf-8"],
  "/motor.js": ["motor.js", "text/javascript; charset=utf-8"],
  "/visual.js": ["visual.js", "text/javascript; charset=utf-8"],
};

function handle(req, res, pathname) {
  if (pathname === undefined) pathname = new URL(req.url, "http://x").pathname;
  const f = FILES[pathname];
  if (!f || req.method !== "GET") { res.writeHead(404); return res.end("Não encontrado"); }
  fs.readFile(path.join(__dirname, f[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end("Arquivo não encontrado"); }
    res.writeHead(200, { "Content-Type": f[1], "Cache-Control": "no-store" });
    res.end(data);
  });
}

function upgrade(req, socket, head, pathname) {
  if (pathname === undefined) pathname = new URL(req.url, "http://x").pathname;
  if (pathname !== "/ws") return socket.destroy();
  wsAccept(req, socket, ws => {
    sockets.add(ws);
    ws.onmessage = text => onMessage(ws, text);
    ws.onclose = () => {
      sockets.delete(ws);
      if (ws.player) { ws.player.lastSeen = Date.now(); ws.player.held = M.blankInput(); }
      broadcastLobby();
    };
  });
}

module.exports = {
  handle, upgrade, lanAddresses,
  configure({ port, base } = {}) { if (port) PORT = port; if (base) BASE = base; },
};

if (require.main === module) {
  const server = http.createServer((req, res) => handle(req, res));
  server.on("upgrade", (req, socket, head) => upgrade(req, socket, head));
  server.listen(PORT, "0.0.0.0", () => {
    console.log("🔫 Tiro & Treta Online rodando!");
    console.log("Abra no navegador (mesma rede Wi-Fi):");
    console.log(`  http://localhost:${PORT}`);
    lanAddresses().forEach(ip => console.log(`  http://${ip}:${PORT}`));
  });
}
