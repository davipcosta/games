// Ofensiva — servidor autoritativo para rede local (sem dependências).
// Uso sozinho: node ofensiva/server.js   (porta 3000, ou PORT=8080 ...)
// Dentro do hub: o server.js da raiz monta este módulo em /ofensiva/.
//
// Cada navegador simula o próprio movimento e manda posição + tiros; o servidor
// confere, resolve acertos (com "volta no tempo" para compensar o atraso), roda os
// bots, as granadas, a bomba e as rodadas, e manda fotos do mundo 30x por segundo.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const OF = require("./shared.js");
const Bots = require("./bots.js");

let PORT = Number(process.env.PORT) || 3000;
let BASE = "/";
const TICK = 1 / 60;
const MAX_PLAYERS = 16;
const W = OF.WEAPONS;
const WI = Object.fromEntries(OF.WEP_LIST.map((k, i) => [k, i]));
const FREEZE = 5, ROUND_TIME = 115, BOMB_TIME = 40, PLANT_TIME = 3, END_TIME = 5, BUY_TIME = 25;

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

const humans = []; // { token, name, ws, lastSeen, pref, pid }
const sockets = new Set();
let phase = "lobby"; // lobby | play | over
let hostToken = null;
let cfg = { mode: "defuse", map: 0, bots: 5, diff: "medio", rounds: 8, frags: 30, minutes: 10, ggk: 1 };
let results = null;
let G = null;
let nextId = 1;
let lastNoHumans = 0;
const clock = () => performance.now() / 1000;

const connected = h => h && h.ws && h.ws.open;
const byToken = t => humans.find(h => h.token === t);

function fixHost() {
  const h = byToken(hostToken);
  if (h && connected(h)) return;
  const next = humans.find(connected);
  hostToken = next ? next.token : null;
}

function cleanName(n) {
  return String(n || "").replace(/[<>&"]/g, "").replace(/\s+/g, " ").trim().slice(0, 14) || "Jogador";
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

function lobbyMsg(h) {
  return JSON.stringify({
    t: "lobby", phase, cfg, results,
    you: { host: !!h && h.token === hostToken, token: h && h.token, pref: h ? h.pref : "auto" },
    players: humans.filter(connected).map(x => ({ name: x.name, host: x.token === hostToken, pref: x.pref })),
    addresses: lanAddresses().map(ip => `http://${ip}:${PORT}${BASE}`),
    maps: OF.MAPS.map(m => m.nome),
  });
}
function broadcastLobby() {
  fixHost();
  for (const ws of sockets) ws.send(lobbyMsg(ws.human));
}
const sendTo = (p, obj) => { const h = p && !p.bot && byToken(p.token); if (connected(h)) h.ws.send(JSON.stringify(obj)); };
const broadcast = obj => { const s = JSON.stringify(obj); for (const ws of sockets) ws.send(s); };

/* ---------- Jogadores ---------- */

function teamCount(team) { let n = 0; for (const p of G.players.values()) if (p.team === team) n++; return n; }

function pickTeam(pref) {
  if (G.mode !== "defuse") return "f";
  if (pref === "r" || pref === "t") return pref;
  const r = teamCount("r"), t = teamCount("t");
  return r < t ? "r" : t < r ? "t" : (Math.random() < 0.5 ? "r" : "t");
}

function defaultPistol(p) { return p.team === "r" ? "glock" : "usp"; }
function mkItem(w) { const d = W[w]; return { w, mag: d.mag || 0, res: d.res || 0 }; }

function resetInv(p) {
  p.inv = { 1: null, 2: mkItem(defaultPistol(p)), 3: { w: "faca" }, 4: { he: 0, flash: 0, smoke: 0 }, 5: false };
  p.cur = p.inv[2].w; p.cs++;
}

function newPlayer(name, bot, token) {
  const p = {
    id: nextId++, name, bot, token, team: "f", alive: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, crouch: false, onGround: true, walk: false, speedMul: 1,
    hp: 0, armor: 0, helmet: false, kit: false, money: 800, inv: null, cur: "faca", cs: 0,
    nextFire: 0, reloadT: 0, kills: 0, deaths: 0, score: 0, gg: 0, ggk: 0, hist: [], respawnT: 0, prot: 0,
    tpSeq: 0, lastSt: null, using: false, plantT: -1, plantPos: null, ping: 0, blindT: 0, spawnT: 0,
    dmPrimary: null, scoped: false, ai: null, leftT: 0,
  };
  return p;
}

function addPlayer(name, bot, token, pref) {
  const p = newPlayer(name, bot, token);
  p.team = pickTeam(pref);
  G.players.set(p.id, p);
  resetInv(p);
  if (G.mode === "defuse") {
    // entrou no começo da rodada: já joga
    if (G.round && G.round.st === "freeze") spawnDefuse(p, true);
  } else p.respawnT = G.now + 0.5;
  return p;
}

function removePlayer(p) {
  if (p.alive) dropAll(p);
  G.players.delete(p.id);
  if (G.bomb && G.bomb.carrier === p.id && G.bomb.st === "carried") G.bomb.st = "none";
}

function tp(p) {
  p.tpSeq++;
  p.lastSt = { x: p.x, y: p.y, z: p.z, t: G.now };
  sendTo(p, { t: "tp", n: p.tpSeq, x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw) });
}

const r2 = v => Math.round(v * 100) / 100;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function faceCenter(p) {
  const m = G.map, cx = m.w * OF.CELL / 2, cz = m.h * OF.CELL / 2;
  p.yaw = Math.atan2(-(cx - p.x), -(cz - p.z)); p.pitch = 0;
}

function placeAt(p, x, z) {
  p.x = x; p.z = z; p.y = OF.floorUnder(G.map, x, z);
  p.vx = p.vy = p.vz = 0; p.crouch = false; p.onGround = true; p.hist = [];
  p.reloadT = 0; p.using = false; p.plantT = -1; p.scoped = false; p.blindT = 0;
}

function spawnDefuse(p, fresh) {
  const list = G.spawnQueue[p.team];
  const spot = list.length ? list.pop() : G.map.spawns[p.team][(Math.random() * G.map.spawns[p.team].length) | 0];
  const jx = (Math.random() - 0.5) * 0.6, jz = (Math.random() - 0.5) * 0.6;
  if (fresh || !p.alive) { resetInv(p); p.armor = 0; p.helmet = false; p.kit = false; }
  placeAt(p, spot[0] + jx, spot[1] + jz);
  faceCenter(p);
  p.alive = true; p.hp = 100; p.spawnT = G.now;
  if (p.bot) { Bots.initAI(p); }
  tp(p);
}

function spawnFree(p) {
  const m = G.map, others = [...G.players.values()].filter(q => q.alive && q !== p);
  let best = null, bd = -1;
  for (let k = 0; k < 16; k++) {
    const i = m.open[(Math.random() * m.open.length) | 0];
    const x = (i % m.w + 0.5) * OF.CELL, z = (((i / m.w) | 0) + 0.5) * OF.CELL;
    let d = 1e9;
    for (const q of others) d = Math.min(d, Math.hypot(q.x - x, q.z - z));
    if (d > bd) { bd = d; best = [x, z]; }
  }
  placeAt(p, best[0], best[1]);
  faceCenter(p);
  p.yaw += (Math.random() - 0.5) * 2;
  p.alive = true; p.hp = 100; p.armor = 100; p.helmet = true; p.prot = 1.5; p.spawnT = G.now;
  if (G.mode === "gg") ggEquip(p, true);
  else {
    resetInv(p);
    p.inv[2] = mkItem("usp");
    const prim = p.dmPrimary || (p.bot ? ["fuzilR", "fuzilT", "smg", "escopeta", "sniper", "fuzilR", "fuzilT"][(Math.random() * 7) | 0] : "fuzilR");
    if (p.bot) p.dmPrimary = prim;
    p.inv[1] = mkItem(prim); p.inv[4].he = 1;
    p.cur = prim; p.cs++;
  }
  if (p.bot) Bots.initAI(p);
  tp(p);
}

function ggEquip(p, spawning) {
  const w = OF.GG_LADDER[Math.min(p.gg, OF.GG_LADDER.length - 1)];
  p.inv = { 1: null, 2: null, 3: { w: "faca" }, 4: { he: 0, flash: 0, smoke: 0 }, 5: false };
  if (W[w].slot !== 3) p.inv[W[w].slot] = mkItem(w);
  p.cur = w; p.cs++; p.reloadT = 0; p.scoped = false;
  if (!spawning) p.nextFire = Math.max(p.nextFire, G.now + 0.3);
}

function owns(p, w) {
  const d = W[w];
  if (!d || !p.inv) return false;
  if (d.slot === 1 || d.slot === 2) return p.inv[d.slot] && p.inv[d.slot].w === w;
  if (d.slot === 3) return true;
  if (d.slot === 4) return p.inv[4][w] > 0;
  if (d.slot === 5) return !!p.inv[5];
  return false;
}

function bestWeapon(p) {
  return p.inv[1] ? p.inv[1].w : p.inv[2] ? p.inv[2].w : "faca";
}

function switchTo(p, w, serverSide = true) {
  if (!owns(p, w) || p.cur === w) return;
  p.cur = w; p.reloadT = 0; p.scoped = false; p.plantT = -1;
  p.nextFire = Math.max(p.nextFire, G.now + 0.3);
  if (serverSide) p.cs++;
}

/* ---------- Itens no chão ---------- */

function dropItem(p, item, vel) {
  const f = OF.dirFromAngles(p.yaw, 0);
  G.items.push({
    id: G.nextItem++, w: item.w, mag: item.mag || 0, res: item.res || 0,
    x: p.x, y: p.y + 1.2, z: p.z, vx: f[0] * vel + p.vx * 0.5, vy: 1.5, vz: f[2] * vel + p.vz * 0.5,
    t: G.now, by: p.id,
  });
}

function dropAll(p) {
  if (G.mode !== "defuse") return;
  const it = p.inv[1] || p.inv[2];
  if (it) dropItem(p, it, 1.5);
  if (p.inv[5]) dropBomb(p, 1);
}

function dropBomb(p, vel) {
  p.inv[5] = false;
  dropItem(p, { w: "bomba" }, vel);
  G.bomb = { st: "dropped", item: G.items[G.items.length - 1].id, x: p.x, y: p.y, z: p.z };
  if (p.cur === "bomba") { p.cur = bestWeapon(p); p.cs++; }
  teamMsg("r", "A bomba caiu!", "#ffb347");
}

function dropCurrent(p) {
  if (!p.alive || G.mode !== "defuse") return;
  const d = W[p.cur];
  if (p.cur === "bomba") return dropBomb(p, 4);
  if (!d || (d.slot !== 1 && d.slot !== 2)) return;
  const it = p.inv[d.slot];
  if (!it) return;
  p.inv[d.slot] = null;
  dropItem(p, it, 4);
  p.cur = bestWeapon(p); p.cs++; p.reloadT = 0; p.scoped = false;
}

function updateItems(dt) {
  const m = G.map;
  for (let i = G.items.length - 1; i >= 0; i--) {
    const it = G.items[i];
    if (it.vx || it.vy || it.vz) {
      it.vy -= OF.GRAV * dt;
      const nx = it.x + it.vx * dt, nz = it.z + it.vz * dt;
      if (!OF.pointSolid(m, nx, it.y, it.z)) it.x = nx; else it.vx *= -0.3;
      if (!OF.pointSolid(m, it.x, it.y, nz)) it.z = nz; else it.vz *= -0.3;
      const fl = OF.floorUnder(m, it.x, it.z, 0.05);
      it.y += it.vy * dt;
      if (it.y <= fl + 0.05) { it.y = fl + 0.05; it.vx = it.vy = it.vz = 0; }
      if (it.w === "bomba" && G.bomb.st === "dropped") { G.bomb.x = it.x; G.bomb.y = it.y; G.bomb.z = it.z; }
    }
    if (G.now - it.t > 90 && it.w !== "bomba") { G.items.splice(i, 1); continue; }
    for (const p of G.players.values()) {
      if (!p.alive || Math.abs(p.x - it.x) > 0.9 || Math.abs(p.z - it.z) > 0.9 || it.y - p.y > 1.4 || p.y - it.y > 0.6) continue;
      if (it.by === p.id && G.now - it.t < 1.2) continue;
      if (it.w === "bomba") {
        if (p.team !== "r") continue;
        p.inv[5] = true; G.bomb = { st: "carried", carrier: p.id };
        sendTo(p, { t: "cm", x: "Você pegou a bomba", c: "#ffb347" });
      } else {
        const slot = W[it.w].slot;
        if (p.inv[slot]) continue;
        p.inv[slot] = { w: it.w, mag: it.mag, res: it.res };
        if (W[p.cur].slot > slot || p.cur === "faca") { p.cur = it.w; p.cs++; }
      }
      G.ev.push(["pk", p.id]);
      G.items.splice(i, 1);
      break;
    }
  }
}

/* ---------- Tiros e dano ---------- */

function posAt(q, vt) {
  if (vt == null || !q.hist.length) return [q.x, q.y, q.z, q.crouch];
  const h = q.hist;
  if (vt >= h[h.length - 1][0]) return [q.x, q.y, q.z, q.crouch];
  for (let k = h.length - 1; k > 0; k--) {
    const a = h[k - 1], b = h[k];
    if (vt >= a[0]) {
      const f = (vt - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, f < 0.5 ? a[4] : b[4]];
    }
  }
  const a = h[0];
  return [a[1], a[2], a[3], a[4]];
}

const enemyOf = (a, b) => G.mode !== "defuse" || a.team !== b.team;

function trace(p, o, d, range, vt, pad = 0) {
  const wh = OF.rayWorld(G.map, o[0], o[1], o[2], d[0], d[1], d[2], range);
  let best = wh ? wh.t : range, victim = null, part = null;
  for (const q of G.players.values()) {
    if (q === p || !q.alive || !enemyOf(p, q)) continue;
    const [x, y, z, c] = posAt(q, vt);
    // descarte rápido: distância do raio ao centro do jogador
    const vx = x - o[0], vy = y + 0.9 - o[1], vz = z - o[2];
    const tc = vx * d[0] + vy * d[1] + vz * d[2];
    if (tc < -1 || tc > best + 1) continue;
    const px = vx - d[0] * tc, py = vy - d[1] * tc, pz = vz - d[2] * tc;
    if (px * px + py * py + pz * pz > 2.5) continue;
    for (const b of OF.hitboxes(x, y, z, c, pad)) {
      const t = OF.rayBox(o[0], o[1], o[2], d[0], d[1], d[2], b);
      if (t >= 0 && t < best) { best = t; victim = q; part = b[0]; }
    }
  }
  return { t: best, victim, part, world: !victim && !!wh, n: wh };
}

function hurt(v, a, hp, armor, wkey, part, at) {
  if (!v.alive || v.prot > 0 || G.over) return;
  v.hp -= hp; v.armor = Math.max(0, v.armor - armor);
  G.ev.push(["h", v.id, a ? a.id : -1, hp, part === "head" ? 1 : 0, r2(at[0]), r2(at[1]), r2(at[2])]);
  if (v.bot) Bots.hurt(G, v, a);
  if (v.hp <= 0) kill(v, a, wkey, part === "head");
}

function fire(p, dirs, opt = {}) {
  if (!p.alive || G.over) return false;
  if (G.mode === "defuse" && G.round.st === "freeze") return false;
  const w = W[p.cur];
  if (!w || w.nade || p.cur === "bomba") return false;
  if (G.now < p.nextFire - 0.05) return false;
  const rate = w.melee && opt.heavy ? w.rate2 : w.rate;
  p.nextFire = Math.max(G.now, p.nextFire) + rate;
  p.prot = 0;
  const eye = [p.x, p.y + OF.eyeHeight(p.crouch), p.z];
  let o = eye;
  if (opt.o && Math.hypot(opt.o[0] - eye[0], opt.o[1] - eye[1], opt.o[2] - eye[2]) < 1.5) o = opt.o;
  const vt = opt.vt;

  if (w.melee) {
    const d = dirs[0];
    const tr = trace(p, o, d, w.range, vt, 0.12);
    G.ev.push(["f", p.id, WI.faca, opt.heavy ? 1 : 0]);
    if (tr.victim) {
      const v = tr.victim;
      const vf = OF.dirFromAngles(v.yaw, 0);
      const back = vf[0] * d[0] + vf[2] * d[2] > 0.5;
      let dmg = opt.heavy ? w.dmg2 : w.dmg;
      if (back) dmg = opt.heavy ? 195 : dmg * 3;
      if (tr.part === "head") dmg *= 1.3;
      let ar = 0;
      if (v.armor > 0) { ar = dmg * 0.15 * 0.5; dmg *= 0.85; }
      const at = [o[0] + d[0] * tr.t, o[1] + d[1] * tr.t, o[2] + d[2] * tr.t];
      hurt(v, p, Math.round(dmg), Math.round(ar), "faca", tr.part, at);
    }
    return true;
  }

  const it = p.inv[w.slot];
  if (!it || it.w !== p.cur || it.mag <= 0 || p.reloadT > 0) return false;
  it.mag--;
  if (G.mode === "gg" && it.mag === 0) { /* recarga automática no cliente */ }
  const n = Math.min(dirs.length, w.pellets || 1);
  let first = null;
  for (let k = 0; k < n; k++) {
    let d = dirs[k];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (!(l > 0.5)) continue;
    d = [d[0] / l, d[1] / l, d[2] / l];
    const tr = trace(p, o, d, 250, vt);
    const at = [o[0] + d[0] * tr.t, o[1] + d[1] * tr.t, o[2] + d[2] * tr.t];
    if (!first) first = at;
    if (tr.victim) {
      const v = tr.victim;
      const dmg = OF.damageCalc(w, tr.t, tr.part, v.armor, v.helmet);
      hurt(v, p, dmg.hp, dmg.armor, p.cur, tr.part, at);
    }
  }
  if (first) G.ev.push(["f", p.id, WI[p.cur], r2(first[0]), r2(first[1]), r2(first[2])]);
  Bots.heard(G, p.x, p.z, p);
  return true;
}

function reload(p) {
  const w = W[p.cur];
  if (!p.alive || !w || !w.mag) return;
  const it = p.inv[w.slot];
  if (!it || p.reloadT > 0 || it.mag >= w.mag) return;
  if (it.res <= 0 && G.mode !== "gg") return;
  p.reloadT = w.reload; p.scoped = false;
  G.ev.push(["r", p.id]);
}

function finishReload(p) {
  const w = W[p.cur], it = w && p.inv[w.slot];
  if (!it || !w.mag) return;
  if (G.mode === "gg") { it.mag = w.mag; return; }
  const take = Math.min(w.mag - it.mag, it.res);
  it.mag += take; it.res -= take;
}

function kill(v, a, wkey, hs, quiet) {
  v.alive = false; v.hp = 0; v.deaths++; v.using = false; v.plantT = -1; v.reloadT = 0;
  G.ev.push(["k", a ? a.id : -1, v.id, WI[wkey] ?? -1, hs ? 1 : 0]);
  if (G.bomb && G.bomb.defuser === v.id) { G.bomb.defuser = null; G.bomb.prog = 0; }
  dropAll(v);
  if (a && a !== v && enemyOf(a, v)) {
    a.kills++; a.score++;
    if (G.mode === "defuse") a.money = Math.min(16000, a.money + (wkey === "faca" ? 1500 : 300));
    if (G.mode === "gg") ggAdvance(a, v, wkey);
  } else if (!quiet && wkey !== "bomba") { v.kills = Math.max(-99, v.kills - 1); v.score--; }
  if (G.mode !== "defuse") v.respawnT = G.now + (G.mode === "gg" ? 1.6 : 2.2);
  if (G.mode === "dm" && a && a.score >= cfg.frags) endMatch(a);
}

function ggAdvance(a, v, wkey) {
  const last = OF.GG_LADDER.length - 1;
  if (wkey === "faca" && v.gg > 0 && a.gg !== last) {
    v.gg--; v.ggk = 0;
    G.ev.push(["gd", v.id, a.id]);
  }
  a.ggk++;
  if (a.gg === last || a.ggk >= cfg.ggk || wkey === "faca") {
    a.gg++; a.ggk = 0;
    if (a.gg > last) return endMatch(a);
    if (a.alive) ggEquip(a, false);
    G.ev.push(["gu", a.id, a.gg]);
  }
}

/* ---------- Granadas ---------- */

function throwNade(p, d, o) {
  if (!p.alive || G.over) return;
  if (G.mode === "defuse" && G.round.st === "freeze") return;
  const type = p.cur;
  if (!OF.NADES.includes(type) || !(p.inv[4][type] > 0) || G.now < p.nextFire - 0.05) return;
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!(l > 0.5)) return;
  d = [d[0] / l, d[1] / l, d[2] / l];
  p.inv[4][type]--;
  p.nextFire = G.now + 0.6;
  const eye = [p.x, p.y + OF.eyeHeight(p.crouch), p.z];
  const spd = 15;
  const n = {
    id: G.nextItem++, type, by: p.id, x: eye[0] + d[0] * 0.3, y: eye[1] + d[1] * 0.3, z: eye[2] + d[2] * 0.3,
    vx: d[0] * spd + p.vx * 0.5, vy: d[1] * spd + 2, vz: d[2] * spd + p.vz * 0.5,
    fuse: type === "smoke" ? 1.6 : 1.5,
  };
  if (OF.pointSolid(G.map, n.x, n.y, n.z)) { n.x = eye[0]; n.y = eye[1]; n.z = eye[2]; }
  G.nades.push(n);
  G.ev.push(["t", p.id]);
  p.cur = p.inv[4][type] > 0 ? type : bestWeapon(p); p.cs++;
}

function updateNades(dt) {
  const m = G.map;
  for (let i = G.nades.length - 1; i >= 0; i--) {
    const n = G.nades[i];
    n.vy -= OF.GRAV * 0.9 * dt;
    let bounced = false;
    const nx = n.x + n.vx * dt;
    if (OF.pointSolid(m, nx, n.y, n.z)) { n.vx *= -0.45; n.vz *= 0.8; bounced = true; } else n.x = nx;
    const nz = n.z + n.vz * dt;
    if (OF.pointSolid(m, n.x, n.y, nz)) { n.vz *= -0.45; n.vx *= 0.8; bounced = true; } else n.z = nz;
    const ny = n.y + n.vy * dt;
    if (OF.pointSolid(m, n.x, ny, n.z)) {
      if (n.vy < 0) { n.vy = Math.abs(n.vy) < 2 ? 0 : -n.vy * 0.4; n.vx *= 0.7; n.vz *= 0.7; }
      else n.vy = -n.vy * 0.3;
      if (Math.abs(n.vy) > 1) bounced = true;
    } else n.y = ny;
    if (n.vy === 0) { const k = Math.max(0, 1 - 3 * dt); n.vx *= k; n.vz *= k; }
    if (bounced && Math.hypot(n.vx, n.vy, n.vz) > 2) G.ev.push(["nb", r2(n.x), r2(n.y), r2(n.z)]);
    n.fuse -= dt;
    const slow = Math.hypot(n.vx, n.vy, n.vz) < 0.6;
    if (n.fuse <= 0 && (n.type !== "smoke" || slow || n.fuse < -2)) {
      G.nades.splice(i, 1);
      detonate(n);
    }
  }
  for (let i = G.smokes.length - 1; i >= 0; i--) if (G.now - G.smokes[i].t > 18) G.smokes.splice(i, 1);
}

function detonate(n) {
  const m = G.map, by = G.players.get(n.by);
  if (n.type === "he") {
    G.ev.push(["x", 0, r2(n.x), r2(n.y), r2(n.z)]);
    for (const q of G.players.values()) {
      if (!q.alive || (by && q !== by && !enemyOf(by, q))) continue;
      const cy = q.y + 1.0, d = Math.hypot(q.x - n.x, cy - n.y, q.z - n.z);
      if (d > 9 || !OF.clearLine(m, n.x, n.y + 0.2, n.z, q.x, cy, q.z)) continue;
      let dmg = 100 * (1 - d / 9), ar = 0;
      if (q === by) dmg *= 0.5;
      if (q.armor > 0) { ar = dmg * 0.25; dmg *= 0.5; }
      if (dmg >= 1) hurt(q, by || null, Math.round(dmg), Math.round(ar), "he", "chest", [q.x, cy, q.z]);
    }
    Bots.heard(G, n.x, n.z, by || {});
  } else if (n.type === "flash") {
    G.ev.push(["x", 1, r2(n.x), r2(n.y), r2(n.z)]);
    for (const q of G.players.values()) {
      if (!q.alive || !q.bot) continue;
      const ey = q.y + OF.eyeHeight(q.crouch);
      const dx = n.x - q.x, dy = n.y - ey, dz = n.z - q.z, d = Math.hypot(dx, dy, dz);
      if (d > 30 || !OF.clearLine(m, n.x, n.y, n.z, q.x, ey, q.z)) continue;
      const f = OF.dirFromAngles(q.yaw, q.pitch), dot = (f[0] * dx + f[1] * dy + f[2] * dz) / d;
      const t = (dot > 0.5 ? 3.5 : dot > -0.2 ? 1.8 : 0.5) * Math.min(1, 1.3 - d / 30);
      q.blindT = Math.max(q.blindT, t);
    }
  } else {
    G.smokes.push({ id: n.id, x: n.x, y: OF.floorUnder(m, n.x, n.z, 0.05), z: n.z, t: G.now });
    G.ev.push(["x", 2, r2(n.x), r2(n.y), r2(n.z)]);
  }
}

/* ---------- Bomba e rodadas ---------- */

function teamMsg(team, x, c) {
  for (const p of G.players.values()) if (p.team === team) sendTo(p, { t: "cm", x, c });
}

function inBuyZone(p) {
  if (G.mode !== "defuse") return true;
  const z = G.buyZone[p.team];
  if (!z) return false;
  const cx = Math.floor(p.x / OF.CELL), cz = Math.floor(p.z / OF.CELL);
  return cx >= z.x0 && cx <= z.x1 && cz >= z.z0 && cz <= z.z1;
}
function canBuy(p) {
  if (!p.alive || G.over) return false;
  if (G.mode === "gg") return false;
  if (G.mode === "dm") return G.now - p.spawnT < 12;
  const r = G.round;
  const t = r.st === "freeze" || (r.st === "live" && G.now - r.liveStart < BUY_TIME);
  return t && inBuyZone(p);
}

function buy(p, what) {
  if (!canBuy(p)) return false;
  const free = G.mode === "dm";
  const pay = price => { if (free) return true; if (p.money < price) return false; p.money -= price; return true; };
  const e = OF.EQUIP[what];
  if (e) {
    if (e.team && e.team !== p.team && !free) return false;
    if (what === "kit") { if (p.kit || G.mode !== "defuse") return false; if (!pay(e.price)) return false; p.kit = true; return true; }
    if (what === "colete") { if (p.armor >= 100) return false; if (!pay(e.price)) return false; p.armor = 100; return true; }
    if (what === "capacete") {
      if (p.armor >= 100 && p.helmet) return false;
      const price = p.armor >= 100 ? 350 : e.price;
      if (!pay(price)) return false; p.armor = 100; p.helmet = true; return true;
    }
    return false;
  }
  const w = W[what];
  if (!w || what === "faca" || what === "bomba") return false;
  if (w.team && w.team !== p.team && !free) return false;
  if (w.nade) {
    if (p.inv[4][what] >= w.max) return false;
    if (!pay(w.price)) return false;
    p.inv[4][what]++;
    return true;
  }
  if (p.inv[w.slot] && p.inv[w.slot].w === what) {
    // já tem: compra só munição
    const it = p.inv[w.slot];
    if (it.res >= w.res) return false;
    if (!pay(free ? 0 : 100)) return false;
    it.res = w.res; return true;
  }
  if (!pay(w.price)) return false;
  if (p.inv[w.slot]) {
    if (G.mode === "defuse") dropItem(p, p.inv[w.slot], 1.5);
  }
  p.inv[w.slot] = mkItem(what);
  if (w.slot === 1 && G.mode === "dm") p.dmPrimary = what;
  p.cur = what; p.cs++; p.reloadT = 0; p.scoped = false;
  p.nextFire = Math.max(p.nextFire, G.now + 0.3);
  return true;
}

function newRound() {
  const r = G.round;
  G.round = { st: "freeze", t: FREEZE, n: (r ? r.n : 0) + 1, liveStart: 0 };
  G.items = []; G.nades = []; G.smokes = [];
  G.bomb = { st: "none" };
  G.plan = { site: Math.random() < 0.5 ? "A" : "B" };
  G.spawnQueue = { r: shuffle(G.map.spawns.r.slice()), t: shuffle(G.map.spawns.t.slice()) };
  const first = G.round.n === 1;
  for (const p of G.players.values()) {
    if (p.team !== "r" && p.team !== "t") continue;
    if (first) { p.money = 800; }
    if (p.inv) { p.inv[5] = false; if (p.cur === "bomba") { p.cur = bestWeapon(p); p.cs++; } }
    spawnDefuse(p, first);
    if (p.bot) Bots.buy(G, p, api);
  }
  const rebels = [...G.players.values()].filter(p => p.team === "r" && p.alive);
  if (rebels.length) {
    const c = rebels[(Math.random() * rebels.length) | 0];
    c.inv[5] = true; G.bomb = { st: "carried", carrier: c.id };
    sendTo(c, { t: "cm", x: "Você está com a bomba! Plante no A ou no B (segure E)", c: "#ffb347" });
  }
  G.ev.push(["rs", G.round.n]);
}

function endRound(winner, reason) {
  if (G.round.st === "end") return;
  G.round.st = "end"; G.round.t = END_TIME;
  G.scores[winner]++;
  const loser = winner === "r" ? "t" : "r";
  G.streak[loser]++; G.streak[winner] = 0;
  const winMoney = reason === "bomb" || reason === "defused" ? 3500 : 3250;
  const loseMoney = 1400 + 500 * Math.min(4, G.streak[loser] - 1);
  for (const p of G.players.values()) {
    if (p.team === winner) p.money += winMoney;
    else if (p.team === loser) p.money += loseMoney + (loser === "r" && G.bomb.planted ? 800 : 0);
    p.money = Math.min(16000, p.money);
    p.using = false; p.plantT = -1;
  }
  G.ev.push(["rw", winner, reason]);
  if (G.scores[winner] >= cfg.rounds) G.matchWinner = winner;
}

function updateRound(dt) {
  const r = G.round;
  if (G.mode !== "defuse") {
    r.t -= dt;
    if (r.t <= 0 && !G.over) {
      const list = [...G.players.values()];
      list.sort(G.mode === "gg" ? (a, b) => b.gg - a.gg || b.kills - a.kills : (a, b) => b.score - a.score);
      endMatch(list[0] || null);
    }
    return;
  }
  r.t -= dt;
  if (r.st === "freeze") {
    if (r.t <= 0) { r.st = "live"; r.t = ROUND_TIME; r.liveStart = G.now; G.ev.push(["go"]); }
    return;
  }
  if (r.st === "end") {
    if (r.t <= 0) {
      if (G.matchWinner) return endMatch(G.matchWinner);
      newRound();
    }
    return;
  }
  // rodada valendo
  const b = G.bomb;
  if (b.st === "planted") {
    b.timer -= dt;
    if (b.timer <= 0) { explodeBomb(); return endRound("r", "bomb"); }
  } else if (r.t <= 0) return endRound("t", "time");
  const aliveR = [...G.players.values()].filter(p => p.team === "r" && p.alive).length;
  const aliveT = [...G.players.values()].filter(p => p.team === "t" && p.alive).length;
  if (!aliveT) return endRound("r", "elim");
  if (!aliveR && b.st !== "planted") return endRound("t", "elim");
}

function explodeBomb() {
  const b = G.bomb;
  b.st = "boom";
  G.ev.push(["x", 3, r2(b.x), r2(b.y), r2(b.z)]);
  for (const q of G.players.values()) {
    if (!q.alive) continue;
    const d = Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z);
    if (d > 22) continue;
    const dmg = d < 10 ? 500 : 500 * (1 - (d - 10) / 12) * 0.4;
    hurt(q, null, Math.round(dmg), 0, "bomba", "chest", [q.x, q.y + 1, q.z]);
  }
}

function updateBombActions(p, dt) {
  const b = G.bomb, r = G.round;
  if (G.mode !== "defuse" || r.st !== "live") { p.plantT = -1; return; }
  // plantar
  if (p.team === "r" && p.inv[5] && p.using && p.onGround && OF.siteAt(G.map, p.x, p.z)) {
    if (p.plantT < 0) { p.plantT = 0; p.plantPos = [p.x, p.z]; G.ev.push(["ps", p.id]); }
    if (Math.hypot(p.x - p.plantPos[0], p.z - p.plantPos[1]) > 0.6) { p.plantT = -1; return; }
    p.plantT += dt;
    if (p.plantT >= PLANT_TIME) {
      p.inv[5] = false; p.plantT = -1;
      if (p.cur === "bomba") { p.cur = bestWeapon(p); }
      p.cs++;
      const site = OF.siteAt(G.map, p.x, p.z);
      G.bomb = { st: "planted", x: p.x, y: p.y, z: p.z, timer: BOMB_TIME, defuser: null, prog: 0, site, planted: true };
      p.money = Math.min(16000, p.money + 300);
      G.ev.push(["pl", site]);
    }
    return;
  }
  p.plantT = -1;
  // desarmar
  if (b.st !== "planted") return;
  const near = p.team === "t" && p.using && Math.hypot(p.x - b.x, p.z - b.z) < 1.7 && Math.abs(p.y - b.y) < 1.5;
  if (near && b.defuser == null) { b.defuser = p.id; b.prog = 0; b.need = p.kit ? 5 : 10; G.ev.push(["ds", p.id]); }
  if (b.defuser === p.id) {
    if (!near) { b.defuser = null; b.prog = 0; return; }
    b.prog += dt;
    if (b.prog >= b.need) {
      b.st = "defused"; b.defuser = null;
      p.money = Math.min(16000, p.money + 300);
      G.ev.push(["df", p.id]);
      endRound("t", "defused");
    }
  }
}

/* ---------- Partida ---------- */

const api = {
  move(p, inp, dt) {
    p.speedMul = OF.speedMulOf(W[p.cur], p.scoped);
    OF.move(G.map, p, inp, dt);
  },
  fire: (p, dirs, opt) => fire(p, dirs, opt),
  reload: p => reload(p),
  switchTo: (p, w) => switchTo(p, w, true),
  buy: (p, w) => buy(p, w),
};

function startMatch() {
  const list = humans.filter(connected);
  const mapIdx = Math.max(0, Math.min(OF.MAPS.length - 1, cfg.map | 0));
  const map = OF.MAPS[mapIdx];
  const prev = G;
  G = {
    mode: cfg.mode, cfg: { ...cfg }, map, mapIdx, players: new Map(), items: [], nades: [], smokes: [], ev: [],
    bomb: { st: "none" }, round: null, scores: { r: 0, t: 0 }, streak: { r: 0, t: 0 }, nextItem: 1,
    now: prev ? prev.now : clock(), over: false, matchWinner: null, plan: { site: "A" }, spawnQueue: { r: [], t: [] },
    spawnCenter: {}, buyZone: {},
  };
  for (const t of ["r", "t"]) {
    const s = map.spawns[t];
    G.spawnCenter[t] = [s.reduce((a, b) => a + b[0], 0) / s.length, s.reduce((a, b) => a + b[1], 0) / s.length];
    const cs = s.map(([x, z]) => [Math.floor(x / OF.CELL), Math.floor(z / OF.CELL)]);
    G.buyZone[t] = { x0: Math.min(...cs.map(c => c[0])) - 3, x1: Math.max(...cs.map(c => c[0])) + 3, z0: Math.min(...cs.map(c => c[1])) - 3, z1: Math.max(...cs.map(c => c[1])) + 3 };
  }
  // humanos primeiro (respeitando a preferência), depois bots equilibrando os times
  const prefFirst = list.slice().sort((a, b) => (a.pref === "auto") - (b.pref === "auto"));
  for (const h of prefFirst) { const p = addPlayer(h.name, false, h.token, h.pref); h.pid = p.id; }
  const names = shuffle(Bots.BOT_NAMES.slice());
  const nb = Math.max(0, Math.min(cfg.bots, MAX_PLAYERS - list.length));
  for (let i = 0; i < nb; i++) addPlayer(names[i % names.length], true, null, "auto");
  if (G.mode === "defuse" && (!teamCount("r") || !teamCount("t"))) {
    G = null;
    return "No modo Desarmar precisa ter gente nos dois times: adicione bots ou troque de time.";
  }
  phase = "play"; results = null;
  if (G.mode === "defuse") newRound();
  else G.round = { st: "live", t: cfg.minutes * 60, n: 1 };
  for (const h of list) sendMatch(h);
  broadcastLobby();
  console.log(`Partida: ${OF.MODES[G.mode].nome} em ${map.nome} — ${[...G.players.values()].map(p => p.name).join(", ")}`);
  return null;
}

function sendMatch(h) {
  const p = G.players.get(h.pid);
  if (!p || !connected(h)) return;
  h.ws.send(JSON.stringify({ t: "match", mode: G.mode, map: G.mapIdx, you: p.id, cfg: G.cfg }));
  lastRoster = "";
  if (p.alive) tp(p);
}

function endMatch(winner) {
  if (G.over) return;
  G.over = true;
  phase = "over";
  const list = [...G.players.values()].map(p => ({ n: p.name, tm: p.team, k: p.kills, d: p.deaths, s: p.score, gg: p.gg, b: p.bot }));
  if (G.mode === "gg") list.sort((a, b) => b.gg - a.gg || b.k - a.k);
  else list.sort((a, b) => b.s - a.s || b.k - a.k);
  let title;
  if (G.mode === "defuse") title = `${OF.TEAMS[winner].nome} venceram ${G.scores[winner]} a ${G.scores[winner === "r" ? "t" : "r"]}`;
  else title = winner ? `${winner.name} venceu!` : "Fim de partida";
  results = { title, mode: G.mode, win: G.mode === "defuse" ? winner : null, list, scores: G.scores };
  sendSnapshots();
  broadcast({ t: "over", results });
  broadcastLobby();
  console.log("Fim:", title);
}

/* ---------- Mensagens ---------- */

function onMessage(ws, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  const h = ws.human;

  if (m.t === "join") {
    let hu = byToken(m.token);
    if (hu) {
      if (hu.ws && hu.ws !== ws && hu.ws.open) { const old = hu.ws; old.human = null; old.close(); }
    } else {
      hu = { token: crypto.randomUUID(), pref: "auto", pid: 0 };
      humans.push(hu);
    }
    hu.name = cleanName(m.name);
    hu.ws = ws; hu.lastSeen = Date.now();
    ws.human = hu;
    console.log(`${hu.name} conectou`);
    if (phase === "play" && G) {
      let p = G.players.get(hu.pid);
      if (!p || p.bot) {
        if (G.players.size >= MAX_PLAYERS) {
          // tira um bot para abrir vaga
          const bot = [...G.players.values()].find(q => q.bot);
          if (bot) removePlayer(bot);
        }
        p = addPlayer(hu.name, false, hu.token, hu.pref);
        hu.pid = p.id;
      }
      p.name = hu.name; p.leftT = 0;
      sendMatch(hu);
    } else if (phase === "over" && results) ws.send(JSON.stringify({ t: "over", results }));
    broadcastLobby();
    return;
  }
  if (!h) return;
  h.lastSeen = Date.now();
  const p = G && phase !== "lobby" ? G.players.get(h.pid) : null;

  switch (m.t) {
    case "st": {
      if (!p) return;
      if (typeof m.yw === "number" && isFinite(m.yw)) p.yaw = m.yw;
      if (typeof m.pt === "number" && isFinite(m.pt)) p.pitch = Math.max(-1.6, Math.min(1.6, m.pt));
      p.using = !!m.u; p.walk = !!m.w; p.scoped = !!m.sc && !!W[p.cur]?.scope;
      if (!p.alive || m.n !== p.tpSeq) return;
      if (G.mode === "defuse" && G.round.st === "freeze") return;
      const x = +m.x, y = +m.y, z = +m.z;
      if (![x, y, z].every(isFinite)) return;
      const crouch = !!m.c;
      const last = p.lastSt || { x: p.x, y: p.y, z: p.z, t: G.now };
      const dt = Math.max(0.016, G.now - last.t);
      const far = Math.hypot(x - last.x, z - last.z) > OF.RUN * 1.6 * dt + 0.8 || y - last.y > 2.5 + 8 * dt;
      if (far || OF.boxHits(G.map, x, y + 0.03, z, crouch ? OF.CROUCH_H - 0.05 : OF.STAND_H - 0.05, OF.P_R - 0.05)) {
        if (G.now - (p.lastFix || 0) > 0.3) { p.lastFix = G.now; tp(p); }
        return;
      }
      p.x = x; p.y = y; p.z = z; p.crouch = crouch; p.onGround = !!m.g;
      p.vx = +m.vx || 0; p.vy = +m.vy || 0; p.vz = +m.vz || 0;
      p.lastSt = { x, y, z, t: G.now };
      return;
    }
    case "f": {
      if (!p || !Array.isArray(m.d)) return;
      if (m.w !== WI[p.cur]) return;
      const dirs = m.d.slice(0, 12).filter(d => Array.isArray(d) && d.length === 3 && d.every(v => typeof v === "number" && isFinite(v)));
      if (!dirs.length) return;
      const o = Array.isArray(m.o) && m.o.length === 3 && m.o.every(isFinite) ? m.o.map(Number) : null;
      let vt = typeof m.vt === "number" ? m.vt / 1000 : null;
      if (vt != null) vt = Math.max(G.now - 0.4, Math.min(G.now, vt));
      fire(p, dirs, { o, vt, heavy: !!m.h });
      return;
    }
    case "rl": if (p) reload(p); return;
    case "sw": if (p && typeof m.w === "string") switchTo(p, m.w, false); return;
    case "buy": if (p && typeof m.w === "string") buy(p, m.w); return;
    case "drop": if (p) dropCurrent(p); return;
    case "nade": {
      if (!p || !Array.isArray(m.d) || m.d.length !== 3 || !m.d.every(isFinite)) return;
      throwNade(p, m.d.map(Number));
      return;
    }
    case "team": {
      if (!p || G.mode !== "defuse" || !["r", "t"].includes(m.team) || p.team === m.team) return;
      if (p.alive) { kill(p, null, "faca", false, true); p.deaths--; }
      p.team = m.team; h.pref = m.team;
      resetInv(p);
      lastRoster = "";
      return;
    }
    case "say": {
      const x = String(m.x || "").replace(/[<>]/g, "").trim().slice(0, 120);
      if (!x) return;
      const msg = JSON.stringify({ t: "chat", n: h.name, tm: p ? p.team : "s", x, team: !!m.team, dead: p ? !p.alive : false });
      for (const s of sockets) {
        if (!s.human) continue;
        if (m.team && p) { const q = G.players.get(s.human.pid); if (!q || q.team !== p.team) continue; }
        s.send(msg);
      }
      return;
    }
    case "pg": if (p) p.ping = Math.max(0, Math.min(999, m.pi | 0)); ws.send(JSON.stringify({ t: "po", c: m.c })); return;
    case "pref": if (["auto", "r", "t"].includes(m.pref)) { h.pref = m.pref; broadcastLobby(); } return;
    case "name": h.name = cleanName(m.name); if (p) p.name = h.name; broadcastLobby(); return;
  }

  const isHost = h.token === hostToken;
  const err = e => ws.send(JSON.stringify({ t: "err", msg: e }));
  if (m.t === "cfg") {
    if (!isHost || phase === "play") return;
    const c = m.cfg || {};
    if (["dm", "defuse", "gg"].includes(c.mode)) cfg.mode = c.mode;
    if (Number.isInteger(+c.map) && +c.map >= 0 && +c.map < OF.MAPS.length) cfg.map = +c.map;
    if (Number.isInteger(c.bots) && c.bots >= 0 && c.bots <= 15) cfg.bots = c.bots;
    if (["facil", "medio", "dificil"].includes(c.diff)) cfg.diff = c.diff;
    if ([3, 5, 8, 10, 16].includes(c.rounds)) cfg.rounds = c.rounds;
    if ([10, 20, 30, 50].includes(c.frags)) cfg.frags = c.frags;
    if ([3, 5, 10, 15, 20].includes(c.minutes)) cfg.minutes = c.minutes;
    if ([1, 2, 3].includes(c.ggk)) cfg.ggk = c.ggk;
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
  if (m.t === "stop") { // anfitrião encerra a partida em andamento
    if (!isHost || phase !== "play") return;
    phase = "lobby"; G = null; results = null;
    broadcast({ t: "stopped" });
    broadcastLobby();
    return;
  }
  if (m.t === "toLobby") {
    if (!isHost || phase !== "over") return;
    phase = "lobby"; results = null; G = null;
    broadcastLobby();
  }
}

/* ---------- Fotos ---------- */

let lastRoster = "", rosterT = 0;
const ROUND_CODE = { freeze: 0, live: 1, end: 2 };
const BOMB_CODE = { none: 0, carried: 1, dropped: 2, planted: 3, boom: 4, defused: 5 };
const NADE_CODE = { he: 0, flash: 1, smoke: 2 };

function sendSnapshots() {
  const g = G;
  const P = [];
  for (const p of g.players.values()) {
    const flags = (p.alive ? 1 : 0) | (p.crouch ? 2 : 0) | (p.onGround ? 4 : 0) | (p.walk ? 8 : 0) | (p.scoped ? 16 : 0) |
      (p.plantT >= 0 ? 32 : 0) | (g.bomb.defuser === p.id ? 64 : 0) | (p.inv[5] ? 128 : 0) | (p.reloadT > 0 ? 256 : 0) | (p.prot > 0 ? 512 : 0);
    P.push([p.id, Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100), Math.round(p.yaw * 1000), Math.round(p.pitch * 1000), flags, WI[p.cur], Math.max(0, p.hp)]);
  }
  const r = g.round, b = g.bomb;
  const s = {
    t: "s", tm: Math.round(g.now * 1000), P,
    rd: [ROUND_CODE[r.st] ?? 1, Math.max(0, Math.round(r.t * 10) / 10), r.n, g.scores.r, g.scores.t],
    bm: b.st === "planted" ? [3, r2(b.x), r2(b.y), r2(b.z), Math.round(b.timer * 10) / 10, b.defuser ? Math.round(b.prog / b.need * 100) / 100 : -1, b.defuser || 0]
      : [BOMB_CODE[b.st] || 0, b.carrier || 0],
    it: g.items.map(i => [i.id, WI[i.w], r2(i.x), r2(i.y), r2(i.z)]),
    nd: g.nades.map(n => [n.id, NADE_CODE[n.type], r2(n.x), r2(n.y), r2(n.z)]),
    sm: g.smokes.map(m => [m.id, r2(m.x), r2(m.y), r2(m.z), Math.round((g.now - m.t) * 10) / 10]),
    ev: g.ev,
  };
  g.ev = [];
  const common = JSON.stringify(s).slice(1);
  for (const ws of sockets) {
    const h = ws.human;
    const p = h && g.players.get(h.pid);
    if (!p) { ws.send("{" + common); continue; }
    const inv = p.inv;
    const me = {
      id: p.id, hp: Math.max(0, p.hp), ar: p.armor, hl: p.helmet ? 1 : 0, kit: p.kit ? 1 : 0, $: p.money,
      i1: inv[1] ? [WI[inv[1].w], inv[1].mag, inv[1].res] : 0, i2: inv[2] ? [WI[inv[2].w], inv[2].mag, inv[2].res] : 0,
      n: [inv[4].he, inv[4].flash, inv[4].smoke], bomb: inv[5] ? 1 : 0, cur: WI[p.cur], cs: p.cs,
      rl: Math.max(0, Math.round(p.reloadT * 100) / 100), al: p.alive ? 1 : 0, rsp: p.alive ? 0 : Math.max(0, Math.round((p.respawnT - g.now) * 10) / 10),
      buy: canBuy(p) ? 1 : 0, tp: p.tpSeq, gg: p.gg, ggk: p.ggk, tm: p.team, pt: p.plantT >= 0 ? Math.round(p.plantT / PLANT_TIME * 100) / 100 : -1,
    };
    ws.send('{"me":' + JSON.stringify(me) + "," + common);
  }
  // placar (só quando muda)
  rosterT -= 1;
  if (rosterT <= 0) {
    rosterT = 15;
    const list = [...g.players.values()].map(p => [p.id, p.name, p.team, p.kills, p.deaths, p.score, p.bot ? 1 : 0, p.alive ? 1 : 0, p.gg, p.ping, p.inv[5] ? 1 : 0, p.money]);
    const str = JSON.stringify({ t: "sb", P: list, host: hostToken ? (byToken(hostToken)?.pid || 0) : 0 });
    if (str !== lastRoster) { lastRoster = str; for (const ws of sockets) ws.send(str); }
  }
}

/* ---------- Laço principal ---------- */

function tick(dt) {
  const g = G;
  g.now += dt;
  updateRound(dt);
  if (g.over || G !== g) return;
  for (const p of g.players.values()) {
    if (!p.alive) {
      if (g.mode !== "defuse" && g.now >= p.respawnT && p.respawnT > 0 && !p.leftT) spawnFree(p);
      continue;
    }
    p.prot = Math.max(0, p.prot - dt);
    p.blindT = Math.max(0, p.blindT - dt);
    if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) { p.reloadT = 0; finishReload(p); } }
    if (p.bot) Bots.think(g, p, dt, api);
    updateBombActions(p, dt);
    if (g.over) return;
    // caiu do mapa (não deveria): volta
    if (p.y < -20) { if (g.mode === "defuse") kill(p, null, "faca", false); else spawnFree(p); }
    p.hist.push([g.now, p.x, p.y, p.z, p.crouch]);
    if (p.hist.length > 40) p.hist.shift();
  }
  updateItems(dt);
  updateNades(dt);
  // humanos desconectados há muito tempo saem da partida
  for (const p of g.players.values()) {
    if (p.bot) continue;
    const h = byToken(p.token);
    if (connected(h) && h.pid === p.id) { p.leftT = 0; continue; }
    if (!p.leftT) p.leftT = g.now;
    else if (g.now - p.leftT > 20) { removePlayer(p); lastRoster = ""; }
  }
}

let last = clock(), acc = 0, snapAcc = 0;
setInterval(() => {
  const now = clock();
  const real = Math.min(0.25, now - last);
  last = now;
  if (phase !== "play" || !G) return;
  acc += real;
  let n = 0;
  while (acc >= TICK && n < 10) { tick(TICK); acc -= TICK; n++; if (phase !== "play" || !G) return; }
  if (n >= 10) acc = 0;
  snapAcc += real;
  if (snapAcc >= 1 / 30) { snapAcc %= 1 / 30; sendSnapshots(); }

  // todos os humanos saíram: volta ao lobby
  const anyHuman = humans.some(connected);
  if (anyHuman) lastNoHumans = 0;
  else if (!lastNoHumans) lastNoHumans = now;
  else if (now - lastNoHumans > 30) { phase = "lobby"; G = null; lastNoHumans = 0; broadcastLobby(); console.log("Sem jogadores: partida encerrada"); }
}, 1000 / 120);

// limpa quem saiu há tempo
setInterval(() => {
  const before = humans.length;
  for (let i = humans.length - 1; i >= 0; i--)
    if (!connected(humans[i]) && Date.now() - humans[i].lastSeen > 60000) humans.splice(i, 1);
  if (humans.length !== before) broadcastLobby();
}, 5000);

/* ---------- HTTP ---------- */

const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/shared.js": ["shared.js", "text/javascript; charset=utf-8"],
  "/render.js": ["render.js", "text/javascript; charset=utf-8"],
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
      if (ws.human) { ws.human.lastSeen = Date.now(); console.log(`${ws.human.name} desconectou`); }
      broadcastLobby();
    };
  });
}

module.exports = {
  handle, upgrade, lanAddresses,
  _debug: { get G() { return G; } }, // usado só pelos testes
  configure({ port, base } = {}) { if (port) PORT = port; if (base) BASE = base; },
};

if (require.main === module) {
  const server = http.createServer((req, res) => handle(req, res));
  server.on("upgrade", (req, socket, head) => upgrade(req, socket, head));
  server.listen(PORT, "0.0.0.0", () => {
    console.log("🎯 Ofensiva rodando!");
    console.log("Abra no navegador (mesma rede Wi-Fi):");
    console.log(`  http://localhost:${PORT}`);
    lanAddresses().forEach(ip => console.log(`  http://${ip}:${PORT}`));
  });
}
