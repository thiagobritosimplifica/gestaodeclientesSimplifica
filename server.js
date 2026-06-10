/* ====================================================
   Simplifica — Gestão de Clientes
   Servidor (server.js) — site estático + API de dados
   Sem dependências externas (Node.js puro).
   ==================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  clients: [],
  closers: ['Leonardo', 'Gustavo', 'Thiago']
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function readDb() {
  try {
    return { ...DEFAULT_DB, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_DB };
  }
}

// Grava em arquivo temporário e renomeia para evitar db corrompido
function writeDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload muito grande'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  // ---- API ----
  if (pathname === '/api/data' && req.method === 'GET') {
    return sendJson(res, 200, readDb());
  }

  if ((pathname === '/api/clients' || pathname === '/api/closers') && req.method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!Array.isArray(body)) return sendJson(res, 400, { error: 'esperado um array' });
      const db = readDb();
      if (pathname === '/api/clients') db.clients = body;
      else db.closers = body;
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'JSON inválido' });
    }
  }

  // ---- Arquivos estáticos ----
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }

  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.join(__dirname, path.normalize(file));
  const ext = path.extname(full).toLowerCase();

  // Bloqueia path traversal, extensões desconhecidas e o próprio servidor
  if (!full.startsWith(__dirname) || !MIME[ext] || path.basename(full) === 'server.js') {
    res.writeHead(404);
    return res.end('Not found');
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Simplifica rodando na porta ${PORT} — dados em ${DB_FILE}`);
});
