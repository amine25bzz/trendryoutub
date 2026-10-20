import { collect, CFG } from '../server.js';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const force = req.query?.refresh === '1';
    const data = await getTrends(force);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(data);
  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ error: e.message || String(e) });
  }
}
