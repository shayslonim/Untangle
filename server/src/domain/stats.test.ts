import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, computeStats } from "./stats.js";

test("addDays walks the calendar", () => {
  assert.equal(addDays("2026-07-08", 1), "2026-07-09");
  assert.equal(addDays("2026-07-01", -1), "2026-06-30");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("computeStats derives today/week/month sums", () => {
  const s = computeStats(
    [
      { day: "2026-07-08", count: 2 },
      { day: "2026-07-05", count: 1 },
      { day: "2026-06-20", count: 5 },
    ],
    "2026-07-08"
  );
  assert.equal(s.today, 2);
  assert.equal(s.week, 3); // 08 + 05 within last 7 days
  assert.equal(s.month, 8); // all three within last 30 days
  assert.equal(s.weekSeries.length, 7);
  assert.equal(s.monthSeries.length, 30);
});

test("streak counts calm days since the last entry", () => {
  const s = computeStats([{ day: "2026-07-05", count: 1 }], "2026-07-08");
  assert.equal(s.streak, 3);
});

test("empty history reads as 'start when ready'", () => {
  const s = computeStats([], "2026-07-08");
  assert.equal(s.streak, 0);
  assert.equal(s.streakLabel, "Start when ready");
  assert.equal(s.avg, 0);
});
