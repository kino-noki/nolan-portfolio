const MAX_SESSION_ID_CHARS = 120;
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;

function getAllowedOrigins() {
  return [
    process.env.SITE_ORIGIN,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ].filter(Boolean);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;

  let isSameHost = false;
  try {
    isSameHost = new URL(origin).host === req.headers.host;
  } catch (e) {}

  if (!isSameHost && !getAllowedOrigins().includes(origin)) {
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

function cleanBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function textFromAdf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textFromAdf).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const parts = [];
    if (typeof value.text === 'string') parts.push(value.text);
    if (typeof value.emailAddress === 'string') parts.push(value.emailAddress);
    if (typeof value.displayName === 'string') parts.push(value.displayName);
    if (value.content) parts.push(textFromAdf(value.content));
    if (value.value) parts.push(textFromAdf(value.value));
    return parts.filter(Boolean).join(' ');
  }
  return '';
}

function truncate(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}

function escapeJqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function authHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function validateInput(body) {
  const ticketKey = String(body.ticket_key || '').trim().toUpperCase();
  const sessionId = String(body.session_id || '').trim();

  if (ticketKey && !TICKET_KEY_RE.test(ticketKey)) return { error: 'ticket_key must look like ABC-123' };
  if (!ticketKey && (!sessionId || sessionId.length > MAX_SESSION_ID_CHARS)) {
    return { error: 'ticket_key or session_id is required' };
  }

  return { ticketKey, sessionId };
}

function buildJql(ticketKey, sessionId) {
  const projectKey = String(process.env.JIRA_PROJECT_KEY || '').trim().toUpperCase();
  const projectPrefix = projectKey ? `project = ${projectKey} AND ` : '';
  if (ticketKey) return `${projectPrefix}key = ${ticketKey}`;
  return `${projectPrefix}text ~ "${escapeJqlString(sessionId)}" ORDER BY updated DESC`;
}

async function searchIssue({ baseUrl, auth, ticketKey, sessionId }) {
  const fields = ['summary', 'status', 'comment', 'created', 'updated', 'resolution'];

  const resp = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': auth
    },
    body: JSON.stringify({
      jql: buildJql(ticketKey, sessionId),
      maxResults: 3,
      fields
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.errorMessages?.[0] || data.message || `Jira search failed (${resp.status})`);
  }
  return data.issues || [];
}

function summarizeIssue(issue) {
  const fields = issue.fields || {};
  const comments = fields.comment?.comments || [];
  const latestComment = comments.length ? comments[comments.length - 1] : null;

  return {
    key: issue.key,
    summary: fields.summary || '',
    status: fields.status?.name || '',
    resolution: fields.resolution?.name || '',
    created: fields.created || '',
    updated: fields.updated || '',
    latest_comment: latestComment ? {
      author: latestComment.author?.displayName || 'Nolan',
      created: latestComment.created || '',
      body: truncate(textFromAdf(latestComment.body), 600)
    } : null
  };
}

module.exports = async function handler(req, res) {
  if (!applyCors(req, res)) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const baseUrl = cleanBaseUrl(process.env.JIRA_BASE_URL);
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !jiraEmail || !jiraToken) {
    return res.status(500).json({ error: 'Server not configured for Jira lookup' });
  }

  try {
    const input = validateInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });

    const issues = await searchIssue({
      baseUrl,
      auth: authHeader(jiraEmail, jiraToken),
      ticketKey: input.ticketKey,
      sessionId: input.sessionId
    });

    const issue = issues[0];
    if (!issue) {
      return res.status(404).json({
        error: input.ticketKey
          ? 'I found no ticket with that key.'
          : 'I found no ticket for this chat yet.'
      });
    }

    return res.status(200).json({ ok: true, ticket: summarizeIssue(issue) });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
