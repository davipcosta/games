// Tiro & Treta — motor do jogo (simulação). Roda no navegador (script comum) e no Node (require).
// Não desenha nem toca som: avisa o que aconteceu por emit(tipo, ...dados) — quem hospeda decide o que fazer.
"use strict";
/* ═══════════════════════════ Configuração ═══════════════════════════ */
const W = 960, H = 540;
const GRAV = 1800, STEP = 1 / 120;
const RUN = 235, JUMP = 640;
const STAND_H = 44, CROUCH_H = 30;

const GUNS = {
  pistola:  { nome: "Pistola", dmg: 15, cd: 0.28, ammo: 12, speed: 1500, spread: 0.02, pellets: 1, kick: 140, life: 0.7, snd: "pistola" },
  smg:      { nome: "Submetralhadora", dmg: 7, cd: 0.075, ammo: 40, speed: 1400, spread: 0.075, pellets: 1, kick: 60, life: 0.6, snd: "smg" },
  escopeta: { nome: "Escopeta", dmg: 10, cd: 0.8, ammo: 6, speed: 1250, spread: 0.16, pellets: 7, kick: 110, life: 0.27, recoil: 220, snd: "escopeta", shake: 4 },
  rifle:    { nome: "Rifle", dmg: 62, cd: 1.0, ammo: 5, speed: 3200, spread: 0, pellets: 1, kick: 340, life: 0.5, snd: "rifle", tracer: true, shake: 3 },
  bazuca:   { nome: "Bazuca", dmg: 0, cd: 1.2, ammo: 3, speed: 620, rocket: true, recoil: 260, snd: "bazuca", shake: 3 },
};
const MELEE = {
  soco:  { nome: "Soco", dmg: 9, range: 24, cd: 0.3, kick: 270 },
  facao: { nome: "Facão", dmg: 28, range: 38, cd: 0.36, kick: 330 },
};
const DROP_TABLE = ["pistola", "smg", "smg", "escopeta", "escopeta", "rifle", "rifle", "bazuca",
  "facao", "granadas", "granadas", "vida", "vida"];

const LOOKS = [
  { nome: "Vermelho", shirt: "#e5484d", pants: "#3b2626", hair: "#2b1a10", skin: "#f1c39b" },
  { nome: "Azul",     shirt: "#3e8cff", pants: "#22304a", hair: "#e8c36a", skin: "#e8b48a" },
  { nome: "Verde",    shirt: "#36c46a", pants: "#25362b", hair: "#141414", skin: "#b97a52" },
  { nome: "Amarelo",  shirt: "#ffc24b", pants: "#3a3320", hair: "#7a3b1a", skin: "#f4d1b0" },
];
const BOT_NAMES = ["Bruto", "Faísca", "Tranca", "Zarolho", "Pavio", "Marreta", "Ferrugem", "Tatu", "Coronha", "Gatilho"];

const DIFF = {
  facil:   { react: 0.7,  crouch: 0.1,  nade: 0.1,  pause: 0.6,  dodgeNade: false },
  medio:   { react: 0.38, crouch: 0.35, nade: 0.25, pause: 0.25, dodgeNade: true },
  dificil: { react: 0.13, crouch: 0.9,  nade: 0.45, pause: 0,    dodgeNade: true },
};

/* ═══════════════════════════ Mapas ═══════════════════════════
   solids: [x, y, w, h] blocos sólidos   plats: [x, y, w] plataformas (passáveis por baixo)
   crates/barrels: [x, y] canto sup. esquerdo   spawns: [x, pé]                          */
const MAPS = [
  {
    nome: "Armazém", tema: "armazem",
    solids: [[0, 500, 960, 40], [0, 0, 16, 500], [944, 0, 16, 500], [420, 440, 120, 60]],
    plats: [[60, 410, 220], [680, 410, 220], [330, 330, 300], [40, 250, 200], [720, 250, 200], [300, 170, 360]],
    crates: [[250, 470], [680, 470], [16, 470], [570, 300]],
    barrels: [[150, 468], [800, 218], [465, 138]],
    spawns: [[100, 500], [860, 500], [150, 410], [790, 410], [480, 330], [480, 170]],
  },
  {
    nome: "Telhados", tema: "telhados",
    solids: [[0, 420, 300, 120], [380, 360, 220, 180], [680, 440, 280, 100], [180, 385, 30, 35]],
    plats: [[50, 320, 170], [410, 260, 160], [730, 340, 180], [250, 190, 150], [600, 210, 130]],
    crates: [[100, 390], [430, 330], [880, 410]],
    barrels: [[550, 328], [740, 408]],
    spawns: [[80, 420], [260, 420], [480, 360], [760, 440], [900, 440], [130, 320]],
  },
  {
    nome: "Fundição", tema: "fabrica",
    solids: [[0, 500, 430, 40], [530, 500, 430, 40], [0, 0, 16, 500], [944, 0, 16, 500], [200, 450, 40, 50], [720, 450, 40, 50]],
    plats: [[300, 400, 360], [16, 400, 170], [774, 400, 170], [120, 300, 250], [590, 300, 250], [380, 210, 200], [16, 200, 150], [794, 200, 150]],
    crates: [[60, 470], [870, 470], [465, 180]],
    barrels: [[330, 468], [598, 468], [300, 268], [636, 268]],
    spawns: [[80, 500], [880, 500], [200, 300], [760, 300], [480, 400], [480, 210]],
  },
];

/* ═══════════════════════════ Utilidades ═══════════════════════════ */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rr = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// aim: ângulo de mira em radianos (mouse / analógico direito) ou null = atira reto para onde está virado
const blankInput = () => ({ left: false, right: false, up: false, down: false, shoot: false, melee: false, grenade: false, face: 0, aim: null });
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Interseção segmento × retângulo (slab). Retorna t ∈ [0,1] ou null.
function segAABB(x0, y0, dx, dy, r) {
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (x0 < r.x || x0 > r.x + r.w) return null; }
  else {
    let t1 = (r.x - x0) / dx, t2 = (r.x + r.w - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (y0 < r.y || y0 > r.y + r.h) return null; }
  else {
    let t1 = (r.y - y0) / dy, t2 = (r.y + r.h - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/* ═══════════════════════════ Ganchos ═══════════════════════════ */
let emit = () => {};
function setEmit(fn) { emit = fn; }
const hooks = { matchEnd() {} };

/* ═══════════════════════════ Estado do jogo ═══════════════════════════ */
const game = {
  state: "menu", demo: true, paused: false,
  cfg: null, level: null, mapIdx: 0,
  fighters: [], bullets: [], rockets: [], grenades: [], pickups: [], particles: [], timers: [], feed: [],
  scores: [], kills: [], round: 0, roundT: 0, ending: null, slowmo: 0, shake: 0,
  banner: null, dropT: 0, suddenDeath: false, eid: 0,
  stats: { causes: {}, rounds: [] },
};

function buildLevel(m) {
  return {
    def: m,
    solids: m.solids.map(([x, y, w, h]) => ({ x, y, w, h })),
    plats: m.plats.map(([x, y, w]) => ({ x, y, w, h: 8 })),
    objs: [
      ...m.crates.map(([x, y]) => ({ type: "crate", x, y, w: 30, h: 30, hp: 40, alive: true, hurtT: 0 })),
      ...m.barrels.map(([x, y]) => ({ type: "barrel", x, y, w: 24, h: 32, hp: 22, alive: true, hurtT: 0 })),
    ],
    bg: null,
  };
}
function solidsNow() {
  const L = game.level;
  return L.objsAlive ? L.solidsAll : (L.solidsAll = L.solids.concat(L.objs.filter(o => o.alive)), L.objsAlive = true, L.solidsAll);
}
function invalidateSolids() { game.level.objsAlive = false; }

function makeFighter(slot, i, spawn, look) {
  const isBot = slot.type.startsWith("bot");
  return {
    id: i, ctrl: slot, isBot, look,
    name: slot.name,
    x: spawn[0] - 10, y: spawn[1] - STAND_H, w: 20, h: STAND_H,
    vx: 0, vy: 0, dir: spawn[0] < W / 2 ? 1 : -1,
    onGround: false, onPlat: false, crouch: false, jumping: false,
    hp: 100, alive: true, deadT: 0,
    gun: null, ammo: 0, melee: null, grenades: 1, aim: null,
    fireCd: 0.4, meleeCd: 0, nadeCd: 0, stun: 0, hurtT: 0, dropT: 0, meleeAnim: 0, flash: 0,
    coyote: 0, jumpBuf: 0, anim: 0, lastHitBy: null, lastHitT: -99,
    inp: blankInput(), prev: blankInput(),
    ai: isBot ? { level: slot.type.slice(4), t: Math.random() * 10, retarget: 0, seen: 0, crouchT: 0, dodgeCd: 1, nadeCd: 2, wander: pick([-1, 1]), stuckT: 0, climb: null, pauseT: 0, burstT: 0, strafe: 0, strafeT: 0 } : null,
  };
}

function startMatch(cfg, demo) {
  game.cfg = cfg; game.demo = demo;
  game.scores = cfg.slots.map(() => 0);
  game.kills = cfg.slots.map(() => 0);
  game.round = 0;
  game.state = "play"; game.paused = false;
  startRound();
}

function startRound() {
  const cfg = game.cfg;
  game.round++;
  game.mapIdx = cfg.map === "rand" ? (game.round === 1 || MAPS.length < 2 ? Math.floor(Math.random() * MAPS.length)
    : (game.mapIdx + 1 + Math.floor(Math.random() * (MAPS.length - 1))) % MAPS.length) : +cfg.map;
  game.level = buildLevel(MAPS[game.mapIdx]);
  invalidateSolids();
  const spawns = shuffle(MAPS[game.mapIdx].spawns.slice());
  game.fighters = cfg.slots.map((s, i) => makeFighter(s, i, spawns[i % spawns.length], LOOKS[s.color]));
  game.bullets = []; game.rockets = []; game.grenades = []; game.pickups = []; game.timers = []; game.feed = [];
  game.ending = null; game.slowmo = 0; game.roundT = 0; game.suddenDeath = false;
  game.dropT = 3;
  // armas espalhadas pelo mapa no começo da rodada: corrida para pegar
  const spots = shuffle(surfacesAll().filter(sf => sf.w >= 60 && sf.y > 60 && sf.y < H));
  const starters = ["pistola", "pistola", "smg", "escopeta", "rifle", "pistola", "facao", "smg"];
  const nStart = Math.min(spots.length, game.fighters.length + 2);
  for (let k = 0; k < nStart; k++) {
    const sf = spots[k], px = rr(sf.x + 6, sf.x + sf.w - 28);
    const blocked = game.level.objs.some(o => px + 22 > o.x && px < o.x + o.w && Math.abs(o.y + o.h - sf.y) < 2);
    spawnPickup(k < 2 ? "pistola" : pick(starters), blocked ? sf.x + sf.w / 2 - 11 : px, sf.y - 14, false);
  }
  spawnPickup(pick(DROP_TABLE.slice(0, 8)), rr(80, W - 80), -40, true);
  game.banner = { text: `RODADA ${game.round}`, sub: MAPS[game.mapIdx].nome, t: 0, dur: 1.6 };
  emit("novaRodada");
  emit("s", "luta");
}

/* ═══════════════════════════ Física ═══════════════════════════ */
function moveBody(b, dt, ignorePlats) {
  const sol = solidsNow();
  b.hitWall = false;
  b.x += b.vx * dt;
  for (const s of sol) if (s !== b && overlap(b, s)) {
    if (b.vx > 0) b.x = s.x - b.w; else if (b.vx < 0) b.x = s.x + s.w; else continue;
    b.vx = 0; b.hitWall = true;
  }
  const oldBottom = b.y + b.h;
  b.y += b.vy * dt;
  b.onGround = false; b.onPlat = false;
  for (const s of sol) if (s !== b && overlap(b, s)) {
    if (b.vy > 0) { b.y = s.y - b.h; b.onGround = true; }
    else if (b.vy < 0) b.y = s.y + s.h;
    else { b.y = s.y - b.h; b.onGround = true; }
    b.vy = 0;
  }
  if (!ignorePlats && b.vy >= 0) for (const p of game.level.plats) {
    if (b.x + b.w > p.x && b.x < p.x + p.w && oldBottom <= p.y + 0.5 && b.y + b.h >= p.y) {
      b.y = p.y - b.h; b.vy = 0; b.onGround = true; b.onPlat = true;
    }
  }
}

function setCrouch(f, want) {
  if (want === f.crouch) return;
  if (want) { f.y += STAND_H - CROUCH_H; f.h = CROUCH_H; f.crouch = true; }
  else {
    const test = { x: f.x, y: f.y - (STAND_H - CROUCH_H), w: f.w, h: STAND_H };
    if (solidsNow().some(s => overlap(test, s))) return; // sem espaço para levantar
    f.y = test.y; f.h = STAND_H; f.crouch = false;
  }
}

// Raio contra paredes, objetos e lutadores (vivos). Retorna o acerto mais próximo.
function raycast(x0, y0, x1, y1, ignore, withFighters = true) {
  const dx = x1 - x0, dy = y1 - y0;
  let best = 2, hit = null;
  const L = game.level;
  for (const s of L.solids) { const t = segAABB(x0, y0, dx, dy, s); if (t !== null && t < best) { best = t; hit = { kind: "wall" }; } }
  for (const o of L.objs) if (o.alive) { const t = segAABB(x0, y0, dx, dy, o); if (t !== null && t < best) { best = t; hit = { kind: "obj", obj: o }; } }
  if (withFighters) for (const f of game.fighters) if (f.alive && f !== ignore) {
    const t = segAABB(x0, y0, dx, dy, f); if (t !== null && t < best) { best = t; hit = { kind: "fighter", f }; }
  }
  if (!hit) return null;
  hit.t = best; hit.x = x0 + dx * best; hit.y = y0 + dy * best;
  return hit;
}
const hasLOS = (x0, y0, x1, y1) => !raycast(x0, y0, x1, y1, null, false);

// Menor topo de superfície abaixo de (x, y) — null = vazio (queda mortal)
function groundBelow(x, y) {
  let best = null;
  const L = game.level;
  const test = s => { if (x >= s.x && x <= s.x + s.w && s.y >= y && (best === null || s.y < best)) best = s.y; };
  L.solids.forEach(test); L.plats.forEach(test); L.objs.forEach(o => o.alive && test(o));
  return best;
}

/* ═══════════════════════════ Combate ═══════════════════════════ */
function hurt(f, dmg, by, kx, ky, cause, hy) {
  if (!f.alive) return;
  f.hp -= dmg; f.hurtT = 0.12;
  f.vx += kx; f.vy += ky;
  if (Math.abs(kx) > 150 || ky < -200) f.stun = Math.max(f.stun, 0.2);
  if (by && by !== f) { f.lastHitBy = by; f.lastHitT = game.roundT; }
  blood(f.x + f.w / 2, hy ?? f.y + f.h * 0.35, sign(kx) || -f.dir, Math.min(18, 3 + dmg / 3));
  if (f.hp <= 0) kill(f, by, cause);
}

const ICON = { pistola: "🔫", smg: "🔫", escopeta: "🔫", rifle: "🎯", bazuca: "🚀", explosao: "💥", granada: "💣", soco: "👊", facao: "🔪", queda: "⬇", barril: "🛢" };
function kill(f, by, cause) {
  if (!f.alive) return;
  f.alive = false; f.hp = 0; f.deadT = 0;
  if (f.crouch) { f.crouch = false; }
  f.y += f.h - 14; f.h = 14;
  if (f.gun && f.ammo > 0) dropItem(f.gun, f, f.ammo);
  if (f.melee) dropItem(f.melee, f);
  f.gun = null; f.melee = null;
  blood(f.x + f.w / 2, f.y, 0, 26);
  emit("s", "morte", f.x);
  game.stats.causes[cause] = (game.stats.causes[cause] || 0) + 1;
  if (by && by !== f) {
    game.kills[by.id]++;
    addFeed(`${by.name} ${ICON[cause] || "☠"} ${f.name}`, by.look.shirt, f.look.shirt);
  } else if (cause === "queda") addFeed(`${f.name} caiu do mapa`, null, f.look.shirt);
  else if (cause === "subita") addFeed(`${f.name} não resistiu`, null, f.look.shirt);
  else addFeed(`${f.name} se explodiu`, null, f.look.shirt);
  const alive = game.fighters.filter(x => x.alive).length;
  if (alive <= 1) game.slowmo = 1.1;
}
function addFeed(text, ca, cb) {
  game.feed.unshift({ text, ca, cb, t: 0 });
  if (game.feed.length > 5) game.feed.pop();
}

const aimAngle = f => (f.aim ?? (f.dir > 0 ? 0 : Math.PI));

function fire(f) {
  const g = GUNS[f.gun];
  f.fireCd = g.cd; f.ammo--; f.flash = 0.06;
  const ang = aimAngle(f), ca = Math.cos(ang), sa = Math.sin(ang);
  const cx = f.x + f.w / 2, my = f.y + (f.crouch ? 9 : 11);
  const reach = f.crouch ? 20 : 22, mx = cx + ca * reach, muzY = my + sa * reach;
  if (g.rocket) {
    game.rockets.push({ id: ++game.eid, x: cx, y: my, vx: ca * g.speed, vy: sa * g.speed, owner: f, life: 2.5 });
  } else {
    for (let i = 0; i < g.pellets; i++) {
      const a = ang + (Math.random() * 2 - 1) * g.spread;
      game.bullets.push({ id: ++game.eid, x: cx, y: my, sx: mx, sy: muzY, vx: Math.cos(a) * g.speed, vy: Math.sin(a) * g.speed,
        dmg: g.dmg, kick: g.kick, owner: f, life: g.life * rr(0.85, 1.15), tracer: g.tracer, gun: f.gun });
    }
  }
  emit("muzzle", mx, muzY, ang, g.rocket ? 0 : 1);
  if (g.recoil) { f.vx -= ca * g.recoil; if (!f.onGround) f.vy -= 40 + sa * g.recoil * 0.8; }
  if (g.shake) emit("shake", g.shake);
  emit("s", g.snd, cx);
  if (f.ammo <= 0) {
    // arma vazia: joga fora
    emit("gunthrow", cx, my, f.dir);
    f.gun = null; f.ammo = 0;
  }
}

function meleeAttack(f) {
  const m = MELEE[f.melee || "soco"];
  f.meleeCd = m.cd; f.meleeAnim = 0.16;
  const box = { x: f.dir > 0 ? f.x + f.w - 4 : f.x - m.range + 4, y: f.y + 2, w: m.range, h: f.h - 8 };
  let hit = false;
  for (const o of game.fighters) if (o !== f && o.alive && overlap(box, o)) {
    hurt(o, m.dmg, f, f.dir * m.kick, -170, f.melee || "soco", o.y + 10);
    hit = true;
  }
  for (const o of game.level.objs) if (o.alive && overlap(box, o)) { damageObj(o, m.dmg, f); hit = true; }
  emit("s", hit ? (f.melee ? "corte" : "soco") : "vento", f.x);
  if (hit) emit("shake", 2);
}

function throwGrenade(f) {
  f.grenades--; f.nadeCd = 0.5;
  const up = f.inp.up, down = f.inp.down;
  let vx = f.dir * (down ? 260 : up ? 300 : 440) + f.vx * 0.4;
  let vy = down ? -60 : up ? -620 : -380;
  if (f.aim != null) { // mirando: joga na direção do cursor (com um leve arco)
    vx = Math.cos(f.aim) * 520 + f.vx * 0.4;
    vy = Math.sin(f.aim) * 520 - 140;
  }
  game.grenades.push({ id: ++game.eid, x: f.x + f.w / 2 - 4, y: f.y + 6, w: 8, h: 8, vx, vy, fuse: 2.1, owner: f, spin: 0 });
  emit("s", "lancar", f.x);
}

function explode(x, y, r, dmg, owner, cause = "explosao") {
  for (const f of game.fighters) {
    const fx = f.x + f.w / 2, fy = f.y + f.h / 2, d = Math.hypot(fx - x, fy - y);
    if (d > r + 16) continue;
    const k = 1 - d / (r + 16);
    const kx = (sign(fx - x) || pick([-1, 1])) * 560 * k, ky = -460 * k - 90;
    if (f.alive) hurt(f, dmg * (0.3 + 0.7 * k), owner, kx, ky, cause, fy);
    else { f.vx += kx; f.vy += ky; }
  }
  for (const o of game.level.objs) if (o.alive) {
    const d = Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y);
    if (d < r + 20) damageObj(o, dmg * (1 - d / (r + 20)) + 10, owner);
  }
  for (const p of game.pickups) { const d = Math.hypot(p.x - x, p.y - y); if (d < r * 1.5) { p.vx += sign(p.x - x) * 300; p.vy -= 300; p.chute = false; } }
  for (const g of game.grenades) { const d = Math.hypot(g.x - x, g.y - y); if (d < r * 1.5) { g.vx += sign(g.x - x) * 350; g.vy -= 300; } }
  emit("boom", x, y, r);
  emit("s", "explosao", x);
}

function damageObj(o, dmg, by) {
  if (!o.alive) return;
  o.hp -= dmg; o.hurtT = 0.1;
  if (o.hp > 0) return;
  o.alive = false; invalidateSolids();
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  if (o.type === "barrel") {
    game.timers.push({ t: 0.07, fn: () => explode(cx, cy, 95, 80, by, "barril") });
  } else {
    emit("s", "madeira", cx);
    emit("debris", cx, cy);
    if (Math.random() < 0.45) spawnPickup(pick(DROP_TABLE), cx - 11, cy - 7, false);
  }
}

function blood(x, y, dir, n) { emit("blood", x, y, dir, n); }

/* ═══════════════════════════ Itens ═══════════════════════════ */
function spawnPickup(type, x, y, chute) {
  game.pickups.push({ id: ++game.eid, type, x, y, w: 22, h: 14, vx: 0, vy: 0, chute, ammo: GUNS[type]?.ammo ?? 0, life: 30, sway: Math.random() * 6 });
}
function dropItem(type, f, ammo) {
  game.pickups.push({ id: ++game.eid, type, x: f.x, y: f.y + 6, w: 22, h: 14, vx: -f.dir * rr(60, 160), vy: -220, chute: false, ammo: ammo ?? GUNS[type]?.ammo ?? 0, life: 25, sway: 0, noPickT: 0.5 });
}
function takePickup(f, p) {
  const t = p.type;
  if (GUNS[t]) {
    if (f.gun) dropItem(f.gun, f, f.ammo);
    f.gun = t; f.ammo = p.ammo || GUNS[t].ammo; f.fireCd = Math.max(f.fireCd, 0.15);
  } else if (t === "facao") {
    if (f.melee) dropItem(f.melee, f);
    f.melee = "facao";
  } else if (t === "granadas") f.grenades = Math.min(5, f.grenades + 2);
  else if (t === "vida") f.hp = Math.min(100, f.hp + 40);
  p.dead = true;
  emit("s", t === "vida" ? "vida" : "pegar", f.x);
}
function tryPickups(f, manual) {
  for (const p of game.pickups) {
    if (p.dead || (p.noPickT > 0) || p.chute && p.y < 0) continue;
    const r = { x: p.x - 6, y: p.y - 6, w: p.w + 12, h: p.h + 12 };
    if (!overlap(f, r)) continue;
    const t = p.type;
    const auto = (GUNS[t] && !f.gun) || (t === "facao" && !f.melee) || (t === "granadas" && f.grenades < 5) || (t === "vida" && f.hp < 100);
    if (auto || (manual && (GUNS[t] || t === "facao"))) { takePickup(f, p); return true; }
  }
  return false;
}

/* ═══════════════════════════ Bots ═══════════════════════════ */
function surfacesAll() {
  const L = game.level;
  return [
    ...L.solids.map(s => ({ x: s.x, y: s.y, w: s.w, solid: true })),
    ...L.plats.map(p => ({ x: p.x, y: p.y, w: p.w, solid: false })),
    ...L.objs.filter(o => o.alive).map(o => ({ x: o.x, y: o.y, w: o.w, solid: true })),
  ];
}
// Superfície onde o lutador está pisando (o trecho em que dá para andar sem cair).
function supportSpan(f) {
  const feet = f.y + f.h;
  let best = null, bo = 0;
  for (const s of surfacesAll()) {
    if (Math.abs(s.y - feet) >= 3) continue;
    const o = Math.min(f.x + f.w, s.x + s.w) - Math.max(f.x, s.x); // quanto do pé está apoiado
    if (o > bo) { bo = o; best = s; }
  }
  return best;
}
// Superfície logo abaixo de um ponto (onde algo vai pousar).
function surfaceUnder(x, feet) {
  let best = null;
  for (const s of surfacesAll()) if (x >= s.x - 2 && x <= s.x + s.w + 2 && s.y >= feet - 3 && (!best || s.y < best.y)) best = s;
  return best;
}
const sameSurf = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w;

// Como ir da superfície A para a B. Cada opção: { kind, tx: [min, max] onde começar, dir, cost }
//   jump  = pular (dir 0 = reto para cima, ±1 = pular em direção)    drop = agachar+pular (desce da plataforma)
//   walk  = andar e sair pela beirada                                 leap = pular um vão saindo da beirada
function links(A, B) {
  const out = [];
  const dy = A.y - B.y; // > 0: B está mais alta
  const a0 = A.x, a1 = A.x + A.w, b0 = B.x, b1 = B.x + B.w;
  const ov = Math.min(a1, b1) - Math.max(a0, b0);
  const gap = Math.max(0, b0 - a1, a0 - b1);
  const side = b0 + b1 > a0 + a1 ? 1 : -1;
  const edge = side > 0 ? a1 - 8 : a0 + 8;
  const far = Math.abs((b0 + b1) / 2 - (a0 + a1) / 2) * 0.25;
  if (dy >= 14 && dy <= 108) { // subir
    if (B.solid && ov > 0) { // bloco apoiado em A: sobe pela lateral
      if (b0 - 14 >= a0 + 4) out.push({ kind: "jump", tx: [b0 - 14, b0 - 14], dir: 1, cost: dy + 20 + far });
      if (b1 + 14 <= a1 - 4) out.push({ kind: "jump", tx: [b1 + 14, b1 + 14], dir: -1, cost: dy + 20 + far });
    } else if (!B.solid && ov >= 24) out.push({ kind: "jump", tx: [Math.max(a0, b0) + 12, Math.min(a1, b1) - 12], dir: 0, cost: dy + far });
    else if (gap <= 92) out.push({ kind: "jump", tx: [edge, edge], dir: side, cost: dy + gap + far });
  } else if (dy > -14 && dy < 14) { // mesmo nível, separadas
    if (gap > 0 && gap <= 140) out.push({ kind: "leap", tx: [edge, edge], dir: side, cost: gap + 10 + far });
  } else if (dy <= -14) { // descer
    if (!A.solid && ov >= 24) out.push({ kind: "drop", tx: [Math.max(a0, b0) + 12, Math.min(a1, b1) - 12], dir: 0, cost: -dy * 0.4 + 5 + far });
    for (const sd of [1, -1]) {
      const e = sd > 0 ? a1 : a0;
      const beyond = sd > 0 ? b1 > a1 + 10 : b0 < a0 - 10; // B continua depois da beirada
      if (!beyond) continue;
      const g = sd > 0 ? Math.max(0, b0 - a1) : Math.max(0, a0 - b1);
      if (g > 150) continue;
      out.push({ kind: g < 4 ? "walk" : "leap", tx: [e - sd * 8, e - sd * 8], dir: sd, cost: -dy * 0.4 + g + 8 + far });
    }
  }
  return out;
}

// Dijkstra no grafo de superfícies: devolve a primeira ligação do melhor caminho até goalS.
function planRoute(cur, goalS, cx, gx) {
  const nodes = surfacesAll();
  const ci = nodes.findIndex(s => sameSurf(s, cur)), gi = nodes.findIndex(s => sameSurf(s, goalS));
  if (ci < 0 || gi < 0 || ci === gi) return null;
  const n = nodes.length, dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
  const cache = new Map();
  const L = (i, j) => { const k = i * 256 + j; let v = cache.get(k); if (!v) cache.set(k, v = links(nodes[i], nodes[j])); return v; };
  dist[ci] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === gi) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (v === u || done[v]) continue;
      const ops = L(u, v);
      if (!ops.length) continue;
      let c = Infinity; for (const o of ops) c = Math.min(c, o.cost);
      c += dist[u] + 30;
      if (c < dist[v]) { dist[v] = c; prev[v] = u; }
    }
  }
  if (dist[gi] === Infinity) return null;
  let v = gi;
  while (prev[v] !== ci) { v = prev[v]; if (v < 0) return null; }
  let best = null, bc = Infinity;
  for (const o of L(ci, v)) {
    let c = Math.abs(clamp(cx, o.tx[0], o.tx[1]) - cx) + o.cost;
    if (v === gi) { // último passo: prefere cair perto do objetivo
      const landX = o.dir ? o.tx[0] + o.dir * 30 : clamp(gx, o.tx[0], o.tx[1]);
      c += Math.abs(landX - gx) * 0.6;
    }
    if (c < bc) { bc = c; best = o; }
  }
  return best && { ...best, dest: nodes[v] };
}

function setLanding(ai, s) {
  const m = Math.min(12, s.w / 3);
  ai.land = { x0: s.x + m, x1: s.x + s.w - m, start: ai.t, until: ai.t + 1.1 };
}

function botThink(f, dt) {
  const ai = f.ai, d = DIFF[ai.level] || DIFF.medio, inp = blankInput();
  ai.t += dt; ai.retarget -= dt; ai.dodgeCd -= dt; ai.nadeCd -= dt; ai.crouchT -= dt; ai.pauseT -= dt; ai.strafeT -= dt;
  f.inp = inp;
  if (!f.alive) return;
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2, feet = f.y + f.h;

  // alvo
  if (!ai.target || !ai.target.alive || ai.retarget <= 0) {
    ai.retarget = rr(0.8, 1.6);
    let best = null, bc = Infinity;
    for (const o of game.fighters) if (o !== f && o.alive) {
      const c = Math.hypot(o.x - f.x, (o.y - f.y) * 1.6) + (hasLOS(cx, cy, o.x + o.w / 2, o.y + o.h / 2) ? 0 : 160);
      if (c < bc) { bc = c; best = o; }
    }
    ai.target = best;
  }
  const tg = ai.target;
  if (!tg) return;
  const tcx = tg.x + tg.w / 2, tdx = tcx - cx;

  // objetivo: arma/vida próxima ou o alvo
  let goal = tg;
  const wantGun = !f.gun || (f.gun === "pistola" && f.ammo < 5);
  const useful = p => !p.dead && p.y >= 0 && !(p.chute && p.y < 200) && p !== ai.ignore &&
    ((GUNS[p.type] && wantGun) || (p.type === "vida" && f.hp < 70) || (p.type === "granadas" && f.grenades < 2) || (p.type === "facao" && !f.melee));
  const pcost = p => Math.abs(p.x - cx) + Math.abs(p.y - feet) * 2;
  if (ai.pick && (!game.pickups.includes(ai.pick) || !useful(ai.pick) || pcost(ai.pick) > 650)) ai.pick = null;
  if (!ai.pick && (wantGun || f.hp < 55 || !f.melee)) {
    let bc = 420;
    for (const p of game.pickups) if (useful(p)) { const c = pcost(p); if (c < bc) { bc = c; ai.pick = p; ai.pickT = 0; } }
  }
  if (ai.pick) {
    goal = ai.pick;
    ai.pickT += dt;
    if (ai.pickT > 7) { ai.ignore = ai.pick; ai.pick = null; goal = tg; } // não está conseguindo: desiste desse item
  }
  ai.goal = goal;
  const gx = goal.x + goal.w / 2, gfeet = goal.y + goal.h, dyFeet = gfeet - feet;

  // linha de tiro
  const myBulletY = f.y + (f.crouch ? 9 : 11);
  const standBulletY = feet - STAND_H + 11, crouchBulletY = feet - CROUCH_H + 9;
  const inRect = y => y >= tg.y + 1 && y <= tg.y + tg.h - 1;
  const los = hasLOS(cx, myBulletY, tcx, tg.y + tg.h / 2) || hasLOS(cx, myBulletY, tcx, myBulletY);
  const alignedStand = inRect(standBulletY), alignedCrouch = inRect(crouchBulletY);
  const dist = Math.abs(tdx);
  const range = f.gun ? (f.gun === "escopeta" ? 260 : 820) : 0;
  const canShoot = f.gun && los && dist < range && (alignedStand || alignedCrouch) && hasLOS(cx, alignedStand ? standBulletY : crouchBulletY, tcx, alignedStand ? standBulletY : crouchBulletY);

  let move = 0, wantCrouch = false;

  // navegação entre superfícies (grafo)
  let nav = false, committed = !!(ai.gapJump && ai.t < ai.gapJump.until);
  const cur = f.onGround ? supportSpan(f) : null;
  const gs = surfaceUnder(gx, gfeet);
  ai.planT = (ai.planT || 0) - dt;
  if (committed && f.onGround) {
    nav = true; move = ai.gapJump.dir; // terminando a saída/pulo já decidido
  } else if (gs && !(goal === tg && canShoot)) {
    if (cur) {
      if (sameSurf(cur, gs)) ai.plan = null;
      else if (ai.planT <= 0 || !ai.plan) { ai.plan = planRoute(cur, gs, cx, gx); ai.planT = 0.25; }
    }
    const pl = ai.plan;
    if (pl) {
      nav = true;
      const tx = clamp(cx, pl.tx[0], pl.tx[1]);
      if (Math.abs(tx - cx) > 6) move = sign(tx - cx); // no ar também (ex.: pulando uma caixa no caminho)
      else if (!f.onGround) move = pl.dir;
      else if (pl.kind === "drop") {
        if (f.onPlat && !cur.solid) { inp.down = true; inp.up = (ai.t % 0.3) < 0.15; setLanding(ai, pl.dest); }
        else { ai.plan = null; ai.planT = 0; } // não está numa plataforma: replaneja
      }
      else {
        setLanding(ai, pl.dest);
        move = pl.dir;
        if (pl.kind !== "walk") inp.up = true;
        if (pl.dir) { ai.gapJump = { dir: pl.dir, until: ai.t + (pl.kind === "walk" ? 0.5 : 0.8) }; committed = true; }
        ai.plan = null; ai.planT = 0.3;
      }
    }
  } else ai.plan = null;
  if (nav) {
    // já decidido acima
  } else if (goal === tg) {
    if (f.gun) {
      const ideal = f.gun === "escopeta" ? 110 : f.gun === "bazuca" ? 300 : 220;
      if (!canShoot) move = sign(tdx);
      else if (dist > ideal + 90) move = sign(tdx);
      else move = 0;
    } else move = dist > 22 ? sign(tdx) : 0;
  } else move = Math.abs(gx - cx) > 4 ? sign(gx - cx) : 0;

  // combate
  if (canShoot) {
    ai.seen += dt;
    if (!alignedStand) wantCrouch = true;
    if (ai.seen > d.react && ai.pauseT <= 0) {
      inp.shoot = true;
      if (move && sign(move) !== sign(tdx)) move = 0;
      if (!move) inp.face = sign(tdx);
      ai.burstT += dt;
      if (ai.burstT > 0.7 && Math.random() < d.pause) { ai.pauseT = rr(0.2, 0.6); ai.burstT = 0; }
    }
  } else ai.seen = Math.max(0, ai.seen - dt * 2);
  if (!f.gun && dist < 34 && Math.abs(tg.y + tg.h / 2 - cy) < 30) { inp.melee = true; inp.face = sign(tdx); move = 0; }
  else if (f.melee && dist < 40 && Math.abs(tg.y + tg.h / 2 - cy) < 30 && Math.random() < 0.5) { inp.melee = true; inp.face = sign(tdx); }

  // desviar agachando quando o alvo mira em pé
  if (tg.gun && tg.alive && !tg.crouch && sign(cx - tcx) === tg.dir && Math.abs(tg.y + tg.h - feet) < 8 && los
      && ai.dodgeCd <= 0 && Math.random() < d.crouch * dt * 4) { ai.crouchT = rr(0.35, 0.9); ai.dodgeCd = rr(1.2, 2.5); }
  if (ai.crouchT > 0 && f.onGround) { wantCrouch = true; move = 0; if (!inp.face) inp.face = sign(tdx); }

  // granada
  if (f.grenades > 0 && ai.nadeCd <= 0 && dist > 130 && dist < 380 && Math.abs(tg.y - f.y) < 90 && Math.random() < d.nade * dt * 2) {
    inp.face = sign(tdx); move = 0; inp.grenade = true; ai.nadeCd = rr(2.5, 5);
  }

  // fugir de granadas
  if (d.dodgeNade) for (const g of game.grenades) {
    if (Math.abs(g.x - cx) < 120 && Math.abs(g.y - cy) < 80 && g.fuse < 1.6) { move = sign(cx - g.x) || 1; wantCrouch = false; inp.shoot = false; break; }
  }

  // pegar arma por cima (manual)
  if (goal !== tg && Math.abs(gx - cx) < 14 && Math.abs(dyFeet) < 20 && (ai.t % 0.2) < 0.1) inp.melee = true;

  // segurança: beiradas e paredes
  if (move && f.onGround && !committed) {
    const ahead = cx + move * (f.w / 2 + 8);
    if (groundBelow(ahead, feet - 2) === null) {
      const land = groundBelow(cx + move * 140, feet - 105);
      if (land !== null && land < feet + 200) { inp.up = true; ai.gapJump = { dir: move, until: ai.t + 0.9 }; }
      else move = 0;
    }
    const probe = { x: move > 0 ? f.x + f.w : f.x - 6, y: f.y + 4, w: 6, h: f.h - 10 };
    if (move && solidsNow().some(s => overlap(probe, s))) inp.up = true;
  }
  // no ar: mira a superfície planejada; pulo de vão segue em frente; fora isso, não cair no vazio
  if (f.onGround && ai.land && ai.t - ai.land.start > 0.15) ai.land = null;
  if (!f.onGround) {
    if (ai.land && ai.t < ai.land.until) move = cx < ai.land.x0 ? 1 : cx > ai.land.x1 ? -1 : 0;
    else if (ai.gapJump && ai.t < ai.gapJump.until) move = ai.gapJump.dir;
    else {
      const look = cx + f.vx * 0.22 + move * 6;
      if (groundBelow(look, feet) === null) {
        const l = groundBelow(cx - 40, feet), r = groundBelow(cx + 40, feet);
        move = l !== null && (r === null || f.vx > 0) ? -1 : r !== null ? 1 : -sign(f.vx);
      }
    }
  }
  // travado?
  if (move && Math.abs(f.vx) < 15 && f.onGround) { ai.stuckT += dt; if (ai.stuckT > 0.5) { inp.up = true; if (ai.stuckT > 1.4) { ai.wander = -move; ai.stuckT = 0; ai.plan = null; ai.planT = 0.6; } } }
  else ai.stuckT = 0;

  if (wantCrouch && f.onGround && !f.onPlat && !inp.up) { inp.down = true; move = 0; }
  // segura o pulo (senão o pulo variável corta a altura); descer da plataforma usa pulsos
  if (inp.up && !inp.down && f.onGround) ai.jumpHold = 0.4;
  if (ai.jumpHold > 0) { ai.jumpHold -= dt; if (!inp.down) inp.up = true; }
  inp.left = move < 0; inp.right = move > 0;
}

/* ═══════════════════════════ Atualização ═══════════════════════════ */
function updateFighter(f, dt) {
  const inp = f.inp, pr = f.prev;
  const pressed = k => inp[k] && !pr[k];
  f.fireCd -= dt; f.meleeCd -= dt; f.nadeCd -= dt; f.stun -= dt; f.hurtT -= dt; f.dropT -= dt;
  f.meleeAnim -= dt; f.flash -= dt; f.coyote -= dt; f.jumpBuf -= dt;

  if (!f.alive) {
    f.deadT += dt;
    f.vy = Math.min(f.vy + GRAV * dt, 950);
    if (f.onGround) f.vx = approach(f.vx, 0, 900 * dt);
    moveBody(f, dt, false);
    return;
  }

  const ok = f.stun <= 0 && !game.ending?.frozen;
  // segurar ↓ em cima de uma plataforma: desce por ela
  if (ok && inp.down && f.onPlat && f.dropT <= 0) { f.dropT = 0.22; setCrouch(f, false); f.y += 1; f.onGround = false; f.onPlat = false; }
  setCrouch(f, ok && inp.down && f.onGround && !f.onPlat);
  const mv = ok ? (inp.right ? 1 : 0) - (inp.left ? 1 : 0) : 0;
  if (mv) f.dir = mv; else if (inp.face && ok) f.dir = inp.face;
  f.aim = typeof inp.aim === "number" && isFinite(inp.aim) ? inp.aim : null;
  if (f.aim != null && ok) f.dir = Math.cos(f.aim) >= 0 ? 1 : -1; // vira para onde mira
  const max = f.crouch ? 0 : RUN;
  if (ok) f.vx = approach(f.vx, mv * max, (f.onGround ? 2600 : 1500) * dt);
  else f.vx = approach(f.vx, 0, (f.onGround ? 700 : 200) * dt);

  if (pressed("up")) f.jumpBuf = 0.12;
  if (f.onGround) f.coyote = 0.08;
  if (ok && f.jumpBuf > 0 && f.coyote > 0) {
    if (inp.down && f.onPlat) { f.dropT = 0.22; setCrouch(f, false); f.y += 1; }
    else { setCrouch(f, false); if (!f.crouch) { f.vy = -JUMP; f.jumping = true; } }
    f.jumpBuf = 0; f.coyote = 0; f.onGround = false;
  }
  if (f.jumping && !inp.up && f.vy < -260) f.vy = -260;
  if (f.vy >= 0) f.jumping = false;

  f.vy = Math.min(f.vy + GRAV * dt, 950);
  moveBody(f, dt, f.dropT > 0);
  if (f.onGround && Math.abs(f.vx) > 20) f.anim += dt * Math.abs(f.vx) * 0.06; else f.anim = 0;

  // ações
  if (ok) {
    if (pressed("melee") && tryPickups(f, true)) f.meleeCd = 0.2;
    else if (inp.melee && f.meleeCd <= 0) meleeAttack(f);
    if (inp.shoot) {
      if (f.gun && f.fireCd <= 0) fire(f);
      else if (!f.gun && f.meleeCd <= 0) meleeAttack(f);
    }
    if (pressed("grenade") && f.nadeCd <= 0) { if (f.grenades > 0) throwGrenade(f); else emit("s", "clique", f.x); }
  }
  tryPickups(f, false);

  // morte súbita / queda
  if (game.suddenDeath) { f.hp -= 3 * dt; if (f.hp <= 0) kill(f, null, "subita"); }
  if (f.y > H + 60 || f.x < -200 || f.x > W + 200) {
    const by = game.roundT - f.lastHitT < 4 ? f.lastHitBy : null;
    kill(f, by, "queda");
    f.vy = 0;
  }
}

function updateBullets(dt) {
  for (const b of game.bullets) {
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    const hit = raycast(b.x, b.y, nx, ny, b.owner);
    if (hit) {
      b.dead = true; b.x = hit.x; b.y = hit.y;
      if (hit.kind === "fighter") {
        hurt(hit.f, b.dmg, b.owner, sign(b.vx) * b.kick, -40, b.gun, hit.y);
        emit("s", "acerto", hit.x);
      } else {
        if (hit.kind === "obj") damageObj(hit.obj, b.dmg, b.owner);
        emit("s", "parede", hit.x);
        emit("spark", hit.x, hit.y, -sign(b.vx), hit.kind === "obj" && hit.obj.type === "crate" ? 1 : 0);
      }
      continue;
    }
    b.x = nx; b.y = ny; b.life -= dt;
    if (b.life <= 0 || b.x < -50 || b.x > W + 50 || b.y < -50 || b.y > H + 50) b.dead = true;
  }
  game.bullets = game.bullets.filter(b => !b.dead);

  for (const r of game.rockets) {
    const nx = r.x + r.vx * dt, ny = r.y + r.vy * dt;
    const hit = raycast(r.x, r.y, nx, ny, r.owner);
    r.life -= dt;
    if (hit || r.life <= 0) {
      r.dead = true;
      const hx = hit ? hit.x - sign(r.vx) * 4 : r.x;
      explode(hx, hit ? hit.y : r.y, 85, 85, r.owner, "bazuca");
      continue;
    }
    r.x = nx; r.y = ny;
    if (r.x < -60 || r.x > W + 60) r.dead = true;
  }
  game.rockets = game.rockets.filter(r => !r.dead);
}

function updateGrenades(dt) {
  const sol = solidsNow();
  for (const g of game.grenades) {
    g.fuse -= dt; g.spin += g.vx * dt * 0.1;
    if (g.fuse <= 0) { g.dead = true; explode(g.x + 4, g.y + 4, 95, 85, g.owner, "granada"); continue; }
    g.vy = Math.min(g.vy + GRAV * dt, 900);
    g.x += g.vx * dt;
    for (const s of sol) if (overlap(g, s)) { g.x -= g.vx * dt; g.vx *= -0.5; if (Math.abs(g.vx) > 60) emit("s", "quique", g.x); break; }
    const oldBottom = g.y + g.h;
    g.y += g.vy * dt;
    let landed = false;
    for (const s of sol) if (overlap(g, s)) {
      if (g.vy > 0) { g.y = s.y - g.h; landed = true; } else { g.y = s.y + s.h; g.vy = -g.vy * 0.3; }
      break;
    }
    if (!landed && g.vy > 0) for (const p of game.level.plats)
      if (g.x + g.w > p.x && g.x < p.x + p.w && oldBottom <= p.y + 0.5 && g.y + g.h >= p.y) { g.y = p.y - g.h; landed = true; break; }
    if (landed) {
      if (g.vy > 140) emit("s", "quique", g.x);
      g.vy = g.vy > 140 ? -g.vy * 0.35 : 0;
      g.vx = approach(g.vx, 0, 900 * dt);
    }
    if (g.y > H + 50) g.dead = true;
  }
  game.grenades = game.grenades.filter(g => !g.dead);
}

function updatePickups(dt) {
  for (const p of game.pickups) {
    p.life -= dt; p.noPickT = (p.noPickT || 0) - dt; p.sway += dt * 2;
    p.vy = Math.min(p.vy + GRAV * dt, p.chute ? 85 : 900);
    if (p.chute) p.vx = Math.sin(p.sway) * 25;
    moveBody(p, dt, false);
    if (p.onGround) { p.chute = false; p.vx = approach(p.vx, 0, 600 * dt); }
    if (p.y > H + 40 || p.life <= 0) p.dead = true;
  }
  game.pickups = game.pickups.filter(p => !p.dead);
}

function step(dt) {
  game.roundT += dt;
  for (const t of game.timers) { t.t -= dt; if (t.t <= 0) { t.done = true; t.fn(); } }
  game.timers = game.timers.filter(t => !t.done);

  for (const f of game.fighters) { if (f.isBot) botThink(f, dt); }
  for (const f of game.fighters) { updateFighter(f, dt); f.prev = { ...f.inp }; }
  updateBullets(dt);
  updateGrenades(dt);
  updatePickups(dt);
  for (const o of game.level.objs) o.hurtT -= dt;

  // armas caindo do céu
  if (!game.ending) {
    game.dropT -= dt * (game.cfg.drops || 1);
    if (game.dropT <= 0) {
      game.dropT = rr(4.5, 8);
      if (game.pickups.length < 6) spawnPickup(pick(DROP_TABLE), rr(50, W - 72), -20, true);
    }
    if (game.roundT > 100 && !game.suddenDeath) {
      game.suddenDeath = true;
      game.banner = { text: "MORTE SÚBITA", sub: "a vida de todos está caindo", t: 0, dur: 2 };
    }
  }
  for (const e of game.feed) e.t += dt;
}

function roundFlow(real) {
  if (game.banner) { game.banner.t += real; if (game.banner.t > game.banner.dur) game.banner = null; }
  const alive = game.fighters.filter(f => f.alive);
  if (!game.ending) {
    if (alive.length <= 1 && game.roundT > 0.5) game.ending = { t: 0, scored: false };
    return;
  }
  const e = game.ending;
  e.t += real;
  if (!e.scored && e.t > 1.3) {
    e.scored = true;
    const w = alive.length === 1 ? alive[0] : null;
    if (w) game.scores[w.id]++;
    game.stats.rounds.push([game.mapIdx, Math.round(game.roundT)]);
    game.banner = w ? { text: `${w.name.toUpperCase()} VENCEU A RODADA`, sub: "", color: w.look.shirt, t: 0, dur: 2.6 }
                    : { text: "EMPATE!", sub: "ninguém sobrou", t: 0, dur: 2.6 };
    emit("s", "rodada");
  }
  if (e.t > 3.6) {
    const top = Math.max(...game.scores);
    if (top >= game.cfg.target && !game.demo) { game.state = "over"; game.banner = null; hooks.matchEnd(); }
    else { if (game.demo && top >= game.cfg.target) game.scores = game.scores.map(() => 0); startRound(); }
  }
}

if (typeof module !== "undefined") module.exports = {
  W, H, STEP, GUNS, MELEE, LOOKS, BOT_NAMES, MAPS, game, hooks, setEmit,
  startMatch, startRound, step, roundFlow, buildLevel, blankInput, shuffle, pick,
};
