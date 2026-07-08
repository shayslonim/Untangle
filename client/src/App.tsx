import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Entry, Stats } from "./types";
import { Today } from "./components/Today";
import { Trends } from "./components/Trends";

type View = "today" | "trends";

// User-added trigger suggestions live on-device (they're a UI preference, not
// per-entry data). Selected triggers themselves are still stored per entry.
const CUSTOM_TRIGGERS_KEY = "untangle.customTriggers";

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

  const onLog = async () => {
    const created = await api.createEntry();
    setEntries((prev) => [created, ...prev]);
    api.stats().then(setStats);
    flash("Logged — take a breath");
  };

  const onResist = async () => {
    const created = await api.createEntry({ resisted: true });
    setEntries((prev) => [created, ...prev]);
    api.stats().then(setStats);
    flash("Urge resisted — that's a win 💪");
  };

  const onPatch = async (id: string, patch: Partial<Entry>) => {
    const updated = await api.updateEntry(id, patch);
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    api.stats().then(setStats);
  };

  const onDelete = async (id: string) => {
    await api.deleteEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    api.stats().then(setStats);
    flash("Entry removed");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Untangle 🌿</div>
        <nav className="top-nav">
          <button className={view === "today" ? "on" : ""} onClick={() => setView("today")}>
            Today
          </button>
          <button className={view === "trends" ? "on" : ""} onClick={() => setView("trends")}>
            Trends
          </button>
        </nav>
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

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
