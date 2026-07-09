import type { Entry, Stats } from "./types";
import type { PendingOp } from "./cache";

// Thrown by the API client for a non-2xx response, carrying the HTTP status so
// the outbox can tell a permanent client error (4xx) from a transient server
// error (5xx). A failed fetch (server unreachable) is a plain TypeError, not
// this — so "not an ApiError" means "network".
export class ApiError extends Error {
  constructor(public status: number, statusText = "") {
    super(`${status} ${statusText}`.trim());
    this.name = "ApiError";
  }
}

// The server operations the sync engine needs. The real `api` object satisfies
// this structurally; tests pass a fake.
export interface SyncApi {
  createEntry(patch: Partial<Entry>): Promise<Entry>;
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;
  listEntries(): Promise<Entry[]>;
  stats(): Promise<Stats>;
}

// State callbacks, wired to React state in the app and to plain arrays in tests.
export interface SyncHooks {
  getQueue(): PendingOp[];
  setQueue(next: PendingOp[]): void;
  setEntries(update: (prev: Entry[]) => Entry[]): void;
  setStats(s: Stats): void;
  onDrop(op: PendingOp, err: unknown): void;
}

export type FailKind = "network" | "http";
export interface SyncResult {
  ok: boolean;
  failKind: FailKind | null;
}

// Should a failed write be kept and retried, or dropped as permanently invalid?
// KEEP (transient): network failure (not an ApiError) or a server error (5xx) —
//   e.g. a Render cold-start 502/503. These succeed on a later attempt.
// DROP (permanent): a 4xx client error — the write is invalid (e.g. editing an
//   entry the server no longer has) and would wedge the queue forever.
export function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500;
  return true; // network / unknown → retry
}

// Replay queued writes against the server, FIFO. A `create` carries a client
// tempId, so on success we swap the optimistic entry for the server's real one
// and remap any later update/delete that referenced that tempId. A transient
// failure rethrows (queue kept, so nothing after it runs and the caller stays
// offline + retries); a permanent 4xx drops just that op and continues.
export async function flushQueue(api: SyncApi, hooks: SyncHooks): Promise<void> {
  const idMap = new Map<string, string>();
  let queue = hooks.getQueue();
  while (queue.length > 0) {
    const op = queue[0];
    try {
      if (op.kind === "create") {
        const created = await api.createEntry(op.patch);
        idMap.set(op.tempId, created.id);
        hooks.setEntries((prev) => prev.map((e) => (e.id === op.tempId ? created : e)));
      } else if (op.kind === "update") {
        const realId = idMap.get(op.id) ?? op.id;
        const updated = await api.updateEntry(realId, op.patch);
        hooks.setEntries((prev) =>
          prev.map((e) => (e.id === op.id || e.id === realId ? updated : e))
        );
      } else {
        const realId = idMap.get(op.id) ?? op.id;
        await api.deleteEntry(realId);
      }
      queue = queue.slice(1);
      hooks.setQueue(queue);
    } catch (err) {
      if (isTransient(err)) throw err; // keep the queue, retry later
      hooks.onDrop(op, err);
      queue = queue.slice(1);
      hooks.setQueue(queue);
    }
  }
}

// Full sync: flush the outbox, THEN pull authoritative state. The ordering is
// the safety-critical part — the list fetch only runs once flushQueue has fully
// drained, so a write that's still queued for retry (a transient failure threw
// above) is never clobbered by fetched server state. On any failure we report
// offline + why, and the caller leaves the optimistic entries in place.
export async function runSync(api: SyncApi, hooks: SyncHooks): Promise<SyncResult> {
  try {
    await flushQueue(api, hooks);
    const [entries, stats] = await Promise.all([api.listEntries(), api.stats()]);
    hooks.setEntries(() => entries);
    hooks.setStats(stats);
    return { ok: true, failKind: null };
  } catch (err) {
    return { ok: false, failKind: err instanceof ApiError ? "http" : "network" };
  }
}
