import Fastify from "fastify";
import cors from "@fastify/cors";
import { openDb } from "./db/sqlite/db.js";
import { SqliteEntryRepo } from "./db/sqlite/entryRepo.js";
import { entryRoutes } from "./routes/entries.js";
import { statsRoutes } from "./routes/stats.js";
import { dataRoutes } from "./routes/data.js";

// Single-user for now. Auth (real accounts) is the top roadmap item; until
// then every request is this fixed user. See CLAUDE.md.
const USER_ID = process.env.USER_ID ?? "me";

const DATABASE_FILE = process.env.DATABASE_FILE ?? "./untangle.db";
const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

async function main() {
  const db = openDb(DATABASE_FILE);
  const repo = new SqliteEntryRepo(db);

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
