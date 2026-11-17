// Node HTTP adapter: serves the web client and forwards /api/* to the core.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApi } from './core.js';
import { nodeSecurity } from './security.js';
import { HttpError, fail, readJson, send, serveStatic } from './http.js';

export { localDate } from './core.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db, { clock } = {}) {
  const api = createApi(db, { sec: nodeSecurity, clock });

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed');
        if (await serveStatic(res, PUBLIC_DIR, url.pathname)) return;
        fail(404, 'Not found');
      }
      const out = await api({
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body: await readJson(req),
        ip: req.socket.remoteAddress,
      });
      send(res, out.status, out.body);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
      console.error(err);
      send(res, 500, { error: 'Something went wrong on our side.' });
    }
  };
}
