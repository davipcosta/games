// Ofensiva — bots do servidor: navegação A* na grade do mapa, visão, mira e objetivos.
"use strict";
const OF = require("./shared.js");

const DIFF = {
  facil:   { react: 0.75, aimErr: 0.11, turn: 4.5, head: 0.05, spray: 0.25, burst: 3, crouch: 0.05, fov: 0.95 },
  medio:   { react: 0.42, aimErr: 0.055, turn: 8, head: 0.2, spray: 0.55, burst: 5, crouch: 0.2, fov: 1.15 },
  dificil: { react: 0.22, aimErr: 0.025, turn: 14, head: 0.45, spray: 0.85, burst: 8, crouch: 0.4, fov: 1.35 },
};
const BOT_NAMES = ["Tonhão", "Zé Mira", "Bia Bala", "Juca", "Cris", "Dona Neném", "Marreta", "Pipoca", "Tatu", "Lagartixa",
  "Gaúcho", "Sombra", "Neguinho", "Ruivo", "Baixinho", "Professor", "Coruja", "Faísca", "Trovão", "Bigode"];

/* ---------- Navegação ---------- */

const navCache = new Map();
function nav(m) {
  let n = navCache.get(m);
  if (n) return n;
  const walk = new Uint8Array(m.w * m.h);
  for (let i = 0; i < walk.length; i++) walk[i] = m.lo[i] < OF.WALL_H && m.ce[i] - m.lo[i] >= OF.STAND_H ? 1 : 0;
  const nb = [];
  const can = (a, b) => b >= 0 && walk[b] && m.lo[b] - m.lo[a] <= 1.05;
  for (let i = 0; i < walk.length; i++) {
    const list = [];
    nb.push(list);
    if (!walk[i]) continue;
    const x = i % m.w, z = (i / m.w) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const j = OF.cellIdx(m, x + dx, z + dz);
      if (!can(i, j)) continue;
      let cost = dx && dz ? 1.414 : 1;
      if (dx && dz) { // diagonal só se as duas laterais forem do mesmo nível
        const a = OF.cellIdx(m, x + dx, z), b = OF.cellIdx(m, x, z + dz);
        if (!walk[a] || !walk[b]) continue;
        const h = m.lo[i];
        if (Math.abs(m.lo[a] - h) > 0.01 || Math.abs(m.lo[b] - h) > 0.01 || Math.abs(m.lo[j] - h) > 0.01) continue;
      }
      if (m.lo[j] - m.lo[i] > OF.STEP_H) cost += 1.5; // precisa pular
      list.push(j, cost);
    }
  }
  n = { walk, nb };
  navCache.set(m, n);
  return n;
}

function astar(m, from, to) {
  const N = nav(m);
  if (from < 0 || to < 0 || !N.walk[to]) return null;
  if (from === to) return [to];
  const W = m.w, tx = to % W, tz = (to / W) | 0;
  const hcost = i => { const dx = Math.abs(i % W - tx), dz = Math.abs(((i / W) | 0) - tz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const g = new Float32Array(m.w * m.h).fill(Infinity), came = new Int32Array(m.w * m.h).fill(-1);
  const heap = []; // [f, i]
  const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let s = k; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === k) break; [heap[s], heap[k]] = [heap[k], heap[s]]; k = s; } } return top; };
  g[from] = 0; push(hcost(from), from);
  while (heap.length) {
    const [, i] = pop();
    if (i === to) break;
    const list = N.nb[i];
    for (let k = 0; k < list.length; k += 2) {
      const j = list[k], ng = g[i] + list[k + 1];
      if (ng < g[j]) { g[j] = ng; came[j] = i; push(ng + hcost(j), j); }
    }
  }
  if (came[to] < 0) return null;
  const path = [to];
  for (let i = came[to]; i >= 0 && i !== from; i = came[i]) path.push(i);
  return path.reverse();
}

function nearestWalkable(m, x, z) {
  const N = nav(m);
  let i = OF.cellOf(m, x, z);
  if (i >= 0 && N.walk[i]) return i;
  const cx = Math.floor(x / OF.CELL), cz = Math.floor(z / OF.CELL);
  for (let r = 1; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    i = OF.cellIdx(m, cx + dx, cz + dz);
    if (i >= 0 && N.walk[i]) return i;
  }
  return -1;
}

const center = (m, i) => [((i % m.w) + 0.5) * OF.CELL, (((i / m.w) | 0) + 0.5) * OF.CELL];
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function randomCellIn(m, box) {
  const N = nav(m);
  for (let k = 0; k < 30; k++) {
    const x = Math.floor(rand(box.x0, box.x1 + 1)), z = Math.floor(rand(box.z0, box.z1 + 1));
    const i = OF.cellIdx(m, x, z);
    if (i >= 0 && N.walk[i] && m.lo[i] < 0.6) return i;
  }
  return nearestWalkable(m, (box.x0 + box.x1 + 1) / 2 * OF.CELL, (box.z0 + box.z1 + 1) / 2 * OF.CELL);
}

/* ---------- Cérebro ---------- */

function initAI(p) {
  p.ai = {
    path: null, pk: 0, goalCell: -1, repathT: 0, target: null, reactT: 0, aimOff: [0, 0], aimPart: "chest",
    lastSeen: null, heard: null, stuckT: 0, lastPos: [p.x, p.z], strafe: 1, strafeT: 0, shots: 0, burstLeft: 0,
    pauseT: 0, objT: 0, perceiveT: Math.random() * 0.1, campT: 0, watchYaw: p.yaw, site: null, crouchT: 0, wantCrouch: false,
    jumpCD: 0,
  };
}

function setGoal(G, p, cell) {
  const ai = p.ai;
  if (cell < 0) return;
  if (cell === ai.goalCell && ai.path && G.now < ai.repathT) return;
  const from = nearestWalkable(G.map, p.x, p.z);
  ai.path = astar(G.map, from, cell);
  ai.pk = 0; ai.goalCell = cell; ai.repathT = G.now + 4;
}

function enemiesOf(G, p) {
  const out = [];
  for (const q of G.players.values()) if (q !== p && q.alive && (G.mode !== "defuse" || q.team !== p.team)) out.push(q);
  return out;
}

function canSee(G, p, q) {
  const m = G.map, ex = p.x, ey = p.y + OF.eyeHeight(p.crouch), ez = p.z;
  for (const hy of [q.crouch ? 0.85 : 1.3, q.crouch ? 1.05 : 1.62]) {
    const tx = q.x, ty = q.y + hy, tz = q.z;
    if (!OF.clearLine(m, ex, ey, ez, tx, ty, tz)) continue;
    if (G.smokes.some(s => G.now - s.t > 0.8 && OF.segSphere(ex, ey, ez, tx, ty, tz, s.x, s.y + 1.2, s.z, 3.3))) continue;
    return true;
  }
  return false;
}

function perceive(G, p, D) {
  const ai = p.ai;
  if (p.blindT > 0.4) { ai.target = null; return; }
  let best = null, bd = Infinity;
  for (const q of enemiesOf(G, p)) {
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (d > 90 || d > bd) continue;
    const yawTo = Math.atan2(-dx, -dz);
    const inFov = Math.abs(angDiff(yawTo, p.yaw)) < D.fov || d < 4 || q === ai.target;
    if (!inFov) continue;
    if (!canSee(G, p, q)) continue;
    best = q; bd = d;
  }
  if (best && best !== ai.target) {
    const close = ai.lastSeen && ai.lastSeen.id === best.id && G.now - ai.lastSeen.t < 1.5;
    ai.reactT = G.now + D.react * rand(0.7, 1.3) * (close ? 0.4 : 1);
    const e = D.aimErr * rand(0.6, 1.4);
    ai.aimOff = [rand(-1, 1) * e, rand(-0.6, 1) * e];
    ai.aimPart = Math.random() < D.head ? "head" : "chest";
    ai.shots = 0; ai.burstLeft = D.burst;
  }
  ai.target = best;
  if (best) ai.lastSeen = { id: best.id, x: best.x, y: best.y, z: best.z, t: G.now };
}

// escolhe para onde ir conforme o modo
function objective(G, p, api) {
  const ai = p.ai, m = G.map;
  if (G.mode !== "defuse") {
    if (ai.heard && G.now - ai.heard.t < 3 && Math.random() < 0.7) return setGoal(G, p, nearestWalkable(m, ai.heard.x, ai.heard.z));
    if (ai.goalCell >= 0 && ai.path && ai.pk < ai.path.length && G.now < ai.repathT) return;
    const en = enemiesOf(G, p);
    if (en.length && Math.random() < 0.65) {
      en.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return setGoal(G, p, nearestWalkable(m, en[0].x, en[0].z));
    }
    return setGoal(G, p, m.open[(Math.random() * m.open.length) | 0]);
  }
  const b = G.bomb, rd = G.round;
  if (rd.st === "freeze") return;
  const dist = (x, z) => Math.hypot(x - p.x, z - p.z);
  if (p.team === "r") {
    if (b.st === "dropped") {
      const mates = [...G.players.values()].filter(q => q.alive && q.team === "r" && q.bot);
      mates.sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z));
      if (mates[0] === p) return setGoal(G, p, nearestWalkable(m, b.x, b.z));
    }
    if (b.st === "planted") {
      if (ai.campT > G.now && ai.path && ai.pk >= ai.path.length) return;
      if (ai.goalCell >= 0 && ai.path && ai.pk < ai.path.length) return;
      ai.campT = G.now + rand(4, 9);
      const cx = Math.floor(b.x / OF.CELL), cz = Math.floor(b.z / OF.CELL);
      ai.watchYaw = rand(-Math.PI, Math.PI);
      return setGoal(G, p, randomCellIn(m, { x0: cx - 4, x1: cx + 4, z0: cz - 4, z1: cz + 4 }));
    }
    const site = m.sites[G.plan.site];
    if (p.inv[5]) {
      if (OF.siteAt(m, p.x, p.z) === G.plan.site) { ai.goalCell = -1; ai.path = null; return; }
      return setGoal(G, p, nearestWalkable(m, site.cx, site.cz));
    }
    if (ai.goalCell >= 0 && ai.path && ai.pk < ai.path.length) return;
    if (ai.campT > G.now) return;
    ai.campT = G.now + rand(3, 7);
    ai.watchYaw = rand(-Math.PI, Math.PI);
    return setGoal(G, p, randomCellIn(m, site));
  }
  // Tática
  if (b.st === "planted") {
    if (dist(b.x, b.z) < 1.2) { ai.goalCell = -1; ai.path = null; return; }
    return setGoal(G, p, nearestWalkable(m, b.x, b.z));
  }
  if (!ai.site) ai.site = p.id % 2 ? "A" : "B";
  if (ai.goalCell >= 0 && ai.path && ai.pk < ai.path.length) return;
  if (ai.campT > G.now) return;
  ai.campT = G.now + rand(7, 15);
  const s = m.sites[ai.site];
  const rs = G.spawnCenter.r;
  ai.watchYaw = Math.atan2(-(rs[0] - s.cx), -(rs[1] - s.cz)) + rand(-0.8, 0.8);
  if (Math.random() < 0.15) ai.site = ai.site === "A" ? "B" : "A";
  setGoal(G, p, randomCellIn(m, s));
}

function turnTo(p, yaw, pitch, rate, dt) {
  const dy = angDiff(yaw, p.yaw), mx = rate * dt;
  p.yaw += Math.max(-mx, Math.min(mx, dy));
  const dp = pitch - p.pitch;
  p.pitch += Math.max(-mx, Math.min(mx, dp));
  return Math.abs(dy) + Math.abs(dp);
}

function think(G, p, dt, api) {
  if (!p.ai) initAI(p);
  const ai = p.ai, m = G.map, D = DIFF[G.cfg.diff] || DIFF.medio;
  const inp = { f: 0, s: 0, yaw: p.yaw, jump: false, crouch: false, walk: false };
  p.using = false;
  if (G.mode === "defuse" && G.round.st === "freeze") { api.move(p, inp, dt); return; }

  ai.perceiveT -= dt;
  if (ai.perceiveT <= 0) { ai.perceiveT = 0.12; perceive(G, p, D); }
  ai.objT -= dt;
  if (ai.objT <= 0) { ai.objT = 0.5; objective(G, p, api); }

  let w = OF.WEAPONS[p.cur];
  const slot1 = p.inv[1], slot2 = p.inv[2];
  // troca para a melhor arma disponível
  if (!w || w.nade || p.cur === "bomba" || (p.cur === "faca" && (slot1 || slot2) && G.mode !== "gg")) {
    api.switchTo(p, slot1 ? slot1.w : slot2 ? slot2.w : "faca");
    w = OF.WEAPONS[p.cur];
  }
  const it = p.inv[OF.WEAPONS[p.cur]?.slot];
  const t = ai.target && ai.target.alive ? ai.target : null;
  let moveX = 0, moveZ = 0;

  if (t) {
    const ex = p.x, ey = p.y + OF.eyeHeight(p.crouch), ez = p.z;
    const ty = t.y + (ai.aimPart === "head" ? (t.crouch ? 1.12 : 1.63) : (t.crouch ? 0.85 : 1.28));
    const dx = t.x - ex, dz = t.z - ez, dh = Math.hypot(dx, dz), d = Math.hypot(dx, ty - ey, dz);
    ai.aimOff[0] *= Math.exp(-dt * 1.6); ai.aimOff[1] *= Math.exp(-dt * 1.6);
    const wantYaw = Math.atan2(-dx, -dz) + ai.aimOff[0], wantPitch = Math.atan2(ty - ey, dh) + ai.aimOff[1];
    const err = turnTo(p, wantYaw, wantPitch, D.turn, dt);
    const melee = w && w.melee;
    const longGun = w && (w.kind === "rifle" || w.kind === "sniper");
    // movimento em combate
    if (melee || (w && w.kind === "shotgun" && d > 8)) {
      moveX = dx / dh; moveZ = dz / dh;
    } else if (!(longGun && d > 11)) {
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = rand(0.35, 0.9); ai.strafe = Math.random() < 0.5 ? -1 : 1; }
      moveX = Math.cos(p.yaw) * ai.strafe; moveZ = -Math.sin(p.yaw) * ai.strafe;
    }
    ai.crouchT -= dt;
    if (ai.crouchT <= 0) { ai.crouchT = rand(1, 2.5); ai.wantCrouch = longGun && d > 14 && Math.random() < D.crouch; }
    inp.crouch = ai.wantCrouch;
    // atirar
    if (it && !melee && it.mag === 0 && p.reloadT <= 0) api.reload(p);
    const tol = Math.max(0.025, 0.5 / Math.max(d, 1)) + (w && w.kind === "shotgun" ? 0.04 : 0);
    if (G.now >= ai.reactT && err < tol && G.now >= p.nextFire && p.reloadT <= 0 && ai.pauseT <= G.now) {
      if (melee) {
        if (dh < 1.7) api.fire(p, [OF.dirFromAngles(p.yaw, p.pitch)], { heavy: Math.random() < 0.3 });
      } else if (it && it.mag > 0) {
        const scoped = w.scope && Math.hypot(p.vx, p.vz) < 1;
        if (!w.scope || scoped || d < 6) {
          const base = OF.dirFromAngles(p.yaw, p.pitch);
          const sp = OF.spreadOf(w, Math.hypot(p.vx, p.vz), p.onGround, p.crouch, scoped, ai.shots) * (1.6 - D.spray);
          const dirs = [];
          for (let k = 0; k < (w.pellets || 1); k++) dirs.push(OF.spreadDir(base, w.pellets ? w.spread : sp));
          api.fire(p, dirs, { scoped });
          ai.shots++;
          // recuo empurra a mira para cima; bots bons compensam
          p.pitch += (w.kick || 0) * Math.PI / 180 * 0.35 * (1 - D.spray);
          if (w.auto) {
            ai.burstLeft--;
            if (ai.burstLeft <= 0 && d > 9) { ai.burstLeft = D.burst; ai.pauseT = G.now + rand(0.25, 0.45); ai.shots = 0; }
          } else ai.pauseT = G.now + (d > 15 ? rand(0.15, 0.35) : rand(0.03, 0.12));
        }
      }
    }
  } else {
    ai.shots = Math.max(0, ai.shots - dt * 10);
    if (it && !w.melee && it.mag < (w.mag || 0) * 0.4 && p.reloadT <= 0 && (it.res > 0 || G.mode === "gg")) api.reload(p);
    // ouviu algo: vira para lá
    let lookYaw = null;
    if (ai.heard && G.now - ai.heard.t < 2) lookYaw = Math.atan2(-(ai.heard.x - p.x), -(ai.heard.z - p.z));
    else if (ai.lastSeen && G.now - ai.lastSeen.t < 2.5) lookYaw = Math.atan2(-(ai.lastSeen.x - p.x), -(ai.lastSeen.z - p.z));
    // segue o caminho
    if (ai.path && ai.pk < ai.path.length) {
      const c = center(m, ai.path[ai.pk]);
      const dx = c[0] - p.x, dz = c[1] - p.z, dd = Math.hypot(dx, dz);
      const last = ai.pk === ai.path.length - 1;
      if (dd < (last ? 0.5 : 0.9)) ai.pk++;
      else {
        moveX = dx / dd; moveZ = dz / dd;
        const ci = ai.path[ai.pk];
        if (m.lo[ci] - p.y > OF.STEP_H && dd < 2.0 && p.onGround && ai.jumpCD <= 0) { inp.jump = true; ai.jumpCD = 0.5; }
        if (lookYaw == null) lookYaw = Math.atan2(-dx, -dz);
      }
    } else if (G.mode === "defuse") {
      // parado: plantando, desarmando ou vigiando
      if (p.inv[5] && OF.siteAt(m, p.x, p.z)) p.using = true;
      if (p.team === "t" && G.bomb.st === "planted" && Math.hypot(G.bomb.x - p.x, G.bomb.z - p.z) < 1.5) p.using = true;
      if (lookYaw == null) lookYaw = ai.watchYaw + Math.sin(G.now * 0.7 + p.id) * 0.5;
    }
    if (lookYaw != null) turnTo(p, lookYaw, 0, D.turn * 0.6, dt);
  }
  ai.jumpCD -= dt;

  // destravar
  if (moveX || moveZ) {
    ai.stuckT += dt;
    if (ai.stuckT > 0.8) {
      const moved = Math.hypot(p.x - ai.lastPos[0], p.z - ai.lastPos[1]);
      if (moved < 0.35) {
        if (p.onGround) inp.jump = true;
        ai.repathT = 0; ai.goalCell = -1; ai.path = null;
        if (Math.random() < 0.5) { const o = m.open[(Math.random() * m.open.length) | 0]; setGoal(G, p, o); }
      }
      ai.stuckT = 0; ai.lastPos = [p.x, p.z];
    }
  } else { ai.stuckT = 0; ai.lastPos = [p.x, p.z]; }

  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  inp.f = moveX * -sy + moveZ * -cy;
  inp.s = moveX * cy + moveZ * -sy;
  inp.yaw = p.yaw;
  if (p.using) { inp.f = 0; inp.s = 0; }
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  api.move(p, inp, dt);
}

// compra no começo da rodada
function buy(G, p, api) {
  const r = Math.random();
  const rifle = p.team === "r" ? "fuzilR" : "fuzilT", rp = OF.WEAPONS[rifle].price;
  if (G.round.n === 1 || p.money < 1500) {
    if (p.money >= 650 && r < 0.5) api.buy(p, "colete");
    else if (p.money >= 650) api.buy(p, "magnum");
  } else if (!p.inv[1]) {
    if (p.money >= 4750 + 1000 && r < 0.2) api.buy(p, "sniper");
    else if (p.money >= rp + 650) api.buy(p, rifle);
    else if (p.money >= 1700 + 650 && r < 0.4) api.buy(p, "escopeta");
    else if (p.money >= 1500 + 650) api.buy(p, "smg");
  }
  if (p.armor < 100 || !p.helmet) {
    if (p.money >= 1000) api.buy(p, "capacete");
    else if (p.money >= 650 && p.armor < 100) api.buy(p, "colete");
  }
  if (p.team === "t" && !p.kit && p.money >= 400 && Math.random() < 0.5) api.buy(p, "kit");
}

function heard(G, x, z, by) {
  for (const p of G.players.values()) {
    if (!p.bot || !p.alive || p === by || (G.mode === "defuse" && p.team === by.team)) continue;
    if (Math.hypot(p.x - x, p.z - z) < 35) { if (!p.ai) initAI(p); p.ai.heard = { x, z, t: G.now }; }
  }
}

function hurt(G, p, attacker) {
  if (!p.ai) initAI(p);
  if (attacker && attacker !== p) p.ai.heard = { x: attacker.x, z: attacker.z, t: G.now };
}

module.exports = { think, buy, heard, hurt, initAI, BOT_NAMES, DIFF, astar, nav, nearestWalkable };
