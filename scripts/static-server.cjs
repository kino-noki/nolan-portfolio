const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'public');
const port = Number(process.argv[3] || 4180);
const host = '127.0.0.1';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const apiHandlers = {
  '/api/chat': path.resolve(__dirname, '..', 'api', 'chat.js'),
  '/api/forward': path.resolve(__dirname, '..', 'api', 'forward.js'),
  '/api/ticket-status': path.resolve(__dirname, '..', 'api', 'ticket-status.js')
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length
  });
  res.end(bytes);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  const handlerPath = apiHandlers[pathname];
  if (!handlerPath) return false;

  const handler = require(handlerPath);
  const body = await readBody(req);
  const headers = req.headers || {};
  const mockReq = {
    method: req.method,
    headers: {
      ...headers,
      host: headers.host || `${host}:${port}`
    },
    body
  };

  const mockRes = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      const bytes = Buffer.from(JSON.stringify(payload));
      res.writeHead(this.statusCode, {
        ...this.headers,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': bytes.length
      });
      res.end(bytes);
    },
    end(payload = '') {
      const bytes = Buffer.from(String(payload));
      res.writeHead(this.statusCode, {
        ...this.headers,
        'Content-Length': bytes.length
      });
      res.end(bytes);
    }
  };

  try {
    await handler(mockReq, mockRes);
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }), 'application/json; charset=utf-8');
  }
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (apiHandlers[url.pathname]) {
    handleApi(req, res, url.pathname);
    return;
  }

  const requested = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html';
  const full = path.resolve(root, requested);

  if (!full.startsWith(root + path.sep) && full !== root) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      send(res, 404, 'Not found');
      return;
    }
    send(res, 200, data, types[path.extname(full).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`);
});
