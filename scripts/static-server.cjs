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

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length
  });
  res.end(bytes);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
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
