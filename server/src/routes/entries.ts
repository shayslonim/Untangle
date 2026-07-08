import type { FastifyInstance } from "fastify";
import type { EntryRepo } from "../db/repo.js";
import { parseInput, toDTO } from "../domain/entry.js";

export function entryRoutes(app: FastifyInstance, repo: EntryRepo, userId: string) {
  app.get("/api/entries", async () => {
    const entries = await repo.list(userId);
    return entries.map(toDTO);
  });

  app.post("/api/entries", async (req, reply) => {
    const entry = await repo.create(userId, parseInput(req.body));
    reply.code(201);
    return toDTO(entry);
  });

  app.patch<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const updated = await repo.update(userId, req.params.id, parseInput(req.body));
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return toDTO(updated);
  });

  app.delete<{ Params: { id: string } }>("/api/entries/:id", async (req, reply) => {
    const ok = await repo.remove(userId, req.params.id);
    if (!ok) {
      reply.code(404);
      return { error: "not found" };
    }
    reply.code(204);
    return null;
  });
}
