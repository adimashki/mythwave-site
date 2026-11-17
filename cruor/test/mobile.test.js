// Runs the API core on the same stack as the Android app: sql.js (WASM SQLite) + pure-JS crypto.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { SCHEMA } from '../src/schema.js';
import { createApi } from '../src/core.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { adapt } from '../mobile/sqljs-adapter.js';
import { createBrowserSecurity } from '../mobile/security.browser.js';

let now = new Date('2026-11-02T09:00:00');
let call, raw, sec;

before(async () => {
  const SQL = await initSqlJs();
  raw = new SQL.Database();
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  const db = adapt(raw);
  sec = createBrowserSecurity({ dataKey: randomBytes(32), indexKey: randomBytes(32) });
  await seed(db, sec);
  const api = createApi(db, { sec, clock: () => now, demo: true });
  call = async (method, url, body, token) => {
    const u = new URL(url, 'https://localhost');
    return api({ method, path: u.pathname, query: u.searchParams, body: body ?? {}, headers: token ? { authorization: `Bearer ${token}` } : {} });
  };
});

const login = async (who) => (await call('POST', '/api/auth/login', { identifier: `${who}@cruor.test`, password: DEMO_PASSWORD })).body.token;

test('browser crypto: encryption round-trips and passwords verify', async () => {
  const blob = sec.encrypt('+96170000001');
  assert.match(blob, /^v1\./);
  assert.equal(sec.decrypt(blob), '+96170000001');
  const h = await sec.hashPassword('correct horse');
  assert.ok(await sec.verifyPassword('correct horse', h));
  assert.ok(!(await sec.verifyPassword('wrong', h)));
  assert.equal(sec.blindIndex('x'), sec.blindIndex('x'));
});

test('demo journey on device: book tomorrow, verify today, points, give, persist', async () => {
  const donor = await login('donor');
  const staff = await login('staff');
  const { body: { slots } } = await call('GET', '/api/centers/1/slots?date=2026-11-03');
  const booked = await call('POST', '/api/appointments', { centerId: 1, startsAt: slots[0].startsAt }, donor);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));

  // Demo build allows verifying ahead of the appointment day.
  const v = await call('POST', '/api/staff/verify', { code: booked.body.appointment.verificationCode }, staff);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await call('GET', '/api/me', null, donor)).body.points, 200);
  assert.equal((await call('POST', '/api/staff/verify', { code: booked.body.appointment.verificationCode }, staff)).status, 409);

  const { body: { causes } } = await call('GET', '/api/rewards', null, donor);
  assert.equal((await call('POST', `/api/causes/${causes[0].id}/give`, { message: 'Warm wishes.' }, donor)).status, 201);

  // Export/import (what the app does on every write) keeps everything.
  const SQL = await initSqlJs();
  const reopened = adapt(new SQL.Database(raw.export()));
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM donations').get().n, 2);
  assert.throws(() => reopened.prepare('DELETE FROM audit_log').run(), /append-only/);
});

test('the real server never allows early verification', async () => {
  const SQL = await initSqlJs();
  const r = new SQL.Database();
  r.exec(SCHEMA);
  const db = adapt(r);
  await seed(db, sec);
  const api = createApi(db, { sec, clock: () => now }); // demo defaults to false
  const go = (method, url, body, token) => api({ method, path: url.split('?')[0], query: new URLSearchParams(url.split('?')[1]), body: body ?? {}, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const tok = async (who) => (await go('POST', '/api/auth/login', { identifier: `${who}@cruor.test`, password: DEMO_PASSWORD })).body.token;
  const donor = await tok('donor');
  const { body: { slots } } = await go('GET', '/api/centers/1/slots?date=2026-11-03');
  const b = await go('POST', '/api/appointments', { centerId: 1, startsAt: slots[0].startsAt }, donor);
  const v = await go('POST', '/api/staff/verify', { code: b.body.appointment.verificationCode }, await tok('staff'));
  assert.equal(v.status, 422);
});
