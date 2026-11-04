// Demo data. All organisations below are fictional placeholders.
// Platform-neutral: `sec` is the security implementation for the platform.
import { settings as config } from './settings.js';

const WEEKDAYS = { mon: ['08:00', '16:00'], tue: ['08:00', '16:00'], wed: ['08:00', '16:00'], thu: ['08:00', '18:00'], fri: ['08:00', '14:00'], sat: ['09:00', '13:00'] };
const LONG = { mon: ['07:30', '19:00'], tue: ['07:30', '19:00'], wed: ['07:30', '19:00'], thu: ['07:30', '19:00'], fri: ['07:30', '19:00'], sat: ['09:00', '17:00'], sun: ['10:00', '14:00'] };

export const DEMO_PASSWORD = 'cruor-demo-1';

export async function seed(db, sec) {
  const { blindIndex, encrypt, hashPassword, randomCode } = sec;
  const ins = (sql, ...args) => Number(db.prepare(sql).run(...args).lastInsertRowid);
  const center = (name, kind, address, city, lat, lng, phone, hours, thankYou = null) =>
    ins(`INSERT INTO centers (name, kind, address, city, lat, lng, phone, hours_json, thank_you) VALUES (?,?,?,?,?,?,?,?,?)`,
      name, kind, address, city, lat, lng, phone, JSON.stringify(hours), thankYou);

  const c1 = center('Cedar Regional Blood Bank', 'blood_bank', '12 Hamra Street', 'Beirut', 33.8966, 35.4823, '+961 1 000 001', LONG,
    'From all of us at Cedar Regional: thank you. Your donation is already on its way to patients who need it.');
  center('Seaside Medical Center — Donor Unit', 'hospital', '4 Corniche Road', 'Beirut', 33.9010, 35.4780, '+961 1 000 002', WEEKDAYS);
  center('North Coast Blood Services', 'blood_bank', '88 Port Avenue', 'Tripoli', 34.4367, 35.8497, '+961 6 000 003', WEEKDAYS);
  center('Southern Valley Hospital', 'hospital', '23 Citadel Lane', 'Saida', 33.5571, 35.3729, '+961 7 000 004', WEEKDAYS);
  center('Bay Community Donation Hub', 'blood_bank', '7 Marina Square', 'Jounieh', 33.9808, 35.6178, '+961 9 000 005', LONG);
  center('Bekaa Plains Blood Center', 'blood_bank', '15 Vineyard Road', 'Zahle', 33.8463, 35.9019, '+961 8 000 006', WEEKDAYS);

  const pw = await hashPassword(DEMO_PASSWORD);
  const user = (role, name, email, phone, extra = {}) => ins(
    `INSERT INTO users (role, name, email, phone_enc, phone_idx, password_hash, blood_type, city, lat, lng, dob_enc, weight_kg, center_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    role, name, email, encrypt(phone), blindIndex(phone), pw, extra.bloodType ?? null, extra.city ?? null,
    extra.lat ?? null, extra.lng ?? null, encrypt(extra.dob), extra.weightKg ?? null, extra.centerId ?? null);

  const donor = user('donor', 'Maya Haddad', 'donor@cruor.test', '+96170000001',
    { bloodType: 'O-', city: 'Beirut', lat: 33.8938, lng: 35.5018, dob: '1994-05-12', weightKg: 62 });
  const staff = user('staff', 'Karim (Cedar staff)', 'staff@cruor.test', null, { centerId: c1 });
  user('admin', 'Cruor Admin', 'admin@cruor.test', null);

  // One verified donation ~70 days ago, so the demo donor has history, points and is eligible again.
  const past = new Date(Date.now() - 70 * 86_400_000);
  past.setHours(10, 0, 0, 0);
  const appt = ins(`INSERT INTO appointments (user_id, center_id, starts_at, status, verification_code) VALUES (?,?,?,'completed',?)`,
    donor, c1, past.toISOString(), randomCode(8));
  const don = ins(`INSERT INTO donations (appointment_id, user_id, center_id, verified_by, verified_at, points_awarded) VALUES (?,?,?,?,?,?)`,
    appt, donor, c1, staff, past.toISOString(), config.pointsPerDonation);
  ins(`INSERT INTO points_ledger (user_id, delta, reason, ref_id, created_at) VALUES (?,?,?,?,?)`, donor, config.pointsPerDonation, 'donation', don, past.toISOString());
  db.prepare('UPDATE users SET last_donation_at = ? WHERE id = ?').run(past.toISOString(), donor);
  ins(`INSERT INTO notifications (user_id, kind, title, body) VALUES (?,?,?,?)`, donor, 'impact',
    'Impact update', 'Emergency surgeries in Beirut this week were possible because of recent O- donations in your region.');

  const sponsor = (name, blurb) => ins('INSERT INTO sponsors (name, blurb) VALUES (?,?)', name, blurb);
  const s1 = sponsor('Northwind Coffee Co.', 'Fuelling donors since day one.');
  const s2 = sponsor('Atlas Cinemas', 'Rest up with a movie on us.');
  const s3 = sponsor('Greenleaf Grocers', 'Iron-rich groceries for recovery.');
  const reward = (sid, title, desc, cost, stock) =>
    ins('INSERT INTO rewards (sponsor_id, title, description, cost_points, stock) VALUES (?,?,?,?,?)', sid, title, desc, cost, stock);
  reward(s1, 'Coffee & pastry', 'A hot drink and pastry at any Northwind branch.', 50, 500);
  reward(s3, 'Recovery grocery basket', 'Iron-rich groceries to help you recover.', 150, 100);
  reward(s2, 'Two cinema tickets', 'A standard screening for two.', 200, 80);

  const charity = (name, blurb, verified) => ins('INSERT INTO charities (name, blurb, verified) VALUES (?,?,?)', name, blurb, verified);
  const ch1 = charity('Little Lanterns Foundation', 'Supports children in hospital and in care.', 1);
  const ch2 = charity('Shared Table', 'Community kitchens serving families in need.', 1);
  const ch3 = charity('Green Roots Initiative', 'Native tree planting and reforestation.', 1);
  charity('Unvetted Example Org', 'Not yet verified — must never appear to donors.', 0);
  const cause = (cid, kind, title, desc, cost) =>
    ins('INSERT INTO causes (charity_id, kind, title, description, cost_points) VALUES (?,?,?,?,?)', cid, kind, title, desc, cost);
  cause(ch2, 'meal', 'A meal for a family', 'One hot meal for a family of four, served through a community kitchen.', 50);
  cause(ch1, 'school', 'School supplies', 'A backpack of school supplies for a child starting term.', 100);
  cause(ch3, 'environment', 'Plant a tree', 'One native tree planted and cared for through its first year.', 60);
  cause(ch1, 'gift', 'A holiday gift for a child', 'A wrapped gift for a child spending the holidays in hospital.', 150);
}
