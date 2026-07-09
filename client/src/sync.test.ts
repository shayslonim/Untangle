import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, isTransient, flushQueue, runSync, type SyncApi, type SyncHooks } from "./sync";
import type { PendingOp } from "./cache";
import type { Entry, Stats } from "./types";

const TS = "2026-07-09T10:00:00.000Z";

function entry(id: string, note = ""): Entry {
  return { id, ts: TS, sites: [], triggers: [], mode: null, note, resisted: false };
}

// A fake in-memory server. `errors` lets a test inject failures per operation;
// each entry is a queue of errors to throw on successive calls (undefined = ok).
type Op = "create" | "update" | "delete" | "list";
function makeApi(errors: Partial<Record<Op, (unknown | undefined)[]>> = {}) {
  const store: Entry[] = [];
  let seq = 1;
  const calls: Record<Op, number> = { create: 0, update: 0, delete: 0, list: 0 };
  const maybeThrow = (op: Op) => {
    const err = errors[op]?.[calls[op]];
    calls[op]++;
    if (err) throw err;
  };
  const api: SyncApi = {
    async createEntry(patch) {
      maybeThrow("create");
      const e: Entry = {
        id: `srv-${seq++}`,
        ts: patch.ts ?? TS,
        sites: patch.sites ?? [],
        triggers: patch.triggers ?? [],
        mode: patch.mode ?? null,
        note: patch.note ?? "",
        resisted: patch.resisted ?? false,
      };
      store.push(e);
      return { ...e };
    },
    async updateEntry(id, patch) {
      maybeThrow("update");
      const e = store.find((x) => x.id === id);
      if (!e) throw new ApiError(404, "Not Found");
      Object.assign(e, patch);
      return { ...e };
    },
    async deleteEntry(id) {
      maybeThrow("delete");
      const i = store.findIndex((x) => x.id === id);
      if (i < 0) throw new ApiError(404, "Not Found");
      store.splice(i, 1);
    },
    async listEntries() {
      maybeThrow("list");
      return store.map((e) => ({ ...e }));
    },
    async stats() {
      return {} as Stats;
    },
  };
  return { api, store, calls };
}

// A harness holding the client's entries + outbox in plain variables.
function makeHooks(initEntries: Entry[], initQueue: PendingOp[]) {
  const state = {
    entries: [...initEntries],
    queue: [...initQueue],
    dropped: [] as PendingOp[],
  };
  const hooks: SyncHooks = {
    getQueue: () => state.queue,
    setQueue: (next) => {
      state.queue = next;
    },
    setEntries: (update) => {
      state.entries = update(state.entries);
    },
    setStats: () => {},
    onDrop: (op) => {
      state.dropped.push(op);
    },
  };
  return { state, hooks };
}

const createOp = (tempId: string, note: string): PendingOp => ({
  kind: "create",
  tempId,
  patch: { note },
  ts: TS,
});

// ---- isTransient: the drop-vs-retry classification (the core of the bug) ----

test("isTransient: network errors retry", () => {
  assert.equal(isTransient(new TypeError("Failed to fetch")), true);
  assert.equal(isTransient(new Error("boom")), true);
});

test("isTransient: 5xx (incl. cold-start 502/503) retry", () => {
  assert.equal(isTransient(new ApiError(500)), true);
  assert.equal(isTransient(new ApiError(502)), true);
  assert.equal(isTransient(new ApiError(503)), true);
});

test("isTransient: 4xx client errors are dropped", () => {
  assert.equal(isTransient(new ApiError(400)), false);
  assert.equal(isTransient(new ApiError(404)), false);
  assert.equal(isTransient(new ApiError(409)), false);
});

// ---- offline write is queued, not lost ----

test("network failure keeps the queued create for retry", async () => {
  const { hooks, state } = makeHooks([entry("temp-1", "a")], [createOp("temp-1", "a")]);
  const { api, store } = makeApi({ create: [new TypeError("Failed to fetch")] });
  await assert.rejects(() => flushQueue(api, hooks));
  assert.equal(state.queue.length, 1, "op retained");
  assert.equal(store.length, 0, "nothing reached the server");
});

// ---- THE BUG: a 502 on reconnect must NOT drop or delete the offline entry ----

test("cold-start 502 on reconnect retains the op and never deletes the entry", async () => {
  const { hooks, state } = makeHooks(
    [entry("temp-1", "offline entry")],
    [createOp("temp-1", "offline entry")]
  );
  const { api, store } = makeApi({ create: [new ApiError(502, "Bad Gateway")] });

  const res = await runSync(api, hooks);

  assert.equal(res.ok, false);
  assert.equal(res.failKind, "http");
  assert.equal(state.queue.length, 1, "create is retried, not dropped");
  assert.equal(state.dropped.length, 0, "nothing dropped");
  assert.deepEqual(
    state.entries.map((e) => e.id),
    ["temp-1"],
    "optimistic entry is preserved (not wiped by a list fetch)"
  );
  assert.equal(store.length, 0);
});

// ---- end-to-end: offline write survives reconnect ----

test("offline create survives reconnect (fails once, then syncs)", async () => {
  const { hooks, state } = makeHooks(
    [entry("temp-1", "offline entry")],
    [createOp("temp-1", "offline entry")]
  );
  // First attempt 502 (booting), second succeeds.
  const { api, store } = makeApi({ create: [new ApiError(502)] });

  const first = await runSync(api, hooks);
  assert.equal(first.ok, false);
  assert.equal(state.entries[0].id, "temp-1", "still optimistic after failed attempt");

  const second = await runSync(api, hooks);
  assert.equal(second.ok, true);
  assert.equal(state.queue.length, 0, "queue drained");
  assert.equal(state.entries.length, 1, "entry not lost");
  assert.match(state.entries[0].id, /^srv-/, "swapped to server id");
  assert.equal(state.entries[0].note, "offline entry");
  assert.equal(store.length, 1, "persisted on server");
});

// ---- a genuinely invalid write (4xx) is dropped so it can't wedge ----

test("4xx update of a missing entry is dropped and reported", async () => {
  const { hooks, state } = makeHooks(
    [entry("srv-9", "stale")],
    [{ kind: "update", id: "srv-9", patch: { note: "edit" }, ts: TS }]
  );
  const { api } = makeApi(); // empty server → update 404s

  const res = await runSync(api, hooks);

  assert.equal(res.ok, true, "flush drops the bad op, then the list fetch succeeds");
  assert.equal(state.dropped.length, 1, "the invalid op was dropped");
  assert.equal(state.queue.length, 0, "queue not wedged");
  assert.deepEqual(state.entries, [], "entries reflect server truth");
});

// ---- temp id remapping across ops ----

test("update of a not-yet-synced entry remaps temp id to the real one", async () => {
  const ops: PendingOp[] = [
    createOp("temp-1", "a"),
    { kind: "update", id: "temp-1", patch: { note: "b" }, ts: TS },
  ];
  const { hooks, state } = makeHooks([entry("temp-1", "a")], ops);
  const { api, store } = makeApi();

  const res = await runSync(api, hooks);

  assert.equal(res.ok, true);
  assert.equal(state.dropped.length, 0, "update did NOT 404 — it hit the real id");
  assert.equal(store.length, 1);
  assert.equal(store[0].note, "b", "edit applied to the created entry");
});

test("create then delete of a not-yet-synced entry nets to nothing", async () => {
  const ops: PendingOp[] = [
    createOp("temp-1", "a"),
    { kind: "delete", id: "temp-1", ts: TS },
  ];
  const { hooks, state } = makeHooks([entry("temp-1", "a")], ops);
  const { api, store } = makeApi();

  const res = await runSync(api, hooks);

  assert.equal(res.ok, true);
  assert.equal(state.dropped.length, 0);
  assert.equal(store.length, 0, "created then deleted on server");
  assert.deepEqual(state.entries, []);
});

// ---- ordering safety: a mid-flush failure never lets the list fetch clobber
//      an entry whose write is still queued ----

test("partial flush preserves the entry whose op is retried", async () => {
  const ops: PendingOp[] = [createOp("temp-1", "first"), createOp("temp-2", "second")];
  const { hooks, state } = makeHooks([entry("temp-1", "first"), entry("temp-2", "second")], ops);
  // First create succeeds, second hits a 502.
  const { api } = makeApi({ create: [undefined, new ApiError(502)] });

  const res = await runSync(api, hooks);

  assert.equal(res.ok, false, "stayed offline");
  assert.equal(state.queue.length, 1, "second op retained");
  assert.equal(state.queue[0].kind === "create" && state.queue[0].tempId, "temp-2");
  const ids = state.entries.map((e) => e.id).sort();
  assert.equal(ids.length, 2, "no entry lost");
  assert.match(ids.find((id) => id.startsWith("srv-"))!, /^srv-/, "first swapped to server id");
  assert.ok(ids.includes("temp-2"), "second still optimistic, not clobbered by a list fetch");
});

// ---- a normal online write with an empty queue just refreshes ----

test("online sync with empty queue pulls authoritative state", async () => {
  const { api, store } = makeApi();
  store.push(entry("srv-1", "server side"));
  const { hooks, state } = makeHooks([], []);

  const res = await runSync(api, hooks);

  assert.equal(res.ok, true);
  assert.deepEqual(
    state.entries.map((e) => e.id),
    ["srv-1"]
  );
});
