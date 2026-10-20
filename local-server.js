// TrendRadar — خادم محلي لتشغيل التطبيق على الحاسوب و Electron
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CFG, collect, search } from './lib/youtube.js';

const HERE = process.pkg ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));

// تحميل متغيرات البيئة تلقائياً إن وُجد ملف .env أو key.txt محلياً
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch {}
}
if (!process.env.YOUTUBE_API_KEY) {
  try {
    const envFile = path.join(HERE, '.env');
    if (fsSync.existsSync(envFile)) {
      const lines = fsSync.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
        }
      }
    }
  } catch {}
}
if (!process.env.YOUTUBE_API_KEY) {
  try {
    const keyFile = path.join(HERE, 'key.txt');
    if (fsSync.existsSync(keyFile)) {
      process.env.YOUTUBE_API_KEY = fsSync.readFileSync(keyFile, 'utf8').trim();
    }
  } catch {}
}

const msg = e => (e && e.message) ? e.message : String(e);

export function createServer(deps = {}){
  let cache = null, inflight = null;
  const scache = new Map();

  async function getTrends(force){
    const now = Date.now();
    if(cache){
      const age = now - cache.at;
      if(age < CFG.minRefreshMs || (!force && age < CFG.ttlMs)) return cache.data;
    }
    if(!inflight){
      inflight = collect(deps).then(d => { cache = { at: Date.now(), data: d }; return d; })
        .catch(e => { if(cache) return cache.data; throw e; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if(req.method === 'OPTIONS'){ res.writeHead(204, cors); return res.end(); }
    try {
      if(url.pathname === '/api/trends'){
        const data = await getTrends(url.searchParams.get('refresh') === '1');
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(data));
      }
      if(url.pathname === '/api/search'){
        const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const type = url.searchParams.get('type') === 'channel' ? 'channel' : 'video';
        const head = { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
        if(!q){ res.writeHead(400, head); return res.end(JSON.stringify({ error: 'اكتب كلمة للبحث' })); }
        const k = type + '|' + q.toLowerCase();
        const hit = scache.get(k);
        let data;
        if(hit && Date.now() - hit.at < CFG.searchTtlMs) data = hit.data;
        else {
          data = await search(deps, q, type);
          scache.set(k, { at: Date.now(), data });
          if(scache.size > 100) scache.delete(scache.keys().next().value);
        }
        res.writeHead(200, head);
        return res.end(JSON.stringify(data));
      }
      if(url.pathname === '/' || url.pathname === '/index.html'){
        const html = await fs.readFile(path.join(HERE, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      res.writeHead(404, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch(e){
      res.writeHead(500, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: msg(e) }));
    }
  });
}

function listen(srv, port, tries = 10){
  return new Promise((resolve, reject) => {
    const onError = e => {
      srv.off('listening', onListen);
      if(e.code === 'EADDRINUSE' && tries > 0){
        console.log(`المنفذ ${port} مشغول، أجرّب ${port + 1}…`);
        resolve(listen(srv, port + 1, tries - 1));
      } else reject(e);
    };
    const onListen = () => { srv.off('error', onError); resolve(port); };
    srv.once('error', onError);
    srv.once('listening', onListen);
    srv.listen(port);
  });
}

const isDirectRun = process.argv[1] && (
  import.meta.url === pathToFileURL(process.argv[1]).href ||
  process.argv[1].endsWith('server.js')
);

if(isDirectRun){
  if(!CFG.key) console.warn('تنبيه: YOUTUBE_API_KEY غير مضبوط، ستفشل الطلبات حتى تضبطه.');
  const port = Number(process.env.PORT) || 3000;
  const srv = createServer();
  listen(srv, port).then(p => {
    console.log(`TrendRadar يعمل على http://localhost:${p}  (الدول: ${CFG.regions.join(', ')})`);
  }).catch(e => { console.error('تعذّر تشغيل الخادم:', e.message); process.exit(1); });
}

export { CFG, collect, search };
