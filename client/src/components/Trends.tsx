import type { Stats } from "../types";
import { api } from "../api";
import { BarChart } from "./BarChart";

export function Trends({ stats }: { stats: Stats | null }) {
  if (!stats) return <section className="view">Loading…</section>;

  const cards = [
    { n: stats.today, k: "Today" },
    { n: stats.week, k: "This week" },
    { n: stats.month, k: "This month" },
    { n: stats.avg.toFixed(1), k: "Daily average" },
  ];

  return (
    <section className="view">
      <div className="stats">
        {cards.map((c) => (
          <div className="stat" key={c.k}>
            <div className="n">{c.n}</div>
            <div className="k">{c.k}</div>
          </div>
        ))}
        <div className="stat calm">
          <div className="n">{stats.streak}</div>
          <div className="k">{stats.streakLabel}</div>
        </div>
      </div>

      <h2 className="chart-title">Last 7 days</h2>
      <BarChart data={stats.weekSeries} variant="week" />

      <h2 className="chart-title">Last 30 days</h2>
      <BarChart data={stats.monthSeries} variant="month" />

      <div className="export-row">
        <a className="btn ghost" href={api.exportUrl("csv")}>
          Export CSV
        </a>
        <a className="btn ghost" href={api.exportUrl("json")}>
          Export JSON
        </a>
      </div>
    </section>
  );
}
