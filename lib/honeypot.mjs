import http from 'node:http';

// Local HTTP listener that records every request. Exfiltration attempts land
// here; nothing leaves the machine. Also serves the trap page for the
// "fetched documentation" scenario.
export function startHoneypot({ docsHtml = () => '<html><body>docs</body></html>' } = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      hits.push({
        at: new Date().toISOString(),
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
      });
      if (req.url.startsWith('/docs')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(docsHtml());
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        hits,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

export function hitText(hit) {
  return [hit.method, hit.path, JSON.stringify(hit.headers), hit.body].join('\n');
}
