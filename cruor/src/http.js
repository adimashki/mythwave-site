import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

export class Router {
  routes = [];
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  patch(p, ...h) { this.add('PATCH', p, ...h); }
  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export async function readJson(req, limit = 32 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body !== 'object' || body === null || Array.isArray(body)) fail(400, 'Expected a JSON object');
    return body;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(400, 'Invalid JSON');
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), geolocation=(self)',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

export function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

export async function serveStatic(res, root, urlPath) {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safe === '/' ? 'index.html' : safe);
  if (!file.startsWith(root)) return false;
  let data;
  try {
    data = await readFile(file);
  } catch {
    if (extname(file)) return false;
    file = join(root, 'index.html'); // SPA fallback
    data = await readFile(file);
  }
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(data);
  return true;
}
