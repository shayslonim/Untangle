import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { EntryRepo } from "../repo.js";
import { type Entry, type EntryInput, type Mode } from "../../domain/entry.js";
import type { DayCount } from "../../domain/stats.js";

// The storage-engine row shape. Note the SQLite-isms: arrays are JSON TEXT,
// ts is ISO TEXT. All of this weirdness is trapped in this file's mapper.
interface EntryRow {
  id: string;
  user_id: string;
  ts: string;
  sites: string;
  triggers: string;
  mode: string | null;
  note: string;
}

function parseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rowToEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    userId: r.user_id,
    ts: new Date(r.ts),
    sites: parseArray(r.sites),
    triggers: parseArray(r.triggers),
    mode: (r.mode as Mode | null) ?? null,
    note: r.note,
  };
}

function newId(): string {
  return `${Date.now()}-${randomBytes(3).toString("hex")}`;
}

export class SqliteEntryRepo implements EntryRepo {
  constructor(private db: DatabaseSync) {}

  async list(userId: string): Promise<Entry[]> {
    const rows = this.db
      .prepare("SELECT * FROM entries WHERE user_id = ? ORDER BY ts DESC")
      .all(userId) as unknown as EntryRow[];
    return rows.map(rowToEntry);
  }

  async get(userId: string, id: string): Promise<Entry | null> {
    const row = this.db
      .prepare("SELECT * FROM entries WHERE user_id = ? AND id = ?")
      .get(userId, id) as unknown as EntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  async create(userId: string, input: EntryInput): Promise<Entry> {
    const id = newId();
    const ts = input.ts ? new Date(input.ts).toISOString() : new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO entries (id, user_id, ts, sites, triggers, mode, note)
         VALUES (@id, @user_id, @ts, @sites, @triggers, @mode, @note)`
      )
      .run({
        id,
        user_id: userId,
        ts,
        sites: JSON.stringify(input.sites ?? []),
        triggers: JSON.stringify(input.triggers ?? []),
        mode: input.mode ?? null,
        note: input.note ?? "",
      });
    return (await this.get(userId, id))!;
  }

  async update(userId: string, id: string, patch: EntryInput): Promise<Entry | null> {
    const existing = await this.get(userId, id);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE entries SET ts=@ts, sites=@sites, triggers=@triggers, mode=@mode, note=@note
         WHERE user_id=@user_id AND id=@id`
      )
      .run({
        ts: patch.ts ? new Date(patch.ts).toISOString() : existing.ts.toISOString(),
        sites: JSON.stringify(patch.sites ?? existing.sites),
        triggers: JSON.stringify(patch.triggers ?? existing.triggers),
        mode: patch.mode !== undefined ? patch.mode : existing.mode,
        note: patch.note !== undefined ? patch.note : existing.note,
        user_id: userId,
        id,
      });
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const res = this.db
      .prepare("DELETE FROM entries WHERE user_id = ? AND id = ?")
      .run(userId, id);
    return res.changes > 0;
  }

  async dailyCounts(userId: string, tzOffsetMinutes: number): Promise<DayCount[]> {
    // Shift UTC ts into the client's local time, then group by calendar day.
    // getTimezoneOffset() is minutes to ADD to local to reach UTC, so local
    // time = ts minus that many minutes.
    const modifier = `${-tzOffsetMinutes} minutes`;
    const rows = this.db
      .prepare(
        `SELECT date(ts, ?) AS day, COUNT(*) AS count
         FROM entries WHERE user_id = ?
         GROUP BY day ORDER BY day`
      )
      .all(modifier, userId) as unknown as { day: string; count: number }[];
    return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  async importEntries(
    userId: string,
    entries: EntryInput[],
    replace: boolean
  ): Promise<number> {
    const insert = this.db.prepare(
      `INSERT INTO entries (id, user_id, ts, sites, triggers, mode, note)
       VALUES (@id, @user_id, @ts, @sites, @triggers, @mode, @note)`
    );
    this.db.exec("BEGIN");
    try {
      if (replace) {
        this.db.prepare("DELETE FROM entries WHERE user_id = ?").run(userId);
      }
      let n = 0;
      for (const e of entries) {
        insert.run({
          id: newId(),
          user_id: userId,
          ts: e.ts ? new Date(e.ts).toISOString() : new Date().toISOString(),
          sites: JSON.stringify(e.sites ?? []),
          triggers: JSON.stringify(e.triggers ?? []),
          mode: e.mode ?? null,
          note: e.note ?? "",
        });
        n++;
      }
      this.db.exec("COMMIT");
      return n;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}
