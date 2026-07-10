// The storage boundary. Routes depend on this interface, never on SQL or a
// concrete driver. A future Postgres implementation supplies the same contract
// and nothing above the repo changes.

import type { Entry, EntryInput } from "../domain/entry.js";
import type { DayCount } from "../domain/stats.js";

export interface EntryRepo {
  list(userId: string): Promise<Entry[]>;
  get(userId: string, id: string): Promise<Entry | null>;
  create(userId: string, input: EntryInput): Promise<Entry>;
  update(userId: string, id: string, patch: EntryInput): Promise<Entry | null>;
  remove(userId: string, id: string): Promise<boolean>;

  // Per-day tallies grouped by the user's LOCAL calendar day.
  // `tzOffsetMinutes` is `Date.getTimezoneOffset()` from the client
  // (minutes to add to local time to reach UTC; e.g. 240 for UTC-4).
  dailyCounts(userId: string, tzOffsetMinutes: number): Promise<DayCount[]>;

  // Bulk insert for JSON import (restore / migrate). `replace` wipes the
  // user's existing entries first.
  importEntries(userId: string, entries: EntryInput[], replace: boolean): Promise<number>;

  // User-added trigger suggestions (custom categories), stored server-side so
  // they sync across a user's devices. Just a per-user set of labels — the
  // authoritative list every client replaces its local copy with on sync.
  // add/remove are idempotent so replaying a client's offline outbox is safe.
  listTriggers(userId: string): Promise<string[]>;
  addTrigger(userId: string, label: string): Promise<void>;
  removeTrigger(userId: string, label: string): Promise<void>;
}
