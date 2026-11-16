// Ofensiva — código compartilhado entre o navegador e o servidor (Node).
// Mapas em grade, armas, física de movimento, colisão e raios (tiros/visão).
(function (root, factory) {
  const OF = factory();
  if (typeof module === "object" && module.exports) module.exports = OF;
  else root.OF = OF;
})(typeof self !== "undefined" ? self : globalThis, function () {
"use strict";

/* ---------- Constantes ---------- */

const CELL = 2;          // cada caractere do mapa = 2 x 2 metros
const WALL_H = 6;
const P_R = 0.3, STAND_H = 1.8, CROUCH_H = 1.22, EYE_S = 1.64, EYE_C = 1.06;
const GRAV = 20, JUMP_V = 6.8, STEP_H = 0.55;
const RUN = 6.2, WALK_F = 0.52, CROUCH_F = 0.34;
const ACCEL = 8, AIR_ACCEL = 10, FRICTION = 5.2, STOP_SPEED = 2.6, AIR_CAP = 0.8;

/* ---------- Armas ---------- */
// dmg por bala · rate = segundos entre tiros · pen = quanto passa do colete · rm = perda por 12,7 m
// spread/move/air/rec em radianos · kick em graus por tiro · speed = multiplicador de corrida

const WEAPONS = {
  faca:     { nome: "Faca", slot: 3, melee: true, dmg: 34, dmg2: 65, rate: 0.42, rate2: 1.0, range: 1.75, speed: 1.0 },
  glock:    { nome: "Pistola P9", slot: 2, dmg: 25, rate: 0.15, mag: 20, res: 120, pen: 0.47, rm: 0.75, spread: 0.010, move: 0.05, air: 0.22, rec: 0.010, kick: 1.0, side: 0.3, recDecay: 6, price: 400, speed: 1.0, reload: 2.2, kind: "pistol" },
  usp:      { nome: "Pistola T45", slot: 2, dmg: 34, rate: 0.17, mag: 12, res: 100, pen: 0.5, rm: 0.79, spread: 0.008, move: 0.05, air: 0.22, rec: 0.012, kick: 1.3, side: 0.3, recDecay: 6, price: 500, speed: 1.0, reload: 2.6, kind: "pistol" },
  magnum:   { nome: "Magnum .50", slot: 2, dmg: 54, rate: 0.3, mag: 7, res: 35, pen: 0.93, rm: 0.81, spread: 0.007, move: 0.09, air: 0.3, rec: 0.03, kick: 3.4, side: 0.5, recDecay: 3.5, price: 650, speed: 0.98, reload: 2.2, kind: "pistol" },
  escopeta: { nome: "Escopeta 12", slot: 1, dmg: 20, pellets: 9, rate: 0.88, mag: 8, res: 32, pen: 0.5, rm: 0.6, spread: 0.065, move: 0.02, air: 0.1, rec: 0, kick: 5, side: 0.6, recDecay: 3, price: 1700, speed: 0.92, reload: 3.2, kind: "shotgun" },
  smg:      { nome: "SMG Vespa", slot: 1, auto: true, dmg: 26, rate: 0.08, mag: 30, res: 120, pen: 0.6, rm: 0.84, spread: 0.010, move: 0.03, air: 0.2, rec: 0.0022, recMax: 0.05, kick: 0.55, side: 0.35, recDecay: 9, price: 1500, speed: 0.96, reload: 2.6, kind: "smg" },
  fuzilR:   { nome: "Fuzil RK-7", slot: 1, auto: true, team: "r", dmg: 36, rate: 0.1, mag: 30, res: 90, pen: 0.78, rm: 0.98, spread: 0.004, move: 0.09, air: 0.35, rec: 0.0034, recMax: 0.07, kick: 1.1, side: 0.45, recDecay: 7, price: 2700, speed: 0.88, reload: 2.5, kind: "rifle" },
  fuzilT:   { nome: "Fuzil M-Tático", slot: 1, auto: true, team: "t", dmg: 33, rate: 0.09, mag: 30, res: 90, pen: 0.7, rm: 0.97, spread: 0.0035, move: 0.08, air: 0.35, rec: 0.0028, recMax: 0.06, kick: 0.9, side: 0.35, recDecay: 7.5, price: 3100, speed: 0.92, reload: 3.0, kind: "rifle" },
  sniper:   { nome: "Sniper Longa", slot: 1, scope: true, dmg: 115, rate: 1.45, mag: 10, res: 30, pen: 0.97, rm: 0.99, spread: 0.0015, noscope: 0.09, move: 0.2, air: 0.5, rec: 0, kick: 4, side: 0.3, recDecay: 2, price: 4750, speed: 0.84, scopeSpeed: 0.62, reload: 3.6, kind: "sniper" },
  he:       { nome: "Granada", slot: 4, nade: "he", price: 300, speed: 1.0, max: 1 },
  flash:    { nome: "Flash", slot: 4, nade: "flash", price: 200, speed: 1.0, max: 2 },
  smoke:    { nome: "Fumaça", slot: 4, nade: "smoke", price: 300, speed: 1.0, max: 1 },
  bomba:    { nome: "Bomba", slot: 5, speed: 1.0 },
};
const WEP_LIST = Object.keys(WEAPONS);
const NADES = ["he", "flash", "smoke"];
const EQUIP = {
  colete:  { nome: "Colete", price: 650 },
  capacete:{ nome: "Colete + Capacete", price: 1000 },
  kit:     { nome: "Kit de desarme", price: 400, team: "t" },
};
// ordem da corrida armada: cada abate sobe um degrau; o último é a faca
const GG_LADDER = ["glock", "usp", "magnum", "escopeta", "smg", "fuzilR", "fuzilT", "sniper", "faca"];
const HIT_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

function damageCalc(w, dist, part, armor, helmet) {
  let d = w.dmg * Math.pow(w.rm || 1, dist / 12.7) * HIT_MULT[part];
  let armorDmg = 0;
  if (armor > 0 && part !== "legs" && (part !== "head" || helmet)) {
    let nd = d * (w.pen ?? 0.5);
    armorDmg = (d - nd) * 0.5;
    if (armorDmg > armor) { nd = d - armor * 2; armorDmg = armor; }
    d = nd;
  }
  return { hp: Math.max(1, Math.round(d)), armor: Math.round(armorDmg) };
}

// imprecisão atual da arma (radianos)
function spreadOf(w, speedH, onGround, crouch, scoped, recoil) {
  if (!w || w.melee || w.nade) return 0;
  let s = w.scope && !scoped ? w.noscope : w.spread;
  const maxs = RUN * w.speed;
  const mf = Math.max(0, Math.min(1, (speedH - 1.3) / (maxs - 1.3)));
  s += w.move * Math.pow(mf, 1.4);
  if (!onGround) s += w.air;
  if (crouch && onGround) s *= 0.75;
  if (w.rec) s += Math.min(w.recMax || 0.1, recoil * w.rec);
  return s;
}

function speedMulOf(w, scoped) {
  if (!w) return 1;
  return scoped && w.scopeSpeed ? w.scopeSpeed : w.speed;
}

/* ---------- Mapas ---------- */
// #/W parede · . , chão · c caixa (1 m) · C caixa alta (2 m) · K contêiner (2,6 m) · m muro (1,3 m)
// 1-4 piso elevado (0,5 a 2 m) · = túnel (com teto) · A/B locais da bomba · r/p nascimento Rebeldes/Tática

const KINDS = {
  "#": { lo: WALL_H, mat: 2 }, "W": { lo: WALL_H, mat: 3 },
  ".": { lo: 0, mat: 0 }, ",": { lo: 0, mat: 1 },
  "r": { lo: 0, mat: 0, spawn: "r" }, "p": { lo: 0, mat: 1, spawn: "t" },
  "A": { lo: 0, mat: 6, site: "A" }, "B": { lo: 0, mat: 6, site: "B" },
  "c": { lo: 1.0, mat: 4 }, "C": { lo: 2.0, mat: 4 }, "K": { lo: 2.6, mat: 7 },
  "m": { lo: 1.3, mat: 5 },
  "1": { lo: 0.5, mat: 5 }, "2": { lo: 1.0, mat: 5 }, "3": { lo: 1.5, mat: 5 }, "4": { lo: 2.0, mat: 5 },
  "=": { lo: 0, mat: 1, ce: 3.2 },
};

const MAP_DEFS = [
  {
    nome: "Vila Seca",
    desc: "Vilarejo de adobe: meio longo, túnel para o B e varanda alta no A.",
    tema: { sky: [0.52, 0.68, 0.86], horizon: [0.86, 0.8, 0.68], fog: [0.84, 0.78, 0.66], floor: [0.82, 0.7, 0.5], floor2: [0.62, 0.58, 0.52], wall: [0.86, 0.76, 0.58], wall2: [0.7, 0.42, 0.3], sun: 1.0 },
    rows: [
      "##################################",
      "#333cc....##pppppppppp##....CC...#",
      "#333......##pppppppppp##.........#",
      "#2.AAAAA......pppppp......BBBBB..#",
      "#1.AAcAA......pppppp......BBcBB..#",
      "#..AAAAA..##..........##..BBBBB..#",
      "#..AAAAA..####......####..BBBBB..#",
      "#...c.....####......####.....c...#",
      "#.........####..cc..####.........#",
      "#...###..#####......#####..##....#",
      "#...###....................##....#",
      "#...###..c..............c..##....#",
      "#...##########......#########....#",
      "#.m.##########......#########....#",
      "#...##########..cc..#########====#",
      "#...############..###########====#",
      "#...##########......#########====#",
      "#...##########......#########====#",
      "#..c##########..m...#########====#",
      "#...##########......#########====#",
      "#...##########......#########====#",
      "#...##########......#########....#",
      "#...#######............######....#",
      "#......m...................c.....#",
      "#..........#..rrrrrrrr..#........#",
      "#..........#..rrrrrrrr..#........#",
      "#######....#..rrrrrrrr..#....#####",
      "#######....#............#....#####",
      "#######....#............#....#####",
      "##################################",
    ],
  },
  {
    nome: "Porto Velho",
    desc: "Cais de contêineres: corredores apertados e muitas esquinas.",
    tema: { sky: [0.5, 0.6, 0.72], horizon: [0.72, 0.76, 0.8], fog: [0.66, 0.7, 0.74], floor: [0.5, 0.5, 0.5], floor2: [0.42, 0.44, 0.46], wall: [0.6, 0.6, 0.62], wall2: [0.56, 0.3, 0.24], sun: 0.9 },
    rows: [
      "##############################",
      "#.......KK......W....AAAAA...#",
      "#.rr....KK....c.W....AAcAA.pp#",
      "#.rr..........KK==...AAAAA.pp#",
      "#.rr..c.......KK==.........pp#",
      "#.rr........WWWWWW...KK....pp#",
      "#......KK..m.....W...KK......#",
      "###....KK........W...........#",
      "#........WWWW..........WWWW..#",
      "#..c.....W..W..KKK.....W..W..#",
      "#........W..W..KKK..c..W..W..#",
      "#..KK..........m.............#",
      "#..KK....WWWW.....KK...WWWW..#",
      "#..............c..KK.........#",
      "###....KK.......W.....m...####",
      "#......KK..m....==...........#",
      "#.rr............==..BBBBB..pp#",
      "#.rr..c.....KK..W...BBcBB..pp#",
      "#.rr........KK..W...BBBBB..pp#",
      "#.rr...KKK......W...BBBBB..pp#",
      "#......KKK......W......c.....#",
      "##############################",
    ],
  },
  {
    nome: "Pátio",
    desc: "Arena pequena e simétrica: ótima para mata-mata e corrida armada.",
    tema: { sky: [0.45, 0.58, 0.8], horizon: [0.8, 0.78, 0.74], fog: [0.76, 0.74, 0.7], floor: [0.55, 0.52, 0.48], floor2: [0.66, 0.6, 0.5], wall: [0.62, 0.34, 0.26], wall2: [0.82, 0.8, 0.74], sun: 1.0 },
    rows: [
      "########################",
      "#rrrr....#....#....AAAA#",
      "#rrrr..c.#....#..c.AAAA#",
      "#........#.33.#....AAcA#",
      "#..m........2......AAAA#",
      "#...........1..........#",
      "####..WW..........WW..##",
      "#.....WW...cc.....WW...#",
      "#......................#",
      "#..c....4321..1234....c#",
      "#.......4.......4......#",
      "#..c....4321..1234....c#",
      "#......................#",
      "#...WW.....cc.....WW...#",
      "##..WW............WW####",
      "#.....1................#",
      "#.....2.........m..pppp#",
      "#BBcB.33.#....#....pppp#",
      "#BBBB....#....#..c.pppp#",
      "#BBBB....#....#....pppp#",
      "########################",
    ],
  },
];

function parseMap(def, index) {
  const rows = def.rows, h = rows.length, w = rows[0].length;
  const lo = new Float32Array(w * h), ce = new Float32Array(w * h).fill(Infinity);
  const mat = new Uint8Array(w * h), ch = [];
  const spawns = { r: [], t: [] }, sites = { A: null, B: null };
  for (let z = 0; z < h; z++) {
    if (rows[z].length !== w) throw new Error(`Mapa ${def.nome}: linha ${z} tem ${rows[z].length} colunas (esperado ${w})`);
    for (let x = 0; x < w; x++) {
      const c = rows[z][x], k = KINDS[c] || KINDS["."], i = z * w + x;
      lo[i] = k.lo; mat[i] = k.mat; ch[i] = c;
      if (k.ce) ce[i] = k.ce;
      if (k.spawn) spawns[k.spawn].push([(x + 0.5) * CELL, (z + 0.5) * CELL]);
      if (k.site) {
        const s = sites[k.site] || (sites[k.site] = { x0: x, z0: z, x1: x, z1: z });
        s.x0 = Math.min(s.x0, x); s.z0 = Math.min(s.z0, z); s.x1 = Math.max(s.x1, x); s.z1 = Math.max(s.z1, z);
      }
    }
  }
  for (const k of ["A", "B"]) {
    const s = sites[k];
    if (!s) continue;
    s.cx = (s.x0 + s.x1 + 1) / 2 * CELL; s.cz = (s.z0 + s.z1 + 1) / 2 * CELL;
  }
  // células abertas no chão (nascimento do mata-mata)
  const open = [];
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const i = z * w + x;
    if (lo[i] === 0 && ce[i] === Infinity && ch[i] !== "c") open.push(i);
  }
  return { nome: def.nome, desc: def.desc, tema: def.tema, w, h, lo, ce, mat, ch, spawns, sites, open, index };
}

const MAPS = MAP_DEFS.map(parseMap);

/* ---------- Colisão ---------- */

function cellIdx(m, cx, cz) {
  return cx < 0 || cz < 0 || cx >= m.w || cz >= m.h ? -1 : cz * m.w + cx;
}
function cellOf(m, x, z) { return cellIdx(m, Math.floor(x / CELL), Math.floor(z / CELL)); }

function boxHits(m, x, y, z, hgt, r = P_R) {
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const i = cellIdx(m, cx, cz);
    if (i < 0) return true;
    if (y < m.lo[i] - 1e-4 || y + hgt > m.ce[i] + 1e-4) return true;
  }
  return false;
}
function floorUnder(m, x, z, r = P_R) {
  let f = -Infinity;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const i = cellIdx(m, cx, cz);
    f = Math.max(f, i < 0 ? Infinity : m.lo[i]);
  }
  return f;
}
function ceilOver(m, x, z, r = P_R) {
  let c = Infinity;
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const i = cellIdx(m, cx, cz);
    if (i >= 0) c = Math.min(c, m.ce[i]);
  }
  return c;
}
function pointSolid(m, x, y, z) {
  const i = cellOf(m, x, z);
  return i < 0 || y < m.lo[i] || y > m.ce[i];
}

/* ---------- Movimento (estilo Quake/CS) ---------- */

function slide(m, p, ax, d, hgt) {
  if (!d) return;
  const nx = ax === 0 ? p.x + d : p.x, nz = ax === 2 ? p.z + d : p.z;
  if (!boxHits(m, nx, p.y, nz, hgt)) { p.x = nx; p.z = nz; return; }
  if (p.onGround) { // sobe degrau
    const top = floorUnder(m, nx, nz);
    if (top > p.y && top - p.y <= STEP_H + 1e-4 && !boxHits(m, nx, top, nz, hgt)) {
      p.stepUp = (p.stepUp || 0) + top - p.y; p.y = top; p.x = nx; p.z = nz; return;
    }
  }
  // encosta na borda da célula
  const pos = ax === 0 ? p.x : p.z;
  const edge = d > 0 ? Math.floor((pos + P_R + d) / CELL) * CELL - P_R - 1e-3
                     : (Math.floor((pos - P_R + d) / CELL) + 1) * CELL + P_R + 1e-3;
  if (d > 0 ? edge > pos : edge < pos) {
    const tx = ax === 0 ? edge : p.x, tz = ax === 2 ? edge : p.z;
    if (!boxHits(m, tx, p.y, tz, hgt)) { p.x = tx; p.z = tz; }
  }
  if (ax === 0) p.vx = 0; else p.vz = 0;
}

// inp: { f, s (-1..1), jump, crouch, walk, yaw } · p: { x,y,z, vx,vy,vz, onGround, crouch, speedMul }
function move(m, p, inp, dt) {
  const wantC = !!inp.crouch;
  if (wantC && !p.crouch) {
    p.crouch = true;
    if (!p.onGround) { const ny = p.y + (STAND_H - CROUCH_H); if (!boxHits(m, p.x, ny, p.z, CROUCH_H)) p.y = ny; }
  } else if (!wantC && p.crouch) {
    if (p.onGround) { if (!boxHits(m, p.x, p.y, p.z, STAND_H)) p.crouch = false; }
    else {
      const ny = p.y - (STAND_H - CROUCH_H);
      if (ny >= floorUnder(m, p.x, p.z) && !boxHits(m, p.x, ny, p.z, STAND_H)) { p.y = ny; p.crouch = false; }
      else if (!boxHits(m, p.x, p.y, p.z, STAND_H)) p.crouch = false;
    }
  }
  const hgt = p.crouch ? CROUCH_H : STAND_H;

  let f = inp.f || 0, s = inp.s || 0;
  const len = Math.hypot(f, s);
  if (len > 1) { f /= len; s /= len; }
  const sy = Math.sin(inp.yaw || 0), cy = Math.cos(inp.yaw || 0);
  let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
  const wl = Math.hypot(wx, wz);
  let maxs = RUN * (p.speedMul || 1);
  if (p.crouch && p.onGround) maxs *= CROUCH_F; else if (inp.walk) maxs *= WALK_F;
  let wish = 0;
  if (wl > 1e-3) { wish = maxs * Math.min(1, wl); wx /= wl; wz /= wl; }

  if (p.onGround && inp.jump && !p.crouch || p.onGround && inp.jump && p.crouch && !boxHits(m, p.x, p.y + 0.1, p.z, hgt)) {
    p.vy = JUMP_V; p.onGround = false;
  }
  if (p.onGround) {
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 1e-4) {
      const drop = Math.max(sp, STOP_SPEED) * FRICTION * dt;
      const k = Math.max(0, sp - drop) / sp;
      p.vx *= k; p.vz *= k;
    }
    const cur = p.vx * wx + p.vz * wz, add = wish - cur;
    if (add > 0 && wish > 0) { const a = Math.min(ACCEL * dt * wish, add); p.vx += a * wx; p.vz += a * wz; }
  } else if (wish > 0) {
    const cap = Math.min(wish, AIR_CAP);
    const cur = p.vx * wx + p.vz * wz, add = cap - cur;
    if (add > 0) { const a = Math.min(AIR_ACCEL * dt * wish, add); p.vx += a * wx; p.vz += a * wz; }
  }
  // nunca passa do máximo + ganho de pulo lateral moderado
  const sp = Math.hypot(p.vx, p.vz), lim = RUN * 1.35;
  if (sp > lim) { p.vx *= lim / sp; p.vz *= lim / sp; }

  p.stepUp = 0;
  slide(m, p, 0, p.vx * dt, hgt);
  slide(m, p, 2, p.vz * dt, hgt);

  const wasGround = p.onGround;
  if (!wasGround) p.vy -= GRAV * dt; else p.vy = Math.max(p.vy, 0);
  const fl = floorUnder(m, p.x, p.z), cl = ceilOver(m, p.x, p.z);
  let ny = p.y + p.vy * dt;
  if (wasGround && p.vy <= 0 && fl <= p.y && p.y - fl <= STEP_H + 0.01) ny = fl;
  p.landed = 0;
  if (ny <= fl) {
    if (!wasGround) { p.landed = -p.vy; if (p.vy < -3) { p.vx *= 0.8; p.vz *= 0.8; } }
    ny = fl; p.vy = 0; p.onGround = true;
  } else p.onGround = false;
  if (ny + hgt > cl) { ny = cl - hgt; if (p.vy > 0) p.vy = 0; }
  p.y = ny;
}

function eyeHeight(crouch) { return crouch ? EYE_C : EYE_S; }

/* ---------- Raios ---------- */

function rayWorld(m, ox, oy, oz, dx, dy, dz, maxT) {
  let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? (cx + 1) * CELL - ox : ox - cx * CELL) / Math.abs(dx) : Infinity;
  let tmz = dz !== 0 ? (dz > 0 ? (cz + 1) * CELL - oz : oz - cz * CELL) / Math.abs(dz) : Infinity;
  let t0 = 0, axis = -1;
  const side = t => ({ t, nx: axis === 0 ? -sx : 0, ny: 0, nz: axis === 2 ? -sz : 0, side: true });
  for (let it = 0; it < 600; it++) {
    const t1 = Math.min(tmx, tmz, maxT);
    const i = cellIdx(m, cx, cz);
    const y0 = oy + dy * t0, y1 = oy + dy * t1;
    if (i < 0) return y0 < WALL_H + 0.5 ? side(t0) : null;
    const lo = m.lo[i], ce = m.ce[i];
    if (y0 < lo - 1e-6) return axis < 0 ? { t: 0, nx: 0, ny: 1, nz: 0 } : side(t0);
    if (y1 < lo) return { t: (lo - oy) / dy, nx: 0, ny: 1, nz: 0 };
    if (y0 > ce + 1e-6) return axis < 0 ? { t: 0, nx: 0, ny: -1, nz: 0 } : side(t0);
    if (y1 > ce) return { t: (ce - oy) / dy, nx: 0, ny: -1, nz: 0 };
    if (t1 >= maxT) return null;
    if (tmx < tmz) { cx += sx; t0 = tmx; tmx += tdx; axis = 0; }
    else { cz += sz; t0 = tmz; tmz += tdz; axis = 2; }
  }
  return null;
}

function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const lo = b[1 + a], hi = b[4 + a];
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo || o[a] > hi) return -1; continue; }
    let t1 = (lo - o[a]) / d[a], t2 = (hi - o[a]) / d[a];
    if (t1 > t2) { const k = t1; t1 = t2; t2 = k; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  return tmin < 0 ? 0 : tmin;
}

// caixas de acerto: [parte, x0,y0,z0, x1,y1,z1]
function hitboxes(x, y, z, crouch, pad = 0) {
  const s = crouch ? CROUCH_H / STAND_H : 1;
  return [
    ["head", x - 0.15 - pad, y + 1.46 * s, z - 0.15 - pad, x + 0.15 + pad, y + 1.8 * s + pad, z + 0.15 + pad],
    ["chest", x - 0.25 - pad, y + 1.1 * s, z - 0.18 - pad, x + 0.25 + pad, y + 1.46 * s, z + 0.18 + pad],
    ["stomach", x - 0.23 - pad, y + 0.8 * s, z - 0.17 - pad, x + 0.23 + pad, y + 1.1 * s, z + 0.17 + pad],
    ["legs", x - 0.21 - pad, y, z - 0.16 - pad, x + 0.21 + pad, y + 0.8 * s, z + 0.16 + pad],
  ];
}

// linha de visão livre entre dois pontos
function clearLine(m, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  const h = rayWorld(m, ax, ay, az, dx / d, dy / d, dz / d, d);
  return !h || h.t >= d - 0.05;
}

// segmento passa dentro de uma esfera (fumaça)?
function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = dx * dx + dy * dy + dz * dz;
  let t = L > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

// desvia uma direção aleatoriamente dentro de um cone (distribuição ~ CS)
function spreadDir(d, amount, rnd = Math.random) {
  if (amount <= 0) return d.slice();
  const a = rnd() * Math.PI * 2, r = (rnd() + rnd()) * 0.5 * amount;
  // base ortonormal
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(d[1]) > 0.95) { ux = 1; uy = 0; }
  let rx = d[1] * uz - d[2] * uy, ry = d[2] * ux - d[0] * uz, rz = d[0] * uy - d[1] * ux;
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  const qx = ry * d[2] - rz * d[1], qy = rz * d[0] - rx * d[2], qz = rx * d[1] - ry * d[0];
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const nx = d[0] + rx * ox + qx * oy, ny = d[1] + ry * ox + qy * oy, nz = d[2] + rz * ox + qz * oy;
  const nl = Math.hypot(nx, ny, nz);
  return [nx / nl, ny / nl, nz / nl];
}

function siteAt(m, x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (const k of ["A", "B"]) {
    const s = m.sites[k];
    if (s && cx >= s.x0 && cx <= s.x1 && cz >= s.z0 && cz <= s.z1) return k;
  }
  return null;
}

const MODES = {
  dm: { nome: "Mata-mata", desc: "Todos contra todos, renascimento instantâneo e armas de graça." },
  defuse: { nome: "Desarmar", desc: "Rebeldes plantam a bomba, a Tática desarma. Rodadas com dinheiro e loja." },
  gg: { nome: "Corrida armada", desc: "Cada abate troca sua arma. Quem fizer o último abate com a faca vence." },
};
const TEAMS = { r: { nome: "Rebeldes", cor: "#e0903a" }, t: { nome: "Tática", cor: "#4a9cff" }, f: { nome: "Livre", cor: "#cfd6e4" } };

return {
  CELL, WALL_H, P_R, STAND_H, CROUCH_H, EYE_S, EYE_C, GRAV, JUMP_V, STEP_H, RUN, WALK_F, CROUCH_F,
  WEAPONS, WEP_LIST, NADES, EQUIP, GG_LADDER, HIT_MULT, MAPS, MAP_DEFS, KINDS, MODES, TEAMS,
  damageCalc, spreadOf, speedMulOf, parseMap, cellIdx, cellOf, boxHits, floorUnder, ceilOver, pointSolid,
  move, eyeHeight, rayWorld, rayBox, hitboxes, clearLine, segSphere, dirFromAngles, spreadDir, siteAt,
};
});
