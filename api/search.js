import { search, CFG } from '../server.js';

const scache = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const q = (req.query?.q || '').trim().slice(0, 100);
    const type = req.query?.type === 'channel' ? 'channel' : 'video';

    if (!q) {
      return res.status(400).json({ error: 'اكتب كلمة للبحث' });
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

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json(data);
  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: e.message || String(e) });
  }
}
