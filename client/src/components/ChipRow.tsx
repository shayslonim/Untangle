import { useState } from "react";

type Kind = "site" | "trig" | "mode";

export function ChipRowMulti({
  kind,
  options,
  selected,
  onChange,
  customOptions,
  onAddCustom,
  onRemoveCustom,
}: {
  kind: Kind;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  // Optional user-added suggestions. When provided, a textbox is shown to add
  // new ones, and each custom chip gets an "x" to remove it from suggestions.
  customOptions?: string[];
  onAddCustom?: (opt: string) => void;
  onRemoveCustom?: (opt: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);
  };

  const chip = (opt: string) => {
    const on = selected.includes(opt);
    return (
      <button
        key={opt}
        type="button"
        className={`chip${on ? " on" : ""}`}
        aria-pressed={on}
        onClick={() => toggle(opt)}
      >
        {opt}
      </button>
    );
  };

  const commitDraft = () => {
    const label = draft.trim();
    if (!label || !onAddCustom) return;
    onAddCustom(label);
    if (!selected.includes(label)) onChange([...selected, label]);
    setDraft("");
  };

  return (
    <div className={`chips ${kind}`}>
      {options.map(chip)}
      {(customOptions ?? []).map((opt) => {
        const on = selected.includes(opt);
        return (
          <span key={opt} className="chip-wrap">
            <button
              type="button"
              className={`chip${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(opt)}
            >
              {opt}
            </button>
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${opt} from suggestions`}
              title="Remove from suggestions"
              onClick={() => {
                onRemoveCustom?.(opt);
                if (on) onChange(selected.filter((x) => x !== opt));
              }}
            >
              ×
            </button>
          </span>
        );
      })}
      {onAddCustom && (
        <span className="chip-add">
          <input
            type="text"
            value={draft}
            placeholder="Add your own…"
            aria-label="Add your own trigger"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
          />
          <button
            type="button"
            className="chip-add-btn"
            onClick={commitDraft}
            disabled={!draft.trim()}
          >
            Add
          </button>
        </span>
      )}
    </div>
  );
}

export function ChipRowSingle({
  kind,
  options,
  selected,
  onPick,
}: {
  kind: Kind;
  options: string[];
  selected: string | null;
  onPick: (value: string | null) => void;
}) {
  return (
    <div className={`chips ${kind}`}>
      {options.map((opt) => {
        const on = selected === opt;
        return (
          <button
            key={opt}
            type="button"
            className={`chip${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onPick(on ? null : opt)}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
