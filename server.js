// Hub de jogos — servidor para rede local (sem dependências).
// Uso: node server.js   (porta padrão 3000, ou PORT=8080 node server.js)
//
// Serve o hub (index.html), os jogos estáticos (pastas/arquivos .html) e
// monta os jogos online, cada um no seu prefixo (ex.: /batalha-online/).

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

// Jogos com servidor próprio: prefixo -> módulo que exporta handle(req, res, pathname)
const ONLINE = {
  "/batalha-online/": require("./batalha-online/server.js"),
  "/tiro-e-treta/online/": require("./tiro-e-treta/server.js"),
  "/ofensiva/": require("./ofensiva/server.js"),
};
for (const [base, mod] of Object.entries(ONLINE)) mod.configure?.({ port: PORT, base });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  const file = path.normalize(path.join(ROOT, rel));
  const parts = path.relative(ROOT, file).split(path.sep);
  // Fora da pasta, arquivos ocultos ou código de servidor: não serve.
  if (!file.startsWith(ROOT) || parts.some(p => p.startsWith(".") || p === "node_modules") ||
      path.basename(file) === "server.js") {
    res.writeHead(404); return res.end("Não encontrado");
  }
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404); return res.end("Não encontrado"); }
    if (st.isDirectory()) {
      if (!pathname.endsWith("/")) { res.writeHead(301, { Location: pathname + "/" }); return res.end(); }
      return serveStatic(req, res, pathname + "index.html");
    }
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) { res.writeHead(404); return res.end("Não encontrado"); }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://x");

  for (const [base, mod] of Object.entries(ONLINE)) {
    if (pathname === base.slice(0, -1)) { res.writeHead(301, { Location: base }); return res.end(); }
    if (pathname.startsWith(base)) return mod.handle(req, res, pathname.slice(base.length - 1));
  }

  if (pathname === "/api/info") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ addresses: lanAddresses().map(ip => `http://${ip}:${PORT}/`) }));
  }

  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

// WebSocket (jogos em tempo real)
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  for (const [base, mod] of Object.entries(ONLINE))
    if (pathname.startsWith(base) && mod.upgrade) return mod.upgrade(req, socket, head, pathname.slice(base.length - 1));
  socket.destroy();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("🎮 Hub de jogos rodando!");
  console.log("Abra no navegador (qualquer aparelho na mesma rede Wi-Fi):");
  const ips = lanAddresses();
  console.log(`  http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  console.log("Ctrl+C para encerrar.");
});
