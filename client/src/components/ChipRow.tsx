type Kind = "site" | "trig" | "mode";

export function ChipRowMulti({
  kind,
  options,
  selected,
  onChange,
}: {
  kind: Kind;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);
  };
  return (
    <div className={`chips ${kind}`}>
      {options.map((opt) => {
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
      })}
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
