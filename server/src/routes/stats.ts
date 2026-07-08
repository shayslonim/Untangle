import type { FastifyInstance } from "fastify";
import type { EntryRepo } from "../db/repo.js";
import { computeStats } from "../domain/stats.js";

export function statsRoutes(app: FastifyInstance, repo: EntryRepo, userId: string) {
  // GET /api/stats?tzOffset=<Date.getTimezoneOffset()>&today=YYYY-MM-DD
  // The client passes its local timezone offset and current local day so the
  // grouping matches what the user sees on their device.
  app.get<{ Querystring: { tzOffset?: string; today?: string } }>(
    "/api/stats",
    async (req) => {
      const tzOffset = Number(req.query.tzOffset ?? 0) || 0;
      const today =
        req.query.today && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today)
          ? req.query.today
          : new Date().toISOString().slice(0, 10);
      const counts = await repo.dailyCounts(userId, tzOffset);
      return computeStats(counts, today);
    }
  );
}
