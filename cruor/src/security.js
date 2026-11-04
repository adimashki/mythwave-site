// Node implementation of the security interface used by core.js.
// The on-device build provides the same functions in mobile/security.browser.js.
import {
  createCipheriv, createDecipheriv, createHash, createHmac,
  randomBytes, scrypt, timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { codeFromBytes } from './normalize.js';

const scryptAsync = promisify(scrypt);
const dataKey = createHash('sha256').update(config.dataKey).digest();

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

/** AES-256-GCM for sensitive personal fields at rest. */
export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey, iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return null;
  const [v, iv, tag, body] = blob.split('.');
  if (v !== 'v1') throw new Error('Unknown ciphertext version');
  const d = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}

/** Deterministic keyed hash so an encrypted value can still be looked up. */
export function blindIndex(value) {
  if (!value) return null;
  return createHmac('sha256', config.indexKey).update(String(value)).digest('hex');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function randomCode(len = 8) {
  return codeFromBytes(randomBytes(len), len);
}

export const nodeSecurity = { hashPassword, verifyPassword, encrypt, decrypt, blindIndex, sha256, newToken, randomCode };
