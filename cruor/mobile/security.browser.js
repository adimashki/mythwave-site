// On-device implementation of the security interface used by src/core.js.
// Same algorithms as the Node server (scrypt, AES-256-GCM, HMAC-SHA256), via audited pure-JS libraries.
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 as sha256Hash } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { gcm } from '@noble/ciphers/aes.js';
import { codeFromBytes } from '../src/normalize.js';

const SCRYPT = { N: 2 ** 14, r: 8, p: 1, dkLen: 64 }; // matches Node's scrypt defaults

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** `dataKey` and `indexKey` are 32-byte Uint8Arrays held by the device. */
export function createBrowserSecurity({ dataKey, indexKey }) {
  return {
    async hashPassword(password) {
      const salt = randomBytes(16);
      const key = await scryptAsync(utf8ToBytes(password), salt, SCRYPT);
      return `scrypt$${toB64(salt)}$${toB64(key)}`;
    },

    async verifyPassword(password, stored) {
      const [alg, saltB64, keyB64] = String(stored).split('$');
      if (alg !== 'scrypt') return false;
      const expected = fromB64(keyB64);
      const key = await scryptAsync(utf8ToBytes(password), fromB64(saltB64), { ...SCRYPT, dkLen: expected.length });
      return constantTimeEqual(key, expected);
    },

    encrypt(plain) {
      if (plain == null || plain === '') return null;
      const iv = randomBytes(12);
      const sealed = gcm(dataKey, iv).encrypt(utf8ToBytes(String(plain)));
      const body = sealed.subarray(0, sealed.length - 16);
      const tag = sealed.subarray(sealed.length - 16);
      return `v1.${toB64(iv)}.${toB64(tag)}.${toB64(body)}`; // same layout as the server
    },

    decrypt(blob) {
      if (!blob) return null;
      const [v, iv, tag, body] = blob.split('.');
      if (v !== 'v1') throw new Error('Unknown ciphertext version');
      const sealed = new Uint8Array([...fromB64(body), ...fromB64(tag)]);
      return new TextDecoder().decode(gcm(dataKey, fromB64(iv)).decrypt(sealed));
    },

    blindIndex(value) {
      if (!value) return null;
      return bytesToHex(hmac(sha256Hash, indexKey, utf8ToBytes(String(value))));
    },

    sha256(value) {
      return bytesToHex(sha256Hash(utf8ToBytes(value)));
    },

    newToken() {
      return b64url(randomBytes(32));
    },

    randomCode(len = 8) {
      return codeFromBytes(randomBytes(len), len);
    },
  };
}
