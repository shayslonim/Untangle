import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Entry, Stats } from "./types";
import { Today } from "./components/Today";
import { Trends } from "./components/Trends";

type View = "today" | "trends";

export function App() {
  const [view, setView] = useState<View>("today");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <Today entries={entries} onLog={onLog} onPatch={onPatch} onDelete={onDelete} />
        ) : (
          <Trends stats={stats} />
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
