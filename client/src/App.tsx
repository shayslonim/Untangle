import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { runSync, type SyncHooks } from "./sync";
import type { Entry, Stats } from "./types";
import { Today } from "./components/Today";
import { Trends } from "./components/Trends";
import { Settings } from "./components/Settings";
import {
  loadCachedEntries,
  loadCachedStats,
  cacheSnapshot,
  loadRemember,
  saveRemember,
  clearCache,
  loadQueue,
  saveQueue,
  type PendingOp,
} from "./cache";

type View = "today" | "trends";

// online = last sync succeeded; offline = not connected (initial load, cold
// start, or a failed sync) with the retry loop active. We distinguish *why*
// we're offline (booting vs failing vs device-offline) at render time from
// firstFailAt / lastFailKind rather than with extra statuses.
type ServerStatus = "online" | "offline";

// Why the last connection attempt failed: "network" = couldn't reach the server
// (booting / down / no route); "http" = reached it but it returned an error
// (server up but failing). null = no failure recorded yet.
type FailKind = "network" | "http" | null;

// User-added trigger suggestions live on-device (they're a UI preference, not
// per-entry data). Selected triggers themselves are still stored per entry.
const CUSTOM_TRIGGERS_KEY = "untangle.customTriggers";

// How long to wait between reconnection attempts while offline.
const RETRY_MS = 3000;

// Display preference: show log times to the second. On-device only — timestamps
// are always stored and exported with full precision regardless.
const SHOW_SECONDS_KEY = "untangle.showSeconds";

function loadShowSeconds(): boolean {
  return localStorage.getItem(SHOW_SECONDS_KEY) === "true";
}

// Multi-selects are compared order-insensitively so toggling a tag off then on
// reads as unchanged (a revert), not a new value.
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = [...b].sort();
  return [...a].sort().every((x, i) => x === sb[i]);
}

// The fields that differ between an entry's original (last-synced) value and its
// current one — i.e. the net patch to send. Empty means the edit was reverted,
// so no update op is needed. Keeps the outbox holding only real changes.
function changedFields(orig: Entry, cur: Entry): Partial<Entry> {
  const p: Partial<Entry> = {};
  if (orig.ts !== cur.ts) p.ts = cur.ts;
  if (orig.mode !== cur.mode) p.mode = cur.mode;
  if (orig.note !== cur.note) p.note = cur.note;
  if (orig.resisted !== cur.resisted) p.resisted = cur.resisted;
  if (!sameTags(orig.sites, cur.sites)) p.sites = cur.sites;
  if (!sameTags(orig.triggers, cur.triggers)) p.triggers = cur.triggers;
  return p;
}

// The outbox key an op targets: a create is keyed by its tempId, which is also
// the id later edits/deletes of that not-yet-synced entry reference.
function opKey(op: PendingOp): string {
  return op.kind === "create" ? op.tempId : op.id;
}

// Ids of the visible entries that have unsynced changes queued — a create (new
// entry) or an update (edited entry). Deletes are excluded: their row is gone.
// Used to flag rows "not synced yet"; a reverted edit drops its op, so its id
// falls out of this set automatically.
function pendingIdsOf(queue: PendingOp[]): Set<string> {
  const ids = new Set<string>();
  for (const op of queue) if (op.kind !== "delete") ids.add(opKey(op));
  return ids;
}

function loadCustomTriggers(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_TRIGGERS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function App() {
  const [view, setView] = useState<View>("today");
  const [entries, setEntries] = useState<Entry[]>(() => loadCachedEntries() ?? []);
  const [stats, setStats] = useState<Stats | null>(() => loadCachedStats());
  const [toast, setToast] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("offline");
  // When we first started failing to connect (for the "taking a while" escalation)
  // and why. Cleared on a successful sync.
  const [firstFailAt, setFirstFailAt] = useState<number | null>(null);
  const [lastFailKind, setLastFailKind] = useState<FailKind>(null);
  // Delay before showing any "trying to connect" banner, so warm loads that
  // resolve in <1s never flash it.
  const [showDisconnected, setShowDisconnected] = useState(false);
  // When the next retry is scheduled (ms epoch), for the banner countdown; null
  // when online or no retry pending.
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  // Forces the banner to recompute the countdown / elapsed-time escalation.
  const [, setTick] = useState(0);
  const [customTriggers, setCustomTriggers] = useState<string[]>(loadCustomTriggers);
  const [showSeconds, setShowSeconds] = useState<boolean>(loadShowSeconds);
  const [rememberDevice, setRememberDevice] = useState<boolean>(loadRemember);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The outbox lives in a ref (authoritative, no stale closures during a drain)
  // with a count mirrored into state for the banner. It's kept compacted (see
  // the enqueue helpers) so it holds only net changes — a create+delete or an
  // edit-then-revert leaves nothing behind — and the count is just its length.
  const outboxRef = useRef<PendingOp[]>(loadQueue());
  const [pendingCount, setPendingCount] = useState(outboxRef.current.length);
  // Ids of rows with unsynced changes, for the "not synced yet" row flag.
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => pendingIdsOf(outboxRef.current));
  // Each edited-but-not-yet-synced existing entry's original (last-synced) value,
  // so an edit that returns to it can be recognised as a revert and dropped.
  // In-memory only: cleared when the queue drains on a successful sync.
  const originalsRef = useRef<Map<string, Entry>>(new Map());
  // Coalesce overlapping syncs: if one is requested while another runs, re-run
  // once it finishes rather than dropping it.
  const syncingRef = useRef(false);
  const rerunRef = useRef(false);
  // One-time warning if on-device persistence fails (quota / private mode).
  const persistWarnedRef = useRef(false);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  // Surface a failed cache/queue write once — otherwise it's invisible and a
  // lost queue could drop an offline write on reload.
  const notePersist = useCallback((ok: boolean) => {
    if (ok || persistWarnedRef.current) return;
    persistWarnedRef.current = true;
    flash("Couldn't save to this device — changes stay for this session only");
  }, []);

  const commitQueue = useCallback(
    (next: PendingOp[]) => {
      outboxRef.current = next;
      setPendingCount(next.length);
      setPendingIds(pendingIdsOf(next));
      if (next.length === 0) originalsRef.current.clear(); // drained → no pending originals
      notePersist(saveQueue(next));
    },
    [notePersist]
  );

  // Persist the current view whenever it changes (no-op when remember is off).
  useEffect(() => {
    notePersist(cacheSnapshot(entries, stats));
  }, [entries, stats, notePersist]);

  // Hooks bridging the framework-agnostic sync engine (sync.ts) to React state.
  const syncHooks: SyncHooks = useMemo(
    () => ({
      getQueue: () => outboxRef.current,
      setQueue: (next) => commitQueue(next),
      setEntries: (update) => setEntries(update),
      setStats: (s) => setStats(s),
      onDrop: (op, err) => {
        console.warn("[sync] dropping rejected op", op, err);
        flash("A change couldn't be saved and was skipped");
      },
    }),
    [commitQueue]
  );

  // The single sync path: flush the outbox then pull authoritative state (see
  // runSync). On success we're online and clear the failure markers; on failure
  // we stay offline and record why (network vs http) + when it started, so the
  // banner can tell "waking up" from "having trouble". Coalesces overlapping
  // calls via syncingRef/rerunRef.
  const sync = useCallback(async () => {
    if (syncingRef.current) {
      rerunRef.current = true;
      return;
    }
    syncingRef.current = true;
    try {
      do {
        rerunRef.current = false;
        const res = await runSync(api, syncHooks);
        if (res.ok) {
          setServerStatus("online");
          setFirstFailAt(null);
          setLastFailKind(null);
          setNextRetryAt(null);
        } else {
          setServerStatus("offline");
          setLastFailKind(res.failKind);
          setFirstFailAt((prev) => prev ?? Date.now());
          setNextRetryAt(Date.now() + RETRY_MS); // schedule + countdown
          break;
        }
      } while (rerunRef.current);
    } finally {
      syncingRef.current = false;
    }
  }, [syncHooks]);

  // Initial load + reconnect on the browser regaining network.
  useEffect(() => {
    sync();
    const onOnline = () => sync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [sync]);

  // Scheduled retry: each failed sync sets nextRetryAt, and this fires the next
  // attempt at that time. A fresh failure sets a new nextRetryAt, re-arming it.
  useEffect(() => {
    if (nextRetryAt === null) return;
    const t = window.setTimeout(() => sync(), Math.max(0, nextRetryAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [nextRetryAt, sync]);

  // Only show a "trying to connect" banner if we stay offline past ~1s — a warm
  // load flips to online well before then, so it never flashes.
  useEffect(() => {
    if (serverStatus === "online") {
      setShowDisconnected(false);
      return;
    }
    const t = window.setTimeout(() => setShowDisconnected(true), 1000);
    return () => window.clearTimeout(t);
  }, [serverStatus]);

  // While a retry is pending, tick every second so the banner countdown and the
  // elapsed-time escalation stay current.
  useEffect(() => {
    if (nextRetryAt === null) return;
    const iv = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(iv);
  }, [nextRetryAt]);

  const toggleShowSeconds = (next: boolean) => {
    setShowSeconds(next);
    localStorage.setItem(SHOW_SECONDS_KEY, String(next));
  };

  const toggleRemember = (on: boolean) => {
    setRememberDevice(on);
    saveRemember(on);
    if (on) {
      notePersist(cacheSnapshot(entries, stats));
      notePersist(saveQueue(outboxRef.current));
    } else {
      clearCache();
    }
  };

  const addCustomTrigger = (opt: string) => {
    const label = opt.trim();
    if (!label) return;
    setCustomTriggers((prev) => {
      if (prev.some((t) => t.toLowerCase() === label.toLowerCase())) return prev;
      const next = [...prev, label];
      localStorage.setItem(CUSTOM_TRIGGERS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const removeCustomTrigger = (opt: string) => {
    setCustomTriggers((prev) => {
      const next = prev.filter((t) => t !== opt);
      localStorage.setItem(CUSTOM_TRIGGERS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Optimistic create: show the entry immediately with a temporary id and queue
  // the write. `sync` swaps in the server's real entry; if offline it stays
  // queued and syncs on reconnect — nothing is lost.
  const createOptimistic = (patch: Partial<Entry>, successMsg: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Entry = {
      id: tempId,
      ts: new Date().toISOString(),
      sites: patch.sites ?? [],
      triggers: patch.triggers ?? [],
      mode: patch.mode ?? null,
      note: patch.note ?? "",
      resisted: patch.resisted ?? false,
    };
    setEntries((prev) => [optimistic, ...prev]);
    flash(successMsg);
    // A create for a brand-new entry — unique key, nothing to coalesce.
    commitQueue([...outboxRef.current, { kind: "create", tempId, patch, ts: new Date().toISOString() }]);
    sync();
  };

  const onLog = () => createOptimistic({}, "Logged — take a breath");

  const onResist = () =>
    createOptimistic({ resisted: true }, "Urge resisted — that's a win 💪");

  // Fold an edit into the outbox as a single NET change. If the entry hasn't
  // synced yet, merge it into the pending create. Otherwise keep a lone update
  // op — but if the entry is now back to its original (last-synced) value, drop
  // the op entirely so a revert leaves nothing queued.
  const reconcileEdit = (id: string, before: Entry, after: Entry, patch: Partial<Entry>) => {
    const q = outboxRef.current;
    if (q.some((o) => o.kind === "create" && o.tempId === id)) {
      commitQueue(
        q.map((o) =>
          o.kind === "create" && o.tempId === id ? { ...o, patch: { ...o.patch, ...patch } } : o
        )
      );
      return;
    }
    if (!originalsRef.current.has(id)) originalsRef.current.set(id, before);
    const net = changedFields(originalsRef.current.get(id)!, after);
    const rest = q.filter((o) => !(o.kind === "update" && o.id === id));
    if (Object.keys(net).length === 0) {
      originalsRef.current.delete(id); // reverted — nothing to send
      commitQueue(rest);
    } else {
      commitQueue([...rest, { kind: "update", id, patch: net, ts: new Date().toISOString() }]);
    }
  };

  // Optimistic edit: apply the patch right away, then reconcile the outbox.
  const onPatch = (id: string, patch: Partial<Entry>) => {
    const before = entries.find((e) => e.id === id);
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    if (before) reconcileEdit(id, before, { ...before, ...patch }, patch);
    sync();
  };

  // Optimistic delete: remove immediately, then reconcile the outbox — a
  // not-yet-synced entry's queued ops are dropped wholesale (create+delete nets
  // to nothing); an existing entry keeps a single delete.
  const onDelete = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    flash("Entry removed");
    originalsRef.current.delete(id);
    const q = outboxRef.current;
    const withoutId = q.filter((o) => opKey(o) !== id);
    const pendingCreate = q.some((o) => o.kind === "create" && o.tempId === id);
    commitQueue(
      pendingCreate ? withoutId : [...withoutId, { kind: "delete", id, ts: new Date().toISOString() }]
    );
    sync();
  };

  // Derive the single status banner. When we can't reach the server, it explains
  // WHY (after a 1s delay so warm loads don't flash) — device offline vs server
  // failing vs server unreachable/booting — and, if any writes are queued, notes
  // that they'll sync on reconnect. When online there's no banner: the retry is
  // already conveyed by these messages, and a one-shot write needs no indicator.
  const banner: { cls: string; text: string; sub?: string } | null = (() => {
    if (serverStatus === "online" || !showDisconnected) return null;
    const n = pendingCount;
    const queued = n > 0 ? `${n} change${n === 1 ? "" : "s"} queued` : undefined;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return {
        cls: "banner",
        text: "You're offline.",
        sub: n > 0 ? `${n} change${n === 1 ? "" : "s"} will sync when you reconnect` : undefined,
      };
    }
    // Countdown to the next scheduled retry: " in 3s" … " in 0s". Every value
    // is the same width, so the line never reflows as it ticks down.
    const secsLeft = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)) : null;
    const retry = secsLeft !== null ? ` in ${secsLeft}s` : "";
    if (lastFailKind === "http") {
      return { cls: "banner", text: `The server is having trouble — retrying${retry}`, sub: queued };
    }
    const elapsed = firstFailAt ? Date.now() - firstFailAt : 0;
    const base = elapsed > 45000 ? "Server's taking a while" : "Waking up the server";
    return { cls: "banner calm", text: `${base} — retrying${retry}`, sub: queued };
  })();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Untangle 🌿</div>
        <div className="topbar-right">
          <nav className="top-nav">
            <button className={view === "today" ? "on" : ""} onClick={() => setView("today")}>
              Today
            </button>
            <button className={view === "trends" ? "on" : ""} onClick={() => setView("trends")}>
              Trends
            </button>
          </nav>
          <button
            className="settings-btn"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            ⚙️
          </button>
        </div>
      </header>

      {banner && (
        <div className={banner.cls}>
          <div>{banner.text}</div>
          {banner.sub && <div className="banner-sub">{banner.sub}</div>}
        </div>
      )}

      <main className="container">
        {view === "today" ? (
          <Today
            entries={entries}
            onLog={onLog}
            onResist={onResist}
            onPatch={onPatch}
            onDelete={onDelete}
            customTriggers={customTriggers}
            onAddCustomTrigger={addCustomTrigger}
            onRemoveCustomTrigger={removeCustomTrigger}
            showSeconds={showSeconds}
            markUnsynced={showDisconnected}
            pendingIds={pendingIds}
          />
        ) : (
          <Trends stats={stats} onImported={() => sync()} flash={flash} />
        )}
      </main>

      <nav className="bottom-nav">
        <button className={view === "today" ? "on" : ""} onClick={() => setView("today")}>
          Today
        </button>
        <button className={view === "trends" ? "on" : ""} onClick={() => setView("trends")}>
          Trends
        </button>
      </nav>

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          showSeconds={showSeconds}
          onToggleSeconds={toggleShowSeconds}
          rememberDevice={rememberDevice}
          onToggleRemember={toggleRemember}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
