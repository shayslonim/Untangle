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
const RETRY_MS = 8000;

// Display preference: show log times to the second. On-device only — timestamps
// are always stored and exported with full precision regardless.
const SHOW_SECONDS_KEY = "untangle.showSeconds";

function loadShowSeconds(): boolean {
  return localStorage.getItem(SHOW_SECONDS_KEY) === "true";
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
  // with a count mirrored into state for the banner.
  const outboxRef = useRef<PendingOp[]>(loadQueue());
  const [pendingCount, setPendingCount] = useState(outboxRef.current.length);
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
      notePersist(saveQueue(next));
    },
    [notePersist]
  );

  const enqueue = useCallback(
    (op: PendingOp) => commitQueue([...outboxRef.current, op]),
    [commitQueue]
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
    enqueue({ kind: "create", tempId, patch, ts: new Date().toISOString() });
    sync();
  };

  const onLog = () => createOptimistic({}, "Logged — take a breath");

  const onResist = () =>
    createOptimistic({ resisted: true }, "Urge resisted — that's a win 💪");

  // Optimistic edit: apply the patch right away, then queue it.
  const onPatch = (id: string, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    enqueue({ kind: "update", id, patch, ts: new Date().toISOString() });
    sync();
  };

  // Optimistic delete: remove immediately, then queue it.
  const onDelete = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    flash("Entry removed");
    enqueue({ kind: "delete", id, ts: new Date().toISOString() });
    sync();
  };

  // Derive the single status banner. When we can't reach the server, it explains
  // WHY (after a 1s delay so warm loads don't flash) — device offline vs server
  // failing vs server unreachable/booting — and, if any writes are queued, notes
  // that they'll sync on reconnect. When online there's no banner: the retry is
  // already conveyed by these messages, and a one-shot write needs no indicator.
  const banner: { cls: string; text: string } | null = (() => {
    if (serverStatus === "online" || !showDisconnected) return null;
    const n = pendingCount;
    const queued = n > 0 ? ` — ${n} change${n === 1 ? "" : "s"} queued` : "";
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return {
        cls: "banner",
        text: `You're offline${n > 0 ? ` — ${n} change${n === 1 ? "" : "s"} will sync when you reconnect` : ""}.`,
      };
    }
    // Countdown to the next scheduled retry: "in 5s" while pending, "…" when
    // it's due / a request is in flight.
    const secsLeft = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000)) : null;
    const retry = secsLeft && secsLeft > 0 ? ` in ${secsLeft}s` : "…";
    if (lastFailKind === "http") {
      return { cls: "banner", text: `The server is having trouble — retrying${retry}${queued}` };
    }
    const elapsed = firstFailAt ? Date.now() - firstFailAt : 0;
    const base = elapsed > 45000 ? "Server's taking a while" : "Waking up the server";
    return { cls: "banner calm", text: `${base} — retrying${retry}${queued}` };
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

      {banner && <div className={banner.cls}>{banner.text}</div>}

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
