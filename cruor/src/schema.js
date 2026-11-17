// Platform-neutral SQLite schema and helpers. Works with node:sqlite and sql.js.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS centers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'blood_bank',   -- blood_bank | hospital
  address     TEXT NOT NULL,
  city        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  phone       TEXT,
  hours_json  TEXT NOT NULL,                        -- {"mon":["08:00","16:00"], ...}
  verified    INTEGER NOT NULL DEFAULT 1,           -- only verified partners are listed
  thank_you   TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY,
  role              TEXT NOT NULL CHECK (role IN ('donor','staff','admin')),
  name              TEXT NOT NULL,
  email             TEXT UNIQUE,
  phone_enc         TEXT,
  phone_idx         TEXT UNIQUE,
  password_hash     TEXT NOT NULL,
  blood_type        TEXT,
  city              TEXT,
  lat               REAL,
  lng               REAL,
  dob_enc           TEXT,
  weight_kg         REAL,
  last_donation_at  TEXT,
  center_id         INTEGER REFERENCES centers(id),  -- staff only
  reminders_opt_in  INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (email IS NOT NULL OR phone_idx IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  center_id          INTEGER NOT NULL REFERENCES centers(id),
  starts_at          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'booked'
                     CHECK (status IN ('booked','cancelled','completed','deferred')),
  verification_code  TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_center_time ON appointments(center_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appt_user ON appointments(user_id);

CREATE TABLE IF NOT EXISTS donations (
  id              INTEGER PRIMARY KEY,
  appointment_id  INTEGER NOT NULL UNIQUE REFERENCES appointments(id),
  user_id         INTEGER NOT NULL REFERENCES users(id),
  center_id       INTEGER NOT NULL REFERENCES centers(id),
  verified_by     INTEGER NOT NULL REFERENCES users(id),
  verified_at     TEXT NOT NULL,
  points_awarded  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sponsors (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  blurb TEXT
);

CREATE TABLE IF NOT EXISTS rewards (
  id           INTEGER PRIMARY KEY,
  sponsor_id   INTEGER NOT NULL REFERENCES sponsors(id),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  cost_points  INTEGER NOT NULL CHECK (cost_points > 0),
  stock        INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS charities (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  blurb     TEXT,
  verified  INTEGER NOT NULL DEFAULT 0   -- unverified charities can never receive gifts
);

-- Structured "wishlist" paths: donors choose a path, never an individual recipient.
CREATE TABLE IF NOT EXISTS causes (
  id           INTEGER PRIMARY KEY,
  charity_id   INTEGER NOT NULL REFERENCES charities(id),
  kind         TEXT NOT NULL,          -- gift | meal | school | environment
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  cost_points  INTEGER NOT NULL CHECK (cost_points > 0),
  active       INTEGER NOT NULL DEFAULT 1
);

-- Append-only. Balance is SUM(delta).
CREATE TABLE IF NOT EXISTS points_ledger (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,           -- donation | redemption | charity_gift
  ref_id      INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger(user_id);

CREATE TABLE IF NOT EXISTS redemptions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  reward_id     INTEGER NOT NULL REFERENCES rewards(id),
  points        INTEGER NOT NULL,
  voucher_code  TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS charity_gifts (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  cause_id        INTEGER NOT NULL REFERENCES causes(id),
  points          INTEGER NOT NULL,
  message         TEXT,                -- optional, routed via the charity, moderated
  message_status  TEXT CHECK (message_status IN ('pending','approved','rejected')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Append-only audit trail for verification and other sensitive actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  center_id   INTEGER,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON points_ledger
  BEGIN SELECT RAISE(ABORT, 'points_ledger is append-only'); END;
`;

/** Run fn inside a transaction; roll back on any throw. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
