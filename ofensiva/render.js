// Ofensiva — desenho 3D (WebGL puro, sem bibliotecas) e sons sintetizados (WebAudio).
// Expõe window.R (render) e window.S (som). Só roda no navegador.
(function () {
"use strict";
const OF = window.OF;
const CELL = OF.CELL, WALL_H = OF.WALL_H;

/* ---------- Matrizes 4x4 (coluna-maior, como o GL) ---------- */

function ident(m = new Float32Array(16)) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }
function copy(a, out = new Float32Array(16)) { out.set(a); return out; }
function mul(out, a, b) {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    r[i * 4 + j] = s;
  }
  out.set(r); return out;
}
function translate(m, x, y, z) {
  m[12] += m[0] * x + m[4] * y + m[8] * z; m[13] += m[1] * x + m[5] * y + m[9] * z;
  m[14] += m[2] * x + m[6] * y + m[10] * z; m[15] += m[3] * x + m[7] * y + m[11] * z; return m;
}
function rotY(m, a) { const c = Math.cos(a), s = Math.sin(a); for (let i = 0; i < 4; i++) { const x = m[i], z = m[8 + i]; m[i] = x * c - z * s; m[8 + i] = x * s + z * c; } return m; }
function rotX(m, a) { const c = Math.cos(a), s = Math.sin(a); for (let i = 0; i < 4; i++) { const y = m[4 + i], z = m[8 + i]; m[4 + i] = y * c + z * s; m[8 + i] = -y * s + z * c; } return m; }
function rotZ(m, a) { const c = Math.cos(a), s = Math.sin(a); for (let i = 0; i < 4; i++) { const x = m[i], y = m[4 + i]; m[i] = x * c + y * s; m[4 + i] = -x * s + y * c; } return m; }
function scale(m, x, y, z) { for (let i = 0; i < 4; i++) { m[i] *= x; m[4 + i] *= y; m[8 + i] *= z; } return m; }
function persp(fovy, asp, n, f) {
  const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m;
}

/* ---------- GL ---------- */

let gl, canvas, prog, pprog, sprog, aniso;
const R = { ready: false };
window.R = R;

function shader(vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
  return { p, u, a };
}

const VS = `attribute vec3 aP; attribute vec2 aT; attribute vec3 aC;
uniform mat4 uVP; uniform mat4 uM; uniform vec3 uEye;
varying vec2 vT; varying vec3 vC; varying float vD;
void main(){ vec4 w = uM * vec4(aP, 1.0); gl_Position = uVP * w; vT = aT; vC = aC; vD = distance(w.xyz, uEye); }`;
const FS = `precision mediump float;
uniform sampler2D uTex; uniform vec3 uTint; uniform vec3 uFog; uniform vec2 uFogR;
varying vec2 vT; varying vec3 vC; varying float vD;
void main(){ vec3 c = texture2D(uTex, vT).rgb * vC * uTint; float f = smoothstep(uFogR.x, uFogR.y, vD); gl_FragColor = vec4(mix(c, uFog, f), 1.0); }`;
const PVS = `attribute vec3 aP; attribute vec2 aT; attribute vec4 aC; uniform mat4 uVP;
varying vec2 vT; varying vec4 vC; void main(){ gl_Position = uVP * vec4(aP, 1.0); vT = aT; vC = aC; }`;
const PFS = `precision mediump float; uniform sampler2D uTex; varying vec2 vT; varying vec4 vC;
void main(){ vec4 t = texture2D(uTex, vT); gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a); }`;
const SVS = `attribute vec2 aP; varying vec2 vP; void main(){ vP = aP; gl_Position = vec4(aP, 0.999, 1.0); }`;
const SFS = `precision mediump float; uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uLow; uniform float uH; uniform float uK;
varying vec2 vP; void main(){ float d = (vP.y - uH) * uK; vec3 c = d > 0.0 ? mix(uHor, uTop, clamp(d, 0.0, 1.0)) : mix(uHor, uLow, clamp(-d * 3.0, 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }`;

/* ---------- Texturas procedurais ---------- */

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const css = (c, k = 1) => `rgb(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)})`;

function noise(ctx, s, amt) {
  const d = ctx.getImageData(0, 0, s, s), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const k = 1 + (rnd() - 0.5) * amt;
    p[i] = Math.min(255, p[i] * k); p[i + 1] = Math.min(255, p[i + 1] * k); p[i + 2] = Math.min(255, p[i + 2] * k);
  }
  ctx.putImageData(d, 0, 0);
}
function blotches(ctx, s, n, col, a, rmax) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s, r = (0.3 + rnd() * 0.7) * rmax;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
  }
}

const PAINT = {
  floor(c, s, t) { c.fillStyle = css(t.floor); c.fillRect(0, 0, s, s); blotches(c, s, 18, "60,40,20", 0.18, 70); blotches(c, s, 12, "255,240,210", 0.12, 50);
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? "40,30,20" : "255,240,220"},${0.15 + rnd() * 0.2})`; const r = 1 + rnd() * 3; c.fillRect(rnd() * s, rnd() * s, r, r); }
    noise(c, s, 0.22); },
  floor2(c, s, t) { c.fillStyle = css(t.floor2, 0.7); c.fillRect(0, 0, s, s); const n = 4, w = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { c.fillStyle = css(t.floor2, 0.9 + rnd() * 0.2); c.fillRect(x * w + 2, y * w + 2, w - 4, w - 4); }
    blotches(c, s, 10, "30,30,30", 0.15, 60); noise(c, s, 0.18); },
  wall(c, s, t) { c.fillStyle = css(t.wall); c.fillRect(0, 0, s, s); blotches(c, s, 16, "90,70,50", 0.16, 90); blotches(c, s, 10, "255,250,235", 0.14, 60);
    c.strokeStyle = "rgba(60,45,30,.35)"; c.lineWidth = 1;
    for (let i = 0; i < 4; i++) { c.beginPath(); let x = rnd() * s, y = rnd() * s; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 30; y += rnd() * 18; c.lineTo(x, y); } c.stroke(); }
    noise(c, s, 0.14); },
  wall2(c, s, t) { c.fillStyle = "rgb(170,160,150)"; c.fillRect(0, 0, s, s); const bh = 32, bw = 64;
    for (let y = 0; y < s / bh; y++) for (let x = -1; x < s / bw + 1; x++) { const ox = (y % 2) * bw / 2; c.fillStyle = css(t.wall2, 0.8 + rnd() * 0.35); c.fillRect(x * bw + ox + 2, y * bh + 2, bw - 4, bh - 4); }
    blotches(c, s, 8, "40,30,30", 0.2, 70); noise(c, s, 0.2); },
  crate(c, s) { c.fillStyle = "rgb(150,108,62)"; c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) { c.fillStyle = `rgb(${140 + rnd() * 30},${100 + rnd() * 20},${55 + rnd() * 15})`; c.fillRect(0, y + 1, s, 30); c.fillStyle = "rgba(50,30,10,.5)"; c.fillRect(0, y, s, 2); }
    c.strokeStyle = "rgb(95,64,32)"; c.lineWidth = 22; c.strokeRect(11, 11, s - 22, s - 22);
    c.lineWidth = 18; c.beginPath(); c.moveTo(20, 20); c.lineTo(s - 20, s - 20); c.stroke();
    c.fillStyle = "rgba(30,20,10,.8)"; for (const [x, y] of [[11, 11], [s - 11, 11], [11, s - 11], [s - 11, s - 11]]) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); }
    noise(c, s, 0.18); },
  concrete(c, s) { c.fillStyle = "rgb(150,148,142)"; c.fillRect(0, 0, s, s); blotches(c, s, 14, "70,70,70", 0.16, 70); blotches(c, s, 8, "230,230,220", 0.12, 50);
    c.fillStyle = "rgba(60,60,60,.45)"; c.fillRect(0, 0, s, 2); c.fillRect(0, 0, 2, s); noise(c, s, 0.2); },
  site(c, s, t) { PAINT.floor(c, s, t); c.save(); c.globalAlpha = 0.35; c.strokeStyle = "rgb(230,120,30)"; c.lineWidth = 16;
    for (let k = -s; k < s * 2; k += 64) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + s, s); c.stroke(); } c.restore(); noise(c, s, 0.1); },
  container(c, s) { c.fillStyle = "rgb(235,235,235)"; c.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) { c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(x, 0, 5, s); c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(x + 8, 0, 3, s); }
    c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(0, 0, s, 8); c.fillRect(0, s - 8, s, 8);
    blotches(c, s, 10, "120,60,20", 0.25, 30); noise(c, s, 0.12); },
  metal(c, s) { c.fillStyle = "rgb(90,94,100)"; c.fillRect(0, 0, s, s); c.fillStyle = "rgba(0,0,0,.4)"; c.fillRect(0, s / 2 - 2, s, 4); c.fillRect(s / 2 - 2, 0, 4, s);
    c.fillStyle = "rgba(200,200,200,.5)"; for (let x = 12; x < s; x += 40) for (let y = 12; y < s; y += 40) c.fillRect(x, y, 3, 3); noise(c, s, 0.18); },
};
const MAT_NAMES = ["floor", "floor2", "wall", "wall2", "crate", "concrete", "site", "container", "metal"];

function texFrom(cv, repeat = true, mip = true) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
  else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  if (aniso && mip) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
  return t;
}
function canvasTex(size, draw, repeat, mip) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const c = cv.getContext("2d", { willReadFrequently: true });
  draw(c, size);
  return texFrom(cv, repeat, mip);
}

let TEX = {}, white, cloth, soft, puff, spot;

/* ---------- Mundo ---------- */

let world = []; // [{tex, buf, n}]
let worldMap = null, theme = null;
const SHADE = { top: 1.0, bot: 0.5, px: 0.76, nx: 0.68, pz: 0.9, nz: 0.62 };
const CONTAINER_COLS = [[0.75, 0.22, 0.18], [0.2, 0.42, 0.7], [0.25, 0.55, 0.3], [0.85, 0.55, 0.15], [0.55, 0.57, 0.6], [0.6, 0.3, 0.55]];

R.buildWorld = function (m) {
  worldMap = m; theme = m.tema;
  for (const k in TEX) gl.deleteTexture(TEX[k]);
  TEX = {};
  MAT_NAMES.forEach((name, i) => { seed = 1000 + i * 77 + m.index * 13; TEX[i] = canvasTex(256, (c, s) => PAINT[name](c, s, theme)); });
  for (const w of world) gl.deleteBuffer(w.buf);
  world = [];
  const B = MAT_NAMES.map(() => []);
  // cor por bloco de contêiner (componentes conectadas)
  const tint = new Array(m.w * m.h).fill(null);
  let comp = 0;
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.ch[i] !== "K" || tint[i]) continue;
    const col = CONTAINER_COLS[comp++ % CONTAINER_COLS.length], q = [i];
    tint[i] = col;
    while (q.length) { const j = q.pop(), x = j % m.w, z = (j / m.w) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = OF.cellIdx(m, x + dx, z + dz); if (k >= 0 && m.ch[k] === "K" && !tint[k]) { tint[k] = col; q.push(k); } } }
  }
  const lo = (x, z) => { const i = OF.cellIdx(m, x, z); return i < 0 ? Infinity : m.lo[i]; };
  const ao = y => 0.7 + 0.3 * Math.min(1, Math.max(0, y) / 1.6);
  const push = (mat, v, col) => { const a = B[mat]; for (const p of v) a.push(p[0], p[1], p[2], p[3], p[4], col[0] * p[5], col[1] * p[5], col[2] * p[5]); };
  const quad = (mat, a, b, c, d, col) => push(mat, [a, b, c, a, c, d], col);
  const WHITE = [1, 1, 1];
  for (let cz = 0; cz < m.h; cz++) for (let cx = 0; cx < m.w; cx++) {
    const i = cz * m.w + cx, L = m.lo[i], Ce = m.ce[i], mat = m.mat[i], ch = m.ch[i];
    const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
    const col = tint[i] || WHITE;
    const topMat = mat;
    // topo (com sombra nos cantos encostados em coisas mais altas)
    const occ = (dx, dz) => { let n = 0; if (lo(cx + dx, cz) > L + 0.3) n++; if (lo(cx, cz + dz) > L + 0.3) n++; if (lo(cx + dx, cz + dz) > L + 0.3) n++; return 1 - 0.14 * n; };
    const tu = (x) => x / CELL, isWall = L >= WALL_H;
    if (!(isWall && Ce === Infinity && false)) {
      quad(topMat, [x0, L, z0, tu(x0), tu(z0), SHADE.top * (isWall ? 1 : occ(-1, -1))], [x0, L, z1, tu(x0), tu(z1), SHADE.top * (isWall ? 1 : occ(-1, 1))],
        [x1, L, z1, tu(x1), tu(z1), SHADE.top * (isWall ? 1 : occ(1, 1))], [x1, L, z0, tu(x1), tu(z0), SHADE.top * (isWall ? 1 : occ(1, -1))], col);
    }
    if (Ce < Infinity) { // teto do túnel: face de baixo e telhado
      quad(8, [x0, Ce, z0, tu(x0), tu(z0), SHADE.bot], [x1, Ce, z0, tu(x1), tu(z0), SHADE.bot], [x1, Ce, z1, tu(x1), tu(z1), SHADE.bot], [x0, Ce, z1, tu(x0), tu(z1), SHADE.bot], WHITE);
      quad(2, [x0, WALL_H, z0, 0, 0, 1], [x0, WALL_H, z1, 0, 1, 1], [x1, WALL_H, z1, 1, 1, 1], [x1, WALL_H, z0, 1, 0, 1], WHITE);
    }
    // laterais
    const spans = [];
    if (L > 0) spans.push([0, L, mat, col]);
    if (Ce < Infinity) spans.push([Ce, WALL_H, 2, WHITE]);
    for (const [dx, dz, sh, ex0, ez0, ex1, ez1] of [
      [1, 0, SHADE.px, x1, z1, x1, z0], [-1, 0, SHADE.nx, x0, z0, x0, z1], [0, 1, SHADE.pz, x0, z1, x1, z1], [0, -1, SHADE.nz, x1, z0, x0, z0]]) {
      const j = OF.cellIdx(m, cx + dx, cz + dz);
      if (j < 0) continue;
      const nl = m.lo[j], nc = m.ce[j];
      for (const [a, b, smat, scol] of spans) {
        const ya = Math.max(a, nl), yb = Math.min(b, nc);
        if (yb <= ya + 1e-4) continue;
        const along0 = dx ? ez0 : ex0, along1 = dx ? ez1 : ex1;
        const crate = smat === 4 || smat === 7;
        const vh = crate ? b - a : 2, vtop = crate ? b : WALL_H;
        const u0 = along0 / CELL, u1 = along1 / CELL;
        const v0 = (vtop - ya) / vh, v1 = (vtop - yb) / vh;
        quad(smat, [ex0, ya, ez0, u0, v0, sh * ao(ya)], [ex1, ya, ez1, u1, v0, sh * ao(ya)], [ex1, yb, ez1, u1, v1, sh * ao(yb)], [ex0, yb, ez0, u0, v1, sh * ao(yb)], scol);
      }
    }
  }
  B.forEach((arr, mat) => {
    if (!arr.length) return;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    world.push({ tex: TEX[mat], buf, n: arr.length / 8 });
  });
  R.particles.length = 0; decals.length = 0; decalDirty = true; tracers.length = 0;
};

/* ---------- Cubo para modelos ---------- */

let cubeBuf, quadBuf, pbuf, pdata, decalBuf, decalN = 0;
function buildCube() {
  const v = [];
  const f = (pts, sh) => { const uv = [[0, 1], [1, 1], [1, 0], [0, 0]]; for (const k of [0, 1, 2, 0, 2, 3]) v.push(...pts[k], ...uv[k], sh, sh, sh); };
  const P = (x, y, z) => [x - 0.5, y - 0.5, z - 0.5];
  f([P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], SHADE.pz);
  f([P(1, 0, 0), P(0, 0, 0), P(0, 1, 0), P(1, 1, 0)], SHADE.nz);
  f([P(1, 0, 1), P(1, 0, 0), P(1, 1, 0), P(1, 1, 1)], SHADE.px);
  f([P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)], SHADE.nx);
  f([P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)], SHADE.top);
  f([P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)], SHADE.bot);
  cubeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
}

R.init = function (cv) {
  canvas = cv;
  gl = cv.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("Seu navegador não suporta WebGL.");
  aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  prog = shader(VS, FS); pprog = shader(PVS, PFS); sprog = shader(SVS, SFS);
  buildCube();
  quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  pdata = new Float32Array(6000 * 6 * 9);
  pbuf = gl.createBuffer();
  decalBuf = gl.createBuffer();
  seed = 7;
  white = canvasTex(4, (c, s) => { c.fillStyle = "#fff"; c.fillRect(0, 0, s, s); }, true, false);
  cloth = canvasTex(64, (c, s) => { c.fillStyle = "#ddd"; c.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 4) { c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(0, y, s, 2); } noise(c, s, 0.25); });
  soft = canvasTex(64, (c, s) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.6)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, s, s); }, false, true);
  puff = canvasTex(128, (c, s) => {
    for (let i = 0; i < 26; i++) { const x = 30 + rnd() * 68, y = 30 + rnd() * 68, r = 18 + rnd() * 26; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, s, s); }
  }, false, true);
  spot = canvasTex(32, (c, s) => { const g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.9)"); g.addColorStop(0.7, "rgba(255,255,255,.25)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, s, s); }, false, true);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
  R.ready = true;
};

/* ---------- Partículas, marcas de tiro e traçantes ---------- */

R.particles = [];
const decals = []; let decalDirty = false;
const tracers = [];
R.add = function (p) { if (R.particles.length < 5000) R.particles.push(Object.assign({ vx: 0, vy: 0, vz: 0, g: 0, life: 1, t: 0, size: 0.2, grow: 0, col: [1, 1, 1], a: 1, add: false, drag: 0, tex: 0 }, p)); };
R.decal = function (x, y, z, nx, ny, nz, size = 0.07, col = [0.06, 0.05, 0.04, 0.9]) {
  decals.push({ x: x + nx * 0.012, y: y + ny * 0.012, z: z + nz * 0.012, nx, ny, nz, size, col });
  if (decals.length > 160) decals.shift();
  decalDirty = true;
};
R.tracer = function (a, b, col = [1, 0.9, 0.5], w = 0.018, life = 0.07) { tracers.push({ a, b, t: 0, life, col, w }); };
R.clearFx = function () { R.particles.length = 0; decals.length = 0; decalDirty = true; tracers.length = 0; };

R.impact = function (x, y, z, nx, ny, nz, wood) {
  R.decal(x, y, z, nx, ny, nz);
  for (let i = 0; i < 4; i++) R.add({ x, y, z, vx: nx * 2 + (Math.random() - 0.5) * 4, vy: ny * 2 + Math.random() * 3, vz: nz * 2 + (Math.random() - 0.5) * 4, g: 14, life: 0.25 + Math.random() * 0.2, size: 0.03, col: [1, 0.85, 0.5], add: true });
  for (let i = 0; i < 2; i++) R.add({ x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05, vx: nx * 0.6 + (Math.random() - 0.5) * 0.4, vy: 0.3 + Math.random() * 0.3, vz: nz * 0.6 + (Math.random() - 0.5) * 0.4, life: 0.7, size: 0.12, grow: 0.5, col: wood ? [0.55, 0.42, 0.3] : [0.7, 0.66, 0.6], a: 0.5, tex: 1, drag: 2 });
};
R.blood = function (x, y, z, dx, dy, dz, n = 6) {
  for (let i = 0; i < n; i++) R.add({ x, y, z, vx: dx * 2 + (Math.random() - 0.5) * 2.5, vy: dy * 2 + Math.random() * 2, vz: dz * 2 + (Math.random() - 0.5) * 2.5, g: 9, life: 0.35 + Math.random() * 0.3, size: 0.06 + Math.random() * 0.05, col: [0.55, 0.02, 0.02], a: 0.9, drag: 1 });
  R.add({ x, y, z, life: 0.25, size: 0.15, grow: 1.2, col: [0.6, 0.05, 0.05], a: 0.6, tex: 1 });
};
R.explosion = function (x, y, z, big) {
  const k = big ? 2.5 : 1;
  for (let i = 0; i < 40 * k; i++) {
    const a = Math.random() * 6.28, e = Math.random() * 1.5, s = (2 + Math.random() * 7) * k;
    R.add({ x, y: y + 0.3, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s, vz: Math.sin(a) * Math.cos(e) * s, drag: 3, life: 0.4 + Math.random() * 0.4, size: 0.4 * k, grow: 2, col: [1, 0.55 + Math.random() * 0.3, 0.15], add: true, tex: 1 });
  }
  for (let i = 0; i < 18 * k; i++) {
    const a = Math.random() * 6.28, s = Math.random() * 3 * k;
    R.add({ x: x + Math.cos(a) * s * 0.3, y: y + 0.5 + Math.random() * k, z: z + Math.sin(a) * s * 0.3, vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(a) * s, drag: 1.5, life: 1.6 + Math.random() * 1.2, size: 0.8 * k, grow: 1.5 * k, col: [0.22, 0.2, 0.19], a: 0.75, tex: 2 });
  }
  for (let i = 0; i < 25 * k; i++) R.add({ x, y: y + 0.2, z, vx: (Math.random() - 0.5) * 16, vy: Math.random() * 9, vz: (Math.random() - 0.5) * 16, g: 16, life: 0.6 + Math.random() * 0.6, size: 0.04, col: [1, 0.8, 0.4], add: true });
  flashLight = Math.max(flashLight, big ? 1 : 0.6);
};
R.muzzle = function (x, y, z) {
  R.add({ x, y, z, life: 0.05, size: 0.22, col: [1, 0.8, 0.4], add: true, tex: 1 });
};
let flashLight = 0;

/* ---------- Desenho ---------- */

let VP, view, eye = [0, 0, 0], camRight = [1, 0, 0], camUp = [0, 1, 0];
const tmp = new Float32Array(16);
let curTex = null;

function useMain() {
  gl.useProgram(prog.p);
  gl.uniformMatrix4fv(prog.u.uVP, false, VP);
  gl.uniform3fv(prog.u.uEye, eye);
  gl.uniform3fv(prog.u.uFog, theme ? theme.fog : [0.7, 0.7, 0.7]);
  gl.uniform2f(prog.u.uFogR, 25, 95);
  gl.uniform3f(prog.u.uTint, 1, 1, 1);
  gl.activeTexture(gl.TEXTURE0); gl.uniform1i(prog.u.uTex, 0);
  curTex = null;
}
function bindMesh(buf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(prog.a.aP); gl.vertexAttribPointer(prog.a.aP, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(prog.a.aT); gl.vertexAttribPointer(prog.a.aT, 2, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(prog.a.aC); gl.vertexAttribPointer(prog.a.aC, 3, gl.FLOAT, false, 32, 20);
}
function tex(t) { if (curTex !== t) { gl.bindTexture(gl.TEXTURE_2D, t); curTex = t; } }

// caixa: matriz base m, centro (x,y,z), tamanho (sx,sy,sz), cor
function box(m, x, y, z, sx, sy, sz, col, t = white) {
  copy(m, tmp); translate(tmp, x, y, z); scale(tmp, sx, sy, sz);
  gl.uniformMatrix4fv(prog.u.uM, false, tmp);
  gl.uniform3fv(prog.u.uTint, col);
  tex(t);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
}

/* --- modelos de armas (lista de caixas: [x,y,z, sx,sy,sz, cor]) --- */
const C = { dark: [0.16, 0.16, 0.17], black: [0.08, 0.08, 0.09], wood: [0.45, 0.27, 0.13], steel: [0.62, 0.63, 0.66], olive: [0.3, 0.34, 0.22], green: [0.22, 0.32, 0.18], gray: [0.5, 0.52, 0.5], red: [0.6, 0.12, 0.1], sand: [0.6, 0.52, 0.36] };
const GUNS = {
  faca: [[0, 0, -0.06, 0.025, 0.035, 0.11, C.black], [0, 0.005, -0.2, 0.008, 0.04, 0.2, C.steel]],
  glock: [[0, -0.05, 0.02, 0.035, 0.1, 0.05, C.black], [0, 0.015, -0.04, 0.04, 0.045, 0.19, C.dark]],
  usp: [[0, -0.05, 0.02, 0.035, 0.1, 0.05, C.black], [0, 0.015, -0.05, 0.04, 0.045, 0.2, C.dark], [0, 0.015, -0.19, 0.03, 0.03, 0.09, C.black]],
  magnum: [[0, -0.05, 0.03, 0.04, 0.11, 0.055, C.black], [0, 0.02, -0.06, 0.05, 0.06, 0.25, C.steel]],
  escopeta: [[0, 0, 0.05, 0.05, 0.08, 0.32, C.dark], [0, 0.02, -0.33, 0.035, 0.035, 0.5, C.black], [0, -0.025, -0.25, 0.05, 0.045, 0.2, C.wood], [0, -0.04, 0.27, 0.05, 0.1, 0.2, C.wood]],
  smg: [[0, 0, 0, 0.05, 0.07, 0.3, C.dark], [0, -0.08, -0.06, 0.03, 0.13, 0.04, C.black], [0, 0.01, -0.22, 0.025, 0.025, 0.16, C.black], [0, -0.04, 0.12, 0.035, 0.08, 0.04, C.black]],
  fuzilR: [[0, 0, 0, 0.055, 0.075, 0.42, C.dark], [0, 0.01, -0.34, 0.025, 0.025, 0.3, C.black], [0, -0.01, -0.2, 0.06, 0.05, 0.16, C.wood], [0, -0.1, -0.05, 0.04, 0.16, 0.06, C.black], [0, -0.03, 0.3, 0.05, 0.1, 0.22, C.wood], [0, -0.06, 0.1, 0.035, 0.09, 0.04, C.wood]],
  fuzilT: [[0, 0, 0, 0.055, 0.08, 0.42, C.black], [0, 0.01, -0.34, 0.025, 0.025, 0.3, C.dark], [0, 0.06, -0.02, 0.025, 0.04, 0.2, C.black], [0, -0.1, -0.04, 0.04, 0.15, 0.05, C.dark], [0, -0.02, 0.3, 0.05, 0.09, 0.22, C.black], [0, -0.06, 0.1, 0.035, 0.09, 0.04, C.black]],
  sniper: [[0, 0, 0, 0.06, 0.08, 0.6, C.green], [0, 0.01, -0.5, 0.028, 0.028, 0.45, C.black], [0, 0.085, -0.02, 0.05, 0.05, 0.28, C.black], [0, -0.06, -0.02, 0.04, 0.1, 0.06, C.black], [0, -0.02, 0.38, 0.06, 0.12, 0.2, C.green]],
  he: [[0, 0, -0.05, 0.08, 0.1, 0.08, C.olive], [0, 0.065, -0.05, 0.03, 0.04, 0.03, C.steel]],
  flash: [[0, 0, -0.05, 0.065, 0.13, 0.065, C.gray], [0, 0.08, -0.05, 0.03, 0.04, 0.03, C.steel]],
  smoke: [[0, 0, -0.05, 0.07, 0.13, 0.07, [0.7, 0.72, 0.75]], [0, 0.08, -0.05, 0.03, 0.04, 0.03, C.steel]],
  bomba: [[0, 0, -0.08, 0.18, 0.09, 0.13, C.red], [0, 0.05, -0.08, 0.1, 0.015, 0.07, [0.15, 0.4, 0.15]], [0.06, 0.05, -0.02, 0.03, 0.02, 0.03, C.black]],
};
R.GUNS = GUNS;
function drawGun(m, w) {
  const parts = GUNS[w];
  if (!parts) return;
  for (const p of parts) box(m, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
}

const SKIN = [0.85, 0.66, 0.5];
const TEAM_LOOK = {
  r: { torso: [0.55, 0.4, 0.24], legs: [0.36, 0.32, 0.26], head: [0.2, 0.18, 0.16], hat: [0.2, 0.18, 0.16], vest: [0.3, 0.28, 0.2] },
  t: { torso: [0.2, 0.26, 0.38], legs: [0.17, 0.2, 0.25], head: SKIN, hat: [0.12, 0.15, 0.22], vest: [0.1, 0.12, 0.16] },
};
const FFA_COLS = [[0.7, 0.25, 0.2], [0.2, 0.45, 0.7], [0.3, 0.6, 0.3], [0.75, 0.6, 0.2], [0.55, 0.3, 0.65], [0.2, 0.6, 0.62], [0.8, 0.45, 0.2], [0.45, 0.45, 0.5]];

function drawPlayer(p) {
  const look = p.team === "t" ? TEAM_LOOK.t : p.team === "r" ? TEAM_LOOK.r : null;
  const ffa = FFA_COLS[p.id % FFA_COLS.length];
  const torso = look ? look.torso : ffa, legs = look ? look.legs : [0.25, 0.25, 0.28];
  const head = look ? look.head : SKIN, hat = look ? look.hat : [ffa[0] * 0.6, ffa[1] * 0.6, ffa[2] * 0.6];
  const vest = look ? look.vest : [0.2, 0.2, 0.22];
  const b = ident(new Float32Array(16));
  translate(b, p.x, p.y, p.z);
  rotY(b, p.yaw);
  if (!p.alive) { const k = Math.min(1, p.deadT / 0.45); rotX(b, k * 1.45); translate(b, 0, 0.05 * k, 0); }
  const c = p.crouch && p.alive;
  const hipY = c ? 0.52 : 0.85;
  const sw = Math.sin(p.phase) * 0.7 * p.moveAmt;
  for (const s of [-1, 1]) {
    const m = copy(b);
    translate(m, s * 0.11, hipY, 0);
    if (c) {
      rotX(m, 1.25);
      box(m, 0, -0.21, 0, 0.17, 0.44, 0.19, legs, cloth);
      const k = copy(m); translate(k, 0, -0.42, 0); rotX(k, -1.25);
      box(k, 0, -0.19, 0.02, 0.16, 0.4, 0.18, legs, cloth);
      box(k, 0, -0.38, -0.04, 0.17, 0.08, 0.26, C.black);
    } else {
      rotX(m, sw * s);
      box(m, 0, -0.42, 0, 0.17, 0.84, 0.19, legs, cloth);
      box(m, 0, -0.81, -0.04, 0.18, 0.08, 0.27, C.black);
    }
  }
  const up = copy(b); translate(up, 0, hipY, 0);
  if (c) rotX(up, -0.25);
  box(up, 0, 0.31, 0, 0.46, 0.62, 0.26, torso, cloth);
  box(up, 0, 0.36, 0, 0.48, 0.38, 0.3, vest, cloth);
  // cabeça
  const hd = copy(up); translate(hd, 0, 0.62, 0); rotX(hd, p.pitch * 0.5);
  box(hd, 0, 0.15, 0, 0.26, 0.28, 0.26, head, cloth);
  if (p.team === "t") { box(hd, 0, 0.27, 0.01, 0.3, 0.1, 0.31, hat, cloth); box(hd, 0, 0.17, -0.13, 0.22, 0.06, 0.03, [0.05, 0.05, 0.05]); }
  else if (p.team === "r") { box(hd, 0, 0.16, -0.131, 0.2, 0.05, 0.01, SKIN); }
  else box(hd, 0, 0.27, 0.01, 0.28, 0.06, 0.28, hat, cloth);
  // braços + arma acompanham a mira
  const ar = copy(up); translate(ar, 0, 0.5, 0); rotX(ar, p.pitch);
  const wk = p.wep;
  const knife = wk === "faca", small = wk === "glock" || wk === "usp" || wk === "magnum" || OF.WEAPONS[wk]?.nade || wk === "bomba";
  box(ar, 0.24, -0.05, -0.18, 0.11, 0.11, 0.38, torso, cloth);
  box(ar, -0.2, -0.06, -0.22, 0.11, 0.11, 0.4, torso, cloth);
  box(ar, 0.12, -0.07, -0.42, 0.09, 0.09, 0.09, SKIN);
  const g = copy(ar); translate(g, 0.1, -0.02, small || knife ? -0.5 : -0.3);
  drawGun(g, wk);
}

function drawItem(it, t) {
  const m = ident(new Float32Array(16));
  translate(m, it.x, it.y + 0.04, it.z);
  if (it.w === "bomba") { rotY(m, 0.6); drawGun(m, "bomba"); return; }
  rotY(m, it.id * 1.7); rotZ(m, Math.PI / 2); scale(m, 1.5, 1.5, 1.5);
  drawGun(m, it.w);
}

/* --- pinta partículas (billboards) --- */
function pushQuad(o, x, y, z, s, rot, col, a) {
  const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
  const rx = camRight[0] * c + camUp[0] * sn, ry = camRight[1] * c + camUp[1] * sn, rz = camRight[2] * c + camUp[2] * sn;
  const ux = -camRight[0] * sn + camUp[0] * c, uy = -camRight[1] * sn + camUp[1] * c, uz = -camRight[2] * sn + camUp[2] * c;
  const v = [[x - rx - ux, y - ry - uy, z - rz - uz, 0, 1], [x + rx - ux, y + ry - uy, z + rz - uz, 1, 1], [x + rx + ux, y + ry + uy, z + rz + uz, 1, 0], [x - rx + ux, y - ry + uy, z - rz + uz, 0, 0]];
  for (const k of [0, 1, 2, 0, 2, 3]) { const p = v[k]; pdata.set([p[0], p[1], p[2], p[3], p[4], col[0], col[1], col[2], a], o); o += 9; }
  return o;
}
function pushRaw(o, pts, col, a) {
  for (const k of [0, 1, 2, 0, 2, 3]) { const p = pts[k]; pdata.set([p[0], p[1], p[2], p[3], p[4], col[0], col[1], col[2], a], o); o += 9; }
  return o;
}
function drawP(n, t, additive) {
  if (!n) return;
  gl.useProgram(pprog.p);
  gl.uniformMatrix4fv(pprog.u.uVP, false, VP);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(pprog.u.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
  gl.bufferData(gl.ARRAY_BUFFER, pdata.subarray(0, n * 9), gl.STREAM_DRAW);
  gl.enableVertexAttribArray(pprog.a.aP); gl.vertexAttribPointer(pprog.a.aP, 3, gl.FLOAT, false, 36, 0);
  gl.enableVertexAttribArray(pprog.a.aT); gl.vertexAttribPointer(pprog.a.aT, 2, gl.FLOAT, false, 36, 12);
  gl.enableVertexAttribArray(pprog.a.aC); gl.vertexAttribPointer(pprog.a.aC, 4, gl.FLOAT, false, 36, 20);
  gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLES, 0, n);
  curTex = null;
}

function smokePuffs(s, list) {
  // nuvem determinística em volta do ponto da fumaça
  const age = s.age, grow = Math.min(1, age / 1.6), fade = age > 15.5 ? Math.max(0, 1 - (age - 15.5) / 2.5) : 1;
  let sd = s.id * 9973;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * 3.0 * grow, h = r() * 2.6 * grow;
    const g = 0.62 + r() * 0.12;
    list.push({ x: s.x + Math.cos(a) * d, y: s.y + 0.6 + h, z: s.z + Math.sin(a) * d, size: (1.4 + r() * 0.8) * (0.4 + 0.6 * grow), rot: r() * 6 + age * 0.05 * (i % 2 ? 1 : -1), col: [g, g, g + 0.02], a: 0.9 * fade, tex: 2 });
  }
}

let lastW = 0, lastH = 0, fovNow = 1.3;

// st: { cam:{x,y,z,yaw,pitch,fov}, players, items, nades, smokes, bomb, view, dt }
R.frame = function (st) {
  const dt = st.dt;
  const dpr = Math.min(window.devicePixelRatio || 1, st.lowRes ? 1 : 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (w !== lastW || h !== lastH) { canvas.width = lastW = w; canvas.height = lastH = h; }
  gl.viewport(0, 0, w, h);
  const asp = w / Math.max(1, h);
  const cam = st.cam;
  fovNow = cam.fov;
  const proj = persp(cam.fov, asp, 0.05, 300);
  view = ident(new Float32Array(16));
  rotZ(view, -(cam.roll || 0));
  rotX(view, -cam.pitch); rotY(view, -cam.yaw); translate(view, -cam.x, -cam.y, -cam.z);
  VP = mul(new Float32Array(16), proj, view);
  R.VP = VP;
  eye = [cam.x, cam.y, cam.z];
  camRight = [view[0], view[4], view[8]]; camUp = [view[1], view[5], view[9]];

  // céu
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  gl.useProgram(sprog.p);
  const t = theme || { sky: [0.5, 0.6, 0.8], horizon: [0.8, 0.8, 0.8], fog: [0.7, 0.7, 0.7] };
  gl.uniform3fv(sprog.u.uTop, t.sky); gl.uniform3fv(sprog.u.uHor, t.horizon); gl.uniform3fv(sprog.u.uLow, t.fog);
  gl.uniform1f(sprog.u.uH, -Math.tan(cam.pitch) / Math.tan(cam.fov / 2));
  gl.uniform1f(sprog.u.uK, 0.9 * Math.tan(cam.fov / 2) / Math.tan(0.65));
  for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(sprog.a.aP); gl.vertexAttribPointer(sprog.a.aP, 2, gl.FLOAT, false, 8, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  gl.clear(gl.DEPTH_BUFFER_BIT);

  // mundo
  flashLight = Math.max(0, flashLight - dt * 4);
  const lit = 1 + flashLight * 0.5 + (st.view && st.view.flash > 0 ? 0.12 : 0);
  useMain();
  for (const b of world) { bindMesh(b.buf); tex(b.tex); gl.uniformMatrix4fv(prog.u.uM, false, ident(tmp)); gl.uniform3f(prog.u.uTint, lit, lit, lit); gl.drawArrays(gl.TRIANGLES, 0, b.n); }
  bindMesh(cubeBuf);
  for (const p of st.players) drawPlayer(p);
  for (const it of st.items) drawItem(it);
  for (const n of st.nades) { const m = ident(new Float32Array(16)); translate(m, n.x, n.y, n.z); rotY(m, n.spin || 0); drawGun(m, ["he", "flash", "smoke"][n.type]); }
  if (st.bomb) {
    const m = ident(new Float32Array(16)); translate(m, st.bomb.x, st.bomb.y + 0.05, st.bomb.z); rotY(m, 0.6); drawGun(m, "bomba");
    if (st.bomb.blink) R.add({ x: st.bomb.x + 0.04, y: st.bomb.y + 0.17, z: st.bomb.z + 0.02, life: 0.12, size: 0.12, col: [1, 0.15, 0.1], add: true, tex: 1 });
  }

  // marcas de tiro
  gl.enable(gl.BLEND); gl.depthMask(false);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
  if (decals.length) {
    let o = 0;
    for (const d of decals) {
      let t1 = Math.abs(d.ny) > 0.5 ? [1, 0, 0] : [0, 1, 0];
      const t2 = [d.ny * t1[2] - d.nz * t1[1], d.nz * t1[0] - d.nx * t1[2], d.nx * t1[1] - d.ny * t1[0]];
      t1 = [t2[1] * d.nz - t2[2] * d.ny, t2[2] * d.nx - t2[0] * d.nz, t2[0] * d.ny - t2[1] * d.nx];
      const s = d.size, P = (a, b, u, v) => [d.x + (t1[0] * a + t2[0] * b) * s, d.y + (t1[1] * a + t2[1] * b) * s, d.z + (t1[2] * a + t2[2] * b) * s, u, v];
      o = pushRaw(o, [P(-1, -1, 0, 1), P(1, -1, 1, 1), P(1, 1, 1, 0), P(-1, 1, 0, 0)], d.col, d.col[3]);
    }
    gl.disable(gl.CULL_FACE);
    drawP(o / 9, spot, false);
    gl.enable(gl.CULL_FACE);
  }
  gl.disable(gl.POLYGON_OFFSET_FILL);

  // partículas
  const list = [];
  for (let i = R.particles.length - 1; i >= 0; i--) {
    const p = R.particles[i];
    p.t += dt;
    if (p.t >= p.life) { R.particles.splice(i, 1); continue; }
    p.vy -= p.g * dt;
    if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.g && worldMap && OF.pointSolid(worldMap, p.x, p.y, p.z)) { p.vx = p.vy = p.vz = 0; p.g = 0; }
    const k = p.t / p.life;
    list.push({ x: p.x, y: p.y, z: p.z, size: p.size * (1 + p.grow * k), rot: p.rot || 0, col: p.col, a: p.a * (p.add ? 1 - k : Math.min(1, (1 - k) * 2)), add: p.add, tex: p.tex });
  }
  for (const s of st.smokes) smokePuffs(s, list);
  const dist = q => (q.x - eye[0]) ** 2 + (q.y - eye[1]) ** 2 + (q.z - eye[2]) ** 2;
  const norm = list.filter(q => !q.add);
  for (const q of norm) q.d = dist(q);
  norm.sort((a, b) => b.d - a.d);
  // desenha agrupando por textura, respeitando a ordem de profundidade
  const texOf = k => (k === 1 ? soft : k === 2 ? puff : spot);
  let o = 0, curK = -1;
  for (const q of norm) {
    const k = q.tex || 0;
    if (k !== curK && o) { drawP(o / 9, texOf(curK), false); o = 0; }
    curK = k;
    o = pushQuad(o, q.x, q.y, q.z, q.size, q.rot, q.col, q.a);
    if (o >= pdata.length - 60) { drawP(o / 9, texOf(curK), false); o = 0; }
  }
  if (o) drawP(o / 9, texOf(curK), false);
  // aditivas: faíscas, fogo, traçantes
  o = 0;
  for (const q of list) if (q.add) { o = pushQuad(o, q.x, q.y, q.z, q.size, q.rot, q.col, q.a); if (o >= pdata.length - 60) break; }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i];
    tr.t += dt;
    if (tr.t > tr.life) { tracers.splice(i, 1); continue; }
    const a = tr.a, b = tr.b;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const tx = a[0] - eye[0], ty = a[1] - eye[1], tz = a[2] - eye[2];
    let sx = dy * tz - dz * ty, sy = dz * tx - dx * tz, sz = dx * ty - dy * tx;
    const sl = Math.hypot(sx, sy, sz) || 1; sx *= tr.w / sl; sy *= tr.w / sl; sz *= tr.w / sl;
    // só um trecho do caminho, andando
    const f0 = Math.min(1, tr.t / tr.life * 1.2), f1 = Math.min(1, f0 + 0.35);
    const A = [a[0] + dx * f0, a[1] + dy * f0, a[2] + dz * f0], Bp = [a[0] + dx * f1, a[1] + dy * f1, a[2] + dz * f1];
    o = pushRaw(o, [[A[0] - sx, A[1] - sy, A[2] - sz, 0, 0.5], [Bp[0] - sx, Bp[1] - sy, Bp[2] - sz, 1, 0.5], [Bp[0] + sx, Bp[1] + sy, Bp[2] + sz, 1, 0.5], [A[0] + sx, A[1] + sy, A[2] + sz, 0, 0.5]], tr.col, 0.8);
  }
  gl.disable(gl.CULL_FACE);
  drawP(o / 9, soft, true);
  gl.enable(gl.CULL_FACE);
  gl.depthMask(true); gl.disable(gl.BLEND);

  // arma na mão (por cima de tudo)
  if (st.view && st.view.wep) drawView(st.view, asp, lit);
};

function drawView(v, asp, lit) {
  gl.clear(gl.DEPTH_BUFFER_BIT);
  const proj = persp(1.05, asp, 0.01, 10);
  gl.useProgram(prog.p);
  gl.uniformMatrix4fv(prog.u.uVP, false, proj);
  gl.uniform3f(prog.u.uEye, 0, 0, 0);
  gl.uniform2f(prog.u.uFogR, 50, 60);
  curTex = null;
  bindMesh(cubeBuf);
  const m = ident(new Float32Array(16));
  const w = v.wep, d = OF.WEAPONS[w] || {};
  const kick = v.kick || 0, rl = v.reload || 0, dep = v.deploy || 0;
  const bx = Math.sin(v.bob) * 0.012 * v.bobAmt, by = -Math.abs(Math.cos(v.bob)) * 0.01 * v.bobAmt;
  const long = d.kind === "rifle" || d.kind === "sniper" || d.kind === "shotgun" || d.kind === "smg";
  translate(m, 0.18 + bx + (v.swayX || 0), -0.19 + by - dep * 0.35 - Math.sin(rl * Math.PI) * 0.12 + (v.swayY || 0), long ? -0.38 : -0.42);
  rotY(m, 0.06 + (v.swayX || 0) * 0.8);
  rotX(m, kick * 0.12 - Math.sin(rl * Math.PI) * 0.5 + dep * -0.6);
  translate(m, 0, 0, kick * 0.04);
  if (w === "faca" && v.slash > 0) { const s = Math.sin(v.slash * Math.PI); rotY(m, s * 0.9); rotZ(m, -s * 0.8); translate(m, -s * 0.1, 0.03 * s, -s * 0.1); }
  if (d.nade && v.throwT > 0) { translate(m, 0, 0.1 * v.throwT, 0.1 * v.throwT); rotX(m, v.throwT * 1.2); }
  // mãos/luvas
  const glove = [0.18, 0.17, 0.15], sleeve = v.team === "t" ? TEAM_LOOK.t.torso : v.team === "r" ? TEAM_LOOK.r.torso : [0.35, 0.35, 0.38];
  // mão direita no punho + antebraço descendo para trás
  const arm = (gx, gy, gz, tilt, yawA) => {
    box(m, gx, gy, gz, 0.06, 0.065, 0.08, glove);
    const f = copy(m); translate(f, gx, gy, gz); rotY(f, yawA); rotX(f, tilt);
    box(f, 0, 0, 0.17, 0.075, 0.075, 0.26, sleeve, cloth);
  };
  arm(0.01, -0.075, 0.05, 0.7, -0.15);
  if (long) arm(-0.015, -0.055, -0.2, 0.45, 0.5);
  drawGun(m, w);
  if (v.flash > 0) {
    // clarão na ponta do cano
    const parts = GUNS[w];
    let zt = 0;
    for (const p of parts) zt = Math.min(zt, p[2] - p[5] / 2);
    const fm = copy(m); translate(fm, 0, 0.01, zt - 0.04); rotZ(fm, Math.random() * 6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    gl.useProgram(pprog.p);
    gl.uniformMatrix4fv(pprog.u.uVP, false, mul(new Float32Array(16), proj, fm));
    const s = 0.07 + Math.random() * 0.04;
    let o = pushRaw(0, [[-s, -s, 0, 0, 1], [s, -s, 0, 1, 1], [s, s, 0, 1, 0], [-s, s, 0, 0, 0]], [1, 0.75, 0.35], 1);
    o = pushRaw(o, [[-s * 0.5, -s * 0.5, -s * 1.2, 0, 1], [s * 0.5, s * 0.5, -s * 1.2, 1, 1], [s * 0.5, s * 0.5, 0.0, 1, 0], [-s * 0.5, -s * 0.5, 0, 0, 0]], [1, 0.8, 0.4], 0.8);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, soft); gl.uniform1i(pprog.u.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, pdata.subarray(0, o), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(pprog.a.aP); gl.vertexAttribPointer(pprog.a.aP, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(pprog.a.aT); gl.vertexAttribPointer(pprog.a.aT, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(pprog.a.aC); gl.vertexAttribPointer(pprog.a.aC, 4, gl.FLOAT, false, 36, 20);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, o / 9);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}

// projeta um ponto do mundo na tela (pixels CSS) — para nomes e indicadores
R.project = function (x, y, z) {
  if (!VP) return null;
  const cx = VP[0] * x + VP[4] * y + VP[8] * z + VP[12], cy = VP[1] * x + VP[5] * y + VP[9] * z + VP[13];
  const cw = VP[3] * x + VP[7] * y + VP[11] * z + VP[15];
  if (cw <= 0.05) return null;
  return [(cx / cw * 0.5 + 0.5) * canvas.clientWidth, (1 - (cy / cw * 0.5 + 0.5)) * canvas.clientHeight, cw];
};

/* ---------- Som ---------- */

const S = { ctx: null, vol: 0.6, muted: false, lx: 0, ly: 0, lz: 0, lyaw: 0 };
window.S = S;
let master, noiseBuf, comp;
S.init = function () {
  if (S.ctx) { if (S.ctx.state === "suspended") S.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  S.ctx = new AC();
  comp = S.ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6;
  master = S.ctx.createGain(); master.gain.value = S.muted ? 0 : S.vol;
  master.connect(comp); comp.connect(S.ctx.destination);
  const n = S.ctx.sampleRate * 1.5;
  noiseBuf = S.ctx.createBuffer(1, n, S.ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
};
S.setVol = function (v) { S.vol = v; if (master) master.gain.value = S.muted ? 0 : v; };
S.toggle = function () { S.muted = !S.muted; S.setVol(S.vol); return S.muted; };
S.listen = function (x, y, z, yaw) { S.lx = x; S.ly = y; S.lz = z; S.lyaw = yaw; };

// posição -> ganho, pan e abafamento
function place(pos, range) {
  if (!pos) return { g: 1, pan: 0, lp: 20000 };
  const dx = pos[0] - S.lx, dy = pos[1] - S.ly, dz = pos[2] - S.lz, d = Math.hypot(dx, dy, dz);
  const g = Math.max(0, 1 - d / range) ** 1.6;
  const rx = Math.cos(S.lyaw), rz = -Math.sin(S.lyaw);
  const pan = d > 0.5 ? Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / d)) : 0;
  let lp = 20000 - Math.min(1, d / range) * 17000;
  if (worldMap && d > 2 && !OF.clearLine(worldMap, S.lx, S.ly, S.lz, pos[0], pos[1] + 0.2, pos[2])) lp = Math.min(lp, 1400);
  return { g, pan, lp };
}
function out(pl, vol) {
  const c = S.ctx, g = c.createGain(); g.gain.value = vol * pl.g;
  const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = pl.lp;
  let node = g;
  if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pl.pan; g.connect(p); p.connect(f); }
  else g.connect(f);
  f.connect(master);
  return node;
}
function noiseHit(dest, t0, dur, type, freq, q, vol, attack = 0.002, fEnd) {
  const c = S.ctx, src = c.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
  if (fEnd) f.frequency.exponentialRampToValueAtTime(fEnd, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t0, Math.random() * 0.5, dur + 0.05);
}
function tone(dest, t0, dur, type, f0, f1, vol, attack = 0.003) {
  const c = S.ctx, o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}
const ok = () => S.ctx && S.ctx.state === "running" && !S.muted;

S.shot = function (w, pos) {
  if (!ok()) return;
  const d = OF.WEAPONS[w] || {}, k = d.kind, c = S.ctx, t = c.currentTime;
  if (w === "faca") { const o = out(place(pos, 15), 0.5); noiseHit(o, t, 0.16, "bandpass", 3000, 1.5, 0.5, 0.04, 6000); return; }
  const P = {
    pistol: [0.12, 2200, 0.9, 140], smg: [0.09, 1800, 0.8, 120], rifle: [0.16, 1300, 1.0, 90], sniper: [0.5, 800, 1.2, 60], shotgun: [0.35, 900, 1.2, 70],
  }[k] || [0.12, 2000, 0.8, 120];
  const o = out(place(pos, k === "sniper" ? 160 : 110), 1);
  noiseHit(o, t, P[0], "lowpass", P[1] * (w === "magnum" ? 0.8 : 1), 0.7, P[2], 0.001, 300);
  noiseHit(o, t, 0.03, "highpass", 3000, 0.5, 0.5);
  tone(o, t, P[0] * 0.8, "sine", P[3] * 2, P[3] * 0.6, P[2] * 0.6);
  if (k === "sniper" || k === "shotgun") noiseHit(o, t + 0.12, 0.6, "lowpass", 600, 0.5, 0.18, 0.05, 200);
};
S.step = function (pos, vol = 0.18, land) {
  if (!ok()) return;
  const o = out(place(pos, 28), 1), t = S.ctx.currentTime;
  noiseHit(o, t, land ? 0.12 : 0.06, "lowpass", land ? 500 : 900 + Math.random() * 400, 1, vol, 0.004);
};
S.click = function (pos, f = 1800, vol = 0.25) { if (!ok()) return; const o = out(place(pos, 15), 1); tone(o, S.ctx.currentTime, 0.04, "square", f, f * 0.7, vol); };
S.reload = function (pos) {
  if (!ok()) return;
  const o = out(place(pos, 18), 1), t = S.ctx.currentTime;
  noiseHit(o, t + 0.05, 0.05, "bandpass", 2500, 3, 0.3); noiseHit(o, t + 0.6, 0.06, "bandpass", 1800, 3, 0.35); noiseHit(o, t + 0.9, 0.05, "bandpass", 3000, 3, 0.3);
};
S.hit = function (head) {
  if (!ok()) return;
  const o = out({ g: 1, pan: 0, lp: 20000 }, 1), t = S.ctx.currentTime;
  if (head) { tone(o, t, 0.25, "triangle", 2600, 2400, 0.25); tone(o, t, 0.2, "sine", 3900, 3600, 0.12); }
  else noiseHit(o, t, 0.08, "lowpass", 700, 1, 0.35);
};
S.hurt = function () { if (!ok()) return; const o = out({ g: 1, pan: 0, lp: 20000 }, 1), t = S.ctx.currentTime; noiseHit(o, t, 0.15, "lowpass", 400, 1, 0.6); tone(o, t, 0.15, "sine", 120, 60, 0.4); };
S.boom = function (pos, big) {
  if (!ok()) return;
  const o = out(place(pos, big ? 250 : 150), 1), t = S.ctx.currentTime;
  noiseHit(o, t, big ? 2.5 : 1.4, "lowpass", 900, 0.6, 1.3, 0.005, 60);
  tone(o, t, big ? 1.5 : 0.8, "sine", 80, 30, 1);
};
S.flashPop = function (pos) { if (!ok()) return; const o = out(place(pos, 80), 1), t = S.ctx.currentTime; noiseHit(o, t, 0.3, "highpass", 1500, 0.6, 0.9); };
S.smokePop = function (pos) { if (!ok()) return; const o = out(place(pos, 40), 1), t = S.ctx.currentTime; noiseHit(o, t, 2.2, "bandpass", 1200, 0.4, 0.4, 0.2, 400); };
S.ring = function (dur) {
  if (!ok()) return;
  const o = out({ g: 1, pan: 0, lp: 20000 }, 1), t = S.ctx.currentTime;
  tone(o, t, dur, "sine", 3500, 3300, 0.12, 0.05);
};
S.bounce = function (pos) { if (!ok()) return; const o = out(place(pos, 25), 1); tone(o, S.ctx.currentTime, 0.05, "triangle", 900, 500, 0.3); };
S.beep = function (pos, hi) { if (!ok()) return; const o = out(place(pos, 60), 1); tone(o, S.ctx.currentTime, 0.09, "square", hi ? 2100 : 1800, 0, 0.18); };
S.ui = function (f = 900) { if (!ok()) return; const o = out({ g: 1, pan: 0, lp: 20000 }, 1); tone(o, S.ctx.currentTime, 0.06, "triangle", f, f * 1.3, 0.25); };
S.chord = function (good) {
  if (!ok()) return;
  const o = out({ g: 1, pan: 0, lp: 20000 }, 1), t = S.ctx.currentTime;
  (good ? [523, 659, 784] : [392, 330, 262]).forEach((f, i) => tone(o, t + i * 0.12, 0.5, "triangle", f, 0, 0.18, 0.02));
};
S.swish = function () { if (!ok()) return; const o = out({ g: 1, pan: 0, lp: 20000 }, 1); noiseHit(o, S.ctx.currentTime, 0.18, "bandpass", 1500, 1.2, 0.35, 0.05, 4000); };
})();
