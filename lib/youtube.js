// TrendRadar — مكتبة جلب بيانات ترند يوتيوب من YouTube Data API v3
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.googleapis.com/youtube/v3/videos';

export const CFG = {
  get key() {
    return process.env.YOUTUBE_API_KEY || '';
  },
  regions: (process.env.REGIONS || 'US,GB,CA,AU,IN,BR,MX,DE,FR,ES,IT,JP,KR,ID,TR,SA,EG,AE,MA,DZ')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  // فئات سريعة (Gaming و Entertainment) لتوفير الحصة وتسريع الجلب
  categories: (process.env.CATEGORIES ? process.env.CATEGORIES.split(',') : ['20', '24']),
  generalPages: 2,                 // صفحتان × 50 = أول 100 في القائمة العامة لكل دولة
  size: 50,                        // عدد العناصر المعروضة في كل جدول
  ttlMs: 3 * 3600e3,               // مدة بقاء النتيجة في الذاكرة (3 ساعات)
  minRefreshMs: 5 * 60 * 1000,     // أقل فاصل بين جلبين فعليين
  concurrency: 20,                 // عدد الطلبات المتوازية لتسريع الاستجابة على Vercel
  excludeCategory: '10',           // Music
  shortMaxSec: 60,                 // أقصى مدة نعدّ بها الفيديو Short
  searchSize: 25,                  // عدد نتائج البحث
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
    const r = await f(url, { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(10000) });
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
  if(!key) throw new Error('مفتاح YOUTUBE_API_KEY غير مضبوط. يرجى إضافته في إعدادات البيئة (Environment Variables).');
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
      if(!j.cat) failed[j.cc] = msg(e);
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
    { headers: { 'User-Agent': 'TrendRadar/1.0' }, signal: AbortSignal.timeout(10000) });
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

export async function search(deps = {}, q, type){
  const f = deps.fetchImpl || fetch;
  const key = deps.apiKey !== undefined ? deps.apiKey : CFG.key;
  if(!key) throw new Error('مفتاح YOUTUBE_API_KEY غير مضبوط');
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
