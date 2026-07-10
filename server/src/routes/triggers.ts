import type { FastifyInstance } from "fastify";
import type { EntryRepo } from "../db/repo.js";

// User-added trigger suggestions (custom categories), synced across a user's
// devices. The set is authoritative: clients replay their offline add/remove
// outbox here, then GET the full list and replace their local copy. add/remove
// are idempotent in the repo, so a replayed op is always safe.
//
// The label is carried in the body (add) or the query string (remove) rather
// than the path, so labels with slashes/spaces need no path encoding.
export function triggerRoutes(app: FastifyInstance, repo: EntryRepo, userId: string) {
  app.get("/api/triggers", async () => {
    return repo.listTriggers(userId);
  });

  app.post<{ Body: { label?: unknown } }>("/api/triggers", async (req, reply) => {
    const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
    if (!label) {
      reply.code(400);
      return { error: "expected { label: string }" };
    }
    await repo.addTrigger(userId, label);
    reply.code(201);
    return { label };
  });

  app.delete<{ Querystring: { label?: string } }>("/api/triggers", async (req, reply) => {
    const label = typeof req.query.label === "string" ? req.query.label : "";
    if (!label) {
      reply.code(400);
      return { error: "expected ?label=" };
    }
    await repo.removeTrigger(userId, label);
    reply.code(204);
    return null;
  });
}
