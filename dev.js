// Servidor local de desenvolvimento: estáticos + mesma API da Vercel (memória se não houver Redis).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
try { process.loadEnvFile('.env.local'); } catch { /* sem .env.local: usa o ambiente */ }
const { handle } = await import('./lib/handler.js');

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg' };
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { req.body = !b ? {} : String(req.headers['content-type'] || '').includes('x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(b)) : JSON.parse(b); } catch { req.body = {}; } handle(req, res); });
    return;
  }
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html'; // URLs limpas (/privacidade)
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Dev em http://localhost:${PORT} (Supabase; admin em /admin.html)`));
