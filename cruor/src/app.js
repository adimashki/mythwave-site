import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { tx } from './db.js';
import { Router, HttpError, fail, readJson, send, serveStatic } from './http.js';
import {
  blindIndex, decrypt, encrypt, hashPassword, newToken, normalizeCode, normalizeEmail,
  normalizePhone, randomCode, sha256, verifyPassword,
} from './security.js';
import { BLOOD_TYPES, distanceKm, eligibility, hoursFor, isSameLocalDay, isWithinHours, slotsFor } from './domain.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * Build the request handler. `clock` is injectable so tests can pin "now".
 */
export function createApp(db, { clock = () => new Date() } = {}) {
  const r = new Router();
  const q = (sql) => db.prepare(sql);
  const nowIso = () => clock().toISOString();

  // ---------- helpers ----------
  const audit = (ctx, action, entity, entityId, details = {}, centerId = null) =>
    q(`INSERT INTO audit_log (actor_id, action, entity, entity_id, center_id, details, ip, created_at)
       VALUES (?,?,?,?,?,?,?,?)`).run(ctx.user?.id ?? null, action, entity, entityId ?? null, centerId,
      JSON.stringify(details), ctx.ip, nowIso());

  const balanceOf = (userId) => q('SELECT COALESCE(SUM(delta),0) AS b FROM points_ledger WHERE user_id = ?').get(userId).b;

  const notify = (userId, kind, title, body) =>
    q('INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?,?,?,?,?)').run(userId, kind, title, body, nowIso());

  const profileOf = (u) => {
    const dob = decrypt(u.dob_enc);
    return {
      id: u.id, role: u.role, name: u.name, email: u.email, phone: decrypt(u.phone_enc),
      bloodType: u.blood_type, city: u.city, lat: u.lat, lng: u.lng, dob, weightKg: u.weight_kg,
      lastDonationAt: u.last_donation_at, centerId: u.center_id, remindersOptIn: !!u.reminders_opt_in,
    };
  };

  const eligibilityOf = (u) => eligibility({ dob: decrypt(u.dob_enc), weight_kg: u.weight_kg, last_donation_at: u.last_donation_at }, clock());

  const centerView = (c, from) => ({
    id: c.id, name: c.name, kind: c.kind, address: c.address, city: c.city, lat: c.lat, lng: c.lng, phone: c.phone,
    hours: JSON.parse(c.hours_json), distanceKm: from ? distanceKm(from, c) : null,
    openToday: hoursFor(c, localDate(clock())),
  });

  const apptView = (a) => ({
    id: a.id, centerId: a.center_id, centerName: a.center_name, centerAddress: a.center_address,
    startsAt: a.starts_at, status: a.status, verificationCode: a.verification_code,
  });

  const LIMITS = new Map();
  const rateLimit = (key, max, windowMs) => {
    const now = Date.now();
    const hits = (LIMITS.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) fail(429, 'Too many attempts. Please wait a few minutes and try again.');
    hits.push(now);
    LIMITS.set(key, hits);
  };

  const str = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const dateOnly = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

  // ---------- middleware ----------
  const auth = (ctx) => {
    const header = ctx.req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) fail(401, 'Please sign in.');
    const row = q(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), nowIso());
    if (!row) fail(401, 'Your session has expired. Please sign in again.');
    ctx.user = row;
    ctx.tokenHash = sha256(token);
  };
  const role = (...roles) => (ctx) => {
    if (!roles.includes(ctx.user.role)) fail(403, 'You do not have permission to do that.');
  };

  const startSession = (userId) => {
    const token = newToken();
    q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)')
      .run(sha256(token), userId, new Date(clock().getTime() + config.sessionTtlMs).toISOString());
    return token;
  };

  // ---------- meta ----------
  r.get('/api/meta', () => ({
    bloodTypes: BLOOD_TYPES,
    pointsPerDonation: config.pointsPerDonation,
    eligibility: config.eligibility,
  }));

  // ---------- auth ----------
  r.post('/api/auth/register', async (ctx) => {
    const b = ctx.body;
    rateLimit(`register:${ctx.ip}`, 20, 60 * 60_000);
    const name = str(b.name, 80);
    const email = normalizeEmail(b.email);
    const phone = normalizePhone(b.phone);
    const password = String(b.password || '');
    if (!name) fail(400, 'Please tell us your name.');
    if (!email && !phone) fail(400, 'Register with a valid email or phone number.');
    if (b.email && !email) fail(400, 'That email address does not look right.');
    if (b.phone && !phone) fail(400, 'That phone number does not look right.');
    if (password.length < 8) fail(400, 'Passwords need at least 8 characters.');
    if (b.bloodType && !BLOOD_TYPES.includes(b.bloodType)) fail(400, 'Unknown blood type.');
    if (b.consent !== true) fail(400, 'Please accept the privacy notice to continue.');

    if (email && q('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'An account with that email already exists.');
    if (phone && q('SELECT 1 FROM users WHERE phone_idx = ?').get(blindIndex(phone))) fail(409, 'An account with that phone number already exists.');

    const hash = await hashPassword(password);
    const { lastInsertRowid: id } = q(`INSERT INTO users
      (role, name, email, phone_enc, phone_idx, password_hash, blood_type, city, lat, lng, dob_enc, weight_kg, last_donation_at, created_at)
      VALUES ('donor',?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      name, email, encrypt(phone), blindIndex(phone), hash, b.bloodType || null, str(b.city, 80),
      num(b.lat), num(b.lng), encrypt(dateOnly(b.dob)), num(b.weightKg),
      dateOnly(b.lastDonationAt) ? new Date(`${b.lastDonationAt}T12:00:00`).toISOString() : null, nowIso());
    notify(id, 'welcome', 'Welcome to Cruor', 'One act of generosity can create another. Find a center near you to book your first donation.');
    ctx.user = { id };
    audit(ctx, 'user.register', 'user', Number(id));
    return [201, { token: startSession(id), user: profileOf(q('SELECT * FROM users WHERE id = ?').get(id)) }];
  });

  r.post('/api/auth/login', async (ctx) => {
    const identifier = String(ctx.body.identifier || '').trim();
    rateLimit(`login:${ctx.ip}:${identifier.toLowerCase()}`, 10, 15 * 60_000);
    const email = normalizeEmail(identifier);
    const user = email
      ? q('SELECT * FROM users WHERE email = ?').get(email)
      : q('SELECT * FROM users WHERE phone_idx = ?').get(blindIndex(normalizePhone(identifier)));
    const ok = user && (await verifyPassword(String(ctx.body.password || ''), user.password_hash));
    if (!ok) fail(401, 'Those details do not match an account.');
    return { token: startSession(user.id), user: profileOf(user) };
  });

  r.post('/api/auth/logout', auth, (ctx) => {
    q('DELETE FROM sessions WHERE token_hash = ?').run(ctx.tokenHash);
    return { ok: true };
  });

  // ---------- profile ----------
  r.get('/api/me', auth, (ctx) => ({
    user: profileOf(ctx.user), eligibility: eligibilityOf(ctx.user), points: balanceOf(ctx.user.id),
  }));

  r.patch('/api/me', auth, (ctx) => {
    const b = ctx.body;
    const u = ctx.user;
    if (b.bloodType !== undefined && b.bloodType !== null && !BLOOD_TYPES.includes(b.bloodType)) fail(400, 'Unknown blood type.');
    const has = (k) => Object.hasOwn(b, k);
    q(`UPDATE users SET name=?, blood_type=?, city=?, lat=?, lng=?, dob_enc=?, weight_kg=?, reminders_opt_in=? WHERE id=?`).run(
      has('name') ? (str(b.name, 80) || u.name) : u.name,
      has('bloodType') ? b.bloodType : u.blood_type,
      has('city') ? str(b.city, 80) : u.city,
      has('lat') ? num(b.lat) : u.lat,
      has('lng') ? num(b.lng) : u.lng,
      has('dob') ? encrypt(dateOnly(b.dob)) : u.dob_enc,
      has('weightKg') ? num(b.weightKg) : u.weight_kg,
      has('remindersOptIn') ? (b.remindersOptIn ? 1 : 0) : u.reminders_opt_in,
      u.id);
    const fresh = q('SELECT * FROM users WHERE id = ?').get(u.id);
    return { user: profileOf(fresh), eligibility: eligibilityOf(fresh) };
  });

  // ---------- dashboard ----------
  r.get('/api/dashboard', auth, (ctx) => {
    const u = ctx.user;
    const now = clock();
    const upcoming = q(`SELECT a.*, c.name center_name, c.address center_address FROM appointments a
      JOIN centers c ON c.id = a.center_id WHERE a.user_id = ? AND a.status = 'booked' ORDER BY a.starts_at`).all(u.id).map(apptView);
    const history = q(`SELECT d.id, d.verified_at, d.points_awarded, c.name center_name FROM donations d
      JOIN centers c ON c.id = d.center_id WHERE d.user_id = ? ORDER BY d.verified_at DESC`).all(u.id)
      .map((d) => ({ id: d.id, verifiedAt: d.verified_at, points: d.points_awarded, centerName: d.center_name }));
    const ledger = q('SELECT delta, reason, created_at FROM points_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id)
      .map((l) => ({ delta: l.delta, reason: l.reason, at: l.created_at }));
    const notifications = q('SELECT id, kind, title, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(u.id)
      .map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, read: !!n.read_at, at: n.created_at }));
    const elig = eligibilityOf(u);

    // Reminders are computed, so they are always current.
    const reminders = [];
    if (u.reminders_opt_in) {
      for (const a of upcoming) {
        const hours = (new Date(a.startsAt) - now) / 3_600_000;
        if (hours >= 0 && hours <= 48) {
          reminders.push({ kind: 'appointment', text: `Your donation at ${a.centerName} is ${hours < 24 ? 'within 24 hours' : 'in under 2 days'}. Eat well, drink water and bring ID.` });
        } else if (hours < 0) {
          reminders.push({ kind: 'appointment', text: `Your appointment at ${a.centerName} has passed. If you donated, ask staff to verify it; otherwise cancel and rebook.` });
        }
      }
      if (!upcoming.length && elig.eligible && u.last_donation_at) reminders.push({ kind: 'eligible', text: 'You are eligible to donate again. Book a slot and keep the streak alive.' });
      if (!upcoming.length && elig.nextEligibleAt) reminders.push({ kind: 'wait', text: `You can donate again from ${elig.nextEligibleAt.slice(0, 10)}.` });
      if (elig.missing.length) reminders.push({ kind: 'profile', text: `Add your ${elig.missing.join(' and ')} so we can pre-check eligibility.` });
      if (!u.blood_type) reminders.push({ kind: 'profile', text: 'Add your blood type if you know it — staff will confirm it at your first donation.' });
    }

    return {
      user: profileOf(u), points: balanceOf(u.id), eligibility: elig, upcoming, history, ledger, notifications, reminders,
      stats: { donations: history.length, estimatedLivesHelped: history.length * 3 },
    };
  });

  r.post('/api/notifications/:id/read', auth, (ctx) => {
    q('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(nowIso(), Number(ctx.params.id), ctx.user.id);
    return { ok: true };
  });

  // ---------- centers ----------
  r.get('/api/centers', (ctx) => {
    const s = ctx.query;
    const from = num(s.get('lat')) != null && num(s.get('lng')) != null ? { lat: num(s.get('lat')), lng: num(s.get('lng')) } : null;
    const term = `%${(s.get('q') || '').trim().toLowerCase()}%`;
    const list = q(`SELECT * FROM centers WHERE verified = 1 AND (lower(name) LIKE ? OR lower(city) LIKE ? OR lower(address) LIKE ?)`)
      .all(term, term, term).map((c) => centerView(c, from));
    list.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.name.localeCompare(b.name));
    return { centers: list };
  });

  const getCenter = (id) => q('SELECT * FROM centers WHERE id = ? AND verified = 1').get(Number(id)) || fail(404, 'Center not found.');

  r.get('/api/centers/:id', (ctx) => ({ center: centerView(getCenter(ctx.params.id)) }));

  r.get('/api/centers/:id/slots', (ctx) => {
    const center = getCenter(ctx.params.id);
    const date = dateOnly(ctx.query.get('date')) || localDate(clock());
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const counts = new Map(q(`SELECT starts_at, COUNT(*) n FROM appointments WHERE center_id = ? AND status IN ('booked','completed')
      AND starts_at >= ? AND starts_at < ? GROUP BY starts_at`).all(center.id, dayStart.toISOString(), dayEnd.toISOString()).map((x) => [x.starts_at, x.n]));
    return { date, open: hoursFor(center, date), slots: slotsFor(center, date, counts, clock()) };
  });

  // ---------- appointments ----------
  r.post('/api/appointments', auth, role('donor'), (ctx) => {
    const u = ctx.user;
    const center = getCenter(ctx.body.centerId);
    const startsAt = new Date(ctx.body.startsAt || '');
    if (Number.isNaN(startsAt.getTime())) fail(400, 'Pick a time slot.');
    if (startsAt <= clock()) fail(400, 'That slot is in the past.');
    if (!isWithinHours(center, startsAt.toISOString())) fail(400, 'That center is not taking donations at that time.');

    const elig = eligibilityOf(u);
    if (elig.reasons.length) fail(422, elig.reasons[0], { eligibility: elig });
    if (elig.nextEligibleAt && new Date(elig.nextEligibleAt) > startsAt) {
      fail(422, `You can donate again from ${elig.nextEligibleAt.slice(0, 10)}. Please pick a later date.`, { eligibility: elig });
    }

    return tx(db, () => {
      if (q(`SELECT 1 FROM appointments WHERE user_id = ? AND status = 'booked'`).get(u.id)) {
        fail(409, 'You already have an upcoming appointment. Cancel it first to rebook.');
      }
      const taken = q(`SELECT COUNT(*) n FROM appointments WHERE center_id = ? AND starts_at = ? AND status IN ('booked','completed')`)
        .get(center.id, startsAt.toISOString()).n;
      if (taken >= config.slotCapacity) fail(409, 'That slot just filled up. Please choose another.');
      let code;
      do code = randomCode(8); while (q('SELECT 1 FROM appointments WHERE verification_code = ?').get(code));
      const { lastInsertRowid: id } = q(`INSERT INTO appointments (user_id, center_id, starts_at, verification_code, created_at)
        VALUES (?,?,?,?,?)`).run(u.id, center.id, startsAt.toISOString(), code, nowIso());
      audit(ctx, 'appointment.book', 'appointment', Number(id), {}, center.id);
      return [201, { appointment: apptView(loadAppt(id)), eligibility: elig }];
    });
  });

  const loadAppt = (id) => q(`SELECT a.*, c.name center_name, c.address center_address FROM appointments a
    JOIN centers c ON c.id = a.center_id WHERE a.id = ?`).get(Number(id));

  r.get('/api/appointments/:id', auth, (ctx) => {
    const a = loadAppt(ctx.params.id);
    if (!a || a.user_id !== ctx.user.id) fail(404, 'Appointment not found.');
    return { appointment: apptView(a) };
  });

  r.post('/api/appointments/:id/cancel', auth, (ctx) => {
    const a = loadAppt(ctx.params.id);
    if (!a || a.user_id !== ctx.user.id) fail(404, 'Appointment not found.');
    if (a.status !== 'booked') fail(409, 'Only upcoming appointments can be cancelled.');
    q(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`).run(a.id);
    audit(ctx, 'appointment.cancel', 'appointment', a.id, {}, a.center_id);
    return { appointment: apptView(loadAppt(a.id)) };
  });

  // ---------- rewards ----------
  r.get('/api/rewards', auth, (ctx) => {
    const rewards = q(`SELECT r.*, s.name sponsor FROM rewards r JOIN sponsors s ON s.id = r.sponsor_id WHERE r.active = 1 ORDER BY r.cost_points`).all()
      .map((x) => ({ id: x.id, title: x.title, description: x.description, cost: x.cost_points, sponsor: x.sponsor, inStock: x.stock > 0 }));
    const causes = q(`SELECT c.*, ch.name charity FROM causes c JOIN charities ch ON ch.id = c.charity_id
      WHERE c.active = 1 AND ch.verified = 1 ORDER BY c.cost_points`).all()
      .map((x) => ({ id: x.id, kind: x.kind, title: x.title, description: x.description, cost: x.cost_points, charity: x.charity }));
    const redemptions = q(`SELECT x.voucher_code, x.points, x.created_at, r.title FROM redemptions x JOIN rewards r ON r.id = x.reward_id
      WHERE x.user_id = ? ORDER BY x.id DESC`).all(ctx.user.id)
      .map((x) => ({ title: x.title, voucherCode: x.voucher_code, points: x.points, at: x.created_at }));
    const gifts = q(`SELECT g.points, g.message, g.message_status, g.created_at, c.title, ch.name charity FROM charity_gifts g
      JOIN causes c ON c.id = g.cause_id JOIN charities ch ON ch.id = c.charity_id WHERE g.user_id = ? ORDER BY g.id DESC`).all(ctx.user.id)
      .map((x) => ({ title: x.title, charity: x.charity, points: x.points, message: x.message, messageStatus: x.message_status, at: x.created_at }));
    return { points: balanceOf(ctx.user.id), rewards, causes, redemptions, gifts };
  });

  r.post('/api/rewards/:id/redeem', auth, role('donor'), (ctx) => tx(db, () => {
    const reward = q('SELECT * FROM rewards WHERE id = ? AND active = 1').get(Number(ctx.params.id)) || fail(404, 'Reward not found.');
    if (reward.stock <= 0) fail(409, 'That reward is out of stock right now.');
    if (balanceOf(ctx.user.id) < reward.cost_points) fail(422, 'Not enough points yet.');
    let code;
    do code = `CR-${randomCode(10)}`; while (q('SELECT 1 FROM redemptions WHERE voucher_code = ?').get(code));
    const { lastInsertRowid: id } = q('INSERT INTO redemptions (user_id, reward_id, points, voucher_code, created_at) VALUES (?,?,?,?,?)')
      .run(ctx.user.id, reward.id, reward.cost_points, code, nowIso());
    q('UPDATE rewards SET stock = stock - 1 WHERE id = ?').run(reward.id);
    q('INSERT INTO points_ledger (user_id, delta, reason, ref_id, created_at) VALUES (?,?,?,?,?)').run(ctx.user.id, -reward.cost_points, 'redemption', id, nowIso());
    audit(ctx, 'reward.redeem', 'redemption', Number(id), { rewardId: reward.id, points: reward.cost_points });
    return [201, { voucherCode: code, points: balanceOf(ctx.user.id) }];
  }));

  r.post('/api/causes/:id/give', auth, role('donor'), (ctx) => tx(db, () => {
    const cause = q(`SELECT c.*, ch.name charity FROM causes c JOIN charities ch ON ch.id = c.charity_id
      WHERE c.id = ? AND c.active = 1 AND ch.verified = 1`).get(Number(ctx.params.id)) || fail(404, 'Cause not found.');
    if (balanceOf(ctx.user.id) < cause.cost_points) fail(422, 'Not enough points yet.');
    const message = str(ctx.body.message, 280);
    if (message && /(https?:\/\/|www\.|@\w|\+?\d[\d\s-]{6,})/i.test(message)) {
      fail(400, 'Messages cannot include links, handles or phone numbers. Kind words only.');
    }
    const { lastInsertRowid: id } = q(`INSERT INTO charity_gifts (user_id, cause_id, points, message, message_status, created_at)
      VALUES (?,?,?,?,?,?)`).run(ctx.user.id, cause.id, cause.cost_points, message, message ? 'pending' : null, nowIso());
    q('INSERT INTO points_ledger (user_id, delta, reason, ref_id, created_at) VALUES (?,?,?,?,?)').run(ctx.user.id, -cause.cost_points, 'charity_gift', id, nowIso());
    audit(ctx, 'charity.give', 'charity_gift', Number(id), { causeId: cause.id, points: cause.cost_points, hasMessage: !!message });
    notify(ctx.user.id, 'gift', 'Thank you for giving it forward', `${cause.charity} will fulfil "${cause.title}".${message ? ' Your message will be reviewed and delivered by the charity.' : ''}`);
    return [201, { points: balanceOf(ctx.user.id) }];
  }));

  // ---------- staff portal ----------
  const findByCode = (ctx) => {
    const code = normalizeCode(ctx.body.code);
    if (!code) fail(400, 'Enter or scan a verification code.');
    const a = q(`SELECT a.*, u.name donor_name, u.blood_type donor_blood_type, u.dob_enc FROM appointments a
      JOIN users u ON u.id = a.user_id WHERE a.verification_code = ?`).get(code);
    // Same response for "no such code" and "another center's code" so codes can't be probed.
    if (!a || a.center_id !== ctx.user.center_id) {
      audit(ctx, 'verify.not_found', 'appointment', a?.id, { code: code.slice(0, 2) + '…' }, ctx.user.center_id);
      fail(404, 'No appointment at this center matches that code.');
    }
    return a;
  };
  const staffApptView = (a) => {
    const dob = decrypt(a.dob_enc);
    return {
      id: a.id, startsAt: a.starts_at, status: a.status, donorName: a.donor_name,
      donorBloodType: a.donor_blood_type, donorAge: dob ? eligibility({ dob }, clock()).age : null,
    };
  };

  r.post('/api/staff/lookup', auth, role('staff'), (ctx) => ({ appointment: staffApptView(findByCode(ctx)) }));

  r.post('/api/staff/verify', auth, role('staff'), (ctx) => tx(db, () => {
    const a = findByCode(ctx);
    if (a.status === 'completed') fail(409, 'This donation has already been verified.');
    if (a.status !== 'booked') fail(409, `This appointment is ${a.status} and cannot be verified.`);
    if (!isSameLocalDay(a.starts_at, clock())) fail(422, 'Donations can only be verified on the day of the appointment.');

    const points = config.pointsPerDonation;
    const at = nowIso();
    q(`UPDATE appointments SET status = 'completed' WHERE id = ?`).run(a.id);
    const { lastInsertRowid: donationId } = q(`INSERT INTO donations (appointment_id, user_id, center_id, verified_by, verified_at, points_awarded)
      VALUES (?,?,?,?,?,?)`).run(a.id, a.user_id, a.center_id, ctx.user.id, at, points);
    q('INSERT INTO points_ledger (user_id, delta, reason, ref_id, created_at) VALUES (?,?,?,?,?)').run(a.user_id, points, 'donation', donationId, at);
    q('UPDATE users SET last_donation_at = ? WHERE id = ?').run(at, a.user_id);
    const center = q('SELECT name, thank_you FROM centers WHERE id = ?').get(a.center_id);
    notify(a.user_id, 'thank_you', `Thank you from ${center.name}`,
      center.thank_you || 'Your donation has been verified. Every donation can help up to three patients.');
    notify(a.user_id, 'points', `+${points} points`, 'Sponsor-funded appreciation points are in your wallet. Redeem them, give them to a verified cause, or save them.');
    audit(ctx, 'donation.verify', 'donation', Number(donationId), { appointmentId: a.id, donorId: a.user_id, points }, a.center_id);
    return { verified: true, points, appointment: staffApptView({ ...a, status: 'completed' }) };
  }));

  r.post('/api/staff/defer', auth, role('staff'), (ctx) => {
    const a = findByCode(ctx);
    if (a.status !== 'booked') fail(409, `This appointment is ${a.status}.`);
    q(`UPDATE appointments SET status = 'deferred' WHERE id = ?`).run(a.id);
    // The reason stays internal and coarse: no medical detail is stored here.
    audit(ctx, 'donation.defer', 'appointment', a.id, { donorId: a.user_id }, a.center_id);
    notify(a.user_id, 'deferred', 'Thank you for coming in',
      'Today was not the right day to donate, and that is completely okay. Staff will have explained when you can try again.');
    return { deferred: true };
  });

  r.get('/api/staff/today', auth, role('staff'), (ctx) => {
    const today = localDate(clock());
    const center = q('SELECT * FROM centers WHERE id = ?').get(ctx.user.center_id);
    const rows = q(`SELECT a.*, u.name donor_name, u.blood_type donor_blood_type, u.dob_enc FROM appointments a
      JOIN users u ON u.id = a.user_id WHERE a.center_id = ? AND a.status != 'cancelled' ORDER BY a.starts_at`).all(ctx.user.center_id)
      .filter((a) => localDate(new Date(a.starts_at)) === today).map(staffApptView);
    return { center: center && centerView(center), appointments: rows };
  });

  r.get('/api/staff/audit', auth, role('staff', 'admin'), (ctx) => {
    const rows = ctx.user.role === 'admin'
      ? q(`SELECT l.*, u.name actor FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 100`).all()
      : q(`SELECT l.*, u.name actor FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.center_id = ? ORDER BY l.id DESC LIMIT 100`).all(ctx.user.center_id);
    return { entries: rows.map((l) => ({ id: l.id, at: l.created_at, actor: l.actor, action: l.action, entity: l.entity, entityId: l.entity_id, details: JSON.parse(l.details || '{}') })) };
  });

  // ---------- admin ----------
  r.get('/api/admin/metrics', auth, role('admin'), () => {
    const one = (sql) => q(sql).get().n;
    const donors = one(`SELECT COUNT(*) n FROM users WHERE role = 'donor'`);
    const donated = one(`SELECT COUNT(DISTINCT user_id) n FROM donations`);
    const repeat = one(`SELECT COUNT(*) n FROM (SELECT user_id FROM donations GROUP BY user_id HAVING COUNT(*) > 1)`);
    return {
      registeredDonors: donors,
      activeDonors30d: q(`SELECT COUNT(DISTINCT user_id) n FROM donations WHERE verified_at >= ?`).get(new Date(clock() - 30 * 86_400_000).toISOString()).n,
      verifiedDonations: one('SELECT COUNT(*) n FROM donations'),
      repeatDonationRate: donated ? Math.round((repeat / donated) * 100) : 0,
      bloodBanksOnboarded: one('SELECT COUNT(*) n FROM centers WHERE verified = 1'),
      sponsors: one('SELECT COUNT(*) n FROM sponsors'),
      rewardsRedeemed: one('SELECT COUNT(*) n FROM redemptions'),
      rewardsDonated: one('SELECT COUNT(*) n FROM charity_gifts'),
      pendingMessages: one(`SELECT COUNT(*) n FROM charity_gifts WHERE message_status = 'pending'`),
    };
  });

  r.get('/api/admin/messages', auth, role('admin'), () => ({
    messages: q(`SELECT g.id, g.message, g.created_at, c.title, ch.name charity FROM charity_gifts g JOIN causes c ON c.id = g.cause_id
      JOIN charities ch ON ch.id = c.charity_id WHERE g.message_status = 'pending' ORDER BY g.id`).all()
      .map((m) => ({ id: m.id, message: m.message, cause: m.title, charity: m.charity, at: m.created_at })), // donor identity deliberately omitted
  }));

  r.post('/api/admin/messages/:id/moderate', auth, role('admin'), (ctx) => {
    const decision = ctx.body.decision;
    if (!['approved', 'rejected'].includes(decision)) fail(400, 'Decision must be approved or rejected.');
    const { changes } = q(`UPDATE charity_gifts SET message_status = ? WHERE id = ? AND message_status = 'pending'`).run(decision, Number(ctx.params.id));
    if (!changes) fail(404, 'No pending message with that id.');
    audit(ctx, `message.${decision}`, 'charity_gift', Number(ctx.params.id));
    return { ok: true };
  });

  // ---------- dispatcher ----------
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const ctx = { req, res, query: url.searchParams, ip: req.socket.remoteAddress, params: {}, body: {} };
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed');
        if (await serveStatic(res, PUBLIC_DIR, url.pathname)) return;
        fail(404, 'Not found');
      }
      const m = r.match(req.method, url.pathname);
      if (!m) fail(404, 'Not found');
      ctx.params = m.params;
      ctx.body = await readJson(req);
      let out;
      for (const h of m.handlers) out = await h(ctx);
      const [status, body] = Array.isArray(out) ? out : [200, out];
      send(res, status, body);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
      console.error(err);
      send(res, 500, { error: 'Something went wrong on our side.' });
    }
  };
}

export function localDate(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
