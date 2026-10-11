/**
 * Palimpsest server: API + static web demo. Bind 0.0.0.0 for previews.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { Store } from './store.js';
import { createApi } from './api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const publicDir = path.join(here, '..', 'public');
const vendorMap = {
  '/vendor/common/': path.join(root, 'packages', 'common', 'src'),
  '/vendor/sim/': path.join(root, 'packages', 'sim', 'src'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let filePath = null;

  if (url.pathname === '/' || url.pathname === '/index.html') {
    filePath = path.join(publicDir, 'index.html');
  } else if (url.pathname === '/app.js' || url.pathname === '/style.css') {
    filePath = path.join(publicDir, url.pathname.slice(1));
  } else {
    for (const [prefix, dir] of Object.entries(vendorMap)) {
      if (url.pathname.startsWith(prefix)) {
        const rel = path.normalize(url.pathname.slice(prefix.length)).replace(/^(\.\.[/\\])+/, '');
        filePath = path.join(dir, rel);
        if (!filePath.startsWith(dir)) filePath = null;
        break;
      }
    }
  }

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

export function startServer(overrides = {}) {
  const store = new Store(config.dataDir);
  const api = createApi(store);
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) return api(req, res);
    return serveStatic(req, res);
  });
  const port = overrides.port ?? config.port;
  return new Promise((resolve) => {
    server.listen(port, config.host, () => {
      resolve({ server, store, port: server.address().port });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(({ port }) => {
    console.log(`\n  PALIMPSEST — «Палимпсест»`);
    console.log(`  сервер:      http://${config.host}:${port}`);
    console.log(`  режим цепи:  ${config.chainMode}`);
    console.log(`  данные:      ${config.dataDir}\n`);
    console.log(`  Based on Restory (google/restory), Apache License 2.0.`);
    console.log(`  Not an officially supported Google product.\n`);
  });
}
