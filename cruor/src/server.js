import { createServer } from 'node:http';
import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { nodeSecurity } from './security.js';

const db = openDb(config.dbPath);
if (!db.prepare('SELECT 1 FROM centers LIMIT 1').get()) {
  await seed(db, nodeSecurity);
  console.log('Seeded demo data (see README for demo accounts).');
}

createServer(createApp(db)).listen(config.port, () => {
  console.log(`Cruor running at http://localhost:${config.port}`);
});
