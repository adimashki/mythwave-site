// Pure input normalisers shared by server and on-device builds.

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizePhone(phone) {
  if (!phone) return null;
  const p = String(phone).replace(/[^\d+]/g, '');
  return p.length >= 7 ? p : null;
}

export function normalizeEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

// No 0/O/1/I/L to keep codes easy to read aloud and type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** `bytes` is a Uint8Array/Buffer of random bytes, at least `len` long. */
export function codeFromBytes(bytes, len) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
