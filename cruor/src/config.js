// Node-only configuration (secrets, port, database path).
import { randomBytes } from 'node:crypto';
import { settings } from './settings.js';

const isTest = process.env.NODE_ENV === 'test';

function secret(name) {
  const v = process.env[name];
  if (v) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production`);
  }
  // Dev/test fallback. Data encrypted with a random key is unreadable after
  // restart, so dev uses a fixed key instead.
  return isTest ? randomBytes(32).toString('hex') : `dev-only-${name}-do-not-use-in-production`;
}

export const config = {
  ...settings,
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.CRUOR_DB || (isTest ? ':memory:' : 'data/cruor.db'),
  // Used for AES-256-GCM field encryption (phone, date of birth).
  dataKey: secret('CRUOR_DATA_KEY'),
  // Used for blind indexes so encrypted fields can still be looked up.
  indexKey: secret('CRUOR_INDEX_KEY'),
};
