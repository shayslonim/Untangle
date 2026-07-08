import type { Entry } from "../types";
import { localDayKey } from "../api";
import { EntryCard } from "./EntryCard";

export function Today({
  entries,
  onLog,
  onPatch,
  onDelete,
}: {
  entries: Entry[];
  onLog: () => void;
  onPatch: (id: string, patch: Partial<Entry>) => void;
  onDelete: (id: string) => void;
}) {
  const todayKey = localDayKey(new Date());
  const today = entries
    .filter((e) => localDayKey(new Date(e.ts)) === todayKey)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const count = today.length;

  return (
    <section className="view">
      <div className={`hero${count === 0 ? " calm" : ""}`}>
        <div className="hero-count">{count}</div>
        <div className="hero-sub">
          {count === 0
            ? "A calm day so far — that counts"
            : count === 1
              ? "one pull logged today"
              : `${count} pulls logged today`}
        </div>
      </div>

      <button type="button" className="log-btn" onClick={onLog}>
        Log a pull
      </button>
      <p className="log-hint">Tap whenever you notice a pull — or an urge you resisted.</p>

      <div className="timeline">
        {today.length === 0 ? (
          <p className="empty">Nothing logged yet today. 🌿</p>
        ) : (
          today.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              onPatch={(patch) => onPatch(e.id, patch)}
              onDelete={() => onDelete(e.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
