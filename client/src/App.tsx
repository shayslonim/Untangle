import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Entry, Stats } from "./types";
import { Today } from "./components/Today";
import { Trends } from "./components/Trends";
import { Settings } from "./components/Settings";

type View = "today" | "trends";

// User-added trigger suggestions live on-device (they're a UI preference, not
// per-entry data). Selected triggers themselves are still stored per entry.
const CUSTOM_TRIGGERS_KEY = "untangle.customTriggers";

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
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customTriggers, setCustomTriggers] = useState<string[]>(loadCustomTriggers);
  const [showSeconds, setShowSeconds] = useState<boolean>(loadShowSeconds);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleShowSeconds = (next: boolean) => {
    setShowSeconds(next);
    localStorage.setItem(SHOW_SECONDS_KEY, String(next));
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

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const refresh = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([api.listEntries(), api.stats()]);
      setEntries(e);
      setStats(s);
      setError(null);
    } catch {
      setError("Can't reach the server. Is it running on :3001?");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Optimistic create: show the entry immediately with a temporary id, then
  // swap in the server's version once it confirms. On failure, drop the
  // placeholder and tell the user — nothing was actually saved.
  const createOptimistic = async (
    patch: Partial<Entry>,
    successMsg: string
  ) => {
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
    try {
      const created = await api.createEntry(patch);
      setEntries((prev) => prev.map((e) => (e.id === tempId ? created : e)));
      api.stats().then(setStats);
    } catch {
      setEntries((prev) => prev.filter((e) => e.id !== tempId));
      flash("Couldn't save that — please try again");
    }
  };

  const onLog = () => createOptimistic({}, "Logged — take a breath");

  const onResist = () =>
    createOptimistic({ resisted: true }, "Urge resisted — that's a win 💪");

  // Optimistic edit: apply the patch right away, reconcile with the server's
  // returned entry, and roll back to the previous value if it fails.
  const onPatch = async (id: string, patch: Partial<Entry>) => {
    const prevEntry = entries.find((e) => e.id === id);
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e))
    );
    try {
      const updated = await api.updateEntry(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      api.stats().then(setStats);
    } catch {
      if (prevEntry) {
        setEntries((prev) => prev.map((e) => (e.id === id ? prevEntry : e)));
      }
      flash("Couldn't save that change");
    }
  };

  // Optimistic delete: remove immediately, restore the whole prior list (to
  // keep ordering) if the server rejects it.
  const onDelete = async (id: string) => {
    const snapshot = entries;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    flash("Entry removed");
    try {
      await api.deleteEntry(id);
      api.stats().then(setStats);
    } catch {
      setEntries(snapshot);
      flash("Couldn't remove that entry");
    }
  };

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

      {error && <div className="banner">{error}</div>}

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
          />
        ) : (
          <Trends stats={stats} onImported={refresh} flash={flash} />
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
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
