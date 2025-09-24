import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleSimulationStream } from './simulationStream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer({ port = null, host = null } = {}) {
  const resolvedPort = resolvePort(port);
  const resolvedHost = resolveHost(host);

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const method = (req.method ?? 'GET').toUpperCase();

      if (requestUrl.pathname === '/api/stream') {
        if (method === 'HEAD') {
          res.writeHead(405, {
            'Content-Type': 'text/plain; charset=utf-8',
            Allow: 'GET',
          });
          res.end('Method Not Allowed');
          return;
        }

        if (method === 'GET') {
          await handleSimulationStream(req, res, { searchParams: requestUrl.searchParams });
          return;
        }
      }

      if (method === 'GET' || method === 'HEAD') {
        await serveStatic(requestUrl.pathname, res, { isHead: method === 'HEAD' });
        return;
      }

      res.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        Allow: 'GET, HEAD',
      });
      res.end('Method Not Allowed');
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      console.error('Server request error', error);
    }
  });

  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.removeListener('listening', handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.removeListener('error', handleError);
      const address = server.address();
      let actualPort = resolvedPort;
      let actualHost = resolvedHost;
      if (address && typeof address === 'object') {
        if (typeof address.port === 'number' && address.port > 0) {
          actualPort = address.port;
        }
        if (typeof address.address === 'string' && address.address.length > 0) {
          actualHost = address.address;
        }
      } else if (typeof address === 'string' && address.length > 0) {
        actualHost = address;
      }
      resolve({ server, port: actualPort, host: actualHost });
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(resolvedPort, resolvedHost);
  });
}

async function serveStatic(requestPath, res, { isHead = false } = {}) {
  let relativePath = requestPath;
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html';
  }
  if (relativePath.startsWith('/static/')) {
    relativePath = relativePath.slice('/static'.length);
  }

  const normalized = path.normalize(relativePath).replace(/^[/\\]+/, '');
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    if (isHead) {
      res.end();
    } else {
      res.end('Forbidden');
    }
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Content-Length': data.length,
    });
    if (isHead) {
      res.end();
    } else {
      res.end(data);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      if (isHead) {
        res.end();
      } else {
        res.end('Not Found');
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      if (isHead) {
        res.end();
      } else {
        res.end('Internal Server Error');
      }
      if (error) {
        console.error('Static file error', error);
      }
    }
  }
}

function resolvePort(port) {
  if (Number.isFinite(port)) {
    return port;
  }
  const parsed = Number(port);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) {
    return envPort;
  }
  return 3000;
}

function resolveHost(host) {
  if (typeof host === 'string' && host.trim().length > 0) {
    return host.trim();
  }
  const envHost = process.env.HOST ?? process.env.BIND_HOST ?? null;
  if (typeof envHost === 'string' && envHost.trim().length > 0) {
    return envHost.trim();
  }
  return '0.0.0.0';
}
