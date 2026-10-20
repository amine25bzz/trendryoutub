import { collect, CFG } from '../lib/youtube.js';

let cache = null;
let inflight = null;

async function getTrends(force) {
  const now = Date.now();
  if (cache) {
    const age = now - cache.at;
    if (age < CFG.minRefreshMs || (!force && age < CFG.ttlMs)) return cache.data;
  }
  if (!inflight) {
    inflight = collect().then(d => { cache = { at: Date.now(), data: d }; return d; })
      .catch(e => { if (cache) return cache.data; throw e; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(body);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.end(payload);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (!CFG.key) {
      return send(res, 400, {
        error: 'مفتاح YOUTUBE_API_KEY غير موجود في Vercel. يرجى إضافته في Environment Variables ثم عمل Redeploy.'
      });
    }

    const force = req.query?.refresh === '1';
    const data = await getTrends(force);
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return send(res, 200, data);
  } catch (e) {
    console.error('Error in /api/trends:', e);
    return send(res, 500, { error: e.message || String(e) });
  }
}
