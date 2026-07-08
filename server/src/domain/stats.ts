// Pure Trends math. No DB, no HTTP — unit-testable in isolation.
// Counts are always derived from per-day tallies; nothing is stored.

export interface DayCount {
  day: string; // local calendar day "YYYY-MM-DD"
  count: number;
}

export interface DayPoint {
  key: string; // "YYYY-MM-DD"
  count: number;
}

export interface Stats {
  today: number;
  week: number; // sum over last 7 local days
  month: number; // sum over last 30 local days
  avg: number; // per-day average since first entry
  streak: number; // full calm days since the most recent entry
  streakLabel: string;
  weekSeries: DayPoint[]; // 7 points, oldest→newest
  monthSeries: DayPoint[]; // 30 points, oldest→newest
}

// Add `n` days to a "YYYY-MM-DD" key using UTC arithmetic (DST-safe: we treat
// the key as a plain date, never a wall-clock instant).
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const au = Date.UTC(ay, am - 1, ad);
  const bu = Date.UTC(by, bm - 1, bd);
  return Math.round((bu - au) / 86400000);
}

function series(counts: Map<string, number>, todayKey: string, n: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i);
    out.push({ key, count: counts.get(key) ?? 0 });
  }
  return out;
}

// `dayCounts` is the full set of local-day tallies from the repo.
// `todayKey` is the client's current local calendar day.
export function computeStats(dayCounts: DayCount[], todayKey: string): Stats {
  const counts = new Map<string, number>();
  let total = 0;
  let firstKey: string | null = null;
  let lastKey: string | null = null;
  for (const { day, count } of dayCounts) {
    counts.set(day, count);
    total += count;
    if (firstKey === null || day < firstKey) firstKey = day;
    if (lastKey === null || day > lastKey) lastKey = day;
  }

  const weekSeries = series(counts, todayKey, 7);
  const monthSeries = series(counts, todayKey, 30);
  const week = weekSeries.reduce((s, d) => s + d.count, 0);
  const month = monthSeries.reduce((s, d) => s + d.count, 0);
  const today = counts.get(todayKey) ?? 0;

  let avg = 0;
  if (firstKey) {
    const days = Math.max(1, daysBetween(firstKey, todayKey) + 1);
    avg = total / days;
  }

  let streak = 0;
  let streakLabel = "Calm streak (days)";
  if (lastKey) {
    streak = Math.max(0, daysBetween(lastKey, todayKey));
  } else {
    streakLabel = "Start when ready";
  }

  return { today, week, month, avg, streak, streakLabel, weekSeries, monthSeries };
}
