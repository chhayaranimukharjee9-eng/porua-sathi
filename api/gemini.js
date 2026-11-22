// Vercel Serverless Function: /api/gemini
// Gemini API key stays on the server (Vercel Environment Variable: GEMINI_API_KEY).
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash'; // can be changed from Vercel env var GEMINI_MODEL
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const hits = new Map(); // best-effort per-instance rate limit (10 requests / minute / IP)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'POST only' } });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: { message: 'Server API key is not set' } });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 10) return res.status(429).json({ error: { message: 'Too many requests' } });
  recent.push(now);
  hits.set(ip, recent);

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !Array.isArray(b.contents)) return res.status(400).json({ error: { message: 'Bad request' } });

  // Only forward whitelisted fields; model and key are fixed on the server.
  const gc = b.generationConfig || {};
  const body = {
    contents: b.contents,
    systemInstruction: b.systemInstruction,
    ...(Array.isArray(b.tools) && b.tools.length === 1 && b.tools[0] && b.tools[0].google_search ? { tools: [{ google_search: {} }] } : {}),
    ...(gc.responseMimeType === 'application/json' ? { generationConfig: { responseMimeType: 'application/json' } } : {})
  };
  const payload = JSON.stringify(body);
  if (payload.length > 3000000) return res.status(413).json({ error: { message: 'Payload too large' } });

  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: payload
    });
    const data = await r.json().catch(() => ({ error: { message: 'Bad upstream response' } }));
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: { message: 'Upstream error' } });
  }
};
