// Vercel Serverless Function — /api/forward
// Holds the Zapier webhook URL server-side and forwards payloads to it.
// The browser never sees the webhook URL.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const webhook = process.env.ZAPIER_WEBHOOK;
  if (!webhook) return res.status(500).json({ error: 'Server not configured: ZAPIER_WEBHOOK missing' });

  try {
    const payload = req.body || {};
    // Forward as query params (Zapier Catch Hook reads these reliably)
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      params.append(k, v == null ? '' : String(v));
    }
    await fetch(`${webhook}?${params.toString()}`, { method: 'POST' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Non-critical — log but don't fail the user experience
    return res.status(200).json({ ok: false, error: e.message });
  }
}
