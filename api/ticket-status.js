const MAX_SESSION_ID_CHARS = 120;
const TICKET_KEY_RE = /^(NAI|REC)-\d+$/;

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

function escapeJqlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function authHeader(email, token) {
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

function validateInput(body) {
  const rawTicketKey = String(body.ticket_key || '').trim().toUpperCase();
  const compactKey = rawTicketKey.match(/^(NAI|REC)(\d+)$/);
  const ticketKey = compactKey ? `${compactKey[1]}-${compactKey[2]}` : rawTicketKey;
  const sessionId = String(body.session_id || '').trim();

  if (ticketKey && !TICKET_KEY_RE.test(ticketKey)) return { error: 'ticket_key must look like NAI-123 or REC-123' };
  if (!ticketKey && (!sessionId || sessionId.length > MAX_SESSION_ID_CHARS)) {
    return { error: 'ticket_key or session_id is required' };
  }

  return { ticketKey, sessionId };
}

function buildJql(sessionId) {
  const projectKey = String(process.env.JIRA_PROJECT_KEY || '').trim().toUpperCase();
  const projectPrefix = projectKey ? `project = ${projectKey} AND ` : '';
  return `${projectPrefix}text ~ "${escapeJqlString(sessionId)}" ORDER BY updated DESC`;
}

function issueFields() {
  return ['summary', 'status', 'created', 'updated', 'resolution', 'project', 'issuetype'];
}

async function getIssueByKey({ baseUrl, auth, ticketKey }) {
  const resp = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(ticketKey)}?fields=${issueFields().join(',')}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': auth
    }
  });

  const data = await resp.json().catch(() => ({}));
  if (resp.status === 404) {
    const err = new Error(`Jira returned 404 for ${ticketKey}. Check JIRA_BASE_URL and whether the API token account can browse this project.`);
    err.statusCode = 404;
    throw err;
  }
  if (!resp.ok) {
    throw new Error(data.errorMessages?.[0] || data.message || `Jira issue lookup failed (${resp.status})`);
  }
  return data;
}

async function searchIssueBySession({ baseUrl, auth, sessionId }) {
  const fields = issueFields();

  const resp = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': auth
    },
    body: JSON.stringify({
      jql: buildJql(sessionId),
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

  return {
    key: issue.key,
    project_key: fields.project?.key || '',
    issue_type: fields.issuetype?.name || '',
    summary: fields.summary || '',
    status: fields.status?.name || '',
    resolution: fields.resolution?.name || '',
    created: fields.created || '',
    updated: fields.updated || ''
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

    const auth = authHeader(jiraEmail, jiraToken);
    const issue = input.ticketKey
      ? await getIssueByKey({ baseUrl, auth, ticketKey: input.ticketKey })
      : (await searchIssueBySession({ baseUrl, auth, sessionId: input.sessionId }))[0];

    if (!issue) {
      return res.status(404).json({
        error: input.ticketKey
          ? 'I found no ticket with that key.'
          : 'I found no ticket for this chat yet.'
      });
    }

    return res.status(200).json({ ok: true, ticket: summarizeIssue(issue) });
  } catch (e) {
    return res.status(e.statusCode || 502).json({ error: e.message });
  }
};
