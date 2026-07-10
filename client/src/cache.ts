import type { Entry, Stats } from "./types";

// On-device cache + write outbox, all in localStorage. This is a CACHE, not the
// source of truth (Turso is) — it exists so the app renders instantly on load
// and can accept writes while the server is still waking up.
//
// Everything here is gated by the "remember on this device" preference (default
// ON): when off, we never persist entries/stats/queue to disk, so nothing
// sensitive rests on the device between sessions. The caller still keeps the
// queue in memory for the session, so a write made this session isn't lost
// mid-session.
//
// Failure signalling: reads fail silently (a null result makes the app fetch
// fresh, and the status banner already reflects the real server state). Writes
// return a boolean so App can flash a one-time toast — a failed cache/queue
// write is otherwise invisible.

const ENTRIES_KEY = "untangle.cache.entries";
const STATS_KEY = "untangle.cache.stats";
const TRIGGERS_KEY = "untangle.cache.triggers";
const QUEUE_KEY = "untangle.outbox";
const TRIGGER_QUEUE_KEY = "untangle.triggerOutbox";
const REMEMBER_KEY = "untangle.rememberDevice";

// Defaults to true — only an explicit "false" disables it.
export function loadRemember(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== "false";
}

export function saveRemember(on: boolean): void {
  localStorage.setItem(REMEMBER_KEY, String(on));
}

// Silent by design: a corrupt/absent cache returns null, the app fetches fresh,
// and the connecting/offline/online banner shows the true state to the user.
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadCachedEntries(): Entry[] | null {
  const v = readJson<Entry[]>(ENTRIES_KEY);
  return Array.isArray(v) ? v : null;
}

export function loadCachedStats(): Stats | null {
  return readJson<Stats>(STATS_KEY);
}

// User-added trigger suggestions (custom categories). Cached like entries — the
// server is the source of truth; this just renders instantly on load.
export function loadCachedTriggers(): string[] | null {
  const v = readJson<string[]>(TRIGGERS_KEY);
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
}

export function cacheTriggers(triggers: string[]): boolean {
  if (!loadRemember()) return true; // opted out — not a failure
  try {
    localStorage.setItem(TRIGGERS_KEY, JSON.stringify(triggers));
    return true;
  } catch (err) {
    console.warn("[cache] failed to persist triggers", err);
    return false;
  }
}

// Persist the current view — only when the user has opted in. Returns false if
// the write failed (quota exceeded / private-mode) so the caller can surface it.
export function cacheSnapshot(entries: Entry[], stats: Stats | null): boolean {
  if (!loadRemember()) return true; // opted out — not a failure
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
    if (stats) localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    return true;
  } catch (err) {
    console.warn("[cache] failed to persist snapshot", err);
    return false;
  }
}

// A queued write, replayed against the server (FIFO) once it's reachable.
// `create` carries a client-side tempId so the optimistic entry can be swapped
// for the server's real one; later `update`/`delete` ops may reference that
// tempId and are remapped during the drain. `ts` (client ISO time) is unused
// today but recorded now so a future last-write-wins merge needs no rewrite.
export type PendingOp =
  | { kind: "create"; tempId: string; patch: Partial<Entry>; ts: string }
  | { kind: "update"; id: string; patch: Partial<Entry>; ts: string }
  | { kind: "delete"; id: string; ts: string };

export function loadQueue(): PendingOp[] {
  const v = readJson<PendingOp[]>(QUEUE_KEY);
  return Array.isArray(v) ? v : [];
}

// Persist pending writes. Returns false on failure — unlike the cache, a lost
// queue means a real write won't survive a reload, so the caller should warn.
export function saveQueue(queue: PendingOp[]): boolean {
  if (!loadRemember()) return true; // session-only queue when opted out
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch (err) {
    console.warn("[cache] failed to persist outbox", err);
    return false;
  }
}

// A queued custom-trigger change, replayed against the server (FIFO) once it's
// reachable. Both kinds are idempotent server-side, so replay is always safe.
// A local add-then-remove (or remove-then-add) of the same label is compacted
// to nothing before it's ever sent (see App).
export type TriggerOp =
  | { kind: "add"; label: string; ts: string }
  | { kind: "remove"; label: string; ts: string };

export function loadTriggerQueue(): TriggerOp[] {
  const v = readJson<TriggerOp[]>(TRIGGER_QUEUE_KEY);
  return Array.isArray(v) ? v : [];
}

export function saveTriggerQueue(queue: TriggerOp[]): boolean {
  if (!loadRemember()) return true; // session-only queue when opted out
  try {
    localStorage.setItem(TRIGGER_QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch (err) {
    console.warn("[cache] failed to persist trigger outbox", err);
    return false;
  }
}

// Wipe everything this module owns. Called when the user turns "remember" off.
export function clearCache(): void {
  for (const k of [ENTRIES_KEY, STATS_KEY, TRIGGERS_KEY, QUEUE_KEY, TRIGGER_QUEUE_KEY]) {
    localStorage.removeItem(k);
  }
}
