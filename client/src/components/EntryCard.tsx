import { useState } from "react";
import type { Entry, Mode } from "../types";
import { SITES, TRIGGERS, MODES } from "../types";
import { ChipRowMulti, ChipRowSingle } from "./ChipRow";

const timeFmt = (iso: string, showSeconds: boolean) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
  });

export function EntryCard({
  entry,
  showSeconds,
  onPatch,
  onDelete,
  customTriggers,
  onAddCustomTrigger,
  onRemoveCustomTrigger,
}: {
  entry: Entry;
  showSeconds: boolean;
  onPatch: (patch: Partial<Entry>) => void;
  onDelete: () => void;
  customTriggers: string[];
  onAddCustomTrigger: (opt: string) => void;
  onRemoveCustomTrigger: (opt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(entry.note);

  const modeClass = entry.resisted
    ? " resisted"
    : entry.mode === "Focused"
      ? " focused"
      : entry.mode === "Automatic"
        ? " automatic"
        : "";

  const tags = [
    ...entry.sites.map((s) => ({ cls: "site", label: s })),
    ...entry.triggers.map((t) => ({ cls: "trig", label: t })),
    ...(entry.mode ? [{ cls: "mode", label: entry.mode }] : []),
  ];

  return (
    <div className={`entry${modeClass}`}>
      <div className="entry-head">
        <span className="entry-time">{timeFmt(entry.ts, showSeconds)}</span>
        {entry.resisted && <span className="pill resisted">💪 resisted</span>}
        <div className="entry-tags">
          {tags.map((t, i) => (
            <span key={i} className={`pill ${t.cls}`}>
              {t.label}
            </span>
          ))}
        </div>
        <div className="entry-actions">
          <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
            {open ? "Done" : "Add detail"}
          </button>
          <button type="button" className="link danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {open && (
        <div className="entry-detail">
          <label>Where?</label>
          <ChipRowMulti
            kind="site"
            options={SITES}
            selected={entry.sites}
            onChange={(sites) => onPatch({ sites })}
          />
          <label>Trigger or feeling?</label>
          <ChipRowMulti
            kind="trig"
            options={TRIGGERS}
            selected={entry.triggers}
            onChange={(triggers) => onPatch({ triggers })}
            customOptions={customTriggers}
            onAddCustom={onAddCustomTrigger}
            onRemoveCustom={onRemoveCustomTrigger}
          />
          <label>Automatic or focused?</label>
          <ChipRowSingle
            kind="mode"
            options={MODES}
            selected={entry.mode}
            onPick={(mode) => onPatch({ mode: mode as Mode | null })}
          />
          <label htmlFor={`note-${entry.id}`}>Note</label>
          <textarea
            id={`note-${entry.id}`}
            value={note}
            placeholder="What was happening? An urge you resisted counts too."
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== entry.note && onPatch({ note })}
          />
          <button type="button" className="detail-done" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
