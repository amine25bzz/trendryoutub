// TrendRadar — خادم صغير يجلب ترند يوتيوب من YouTube Data API
// ----------------------------------------------------------------
// لماذا الخادم؟ مفتاح الـ API يجب أن يبقى سرياً على الخادم ولا يظهر في المتصفح.
// الخادم يجلب قوائم mostPopular لعدة دول، يدمج الفيديو الواحد الذي يظهر في أكثر من دولة،
// يستبعد تصنيف الموسيقى، ويقسّم النتيجة إلى: عادي · Shorts · كيدس.
//
// التشغيل:   npm install   ثم   npm start   ثم افتح  http://localhost:3000
//   (لتغيير المفتاح دون تعديل الملف:  YOUTUBE_API_KEY=مفتاحك npm start)
// المتغيرات: YOUTUBE_API_KEY (إلزامي) · PORT (3000) · REGIONS (مثل US,GB,MA,SA)

import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = process.pkg ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://www.googleapis.com/youtube/v3/videos';

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

export const CFG = {
  port: Number(process.env.PORT) || 3000,
  // المفتاح: يُقرأ من متغير البيئة YOUTUBE_API_KEY
  key: process.env.YOUTUBE_API_KEY || '',
  regions: (process.env.REGIONS || 'US,GB,CA,AU,IN,BR,MX,DE,FR,ES,IT,JP,KR,ID,TR,SA,EG,AE,MA,DZ')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  // قوائم فئات إضافية لكل دولة: القائمة العامة مليئة بالموسيقى، وهذه تُظهر بقية المحتوى
  categories: ['1', '17', '20', '22', '23', '24', '25', '26', '27', '28'],
  generalPages: 2,                 // صفحتان × 50 = أول 100 في القائمة العامة لكل دولة
  size: 50,                        // عدد العناصر المعروضة في كل جدول
  ttlMs: 3 * 3600e3,               // مدة بقاء النتيجة في الذاكرة (لحماية حصة الـ API)
  minRefreshMs: 5 * 60 * 1000,     // أقل فاصل بين جلبين فعليين حتى مع ?refresh=1
  concurrency: 6,                  // عدد الطلبات المتوازية
  excludeCategory: '10',           // Music
  shortMaxSec: 60,                 // أقصى مدة نعدّ بها الفيديو Short
  searchSize: 25,                  // عدد نتائج البحث (كل بحث يكلّف 101 وحدة من الحصة)
  searchTtlMs: 10 * 60 * 1000      // مدة حفظ نتيجة البحث في الذاكرة
};

const msg = e => (e && e.message) ? e.message : String(e);

export function parseDuration(s){          // "PT1M5S" -> 65
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || ''));
  if(!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function pool(items, n, fn){
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while(i < items.length){ const it = items[i++]; await fn(it); }
  }));
}

async function fetchChart(f, key, cc, cat, pages){
  const out = [];
  let token = '';
  for(let p = 0; p < pages; p++){
    const url = `${BASE}?part=snippet,statistics,contentDetails,status&chart=mostPopular&regionCode=${cc}&maxResults=50&key=${key}`
      + (cat ? `&videoCategoryId=${cat}` : '') + (token ? `&pageToken=${token}` : '');
    const r = await f(url, { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if(!r.ok){
      const er = j.error || {};
      const e = new Error(er.message || `HTTP ${r.status}`);
      e.status = r.status;
      e.reason = er.errors && er.errors[0] && er.errors[0].reason;
      throw e;
    }
    out.push(...(j.items || []));
    token = j.nextPageToken;
    if(!token) break;
  }
  return out;
}

function absorb(map, it, cc, rank){
  const sn = it.snippet || {};
  if(sn.categoryId === CFG.excludeCategory) return;          // بدون موسيقى
  let v = map.get(it.id);
  if(!v){
    const st = it.statistics || {};
    const th = sn.thumbnails || {};
    const dur = parseDuration(it.contentDetails && it.contentDetails.duration);
    const live = !!(sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none');
    const kids = !!(it.status && it.status.madeForKids === true);
    v = {
      id: it.id, url: `https://www.youtube.com/watch?v=${it.id}`,
      title: sn.title || '—', channel: sn.channelTitle || '—', categoryId: sn.categoryId || '',
      thumb: (th.medium || th.default || {}).url || '',
      views: st.viewCount != null ? Number(st.viewCount) : null,
      likes: st.likeCount != null ? Number(st.likeCount) : null,
      comments: st.commentCount != null ? Number(st.commentCount) : null,
      published: sn.publishedAt || '', duration: dur, live,
      kind: kids ? 'kids' : (!live && dur > 0 && dur <= CFG.shortMaxSec ? 'short' : 'regular'),
      _c: new Map()
    };
    map.set(it.id, v);
  }
  const prev = v._c.get(cc);
  if(prev === undefined || rank < prev) v._c.set(cc, rank);
}

export async function collect(deps = {}){
  const f = deps.fetchImpl || fetch;
  const key = deps.apiKey !== undefined ? deps.apiKey : CFG.key;
  if(!key) throw new Error('YOUTUBE_API_KEY غير مضبوط');
  const regions = deps.regions || CFG.regions;
  const now = deps.now || Date.now();

  const jobs = [];
  for(const cc of regions){
    jobs.push({ cc, cat: '', pages: CFG.generalPages });
    for(const cat of CFG.categories) jobs.push({ cc, cat, pages: 1 });
  }
  const vids = new Map(), failed = {}, okRegions = new Set();
  let fatal = null;

  await pool(jobs, CFG.concurrency, async j => {
    if(fatal) return;
    try {
      const items = await fetchChart(f, key, j.cc, j.cat, j.pages);
      if(!j.cat) okRegions.add(j.cc);
      items.forEach((it, i) => absorb(vids, it, j.cc, i + 1));
    } catch(e){
      if(e.reason === 'quotaExceeded' || e.reason === 'keyInvalid' || e.reason === 'accessNotConfigured'){ fatal = e; return; }
      if(!j.cat) failed[j.cc] = msg(e);                      // أخطاء الفئات تُتجاهل (بعض الدول لا تدعمها)
    }
  });

  if(!vids.size){
    if(fatal) throw new Error(fatal.reason === 'quotaExceeded' ? 'انتهت حصة YouTube API اليومية' : msg(fatal));
    throw new Error('تعذّر جلب أي قائمة: ' + (Object.values(failed)[0] || 'سبب غير معروف'));
  }

  const all = [...vids.values()].map(v => {
    const countries = [...v._c.entries()].map(([cc, rank]) => ({ cc, rank })).sort((a, b) => a.rank - b.rank);
    const { _c, ...rest } = v;
    return { ...rest, countries, bestRank: countries[0].rank };
  });
  const order = (a, b) => b.countries.length - a.countries.length || a.bestRank - b.bestRank || (b.views || 0) - (a.views || 0);
  const chart = kind => ({
    ok: true,
    items: all.filter(v => v.kind === kind).sort(order).slice(0, CFG.size).map((v, i) => ({ ...v, rank: i + 1 }))
  });
  const out = {
    syncedAt: now,
    regions: [...okRegions].sort(),
    failed,
    charts: { regular: chart('regular'), short: chart('short'), kids: chart('kids') }
  };
  if(fatal) out.partial = msg(fatal);
  return out;
}

/* ---------------- البحث في يوتيوب ---------------- */
async function ytCall(f, endpoint, params){
  const r = await f(`https://www.googleapis.com/youtube/v3/${endpoint}?${new URLSearchParams(params)}`,
    { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if(!r.ok){
    const er = j.error || {};
    const e = new Error(er.message || `HTTP ${r.status}`);
    e.reason = er.errors && er.errors[0] && er.errors[0].reason;
    throw e;
  }
  return j;
}

function mapVideo(it, rank){
  const sn = it.snippet || {}, st = it.statistics || {}, th = sn.thumbnails || {};
  const dur = parseDuration(it.contentDetails && it.contentDetails.duration);
  const live = !!(sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none');
  const kids = !!(it.status && it.status.madeForKids === true);
  return {
    id: it.id, rank, url: `https://www.youtube.com/watch?v=${it.id}`,
    title: sn.title || '—', channel: sn.channelTitle || '—', categoryId: sn.categoryId || '',
    thumb: (th.medium || th.default || {}).url || '',
    views: st.viewCount != null ? Number(st.viewCount) : null,
    likes: st.likeCount != null ? Number(st.likeCount) : null,
    comments: st.commentCount != null ? Number(st.commentCount) : null,
    published: sn.publishedAt || '', duration: dur, live,
    kind: kids ? 'kids' : (!live && dur > 0 && dur <= CFG.shortMaxSec ? 'short' : 'regular')
  };
}

function mapChannel(it, rank){
  const sn = it.snippet || {}, st = it.statistics || {}, th = sn.thumbnails || {};
  return {
    id: it.id, rank, url: `https://www.youtube.com/channel/${it.id}`,
    title: sn.title || '—', handle: sn.customUrl || '',
    thumb: (th.medium || th.default || {}).url || '',
    subs: st.hiddenSubscriberCount ? null : (st.subscriberCount != null ? Number(st.subscriberCount) : null),
    hiddenSubs: !!st.hiddenSubscriberCount,
    videos: st.videoCount != null ? Number(st.videoCount) : null,
    views: st.viewCount != null ? Number(st.viewCount) : null,
    created: sn.publishedAt || '', country: sn.country || ''
  };
}

const niceErr = e => e && e.reason === 'quotaExceeded' ? 'انتهت حصة YouTube API اليومية' : msg(e);

export async function search(deps, q, type){
  const f = deps.fetchImpl || fetch;
  const key = deps.apiKey !== undefined ? deps.apiKey : CFG.key;
  if(!key) throw new Error('YOUTUBE_API_KEY غير مضبوط');
  try {
    const s = await ytCall(f, 'search', { part: 'snippet', type, q, maxResults: CFG.searchSize, key });
    const ids = (s.items || []).map(i => i.id && (type === 'channel' ? i.id.channelId : i.id.videoId)).filter(Boolean);
    const out = { type, q, syncedAt: Date.now(), items: [] };
    if(!ids.length) return out;
    const j = type === 'channel'
      ? await ytCall(f, 'channels', { part: 'snippet,statistics', id: ids.join(','), maxResults: 50, key })
      : await ytCall(f, 'videos', { part: 'snippet,statistics,contentDetails,status', id: ids.join(','), maxResults: 50, key });
    const byId = new Map((j.items || []).map(x => [x.id, x]));
    out.items = ids.map(id => byId.get(id)).filter(Boolean)
      .map((x, i) => type === 'channel' ? mapChannel(x, i + 1) : mapVideo(x, i + 1));
    return out;
  } catch(e){ throw new Error(niceErr(e)); }
}

/* ---------------- HTTP ---------------- */
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
        .catch(e => { if(cache) return cache.data; throw e; })   // بيانات قديمة أفضل من لا شيء
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

// يجرّب المنفذ المطلوب، وإن كان مشغولاً ينتقل إلى الذي يليه (حتى 10 محاولات)
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

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  if(!CFG.key) console.warn('تنبيه: YOUTUBE_API_KEY غير مضبوط، ستفشل الطلبات حتى تضبطه.');
  const srv = createServer();
  listen(srv, CFG.port).then(port => {
    console.log(`TrendRadar يعمل على http://localhost:${port}  (الدول: ${CFG.regions.join(', ')})`);
  }).catch(e => { console.error('تعذّر تشغيل الخادم:', e.message); process.exit(1); });
}