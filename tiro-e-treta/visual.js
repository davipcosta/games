// Tiro & Treta — desenho, som e efeitos. Só navegador; usa as constantes/utilidades do motor.js.
"use strict";
/* ═══════════════════════════ Tela ═══════════════════════════ */
const cv = document.getElementById("c"), ctx = cv.getContext("2d");
let SCALE = 1;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.min(innerWidth, innerHeight * W / H), ch = cw * H / W;
  cv.style.width = cw + "px"; cv.style.height = ch + "px";
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  SCALE = cv.width / W;
}
addEventListener("resize", resize); resize();

/* ═══════════════════════════ Som (sintetizado) ═══════════════════════════ */
const Snd = { ctx: null, out: null, noise: null, muted: false, last: {} };
function audioInit() {
  if (Snd.ctx) { if (Snd.ctx.state === "suspended") Snd.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    Snd.ctx = new AC();
    Snd.out = Snd.ctx.createGain(); Snd.out.gain.value = 0.45; Snd.out.connect(Snd.ctx.destination);
    const len = Snd.ctx.sampleRate;
    Snd.noise = Snd.ctx.createBuffer(1, len, Snd.ctx.sampleRate);
    const d = Snd.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch { Snd.ctx = null; }
}
function chain(pan) {
  const c = Snd.ctx, g = c.createGain();
  if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(Snd.out); }
  else g.connect(Snd.out);
  return g;
}
function noise(pan, { dur, type = "lowpass", f = 1000, f2, q = 0.7, vol = 0.5 }) {
  const c = Snd.ctx, t = c.currentTime, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = chain(pan);
  s.buffer = Snd.noise; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(fl); fl.connect(g); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function tone(pan, { dur, f, f2, type = "sine", vol = 0.3, delay = 0 }) {
  const c = Snd.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = chain(pan);
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); o.start(t); o.stop(t + dur + 0.02);
}
function sfx(name, x = W / 2, vol = 1) {
  if (!Snd.ctx || Snd.muted || V.silent || Snd.ctx.state !== "running") return;
  const now = performance.now(), gap = { smg: 40, parede: 50, acerto: 35, quique: 60 }[name] || 0;
  if (gap && now - (Snd.last[name] || 0) < gap) return;
  Snd.last[name] = now;
  const p = (x / W) * 2 - 1;
  const v = vol;
  switch (name) {
    case "pistola": noise(p, { dur: 0.13, type: "bandpass", f: 1900, q: 0.8, vol: 0.7 * v }); tone(p, { dur: 0.08, f: 190, f2: 60, vol: 0.35 * v }); break;
    case "smg": noise(p, { dur: 0.07, type: "bandpass", f: 2500, q: 0.9, vol: 0.5 * v }); tone(p, { dur: 0.05, f: 220, f2: 90, vol: 0.2 * v }); break;
    case "escopeta": noise(p, { dur: 0.32, f: 2200, f2: 300, vol: 1 * v }); tone(p, { dur: 0.2, f: 130, f2: 40, vol: 0.5 * v }); break;
    case "rifle": noise(p, { dur: 0.4, type: "bandpass", f: 1300, f2: 400, q: 0.6, vol: 1 * v }); tone(p, { dur: 0.3, f: 100, f2: 30, vol: 0.55 * v }); break;
    case "bazuca": noise(p, { dur: 0.45, f: 700, f2: 200, vol: 0.8 * v }); tone(p, { dur: 0.35, f: 160, f2: 70, type: "triangle", vol: 0.3 * v }); break;
    case "explosao": noise(p, { dur: 1.1, f: 1200, f2: 80, vol: 1.3 * v }); tone(p, { dur: 0.8, f: 80, f2: 25, vol: 0.8 * v }); break;
    case "soco": tone(p, { dur: 0.09, f: 170, f2: 60, vol: 0.6 * v }); noise(p, { dur: 0.05, f: 900, vol: 0.4 * v }); break;
    case "corte": noise(p, { dur: 0.14, type: "highpass", f: 2500, vol: 0.35 * v }); break;
    case "vento": noise(p, { dur: 0.1, type: "bandpass", f: 900, vol: 0.12 * v }); break;
    case "acerto": noise(p, { dur: 0.06, f: 700, vol: 0.5 * v }); break;
    case "parede": noise(p, { dur: 0.04, type: "highpass", f: 3500, vol: 0.18 * v }); break;
    case "madeira": noise(p, { dur: 0.25, type: "bandpass", f: 500, q: 1.2, vol: 0.7 * v }); break;
    case "clique": tone(p, { dur: 0.03, f: 1600, type: "square", vol: 0.12 * v }); break;
    case "pegar": tone(p, { dur: 0.07, f: 520, type: "square", vol: 0.12 * v }); tone(p, { dur: 0.09, f: 880, type: "square", vol: 0.12 * v, delay: 0.06 }); break;
    case "vida": [523, 659, 784].forEach((f, i) => tone(p, { dur: 0.1, f, type: "triangle", vol: 0.2 * v, delay: i * 0.06 })); break;
    case "quique": tone(p, { dur: 0.04, f: 900, type: "triangle", vol: 0.15 * v }); break;
    case "lancar": noise(p, { dur: 0.12, type: "bandpass", f: 1200, vol: 0.2 * v }); break;
    case "morte": tone(p, { dur: 0.5, f: 320, f2: 70, type: "sawtooth", vol: 0.16 * v }); break;
    case "rodada": [392, 523, 659, 784].forEach((f, i) => tone(0, { dur: 0.16, f, type: "square", vol: 0.1, delay: i * 0.09 })); break;
    case "luta": tone(0, { dur: 0.3, f: 220, f2: 440, type: "square", vol: 0.12 }); break;
  }
}

/* ═══════════════════════════ Efeitos (eventos do motor) ═══════════════════════════ */
const V = { particles: [], shake: 0, silent: false };
let G = null; // estado sendo desenhado (o game local ou a visão montada da rede)

// Avança o que é só visual: partículas, tremor, fumaça dos foguetes.
function visualUpdate(dt, state, real = dt) {
  if (state.level) updateParticles(dt, state.level);
  V.shake = Math.max(0, V.shake - real * 40);
  for (const r of state.rockets) if (Math.random() < dt * 80)
    V.particles.push({ x: r.x - Math.cos(Math.atan2(r.vy || 0, r.vx)) * 10, y: r.y - Math.sin(Math.atan2(r.vy || 0, r.vx)) * 10 + rr(-2, 2), vx: rr(-30, 30), vy: rr(-30, 10), g: -0.05, life: rr(0.3, 0.6), max: 0.6, size: rr(4, 8), color: "#8a8a92", kind: "smoke" });
}
function fx(type, a, b, c, d) {
  switch (type) {
    case "s": sfx(a, b); break;
    case "novaRodada": V.particles = []; V.shake = 0; break;
    case "shake": V.shake = Math.max(V.shake, a); break;
    case "blood": bloodFx(a, b, c, d); break;
    case "muzzle": {
      // c = ângulo do tiro (eventos antigos mandavam só ±1 = direção)
      const x = a, y = b, ang = Math.abs(c) === 1 ? (c > 0 ? 0 : Math.PI) : c, ca = Math.cos(ang), sa = Math.sin(ang), dir = ca >= 0 ? 1 : -1;
      if (d) V.particles.push({ x: x - ca * 16, y: y - sa * 16, vx: -dir * rr(40, 120), vy: rr(-260, -160), g: 1, life: 0.9, max: 0.9, size: 2, color: "#e8b84a", kind: "dot" });
      for (let i = 0; i < 5; i++) { const s = rr(80, 380); V.particles.push({ x, y, vx: ca * s + rr(-50, 50), vy: sa * s + rr(-50, 50), g: 0, life: 0.07, max: 0.07, size: rr(2, 4), color: pick(["#fff3c4", "#ffd27a", "#ff9a3c"]), kind: "dot" }); }
      break;
    }
    case "gunthrow": V.particles.push({ x: a, y: b, vx: -c * 120, vy: -260, g: 1, life: 1.2, max: 1.2, size: 5, color: "#555c6b", kind: "gun" }); break;
    case "spark":
      for (let i = 0; i < 4; i++) V.particles.push({ x: a, y: b, vx: c * rr(40, 260), vy: rr(-200, 60), g: 0.8, life: rr(0.1, 0.3), max: 0.3, size: 2, color: d ? "#c58f52" : "#ffe9a8", kind: "spark" });
      break;
    case "debris": { const cx = a, cy = b;
      for (let i = 0; i < 14; i++) V.particles.push({ x: cx + rr(-12, 12), y: cy + rr(-12, 12), vx: rr(-260, 260), vy: rr(-380, -80), g: 1, life: rr(0.6, 1.2), max: 1.2, size: rr(3, 7), color: pick(["#a8743f", "#8a5a2c", "#c58f52"]), kind: "debris", rot: Math.random() * 6 });
      break; }
    case "boom": { const x = a, y = b, r = c;
    V.particles.push({ x, y, vx: 0, vy: 0, g: 0, life: 0.18, max: 0.18, size: r * 1.1, color: "#fff4d0", kind: "flash" });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = rr(60, 420);
      V.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, g: 0.15, life: rr(0.25, 0.6), max: 0.6, size: rr(5, 13), color: pick(["#ffdf6b", "#ff9a3c", "#ff5a2c", "#ffd27a"]), kind: "fire" });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = rr(20, 140);
      V.particles.push({ x: x + rr(-14, 14), y: y + rr(-14, 14), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 50, g: -0.05, life: rr(0.7, 1.4), max: 1.4, size: rr(10, 20), color: "#3a3a40", kind: "smoke" });
    }
    for (let i = 0; i < 10; i++) V.particles.push({ x, y, vx: rr(-500, 500), vy: rr(-600, -100), g: 1, life: rr(0.4, 0.9), max: 0.9, size: 2, color: "#ffe9a8", kind: "spark" });
    V.shake = Math.max(V.shake, 13);
      break; }
  }
}

function bloodFx(x, y, dir, n) {
  for (let i = 0; i < n; i++) V.particles.push({ x, y, vx: dir * rr(30, 240) + rr(-60, 60), vy: rr(-260, 40), g: 1, life: rr(0.5, 1), max: 1, size: rr(2, 4), color: pick(["#c0242b", "#a01b22", "#d8333a"]), kind: "blood" });
}


function updateParticles(dt, L) {
  for (const p of V.particles) {
    p.life -= dt;
    if (p.stuck) continue;
    p.vy += GRAV * dt * (p.g ?? 1);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === "smoke" || p.kind === "fire") { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
    if (p.kind === "blood" || p.kind === "debris") {
      for (const s of L.solids) if (p.x > s.x && p.x < s.x + s.w && p.y > s.y && p.y < s.y + s.h) {
        if (p.kind === "blood") { p.stuck = true; p.y = Math.max(s.y + 1, Math.min(p.y, s.y + s.h)); p.life = rr(5, 9); p.max = 9; }
        else { p.y = s.y - 1; p.vy *= -0.3; p.vx *= 0.6; }
        break;
      }
      if (!p.stuck && p.vy > 0) for (const pl of L.plats) if (p.x > pl.x && p.x < pl.x + pl.w && p.y > pl.y && p.y < pl.y + 6) {
        if (p.kind === "blood") { p.stuck = true; p.y = pl.y + 1; p.life = rr(5, 9); p.max = 9; } else { p.y = pl.y - 1; p.vy *= -0.3; p.vx *= 0.6; }
        break;
      }
    }
  }
  V.particles = V.particles.filter(p => p.life > 0);
  if (V.particles.length > 900) V.particles.splice(0, V.particles.length - 900);
}


/* ═══════════════════════════ Desenho ═══════════════════════════ */
function makeBackground(level) {
  const c = document.createElement("canvas"), k = 2;
  c.width = W * k; c.height = H * k;
  const g = c.getContext("2d");
  g.scale(k, k);
  const tema = level.def.tema;
  let seed = 7 + MAPS.indexOf(level.def) * 13;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  if (tema === "telhados") {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#160f2e"); sky.addColorStop(0.55, "#4a2550"); sky.addColorStop(1, "#d8663e");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.7})`; g.fillRect(rnd() * W, rnd() * 260, 1.5, 1.5); }
    g.fillStyle = "#ffe7b0"; g.beginPath(); g.arc(790, 90, 34, 0, 7); g.fill();
    g.fillStyle = "rgba(255,231,176,.12)"; g.beginPath(); g.arc(790, 90, 60, 0, 7); g.fill();
    for (const [base, col, hmin, hmax, win] of [[380, "#2a1a3a", 60, 180, "rgba(255,200,120,.25)"], [440, "#1b1228", 80, 240, "rgba(255,210,140,.4)"]]) {
      let x = -20;
      while (x < W) {
        const w = 40 + rnd() * 70, h = hmin + rnd() * (hmax - hmin);
        g.fillStyle = col; g.fillRect(x, base - h, w, H);
        g.fillStyle = win;
        for (let wy = base - h + 10; wy < H; wy += 16) for (let wx = x + 6; wx < x + w - 8; wx += 12) if (rnd() < 0.35) g.fillRect(wx, wy, 5, 7);
        x += w + 4;
      }
    }
  } else if (tema === "fabrica") {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0e1a1c"); bg.addColorStop(1, "#1c2a2a");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#233536"; g.lineWidth = 14;
    for (let i = 0; i < 6; i++) { g.beginPath(); const y = 40 + i * 80; g.moveTo(0, y); g.lineTo(W, y + (rnd() - 0.5) * 30); g.stroke(); }
    g.strokeStyle = "#2c4243"; g.lineWidth = 3;
    for (let x = 40; x < W; x += 120) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let i = 0; i < 5; i++) { // engrenagens
      const x = 80 + rnd() * 800, y = 60 + rnd() * 300, r = 20 + rnd() * 35;
      g.fillStyle = "#1a2829"; g.beginPath();
      for (let a = 0; a < 16; a++) { const rad = a % 2 ? r : r * 1.2, ang = a / 16 * Math.PI * 2; g.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad); }
      g.fill(); g.fillStyle = "#0e1a1c"; g.beginPath(); g.arc(x, y, r * 0.35, 0, 7); g.fill();
    }
    const lava = g.createLinearGradient(0, 440, 0, H);
    lava.addColorStop(0, "rgba(255,120,30,0)"); lava.addColorStop(1, "rgba(255,110,20,.85)");
    g.fillStyle = lava; g.fillRect(430, 440, 100, 100);
    g.fillStyle = "#ff8a2a"; g.fillRect(430, 528, 100, 12);
  } else { // armazém
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1a1714"); bg.addColorStop(1, "#2b241d");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 1;
    for (let y = 0; y < H; y += 18) for (let x = (y / 18 % 2) * 20; x < W; x += 40) g.strokeRect(x, y, 40, 18);
    for (let x = 120; x < W; x += 240) { g.fillStyle = "#3a3f4b"; g.fillRect(x, 0, 14, H); g.fillStyle = "#4a5163"; g.fillRect(x, 0, 3, H); }
    for (const x of [200, 480, 760]) {
      g.fillStyle = "#0d1626"; g.fillRect(x - 50, 30, 100, 50);
      g.fillStyle = "rgba(160,190,255,.18)"; g.fillRect(x - 46, 34, 44, 42); g.fillRect(x + 2, 34, 44, 42);
      const cone = g.createLinearGradient(0, 80, 0, 420);
      cone.addColorStop(0, "rgba(180,200,255,.10)"); cone.addColorStop(1, "rgba(180,200,255,0)");
      g.fillStyle = cone; g.beginPath(); g.moveTo(x - 50, 80); g.lineTo(x + 50, 80); g.lineTo(x + 130, 420); g.lineTo(x - 130, 420); g.fill();
    }
  }
  // geometria estática
  const st = { armazem: ["#3b3f49", "#5a6070", "#2a2d35"], telhados: ["#2c2f3a", "#4c5263", "#1e2028"], fabrica: ["#2e3b3c", "#5b7273", "#1f2828"] }[tema];
  for (const s of level.solids) {
    g.fillStyle = st[0]; g.fillRect(s.x, s.y, s.w, s.h);
    if (tema === "telhados" && s.h > 60) {
      g.fillStyle = "rgba(255,210,140,.18)";
      for (let wy = s.y + 22; wy < H; wy += 26) for (let wx = s.x + 14; wx < s.x + s.w - 18; wx += 26) if (rnd() < 0.5) g.fillRect(wx, wy, 10, 13);
    } else {
      g.strokeStyle = st[2]; g.lineWidth = 1;
      for (let y = s.y + 12; y < s.y + s.h; y += 12) { g.beginPath(); g.moveTo(s.x, y); g.lineTo(s.x + s.w, y); g.stroke(); }
    }
    g.fillStyle = st[1]; g.fillRect(s.x, s.y, s.w, 4);
    if (tema === "fabrica" && s.w > 100) for (let x = s.x; x < s.x + s.w; x += 20) { g.fillStyle = (x / 20) % 2 ? "#e0b030" : "#222"; g.fillRect(x, s.y + 4, 20, 4); }
  }
  for (const p of level.plats) {
    g.fillStyle = "#1b1d22"; for (let x = p.x + 12; x < p.x + p.w - 6; x += 60) g.fillRect(x, p.y + 8, 3, 14);
    g.fillStyle = "#6a7080"; g.fillRect(p.x, p.y, p.w, 8);
    g.fillStyle = "#8a92a4"; g.fillRect(p.x, p.y, p.w, 2);
    g.fillStyle = "#464b57"; for (let x = p.x + 4; x < p.x + p.w - 4; x += 8) g.fillRect(x, p.y + 3, 4, 3);
  }
  return c;
}

function drawObj(o) {
  if (!o.alive) return;
  const hot = o.hurtT > 0;
  if (o.type === "crate") {
    ctx.fillStyle = hot ? "#e9c08a" : "#a8743f"; ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.strokeStyle = "#5e3c1c"; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    ctx.beginPath(); ctx.moveTo(o.x + 3, o.y + 3); ctx.lineTo(o.x + o.w - 3, o.y + o.h - 3); ctx.moveTo(o.x + o.w - 3, o.y + 3); ctx.lineTo(o.x + 3, o.y + o.h - 3); ctx.stroke();
    if (o.hp < 25) { ctx.strokeStyle = "#3a2410"; ctx.beginPath(); ctx.moveTo(o.x + 8, o.y); ctx.lineTo(o.x + 14, o.y + 12); ctx.lineTo(o.x + 10, o.y + 20); ctx.stroke(); }
  } else {
    ctx.fillStyle = hot ? "#ff9090" : "#c22f2f"; ctx.fillRect(o.x, o.y + 2, o.w, o.h - 4);
    ctx.fillStyle = "#8f1f1f"; ctx.fillRect(o.x, o.y, o.w, 4); ctx.fillRect(o.x, o.y + o.h - 4, o.w, 4); ctx.fillRect(o.x, o.y + 14, o.w, 3);
    ctx.fillStyle = "#ffd24b"; ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, o.y + 6); ctx.lineTo(o.x + o.w / 2 + 6, o.y + 13); ctx.lineTo(o.x + o.w / 2 - 6, o.y + 13); ctx.fill();
    ctx.fillStyle = "#111"; ctx.fillRect(o.x + o.w / 2 - 1, o.y + 8, 2, 3);
  }
}

function drawGunShape(type, x, y) {
  // desenhado apontando para +x, com (x,y) no ponto de empunhadura
  ctx.fillStyle = "#2a2d34"; ctx.strokeStyle = "#0b0c0f"; ctx.lineWidth = 1;
  const R = (a, b, c, d, col) => { ctx.fillStyle = col || "#2a2d34"; ctx.fillRect(x + a, y + b, c, d); ctx.strokeRect(x + a, y + b, c, d); };
  switch (type) {
    case "pistola": R(-1, -2, 11, 4); R(-1, 1, 3, 4, "#3a2a1e"); break;
    case "smg": R(-3, -2, 15, 5); R(2, 2, 3, 6, "#1a1b1f"); R(-6, -1, 4, 3); break;
    case "escopeta": R(-8, -2, 26, 4, "#33363e"); R(-8, 1, 8, 4, "#6b4424"); R(6, 2, 6, 2, "#6b4424"); break;
    case "rifle": R(-10, -2, 32, 4, "#3a3e48"); R(-10, 1, 9, 4, "#6b4424"); R(2, -5, 9, 3, "#111"); break;
    case "bazuca": R(-14, -5, 34, 8, "#4a5a3a"); R(18, -6, 4, 10, "#2a3320"); R(-2, 3, 3, 5); break;
    case "facao": ctx.fillStyle = "#cfd6df"; ctx.beginPath(); ctx.moveTo(x + 3, y - 2); ctx.lineTo(x + 24, y - 3); ctx.lineTo(x + 20, y + 2); ctx.lineTo(x + 3, y + 2); ctx.fill(); ctx.stroke(); R(-3, -2, 6, 4, "#3a2a1e"); break;
  }
}

function drawFighter(f) {
  const L = f.look, fx = f.x + f.w / 2, fy = f.y + f.h;
  ctx.save();
  ctx.translate(fx, fy);
  if (!f.alive) {
    const k = Math.min(1, f.deadT * 5);
    ctx.globalAlpha = f.deadT > 6 ? Math.max(0.35, 1 - (f.deadT - 6) * 0.3) : 1;
    ctx.translate(0, -7 * k);
    ctx.rotate(-f.dir * k * Math.PI / 2);
  }
  ctx.scale(f.dir, 1);
  const out = "#0b0c0f";
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const crouch = f.crouch;
  const hip = crouch ? -10 : -18, top = crouch ? -22 : -34, headY = crouch ? -32 : -46;
  const air = f.alive && !f.onGround;
  const sw = f.alive && f.onGround && Math.abs(f.vx) > 20 ? Math.sin(f.anim) * 0.75 : air ? 0.45 : 0;

  // pernas
  const leg = (a, col) => {
    ctx.strokeStyle = out; ctx.lineWidth = 7;
    if (crouch) { ctx.beginPath(); ctx.moveTo(a * 2, hip); ctx.lineTo(7 + a * 2, -6); ctx.lineTo(3 + a * 3, 0); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(a * 2, hip); ctx.lineTo(7 + a * 2, -6); ctx.lineTo(3 + a * 3, 0); ctx.stroke(); return; }
    const ang = a * sw, kx = Math.sin(ang) * 9 + (air ? 3 : 0), ky = hip + 9, ex = Math.sin(ang) * 16 - (air ? a * 4 : 0), ey = air ? -3 : 0;
    ctx.beginPath(); ctx.moveTo(0, hip); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(0, hip); ctx.lineTo(kx, ky); ctx.lineTo(ex, ey); ctx.stroke();
  };
  leg(-1, shade(L.pants, -20)); leg(1, L.pants);

  // braço de trás
  const armSw = f.alive && !f.gun && f.meleeAnim <= 0 ? -sw * 6 : 0;
  const sh = top + 4;
  ctx.strokeStyle = out; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-1, sh); ctx.lineTo(-3 + armSw, sh + 12); ctx.stroke();
  ctx.strokeStyle = shade(L.shirt, -30); ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-1, sh); ctx.lineTo(-3 + armSw, sh + 12); ctx.stroke();

  // facão nas costas se estiver com arma
  if (f.melee && f.gun) { ctx.save(); ctx.translate(-4, top + 6); ctx.rotate(-2.2); drawGunShape("facao", 0, 0); ctx.restore(); }

  // tronco
  const flashW = f.hurtT > 0;
  ctx.fillStyle = flashW ? "#fff" : L.shirt; ctx.strokeStyle = out; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(-6, top, 12, hip - top + 2, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#1a1a1a"; ctx.fillRect(-6, hip - 2, 12, 3); // cinto

  // cabeça
  const hs = crouch ? 11 : 12;
  ctx.fillStyle = flashW ? "#fff" : L.skin; ctx.beginPath(); ctx.roundRect(-6, headY, 12, hs, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = L.hair; ctx.fillRect(-6, headY, 12, 4); ctx.fillRect(-6, headY, 4, 8);
  ctx.fillStyle = shade(L.shirt, -10); ctx.fillRect(-6, headY + 3, 12, 2.5); // faixa
  ctx.fillStyle = out;
  if (f.alive) ctx.fillRect(2.5, headY + 6, 2, 2.5);
  else { ctx.fillRect(1.5, headY + 5.5, 4, 1); ctx.fillRect(3, headY + 4, 1, 4); }

  // braço da frente + arma
  const gy = top + 1;
  ctx.strokeStyle = out; ctx.lineWidth = 6;
  if (f.alive && f.gun && f.meleeAnim <= 0 && f.aim != null) {
    // mirando: braço e arma giram em volta do ombro (ângulo local, já espelhado pelo scale(dir))
    const la = f.dir > 0 ? f.aim : Math.PI - f.aim;
    const l = Math.atan2(Math.sin(la), Math.cos(la));
    const rec = f.flash > 0 ? -3 : 0;
    const hx = 1 + Math.cos(l) * (9 + rec), hy = gy + Math.sin(l) * (9 + rec);
    ctx.beginPath(); ctx.moveTo(1, sh); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = L.shirt; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(1, sh); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(l);
    drawGunShape(f.gun, 0, 0);
    if (f.flash > 0) {
      ctx.fillStyle = "#fff3c4"; ctx.beginPath(); const mx = ({ pistola: 12, smg: 14, escopeta: 20, rifle: 24, bazuca: 22 }[f.gun] || 12);
      ctx.moveTo(mx, -5); ctx.lineTo(mx + 12, 0); ctx.lineTo(mx, 5); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, 7); ctx.fill(); ctx.strokeStyle = out; ctx.lineWidth = 1; ctx.stroke();
  } else if (f.alive && (f.gun || f.meleeAnim > 0 || (f.melee && !f.gun))) {
    const punch = f.meleeAnim > 0 ? (1 - Math.abs(f.meleeAnim / 0.16 - 0.5) * 2) : 0;
    const rec = f.flash > 0 ? -3 : 0;
    const hx = 9 + punch * 10 + rec;
    const hy = f.gun ? gy : gy + 2 - punch * 2;
    ctx.beginPath(); ctx.moveTo(1, sh); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = L.shirt; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(1, sh); ctx.lineTo(hx, hy); ctx.stroke();
    if (f.gun && f.meleeAnim <= 0) drawGunShape(f.gun, hx, hy);
    else if (f.melee) { ctx.save(); ctx.translate(hx, hy); ctx.rotate(punch > 0 ? 0.1 : -0.9); drawGunShape("facao", 0, 0); ctx.restore(); }
    ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, 7); ctx.fill(); ctx.strokeStyle = out; ctx.lineWidth = 1; ctx.stroke();
    if (f.flash > 0 && f.gun) {
      ctx.fillStyle = "#fff3c4"; ctx.beginPath(); const mx = hx + ({ pistola: 12, smg: 14, escopeta: 20, rifle: 24, bazuca: 22 }[f.gun] || 12);
      ctx.moveTo(mx, hy - 5); ctx.lineTo(mx + 12, hy); ctx.lineTo(mx, hy + 5); ctx.fill();
    }
  } else {
    ctx.beginPath(); ctx.moveTo(1, sh); ctx.lineTo(3 - armSw, sh + 12); ctx.stroke();
    ctx.strokeStyle = L.shirt; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(1, sh); ctx.lineTo(3 - armSw, sh + 12); ctx.stroke();
  }
  ctx.restore();

  // nome e vida
  if (f.alive && G.me === f.id) {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(fx - 5, f.y - 32); ctx.lineTo(fx + 5, f.y - 32); ctx.lineTo(fx, f.y - 26); ctx.fill();
  }
  if (f.alive && !G.demo) {
    const ty = f.y - 10;
    ctx.font = "bold 10px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillText(f.name, fx + 1, ty - 4);
    ctx.fillStyle = L.shirt; ctx.fillText(f.name, fx, ty - 5);
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(fx - 14, ty - 1, 28, 4);
    ctx.fillStyle = f.hp > 50 ? "#3ccf6e" : f.hp > 25 ? "#ffc24b" : "#e5484d"; ctx.fillRect(fx - 14, ty - 1, 28 * clamp(f.hp / 100, 0, 1), 4);
  }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawPickup(p) {
  const x = p.x, y = p.y;
  if (p.chute) {
    ctx.strokeStyle = "rgba(230,230,230,.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 2, y); ctx.lineTo(x - 10, y - 26); ctx.moveTo(x + 20, y); ctx.lineTo(x + 32, y - 26); ctx.stroke();
    ctx.fillStyle = "#e9edf5"; ctx.beginPath(); ctx.ellipse(x + 11, y - 26, 24, 12, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#ff5a3c"; ctx.beginPath(); ctx.ellipse(x + 11, y - 26, 8, 12, 0, Math.PI, 0); ctx.fill();
  }
  const blink = p.life < 5 && Math.floor(p.life * 6) % 2 === 0;
  if (blink) return;
  const t = p.type;
  if (t === "vida") {
    ctx.fillStyle = "#f2f2f2"; ctx.fillRect(x + 2, y, 18, 14); ctx.strokeStyle = "#999"; ctx.strokeRect(x + 2, y, 18, 14);
    ctx.fillStyle = "#e5484d"; ctx.fillRect(x + 9, y + 2, 4, 10); ctx.fillRect(x + 6, y + 5, 10, 4);
  } else if (t === "granadas") {
    for (const dx of [5, 13]) { ctx.fillStyle = "#4a5a3a"; ctx.beginPath(); ctx.arc(x + dx, y + 9, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#222"; ctx.fillRect(x + dx - 1.5, y + 1, 3, 4); }
  } else {
    ctx.save(); ctx.fillStyle = "rgba(255,210,120,.18)"; ctx.beginPath(); ctx.ellipse(x + 11, y + 8, 18, 9, 0, 0, 7); ctx.fill(); ctx.restore();
    drawGunShape(t, x + 6, y + 7);
  }
}

function drawParticles() {
  for (const p of V.particles) {
    const a = clamp(p.life / p.max, 0, 1);
    switch (p.kind) {
      case "smoke": ctx.globalAlpha = a * 0.55; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, 7); ctx.fill(); break;
      case "fire": ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 1, 0, 7); ctx.fill(); break;
      case "flash": ctx.globalAlpha = a * 0.8; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.2 - a * 0.5), 0, 7); ctx.fill(); break;
      case "spark": ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke(); break;
      case "debris": ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = p.color; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot + p.life * 8); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); break;
      case "gun": ctx.globalAlpha = a; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 10); ctx.fillStyle = p.color; ctx.fillRect(-7, -2, 14, 4); ctx.restore(); break;
      default: ctx.globalAlpha = p.stuck ? Math.min(1, p.life / 2) * 0.85 : a; ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.stuck ? p.size / 2 : p.size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  const fs = G.fighters, n = fs.length, cw = Math.min(230, (W - 16) / n - 8);
  const total = n * cw + (n - 1) * 8, x0 = (W - total) / 2;
  fs.forEach((f, i) => {
    const x = x0 + i * (cw + 8), y = 8;
    ctx.fillStyle = "rgba(8,10,14,.72)"; ctx.beginPath(); ctx.roundRect(x, y, cw, 44, 8); ctx.fill();
    ctx.fillStyle = f.look.shirt; ctx.fillRect(x, y + 6, 4, 32);
    ctx.globalAlpha = f.alive ? 1 : 0.45;
    ctx.font = "bold 12px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "#fff";
    ctx.fillText(f.name, x + 10, y + 16);
    // vitórias
    for (let k = 0; k < G.cfg.target; k++) {
      ctx.beginPath(); ctx.arc(x + cw - 10 - k * 11, y + 12, 4, 0, 7);
      ctx.fillStyle = k < G.scores[i] ? "#ffc24b" : "rgba(255,255,255,.15)"; ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(x + 10, y + 21, cw - 20, 6);
    ctx.fillStyle = f.hp > 50 ? "#3ccf6e" : f.hp > 25 ? "#ffc24b" : "#e5484d"; ctx.fillRect(x + 10, y + 21, (cw - 20) * clamp(f.hp / 100, 0, 1), 6);
    ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#c9d1e0";
    const arma = f.gun ? `${GUNS[f.gun].nome} ${f.ammo}` : f.alive ? "Punhos" : "Fora";
    ctx.fillText(arma + (f.melee ? " · Facão" : ""), x + 10, y + 39);
    ctx.textAlign = "right"; ctx.fillText(`💣${f.grenades}`, x + cw - 8, y + 39);
    ctx.globalAlpha = 1;
  });
  // feed
  ctx.font = "bold 12px system-ui, sans-serif"; ctx.textAlign = "right";
  G.feed.forEach((e, i) => {
    const a = clamp(5 - e.t, 0, 1); if (!a) return;
    ctx.globalAlpha = a;
    const y = 72 + i * 20, w = ctx.measureText(e.text).width + 16;
    ctx.fillStyle = "rgba(8,10,14,.6)"; ctx.fillRect(W - 12 - w, y - 13, w, 18);
    ctx.fillStyle = "#fff"; ctx.fillText(e.text, W - 20, y);
  });
  ctx.globalAlpha = 1;
}

function drawBanner() {
  const b = G.banner; if (!b) return;
  const a = clamp(Math.min(b.t * 5, (b.dur - b.t) * 4), 0, 1), s = 1 + Math.max(0, 0.25 - b.t) * 1.5;
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H / 2 - 40); ctx.scale(s, s);
  ctx.textAlign = "center"; ctx.font = "900 44px system-ui, sans-serif";
  ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(b.text, 0, 0);
  ctx.fillStyle = b.color || "#fff"; ctx.fillText(b.text, 0, 0);
  if (b.sub) { ctx.font = "700 18px system-ui, sans-serif"; ctx.lineWidth = 5; ctx.strokeText(b.sub, 0, 30); ctx.fillStyle = "#ffc24b"; ctx.fillText(b.sub, 0, 30); }
  ctx.restore();
}

function drawCrosshair(c) {
  ctx.save(); ctx.translate(c.x, c.y);
  ctx.lineCap = "round";
  for (const [col, w] of [["rgba(0,0,0,.7)", 4], [c.color || "#fff", 2]]) {
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7);
    ctx.moveTo(-14, 0); ctx.lineTo(-5, 0); ctx.moveTo(5, 0); ctx.lineTo(14, 0);
    ctx.moveTo(0, -14); ctx.lineTo(0, -5); ctx.moveTo(0, 5); ctx.lineTo(0, 14);
    ctx.stroke();
  }
  ctx.restore();
}

let toastMsg = null;
function toast(t) { toastMsg = { t, until: performance.now() + 1200 }; }

function render(state) {
  G = state;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (!G.level) return;
  const L = G.level;
  if (!L.bg) L.bg = makeBackground(L);
  ctx.save();
  if (V.shake > 0.3) ctx.translate(rr(-1, 1) * V.shake, rr(-1, 1) * V.shake);
  ctx.drawImage(L.bg, 0, 0, W, H);
  L.objs.forEach(drawObj);
  G.pickups.forEach(drawPickup);
  G.fighters.filter(f => !f.alive).forEach(drawFighter);
  G.fighters.filter(f => f.alive).forEach(drawFighter);
  // granadas
  for (const g of G.grenades) {
    ctx.save(); ctx.translate(g.x + 4, g.y + 4); ctx.rotate(g.spin);
    ctx.fillStyle = "#4a5a3a"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#222"; ctx.fillRect(-1.5, -8, 3, 4);
    ctx.restore();
    if (Math.floor(g.fuse * (g.fuse < 0.8 ? 14 : 6)) % 2 === 0) { ctx.fillStyle = "#ff3b2f"; ctx.beginPath(); ctx.arc(g.x + 4, g.y - 3, 2, 0, 7); ctx.fill(); }
  }
  // foguetes
  for (const r of G.rockets) {
    ctx.save(); ctx.translate(r.x, r.y); ctx.rotate(Math.atan2(r.vy || 0, r.vx));
    ctx.fillStyle = "#6b7a55"; ctx.fillRect(-10, -3, 16, 6); ctx.fillStyle = "#c22f2f"; ctx.beginPath(); ctx.moveTo(6, -3); ctx.lineTo(11, 0); ctx.lineTo(6, 3); ctx.fill();
    ctx.fillStyle = "#ffb03c"; ctx.beginPath(); ctx.moveTo(-10, -3); ctx.lineTo(-18 - Math.random() * 6, 0); ctx.lineTo(-10, 3); ctx.fill();
    ctx.restore();
  }
  // balas
  ctx.lineCap = "round";
  for (const b of G.bullets) {
    const len = b.tracer ? 0.05 : 0.014;
    let tx = b.x - b.vx * len, ty = b.y - b.vy * len;
    if ((tx - b.sx) * b.vx + (ty - b.sy) * b.vy < 0) { tx = b.sx; ty = b.sy; } // não desenha atrás do cano
    ctx.strokeStyle = b.tracer ? "rgba(255,240,200,.9)" : "#ffd27a"; ctx.lineWidth = b.tracer ? 2.5 : 2;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  drawParticles();
  ctx.restore();

  if (G.slowmo > 0) { ctx.fillStyle = `rgba(255,255,255,${0.06 * Math.min(1, G.slowmo)})`; ctx.fillRect(0, 0, W, H); }
  if (G.suddenDeath && !G.ending) { ctx.strokeStyle = `rgba(229,72,77,${0.4 + Math.sin(performance.now() / 150) * 0.2})`; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8); }
  if (!G.demo) { drawHUD(); drawBanner(); }
  if (G.crosshair) drawCrosshair(G.crosshair);
  if (toastMsg && performance.now() < toastMsg.until) {
    ctx.font = "bold 14px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(8,10,14,.8)"; ctx.fillRect(W / 2 - 80, H - 44, 160, 26);
    ctx.fillStyle = "#fff"; ctx.fillText(toastMsg.t, W / 2, H - 26);
  }
}
