import type { Entry } from "../types";
import { localDayKey } from "../api";
import { EntryCard } from "./EntryCard";

export function Today({
  entries,
  onLog,
  onResist,
  onPatch,
  onDelete,
  customTriggers,
  onAddCustomTrigger,
  onRemoveCustomTrigger,
  showSeconds,
}: {
  entries: Entry[];
  onLog: () => void;
  onResist: () => void;
  onPatch: (id: string, patch: Partial<Entry>) => void;
  onDelete: (id: string) => void;
  customTriggers: string[];
  onAddCustomTrigger: (opt: string) => void;
  onRemoveCustomTrigger: (opt: string) => void;
  showSeconds: boolean;
}) {
  const todayKey = localDayKey(new Date());
  const today = entries
    .filter((e) => localDayKey(new Date(e.ts)) === todayKey)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  // Resisted urges are wins, not pulls — keep them out of the pull count.
  const count = today.filter((e) => !e.resisted).length;
  const resisted = today.filter((e) => e.resisted).length;

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
        {resisted > 0 && (
          <div className="hero-resisted">
            💪 {resisted} urge{resisted === 1 ? "" : "s"} resisted today
          </div>
        )}
      </div>

      <div className="log-row">
        <button type="button" className="log-btn" onClick={onLog}>
          Log a pull
        </button>
        <button
          type="button"
          className="resist-btn"
          onClick={onResist}
          aria-label="Log an urge you resisted"
          title="Log an urge you resisted"
        >
          💪
        </button>
      </div>
      <p className="log-hint">
        Log a pull, or tap 💪 for an urge you resisted — both are worth noticing.
      </p>

      <div className="timeline">
        {today.length === 0 ? (
          <p className="empty">Nothing logged yet today. 🌿</p>
        ) : (
          today.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              showSeconds={showSeconds}
              onPatch={(patch) => onPatch(e.id, patch)}
              onDelete={() => onDelete(e.id)}
              customTriggers={customTriggers}
              onAddCustomTrigger={onAddCustomTrigger}
              onRemoveCustomTrigger={onRemoveCustomTrigger}
            />
          ))
        )}
      </div>
    </section>
  );
}
