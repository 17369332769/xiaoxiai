// Zero-dependency preview server for the H5 production build.
// Serves multiend/dist/ (SPA fallback to index.html) and reverse-proxies /api/*
// to the local backend, so the built H5 app runs same-origin with no CORS —
// the simplest way to verify the H5 end without Taro's HMR dev server.
//
//   npm run build:h5 && node serve.cjs      # then open http://localhost:10086
//
// Backend target + port are overridable: API_TARGET=host:port PORT=8080 node serve.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 10086;
const [API_HOST, API_PORT] = (process.env.API_TARGET || 'localhost:3000').split(':');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  // Reverse-proxy the API so the H5 app stays same-origin.
  if (req.url.startsWith('/api')) {
    // Drop the browser's Origin/Referer (and Host) before forwarding: this is a
    // server-to-server hop where CORS doesn't apply, and the backend's CORS
    // allowlist only knows the web dev origin — keeping a LAN-IP Origin would
    // make it 403 every visitor who opens the preview by IP.
    const headers = { ...req.headers };
    delete headers.origin;
    delete headers.referer;
    delete headers.host;
    const proxyReq = http.request(
      { host: API_HOST, port: Number(API_PORT), path: req.url, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => { res.writeHead(502); res.end('backend unreachable'); });
    req.pipe(proxyReq);
    return;
  }

  // Static file with SPA fallback to index.html.
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(DIST, urlPath);
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404); res.end('build not found — run `npm run build:h5` first'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`H5 preview: http://localhost:${PORT}   (/api -> ${API_HOST}:${API_PORT})`);
});
