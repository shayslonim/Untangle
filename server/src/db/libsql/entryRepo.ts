import type { Client, Row } from "@libsql/client";
import { randomBytes } from "node:crypto";
import type { EntryRepo } from "../repo.js";
import { type Entry, type EntryInput, type Mode } from "../../domain/entry.js";
import type { DayCount } from "../../domain/stats.js";

// The row shape as libSQL returns it. Same SQLite-isms as the node:sqlite repo:
// arrays are JSON TEXT, ts is ISO TEXT, resisted is 0/1. All trapped here.
function parseArray(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToEntry(r: Row): Entry {
  const mode = r.mode == null ? null : (String(r.mode) as Mode);
  return {
    id: String(r.id),
    userId: String(r.user_id),
    ts: new Date(String(r.ts)),
    sites: parseArray(r.sites),
    triggers: parseArray(r.triggers),
    mode: mode === "Automatic" || mode === "Focused" ? mode : null,
    note: r.note == null ? "" : String(r.note),
    resisted: Number(r.resisted) !== 0,
  };
}

function newId(): string {
  return `${Date.now()}-${randomBytes(3).toString("hex")}`;
}

// Positional-arg row for an INSERT of one entry. Order matches the column list.
type Arg = string | number | null;

function insertArgs(userId: string, e: EntryInput): Arg[] {
  return [
    newId(),
    userId,
    e.ts ? new Date(e.ts).toISOString() : new Date().toISOString(),
    JSON.stringify(e.sites ?? []),
    JSON.stringify(e.triggers ?? []),
    e.mode ?? null,
    e.note ?? "",
    e.resisted ? 1 : 0,
  ];
}

const INSERT_SQL = `INSERT INTO entries (id, user_id, ts, sites, triggers, mode, note, resisted)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

export class LibsqlEntryRepo implements EntryRepo {
  constructor(private db: Client) {}

  async list(userId: string): Promise<Entry[]> {
    const res = await this.db.execute({
      sql: "SELECT * FROM entries WHERE user_id = ? ORDER BY ts DESC",
      args: [userId],
    });
    return res.rows.map(rowToEntry);
  }

  async get(userId: string, id: string): Promise<Entry | null> {
    const res = await this.db.execute({
      sql: "SELECT * FROM entries WHERE user_id = ? AND id = ?",
      args: [userId, id],
    });
    const row = res.rows[0];
    return row ? rowToEntry(row) : null;
  }

  async create(userId: string, input: EntryInput): Promise<Entry> {
    const args = insertArgs(userId, input);
    await this.db.execute({ sql: INSERT_SQL, args });
    // args[0] is the freshly minted id.
    return (await this.get(userId, args[0] as string))!;
  }

  async update(userId: string, id: string, patch: EntryInput): Promise<Entry | null> {
    const existing = await this.get(userId, id);
    if (!existing) return null;
    await this.db.execute({
      sql: `UPDATE entries SET ts=?, sites=?, triggers=?, mode=?, note=?, resisted=?
            WHERE user_id=? AND id=?`,
      args: [
        patch.ts ? new Date(patch.ts).toISOString() : existing.ts.toISOString(),
        JSON.stringify(patch.sites ?? existing.sites),
        JSON.stringify(patch.triggers ?? existing.triggers),
        (patch.mode !== undefined ? patch.mode : existing.mode) ?? null,
        patch.note !== undefined ? patch.note : existing.note,
        (patch.resisted !== undefined ? patch.resisted : existing.resisted) ? 1 : 0,
        userId,
        id,
      ],
    });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const res = await this.db.execute({
      sql: "DELETE FROM entries WHERE user_id = ? AND id = ?",
      args: [userId, id],
    });
    return res.rowsAffected > 0;
  }

  async dailyCounts(userId: string, tzOffsetMinutes: number): Promise<DayCount[]> {
    // Shift UTC ts into the client's local time, then group by calendar day.
    // getTimezoneOffset() is minutes to ADD to local to reach UTC, so local
    // time = ts minus that many minutes.
    const modifier = `${-tzOffsetMinutes} minutes`;
    const res = await this.db.execute({
      sql: `SELECT date(ts, ?) AS day, COUNT(*) AS count
            FROM entries WHERE user_id = ? AND resisted = 0
            GROUP BY day ORDER BY day`,
      args: [modifier, userId],
    });
    return res.rows.map((r) => ({ day: String(r.day), count: Number(r.count) }));
  }

  async importEntries(
    userId: string,
    entries: EntryInput[],
    replace: boolean
  ): Promise<number> {
    const stmts = [];
    if (replace) {
      stmts.push({
        sql: "DELETE FROM entries WHERE user_id = ?",
        args: [userId],
      });
    }
    for (const e of entries) {
      stmts.push({ sql: INSERT_SQL, args: insertArgs(userId, e) });
    }
    // batch is atomic: all inserts (and the optional wipe) commit together.
    await this.db.batch(stmts, "write");
    return entries.length;
  }
}
