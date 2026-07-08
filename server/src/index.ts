import { existsSync } from "node:fs";
// Load server/.env into process.env when present (local dev). No-op in prod
// (Render injects env vars directly, no .env file on disk).
if (existsSync(".env")) process.loadEnvFile(".env");

import Fastify from "fastify";
import cors from "@fastify/cors";
import { openDb } from "./db/sqlite/db.js";
import { SqliteEntryRepo } from "./db/sqlite/entryRepo.js";
import { openLibsql } from "./db/libsql/db.js";
import { LibsqlEntryRepo } from "./db/libsql/entryRepo.js";
import type { EntryRepo } from "./db/repo.js";
import { entryRoutes } from "./routes/entries.js";
import { statsRoutes } from "./routes/stats.js";
import { dataRoutes } from "./routes/data.js";

// Single-user for now. Auth (real accounts) is the top roadmap item; until
// then every request is this fixed user. See CLAUDE.md.
const USER_ID = process.env.USER_ID ?? "me";

const DATABASE_FILE = process.env.DATABASE_FILE ?? "./untangle.db";
const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

// Storage backend selection:
//   • Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) to use Turso/libSQL. By
//     default this runs as an EMBEDDED REPLICA: a local file (LIBSQL_REPLICA_FILE)
//     kept in sync with the remote, so reads are local-disk fast and Turso is
//     the durable source of truth. Set LIBSQL_REPLICA_FILE="" for a direct
//     remote connection (no local replica).
//   • Otherwise fall back to a local SQLite file (node:sqlite) — dev default.
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const REPLICA_FILE = process.env.LIBSQL_REPLICA_FILE ?? "file:local-replica.db";
const SYNC_INTERVAL = Number(process.env.LIBSQL_SYNC_INTERVAL ?? 60);

async function openRepo(log: (msg: string) => void): Promise<EntryRepo> {
  if (TURSO_URL) {
    const useReplica = REPLICA_FILE.length > 0;
    log(useReplica ? `libSQL embedded replica (${REPLICA_FILE})` : "libSQL remote");
    const db = await openLibsql({
      url: useReplica ? REPLICA_FILE : TURSO_URL,
      syncUrl: useReplica ? TURSO_URL : undefined,
      authToken: TURSO_TOKEN,
      syncInterval: useReplica ? SYNC_INTERVAL : undefined,
    });
    return new LibsqlEntryRepo(db);
  }
  log(`SQLite file (${DATABASE_FILE})`);
  return new SqliteEntryRepo(openDb(DATABASE_FILE));
}

async function main() {
  const repo = await openRepo((msg) => console.log(`[storage] ${msg}`));

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: CLIENT_ORIGIN });

  app.get("/api/health", async () => ({ ok: true }));
  entryRoutes(app, repo, USER_ID);
  statsRoutes(app, repo, USER_ID);
  dataRoutes(app, repo, USER_ID);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
