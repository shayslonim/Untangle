import type { FastifyInstance } from "fastify";
import type { EntryRepo } from "../db/repo.js";
import { type EntryInput, type Mode, toDTO } from "../domain/entry.js";

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function isMode(v: unknown): v is Mode {
  return v === "Automatic" || v === "Focused";
}

// Map a raw imported entry (possibly from the legacy single-file app, which
// used scalar `site`/`trigger`) into a validated EntryInput.
function mapImported(raw: any): EntryInput {
  const sites = Array.isArray(raw?.sites)
    ? raw.sites.filter((x: unknown) => typeof x === "string")
    : typeof raw?.site === "string"
      ? [raw.site]
      : [];
  const triggers = Array.isArray(raw?.triggers)
    ? raw.triggers.filter((x: unknown) => typeof x === "string")
    : typeof raw?.trigger === "string"
      ? [raw.trigger]
      : [];
  return {
    ts: typeof raw?.ts === "string" ? raw.ts : undefined,
    sites,
    triggers,
    mode: isMode(raw?.mode) ? raw.mode : null,
    note: typeof raw?.note === "string" ? raw.note : "",
    resisted: raw?.resisted === true,
  };
}

export function dataRoutes(app: FastifyInstance, repo: EntryRepo, userId: string) {
  app.get<{ Querystring: { format?: string } }>("/api/export", async (req, reply) => {
    const entries = (await repo.list(userId)).sort(
      (a, b) => a.ts.getTime() - b.ts.getTime()
    );
    const stamp = new Date().toISOString().slice(0, 10);

    if (req.query.format === "csv") {
      const rows = [["date", "time", "kind", "sites", "triggers", "mode", "note"]];
      for (const e of entries) {
        rows.push([
          e.ts.toISOString().slice(0, 10),
          e.ts.toISOString().slice(11, 16),
          e.resisted ? "resisted" : "pull",
          e.sites.join(" | "),
          e.triggers.join(" | "),
          e.mode ?? "",
          e.note,
        ]);
      }
      reply
        .header("Content-Type", "text/csv")
        .header("Content-Disposition", `attachment; filename="untangle-${stamp}.csv"`);
      return rows.map((r) => r.map(csvCell).join(",")).join("\n");
    }

    reply
      .header("Content-Type", "application/json")
      .header("Content-Disposition", `attachment; filename="untangle-${stamp}.json"`);
    return {
      app: "Untangle",
      exported: new Date().toISOString(),
      entries: entries.map(toDTO),
    };
  });

  // POST /api/import  body: { entries: [...], replace?: boolean }
  app.post<{ Body: { entries?: unknown[]; replace?: boolean } }>(
    "/api/import",
    async (req, reply) => {
      const raw = Array.isArray(req.body?.entries) ? req.body!.entries : null;
      if (!raw) {
        reply.code(400);
        return { error: "expected { entries: [...] }" };
      }
      const mapped = raw.map(mapImported);
      const imported = await repo.importEntries(userId, mapped, req.body?.replace === true);
      return { imported };
    }
  );
}
