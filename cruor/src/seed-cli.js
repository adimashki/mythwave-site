// `npm run seed`: wipe the local database and reseed demo data.
import { rmSync } from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { nodeSecurity } from './security.js';
import { seed, DEMO_PASSWORD } from './seed.js';

if (config.dbPath !== ':memory:') {
  for (const suffix of ['', '-wal', '-shm']) rmSync(config.dbPath + suffix, { force: true });
}
await seed(openDb(config.dbPath), nodeSecurity);
console.log(`Seeded ${config.dbPath}. Demo password for all accounts: ${DEMO_PASSWORD}`);
