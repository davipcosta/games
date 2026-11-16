// Batalha Minada — servidor para rede local (sem dependências).
// Uso: node server.js   (porta padrão 3000, ou PORT=8080 node server.js)

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

let PORT = Number(process.env.PORT) || 3000;
let BASE = "/"; // prefixo quando roda dentro do hub (ex.: "/batalha-online/")
// EXPANDIR=1 faz a água com 0 abrir a região ao redor (como no campo minado). Deixa o jogo bem mais fácil.
const EXPANDIR = process.env.EXPANDIR === "1";
const N = 10;
const SHIP_TYPES = [
  { name: "Porta-aviões", size: 5 },
  { name: "Cruzador", size: 3 },
  { name: "Submarino", size: 2 },
];
const LETTERS = "ABCDEFGHIJ";
const coord = i => LETTERS[i % N] + (Math.floor(i / N) + 1);

/* ---------- Estado ---------- */

const seats = [0, 1].map(() => ({ token: null, clients: new Set(), lastSeen: 0 }));
let game;
let gameCounter = 0;

function newBoard() {
  return {
    grid: Array(N * N).fill(-1),     // índice do navio ou -1
    ships: [],                       // { size, cells, hits }
    shots: Array(N * N).fill(null),  // null | 'hit' | 'miss'
    nums: Array(N * N).fill(null),
    ready: false,
    fired: 0,
    hits: 0,
  };
}

function newGame() {
  const starter = game ? 1 - game.starter : 0; // alterna quem começa na revanche
  game = {
    id: ++gameCounter,
    phase: "setup", // setup | battle | over
    starter,
    current: starter,
    boards: [newBoard(), newBoard()],
    winner: null,
    lastShot: null, // { by, i }
    log: [],
  };
}
newGame();

function addLog(msg) {
  game.log.push(msg);
  if (game.log.length > 8) game.log.shift();
}

/* ---------- Regras ---------- */

function neighbors(i) {
  const r = Math.floor(i / N), c = i % N, out = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
    }
  return out;
}

function validFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIP_TYPES.length) return false;
  const used = new Set();
  return ships.every((cells, k) => {
    if (!Array.isArray(cells) || cells.length !== SHIP_TYPES[k].size) return false;
    if (!cells.every(i => Number.isInteger(i) && i >= 0 && i < N * N && !used.has(i))) return false;
    const sorted = [...cells].sort((a, b) => a - b);
    const rows = sorted.map(i => Math.floor(i / N)), cols = sorted.map(i => i % N);
    const horizontal = rows.every(r => r === rows[0]) && cols.every((c, j) => c === cols[0] + j);
    const vertical = cols.every(c => c === cols[0]) && rows.every((r, j) => r === rows[0] + j);
    if (!horizontal && !vertical) return false;
    cells.forEach(i => used.add(i));
    return true;
  });
}

function place(seat, ships) {
  if (game.phase !== "setup") return "Fase errada.";
  const b = game.boards[seat];
  if (b.ready) return "Frota já confirmada.";
  if (!validFleet(ships)) return "Posicionamento inválido.";
  ships.forEach((cells, k) => {
    b.ships.push({ size: SHIP_TYPES[k].size, cells, hits: 0 });
    cells.forEach(i => (b.grid[i] = k));
  });
  b.ready = true;
  addLog(`Jogador ${seat + 1} posicionou a frota.`);
  if (game.boards.every(x => x.ready)) {
    game.phase = "battle";
    addLog(`Batalha iniciada! Jogador ${game.current + 1} começa.`);
  }
  return null;
}

function shoot(seat, i) {
  if (game.phase !== "battle") return "A batalha não está em andamento.";
  if (game.current !== seat) return "Não é sua vez.";
  if (!Number.isInteger(i) || i < 0 || i >= N * N) return "Casa inválida.";
  const me = game.boards[seat], enemy = game.boards[1 - seat];
  if (enemy.shots[i]) return "Casa já atingida.";

  me.fired++;
  game.lastShot = { by: seat, i };
  const s = enemy.grid[i];
  const who = `Jogador ${seat + 1}`;

  if (s >= 0) {
    enemy.shots[i] = "hit";
    me.hits++;
    const ship = enemy.ships[s];
    ship.hits++;
    if (ship.hits === ship.size) addLog(`💥 ${who} → ${coord(i)}: ${SHIP_TYPES[s].name} afundado!`);
    else addLog(`🔥 ${who} → ${coord(i)}: acertou!`);
    if (enemy.ships.every(sh => sh.hits === sh.size)) {
      game.phase = "over";
      game.winner = seat;
      addLog(`🏆 ${who} venceu em ${me.fired} tiros!`);
    }
    return null; // acertou: joga de novo
  }

  // Água: estilo campo minado, com expansão de zeros
  const queue = [i];
  let opened = 0;
  while (queue.length) {
    const j = queue.shift();
    if (enemy.shots[j] || enemy.grid[j] >= 0) continue;
    enemy.shots[j] = "miss";
    enemy.nums[j] = neighbors(j).filter(k => enemy.grid[k] >= 0).length;
    opened++;
    if (EXPANDIR && enemy.nums[j] === 0) neighbors(j).forEach(k => { if (!enemy.shots[k]) queue.push(k); });
  }
  const n = enemy.nums[i];
  addLog(`🌊 ${who} → ${coord(i)}: água` +
    (n ? ` (${n} ao redor)` : opened > 1 ? ` (abriu ${opened} casas)` : ""));
  game.current = 1 - seat;
  return null;
}

/* ---------- Visão de cada jogador (sem vazar navios do adversário) ---------- */

function boardView(b, showShips) {
  return b.grid.map((s, i) => {
    const sh = b.shots[i];
    if (sh === "hit") return b.ships[s].hits === b.ships[s].size ? "X" : "H";
    if (sh === "miss") return "M" + b.nums[i];
    if (showShips && s >= 0) return "S";
    return "";
  });
}

function viewFor(seat) {
  const me = game.boards[seat], enemy = game.boards[1 - seat];
  const opp = seats[1 - seat];
  return {
    gameId: game.id,
    seat,
    phase: game.phase,
    current: game.current,
    winner: game.winner,
    lastShot: game.lastShot,
    log: game.log,
    ships: SHIP_TYPES,
    expandir: EXPANDIR,
    addresses: lanAddresses().map(ip => `http://${ip}:${PORT}${BASE}`),
    me: {
      board: boardView(me, true),
      ready: me.ready,
      fired: me.fired,
      hits: me.hits,
      fleet: SHIP_TYPES.map((t, k) => ({ hits: me.ships[k] ? me.ships[k].hits : 0 })),
    },
    enemy: {
      board: boardView(enemy, game.phase === "over"),
      ready: enemy.ready,
      joined: !!opp.token,
      connected: opp.clients.size > 0,
      fired: enemy.fired,
      fleet: SHIP_TYPES.map((t, k) => ({ sunk: !!enemy.ships[k] && enemy.ships[k].hits === t.size })),
    },
  };
}

function broadcast() {
  seats.forEach((s, seat) => {
    if (!s.clients.size) return;
    const data = `data: ${JSON.stringify(viewFor(seat))}\n\n`;
    s.clients.forEach(res => res.write(data));
  });
}

/* ---------- HTTP ---------- */

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

function readJson(req) {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const seatOf = token => (token ? seats.findIndex(s => s.token === token) : -1);
const INDEX = path.join(__dirname, "public", "index.html");

// pathname: caminho relativo ao prefixo (o hub passa "/join", "/events"...)
async function handle(req, res, pathname) {
  const url = new URL(req.url, "http://x");
  if (pathname === undefined) pathname = url.pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end("index.html não encontrado"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(data);
    });
    return;
  }

  if (req.method === "POST" && pathname === "/join") {
    const { token } = await readJson(req);
    let seat = seatOf(token);
    if (seat === -1) {
      seat = seats.findIndex(s => !s.token);
      // Assume uma vaga abandonada (desconectada há mais de 20s)
      if (seat === -1) seat = seats.findIndex(s => s.clients.size === 0 && Date.now() - s.lastSeen > 20000);
      if (seat === -1) return send(res, 409, { error: "Sala cheia: já existem 2 jogadores conectados." });
      seats[seat].token = crypto.randomUUID();
      seats[seat].lastSeen = Date.now();
      console.log(`Jogador ${seat + 1} entrou (${req.socket.remoteAddress})`);
    }
    return send(res, 200, { token: seats[seat].token, seat });
  }

  if (req.method === "GET" && pathname === "/events") {
    const seat = seatOf(url.searchParams.get("token"));
    if (seat === -1) { res.writeHead(403); return res.end(); }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1500\n\n");
    seats[seat].clients.add(res);
    broadcast();
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ping);
      seats[seat].clients.delete(res);
      seats[seat].lastSeen = Date.now();
      broadcast();
    });
    return;
  }

  if (req.method === "POST" && pathname === "/action") {
    const body = await readJson(req);
    const seat = seatOf(body.token);
    if (seat === -1) return send(res, 403, { error: "Sessão inválida. Recarregue a página." });
    let err = null;
    if (body.type === "place") err = place(seat, body.ships);
    else if (body.type === "shoot") err = shoot(seat, body.cell);
    else if (body.type === "restart") {
      if (game.phase !== "over") err = "A partida ainda não terminou.";
      else { newGame(); addLog(`Revanche! Posicionem as frotas. Jogador ${game.current + 1} começa.`); }
    } else err = "Ação desconhecida.";
    if (err) return send(res, 400, { error: err });
    broadcast();
    return send(res, 200, { ok: true });
  }

  res.writeHead(404);
  res.end("Não encontrado");
}

module.exports = {
  handle,
  configure({ port, base } = {}) {
    if (port) PORT = port;
    if (base) BASE = base;
  },
  lanAddresses,
};

// Rodando sozinho (node batalha-online/server.js) continua funcionando como antes.
if (require.main === module) http.createServer((req, res) => handle(req, res)).listen(PORT, "0.0.0.0", () => {
  console.log("⚓ Batalha Minada rodando!");
  console.log("Os dois jogadores devem abrir no navegador (mesma rede Wi-Fi):");
  const ips = lanAddresses();
  if (!ips.length) console.log(`  http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  console.log(`Expansão de zeros: ${EXPANDIR ? "ligada" : "desligada (use EXPANDIR=1 para ligar)"}`);
  console.log("Ctrl+C para encerrar.");
});
