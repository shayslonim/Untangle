import { DatabaseSync } from "node:sqlite";

// Open (and create on first run) the SQLite database, then apply migrations.
// Uses Node's built-in node:sqlite — SQLite with zero native dependencies.
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

// Versioned, idempotent migrations. Add new steps to the array; each runs once.
const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_create_entries",
    sql: `
      CREATE TABLE entries (
        id        TEXT PRIMARY KEY,
        user_id   TEXT NOT NULL,
        ts        TEXT NOT NULL,           -- ISO 8601
        sites     TEXT NOT NULL DEFAULT '[]',  -- JSON array
        triggers  TEXT NOT NULL DEFAULT '[]',  -- JSON array
        mode      TEXT,                    -- 'Automatic' | 'Focused' | NULL
        note      TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_entries_user_ts ON entries(user_id, ts);
    `,
  },
  {
    name: "002_add_resisted",
    // A resisted urge is a win, not a pull. Flag it so it never counts toward
    // the pull tallies (see dailyCounts) but is still logged and celebrated.
    sql: `ALTER TABLE entries ADD COLUMN resisted INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    name: "003_create_custom_triggers",
    // User-added trigger suggestions, synced across devices. One row per
    // (user, label); the PK makes add idempotent (INSERT OR IGNORE) so an
    // offline outbox can be replayed safely.
    sql: `
      CREATE TABLE custom_triggers (
        user_id   TEXT NOT NULL,
        label     TEXT NOT NULL,
        added_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, label)
      );
    `,
  },
];

function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
  );
  const insert = db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      insert.run(m.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
