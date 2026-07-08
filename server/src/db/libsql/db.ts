import { createClient, type Client } from "@libsql/client";

// Open a libSQL client and apply migrations. Two shapes:
//
//   • Embedded replica (prod): a local SQLite file kept in sync with a remote
//     Turso database. Reads hit the local file at disk speed; writes go to the
//     remote and sync back. Turso is the source of truth, so the local file
//     being ephemeral (e.g. on Render) is fine — it re-syncs on boot.
//
//   • Local file / remote-only (dev, tests): just `url`, no `syncUrl`.
//
// `url`      — where reads/writes hit locally. "file:..." for a replica, or the
//              remote "libsql://..." URL for a direct connection.
// `syncUrl`  — the remote Turso URL when `url` is a local file (enables replica).
// `authToken`— Turso auth token (remote only).
// `syncInterval` — seconds between background pulls from remote (replica only).
export interface LibsqlConfig {
  url: string;
  syncUrl?: string;
  authToken?: string;
  syncInterval?: number;
}

export async function openLibsql(cfg: LibsqlConfig): Promise<Client> {
  const db = createClient({
    url: cfg.url,
    syncUrl: cfg.syncUrl,
    authToken: cfg.authToken,
    syncInterval: cfg.syncInterval,
  });
  // Pull the current remote state before serving anything (replica only).
  if (cfg.syncUrl) await db.sync();
  await migrate(db);
  return db;
}

// Versioned, idempotent migrations. Same SQL as the SQLite impl — libSQL is
// SQLite-compatible — just applied over the async client. Add new steps to the
// array; each runs once. (WAL/journal pragmas are managed by libSQL itself.)
const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_create_entries",
    sql: `
      CREATE TABLE entries (
        id        TEXT PRIMARY KEY,
        user_id   TEXT NOT NULL,
        ts        TEXT NOT NULL,
        sites     TEXT NOT NULL DEFAULT '[]',
        triggers  TEXT NOT NULL DEFAULT '[]',
        mode      TEXT,
        note      TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_entries_user_ts ON entries(user_id, ts);
    `,
  },
  {
    name: "002_add_resisted",
    sql: `ALTER TABLE entries ADD COLUMN resisted INTEGER NOT NULL DEFAULT 0;`,
  },
];

async function migrate(db: Client): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
  const res = await db.execute("SELECT name FROM _migrations");
  const applied = new Set(res.rows.map((r) => r.name as string));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    // Each migration's SQL may hold several statements; batch runs them
    // atomically along with recording the migration.
    await db.batch(
      [
        ...splitStatements(m.sql),
        {
          sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
          args: [m.name, new Date().toISOString()],
        },
      ],
      "write"
    );
  }
}

// libSQL's batch takes one statement per item, so split a multi-statement
// migration on `;`. Migration SQL here is simple (no semicolons in string
// literals), so a naive split is safe.
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
