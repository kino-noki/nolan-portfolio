// ============================================================================
//  /api/forward  —  Vercel Serverless Function
// ----------------------------------------------------------------------------
//  PURPOSE
//  Receives event payloads from the browser (ticket / recruiter_lead / log)
//  and forwards them to the private Zapier Catch Hook.
//
//  WHY THIS EXISTS AT ALL
//  The browser can't call Zapier directly without exposing the webhook URL in
//  page source — anyone could then spam your Zap or your Jira. By putting the
//  URL in a server-side env var and relaying through this function, the secret
//  never leaves the server. The browser only ever sees "/api/forward".
// ============================================================================

module.exports = async function handler(req, res) {

  // --- CORS / preflight -----------------------------------------------------
  // Browsers send an OPTIONS "preflight" before a cross-origin POST to ask
  // whether the request is allowed. We answer it with a bare 200 and advertise
  // that POST is permitted. Without this, the real POST would be blocked by the
  // browser before it ever reached us. We also hard-reject any non-POST method
  // so the endpoint can't be probed with GET/PUT etc.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // --- Read the secret webhook from the environment -------------------------
  // Pulled from Vercel → Settings → Environment Variables, never hard-coded.
  // We check it up front and fail loudly: a silent failure here would mean
  // conversations quietly never reach Zapier, which is worse than an error.
  const webhook = process.env.ZAPIER_WEBHOOK;
  if (!webhook) return res.status(500).json({ error: 'Server not configured: ZAPIER_WEBHOOK missing' });

  try {
    // --- Normalise the incoming body ----------------------------------------
    // Two different browser APIs call this endpoint. A normal fetch() sends a
    // parsed JS object, but navigator.sendBeacon (used on tab close, because it
    // survives the page unloading) delivers the body as a raw string. We detect
    // the string case and parse it so both paths produce the same object —
    // otherwise tab-close logs would arrive as unusable text.
    let payload = req.body || {};
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) { payload = {}; }
    }

    // --- Forward to Zapier as query-string params ---------------------------
    // Zapier's free Catch Hook parses query params reliably but is finicky about
    // JSON request bodies (it often shows them as an empty "querystring" object).
    // Flattening every field into ?key=value sidesteps that entirely, which is
    // why earlier JSON-body attempts showed up blank in Zapier.
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) {
      params.append(k, v == null ? '' : String(v));
    }

    // --- Verify Zapier actually accepted it ---------------------------------
    // Previously we ignored the response, so a failing webhook looked identical
    // to a working one. Now we check the HTTP status AND Zapier's own body
    // (it returns {"status":"success"} on a good Catch Hook) and report the
    // real outcome back to the browser so it can show a fallback when it matters.
    const zapResp = await fetch(`${webhook}?${params.toString()}`, { method: 'POST' });
    let zapBody = {};
    try { zapBody = await zapResp.json(); } catch (e) { /* Zapier may return no body */ }

    const accepted = zapResp.ok && (zapBody.status === undefined || zapBody.status === 'success');
    if (!accepted) {
      return res.status(502).json({ ok: false, error: `Zapier rejected the request (status ${zapResp.status})` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // --- Network / unexpected failure ---------------------------------------
    // Report it as not-ok with a 502 so the browser knows the send didn't land.
    // The browser decides whether that failure is worth showing the visitor
    // (yes for tickets/leads, no for background logs).
    return res.status(502).json({ ok: false, error: e.message });
  }
}
