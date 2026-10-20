import { search, CFG } from '../lib/youtube.js';

const scache = new Map();

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

    const q = (req.query?.q || '').trim().slice(0, 100);
    const type = req.query?.type === 'channel' ? 'channel' : 'video';

    if (!q) {
      return send(res, 400, { error: 'اكتب كلمة للبحث' });
    }

    const k = type + '|' + q.toLowerCase();
    const hit = scache.get(k);
    let data;

    if (hit && Date.now() - hit.at < CFG.searchTtlMs) {
      data = hit.data;
    } else {
      data = await search({}, q, type);
      scache.set(k, { at: Date.now(), data });
      if (scache.size > 100) scache.delete(scache.keys().next().value);
    }

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return send(res, 200, data);
  } catch (e) {
    console.error('Error in /api/search:', e);
    return send(res, 500, { error: e.message || String(e) });
  }
}
