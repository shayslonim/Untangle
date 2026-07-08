import type { DayPoint } from "../types";

// Hand-drawn "soft hills" SVG — no chart library, works fully offline.
// Zero-days render a sage leaf instead of a bar (calm reads as a win).
export function BarChart({ data, variant }: { data: DayPoint[]; variant: "week" | "month" }) {
  const W = 600;
  const H = variant === "week" ? 200 : 180;
  const padL = 8,
    padR = 8,
    padT = 16,
    padB = 28;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.count));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const gap = variant === "week" ? 14 : 5;
  const bw = (innerW - gap * (n - 1)) / n;

  const bars: JSX.Element[] = [];
  const values: JSX.Element[] = [];
  const leaves: JSX.Element[] = [];
  const labels: JSX.Element[] = [];

  data.forEach((d, i) => {
    const x = padL + i * (bw + gap);
    const h = d.count === 0 ? 3 : Math.max(6, (d.count / max) * innerH);
    const y = padT + innerH - h;
    const r = Math.min(bw / 2, 10);
    bars.push(
      <rect
        key={`b${i}`}
        x={x}
        y={y}
        width={bw}
        height={h}
        rx={r}
        fill={d.count === 0 ? "var(--chart-zero)" : "url(#g1)"}
      />
    );
    if (variant === "week" && d.count > 0) {
      values.push(
        <text key={`v${i}`} x={x + bw / 2} y={y - 6} textAnchor="middle" className="bar-val">
          {d.count}
        </text>
      );
    }
    if (d.count === 0) {
      const cx = x + bw / 2;
      const cy = padT + innerH - 8;
      leaves.push(
        <path
          key={`l${i}`}
          transform={`translate(${cx - 6},${cy - 6}) scale(.5)`}
          d="M5 19C5 11 11 5 19 5c0 8-6 14-14 14z"
          fill="var(--sage)"
        />
      );
    }
    const day = new Date(d.key + "T00:00:00");
    let lab = "";
    if (variant === "week") lab = day.toLocaleDateString([], { weekday: "short" });
    else if (day.getDate() % 5 === 0 || i === 0 || i === n - 1) lab = String(day.getDate());
    if (lab) {
      labels.push(
        <text key={`x${i}`} x={x + bw / 2} y={H - 9} textAnchor="middle" className="bar-lab">
          {lab}
        </text>
      );
    }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${variant} bar chart`} className="chart">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--periwinkle)" />
          <stop offset="1" stopColor="#C7CBF2" />
        </linearGradient>
      </defs>
      <line
        x1={padL}
        y1={padT + innerH + 0.5}
        x2={W - padR}
        y2={padT + innerH + 0.5}
        stroke="var(--line)"
        strokeWidth={1}
      />
      {bars}
      {leaves}
      {values}
      {labels}
    </svg>
  );
}
