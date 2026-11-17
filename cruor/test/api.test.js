import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { nodeSecurity } from '../src/security.js';

// Pin "now" to 09:00 local on a Monday so slots exist regardless of when tests run.
let now = new Date('2026-11-02T09:00:00');
let server, base, db;

before(async () => {
  db = openDb(':memory:');
  await seed(db, nodeSecurity);
  server = createServer(createApp(db, { clock: () => now }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const login = async (identifier) => (await api('/api/auth/login', { method: 'POST', body: { identifier, password: DEMO_PASSWORD } })).body.token;

test('registration validates input and requires consent', async () => {
  let r = await api('/api/auth/register', { method: 'POST', body: { name: 'A', email: 'bad', password: 'longenough', consent: true } });
  assert.equal(r.status, 400);
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'A', email: 'a@b.co', password: 'longenough' } });
  assert.equal(r.status, 400);
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'A', phone: '+961 71 123 456', password: 'longenough', bloodType: 'A+', consent: true } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.phone, '+96171123456');
  r = await api('/api/auth/register', { method: 'POST', body: { name: 'B', phone: '+96171123456', password: 'longenough', consent: true } });
  assert.equal(r.status, 409, 'duplicate phone is rejected via blind index');
});

test('phone and date of birth are encrypted at rest', () => {
  const row = db.prepare(`SELECT phone_enc, dob_enc FROM users WHERE email = 'donor@cruor.test'`).get();
  assert.match(row.phone_enc, /^v1\./);
  assert.ok(!row.phone_enc.includes('96170000001'));
  assert.ok(!row.dob_enc.includes('1994'));
});

test('login works with email or phone and rejects bad passwords', async () => {
  assert.ok(await login('donor@cruor.test'));
  assert.ok(await login('+961 70 000 001'));
  const r = await api('/api/auth/login', { method: 'POST', body: { identifier: 'donor@cruor.test', password: 'nope' } });
  assert.equal(r.status, 401);
});

test('centers search, sorting by distance, and slots', async () => {
  const r = await api('/api/centers?lat=33.89&lng=35.50');
  assert.equal(r.body.centers[0].city, 'Beirut');
  assert.ok(r.body.centers.every((c, i, a) => i === 0 || a[i - 1].distanceKm <= c.distanceKm));
  const tripoli = await api('/api/centers?q=tripoli');
  assert.equal(tripoli.body.centers.length, 1);
  const slots = await api('/api/centers/1/slots?date=2026-11-02');
  assert.ok(slots.body.slots.length > 0);
  assert.ok(slots.body.slots.every((s) => new Date(s.startsAt) > now));
});

test('full journey: book → staff verifies → points → redeem and give', async () => {
  const donor = await login('donor@cruor.test');
  const staff = await login('staff@cruor.test');

  const { body: { slots } } = await api('/api/centers/1/slots?date=2026-11-02');
  const booked = await api('/api/appointments', { method: 'POST', token: donor, body: { centerId: 1, startsAt: slots[2].startsAt } });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const code = booked.body.appointment.verificationCode;

  // Only one active booking at a time.
  const again = await api('/api/appointments', { method: 'POST', token: donor, body: { centerId: 1, startsAt: slots[3].startsAt } });
  assert.equal(again.status, 409);

  // Donors cannot verify themselves.
  assert.equal((await api('/api/staff/verify', { method: 'POST', token: donor, body: { code } })).status, 403);

  const before = (await api('/api/me', { token: donor })).body.points;
  const lookup = await api('/api/staff/lookup', { method: 'POST', token: staff, body: { code: code.toLowerCase() } });
  assert.equal(lookup.body.appointment.donorName, 'Maya Haddad');

  const v = await api('/api/staff/verify', { method: 'POST', token: staff, body: { code } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal((await api('/api/me', { token: donor })).body.points, before + 100);

  // Codes are single-use: no double points.
  assert.equal((await api('/api/staff/verify', { method: 'POST', token: staff, body: { code } })).status, 409);

  const dash = (await api('/api/dashboard', { token: donor })).body;
  assert.equal(dash.history.length, 2);
  assert.ok(dash.notifications.some((n) => n.kind === 'thank_you'));
  assert.ok(dash.eligibility.nextEligibleAt, 'must wait before donating again');

  // Can't book again inside the 56-day window.
  const tooSoon = await api('/api/appointments', { method: 'POST', token: donor, body: { centerId: 1, startsAt: slots[5].startsAt } });
  assert.equal(tooSoon.status, 422);

  const rewards = (await api('/api/rewards', { token: donor })).body;
  assert.ok(!rewards.causes.some((c) => c.charity === 'Unvetted Example Org'), 'unverified charities hidden');
  const red = await api(`/api/rewards/${rewards.rewards[0].id}/redeem`, { method: 'POST', token: donor });
  assert.equal(red.status, 201);
  assert.match(red.body.voucherCode, /^CR-/);

  const blocked = await api(`/api/causes/${rewards.causes[0].id}/give`, { method: 'POST', token: donor, body: { message: 'call me +961 70 123456' } });
  assert.equal(blocked.status, 400, 'contact details are stripped from charity messages');
  const gave = await api(`/api/causes/${rewards.causes[0].id}/give`, { method: 'POST', token: donor, body: { message: 'Wishing you a joyful season.' } });
  assert.equal(gave.status, 201);

  const tooMuch = await api(`/api/rewards/${rewards.rewards.at(-1).id}/redeem`, { method: 'POST', token: donor });
  assert.equal(tooMuch.status, 422);

  // Admin moderates the message without seeing who sent it.
  const admin = await login('admin@cruor.test');
  const msgs = (await api('/api/admin/messages', { token: admin })).body.messages;
  assert.equal(msgs.length, 1);
  assert.ok(!('donorName' in msgs[0]) && !('userId' in msgs[0]));
  assert.equal((await api(`/api/admin/messages/${msgs[0].id}/moderate`, { method: 'POST', token: admin, body: { decision: 'approved' } })).status, 200);

  const metrics = (await api('/api/admin/metrics', { token: admin })).body;
  assert.equal(metrics.verifiedDonations, 2);
  assert.equal(metrics.repeatDonationRate, 100);
  assert.equal(metrics.rewardsRedeemed, 1);
  assert.equal(metrics.rewardsDonated, 1);

  const audit = (await api('/api/staff/audit', { token: staff })).body.entries;
  assert.ok(audit.some((e) => e.action === 'donation.verify'));
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /append-only/);
});

test('staff cannot verify another center, or a future-day appointment', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { name: 'Sam', email: 'sam@x.co', password: 'longenough', dob: '1990-01-01', weightKg: 70, consent: true } });
  const sam = r.body.token;
  const staff = await login('staff@cruor.test');

  const other = (await api('/api/centers/3/slots?date=2026-11-02')).body.slots[0];
  const a = await api('/api/appointments', { method: 'POST', token: sam, body: { centerId: 3, startsAt: other.startsAt } });
  assert.equal((await api('/api/staff/verify', { method: 'POST', token: staff, body: { code: a.body.appointment.verificationCode } })).status, 404);
  await api(`/api/appointments/${a.body.appointment.id}/cancel`, { method: 'POST', token: sam });

  const tomorrow = (await api('/api/centers/1/slots?date=2026-11-03')).body.slots[0];
  const b = await api('/api/appointments', { method: 'POST', token: sam, body: { centerId: 1, startsAt: tomorrow.startsAt } });
  assert.equal((await api('/api/staff/verify', { method: 'POST', token: staff, body: { code: b.body.appointment.verificationCode } })).status, 422);
});

test('booking is blocked for donors who fail the general pre-check', async () => {
  const r = await api('/api/auth/register', { method: 'POST', body: { name: 'Kid', email: 'kid@x.co', password: 'longenough', dob: '2015-01-01', weightKg: 40, consent: true } });
  const slot = (await api('/api/centers/1/slots?date=2026-11-02')).body.slots[0];
  const b = await api('/api/appointments', { method: 'POST', token: r.body.token, body: { centerId: 1, startsAt: slot.startsAt } });
  assert.equal(b.status, 422);
  assert.ok(b.body.eligibility.reasons.length >= 1);
});

test('booking outside opening hours is rejected', async () => {
  const r = await api('/api/auth/login', { method: 'POST', body: { identifier: 'sam@x.co', password: 'longenough' } });
  const odd = new Date('2026-11-02T23:00:00').toISOString();
  const res = await api('/api/appointments', { method: 'POST', token: r.body.token, body: { centerId: 2, startsAt: odd } });
  assert.ok([400, 409].includes(res.status));
});
