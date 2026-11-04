import { config } from './config.js';

export const BLOOD_TYPES = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 86_400_000;

export function ageOn(dobIso, at = new Date()) {
  if (!dobIso) return null;
  const dob = new Date(`${dobIso}T00:00:00`);
  let age = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * General pre-screening only — NOT medical advice. Blood bank staff make the
 * final determination on the day. Returns what we know and what's missing.
 */
export function eligibility({ dob, weight_kg, last_donation_at }, at = new Date()) {
  const rules = config.eligibility;
  const reasons = [];
  const missing = [];

  const age = ageOn(dob, at);
  if (age == null) missing.push('date of birth');
  else if (age < rules.minAge) reasons.push(`Donors must be at least ${rules.minAge}.`);
  else if (age > rules.maxAge) reasons.push(`Donors over ${rules.maxAge} need clearance from a blood bank first.`);

  if (weight_kg == null) missing.push('weight');
  else if (weight_kg < rules.minWeightKg) reasons.push(`Donors must weigh at least ${rules.minWeightKg} kg.`);

  let nextEligibleAt = null;
  if (last_donation_at) {
    const next = new Date(new Date(last_donation_at).getTime() + rules.wholeBloodIntervalDays * DAY_MS);
    if (next > at) nextEligibleAt = next.toISOString();
  }

  return {
    eligible: reasons.length === 0 && missing.length === 0 && !nextEligibleAt,
    nextEligibleAt,
    reasons,
    missing,
    age,
    disclaimer: 'This is a general pre-check, not medical advice. Staff at the donation center make the final decision.',
  };
}

/** Opening hours for a local calendar date, or null if closed. */
export function hoursFor(center, dateStr) {
  const hours = JSON.parse(center.hours_json);
  const d = new Date(`${dateStr}T00:00:00`);
  return hours[DAY_KEYS[d.getDay()]] || null;
}

/** Bookable slots for a center on a local date (YYYY-MM-DD). */
export function slotsFor(center, dateStr, bookedCounts = new Map(), now = new Date()) {
  const window = hoursFor(center, dateStr);
  if (!window) return [];
  const [open, close] = window;
  const start = new Date(`${dateStr}T${open}:00`);
  const end = new Date(`${dateStr}T${close}:00`);
  const out = [];
  for (let t = start; t < end; t = new Date(t.getTime() + config.slotMinutes * 60_000)) {
    if (t <= now) continue;
    const iso = t.toISOString();
    const taken = bookedCounts.get(iso) || 0;
    out.push({ startsAt: iso, available: Math.max(0, config.slotCapacity - taken) });
  }
  return out;
}

export function isWithinHours(center, startsAt) {
  const t = new Date(startsAt);
  if (Number.isNaN(t.getTime())) return false;
  const local = new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return slotsFor(center, local, new Map(), new Date(0)).some((s) => s.startsAt === t.toISOString());
}

export function distanceKm(a, b) {
  if ([a?.lat, a?.lng, b?.lat, b?.lng].some((v) => v == null)) return null;
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export function isSameLocalDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
