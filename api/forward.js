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

// Short-lived in-memory dedupe. Survives only while the serverless instance is warm,
// which is exactly the window in which accidental double-fires arrive. Keyed on the
// fields that make a fire unique; a repeat within the TTL is dropped.
const recentFires = new Map();
const DEDUPE_TTL_MS = 10000;

function isDuplicate(payload) {
  const key = [payload.event, payload.session_id, payload.message_count, payload.status].join('|');
  const now = Date.now();
  // prune old entries
  for (const [k, t] of recentFires) { if (now - t > DEDUPE_TTL_MS) recentFires.delete(k); }
  if (recentFires.has(key)) return true;
  recentFires.set(key, now);
  return false;
}

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

    // --- Idempotency guard --------------------------------------------------
    // Drop an identical fire that arrives within the dedupe window (e.g. a
    // double-submit that slipped past the browser guard). Return ok so the
    // browser doesn't treat the drop as a failure.
    if (isDuplicate(payload)) {
      return res.status(200).json({ ok: true, deduped: true });
    }

    // --- Split fields: small ones in the query string, large ones in the body --
    // Query strings have a hard URL-length limit (~8KB). The full conversation
    // transcript and a pasted job description can blow past that on their own,
    // which made long recruiter sends fail. So the big free-text fields go in the
    // JSON POST body (no practical size limit) while every short field stays in
    // the query string — keeping the existing querystring_* Zapier mappings intact.
    // Body fields appear in Zapier's Catch Hook at the top level (not querystring_).
    const BODY_FIELDS = ['conversation', 'role_description', 'message'];
    const params = new URLSearchParams();
    const bodyData = {};
    for (const [k, v] of Object.entries(payload)) {
      if (BODY_FIELDS.includes(k)) {
        bodyData[k] = v == null ? '' : String(v);
      } else {
        params.append(k, v == null ? '' : String(v));
      }
    }

    // --- Verify Zapier actually accepted it ---------------------------------
    // Previously we ignored the response, so a failing webhook looked identical
    // to a working one. Now we check the HTTP status AND Zapier's own body
    // (it returns {"status":"success"} on a good Catch Hook) and report the
    // real outcome back to the browser so it can show a fallback when it matters.
    const zapResp = await fetch(`${webhook}?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });
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
