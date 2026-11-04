// On-device backend for the Android demo build.
// Runs the same API core as the server (src/core.js) inside the app, on an SQLite
// database compiled to WebAssembly, persisted to the device's local storage.
// Exposes window.cruorLocal, which public/app.js uses instead of fetch() when present.
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { SCHEMA } from '../src/schema.js';
import { createApi } from '../src/core.js';
import { seed } from '../src/seed.js';
import { createBrowserSecurity } from './security.browser.js';
import { adapt } from './sqljs-adapter.js';

const DB_KEY = 'cruor.db.v1';
const KEYS_KEY = 'cruor.keys.v1';

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* unavailable */ } },
};

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Per-device keys for field encryption and blind indexes. */
function deviceKeys() {
  const saved = storage.get(KEYS_KEY);
  if (saved) {
    const { dataKey, indexKey } = JSON.parse(saved);
    return { dataKey: fromB64(dataKey), indexKey: fromB64(indexKey) };
  }
  const keys = { dataKey: randomBytes(32), indexKey: randomBytes(32) };
  storage.set(KEYS_KEY, JSON.stringify({ dataKey: toB64(keys.dataKey), indexKey: toB64(keys.indexKey) }));
  return keys;
}

async function boot() {
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const sec = createBrowserSecurity(deviceKeys());
  const saved = storage.get(DB_KEY);
  let raw;
  try {
    raw = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
  } catch {
    raw = new SQL.Database(); // corrupted save: start fresh rather than crash
  }
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  const db = adapt(raw);
  const persist = () => storage.set(DB_KEY, toB64(raw.export()));

  if (!db.prepare('SELECT 1 FROM centers LIMIT 1').get()) {
    await seed(db, sec);
    persist();
  }
  const api = createApi(db, { sec, demo: true });

  return async function request({ method = 'GET', url, body, token }) {
    const u = new URL(url, 'https://localhost');
    const out = await api({
      method,
      path: u.pathname,
      query: u.searchParams,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: body ?? {},
      ip: 'device',
    });
    if (method !== 'GET') persist();
    // Round-trip through JSON so the client sees exactly what the server would send.
    return { status: out.status, body: JSON.parse(JSON.stringify(out.body)) };
  };
}

const ready = boot();

window.cruorLocal = {
  async request(opts) { return (await ready)(opts); },
  /** Wipe all on-device data and start again with fresh demo data. */
  reset() {
    storage.remove(DB_KEY);
    storage.remove(KEYS_KEY);
    storage.remove('cruor.token');
    location.replace('/#/');
    location.reload();
  },
};

// Android hardware back button: go back in the app, exit at the root.
if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', () => {
    const atRoot = ['', '#/', '#/dashboard', '#/staff', '#/admin'].includes(location.hash);
    if (atRoot) App.exitApp();
    else history.back();
  });
}
