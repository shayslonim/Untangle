// Wire types — mirror the server's EntryDTO / Stats. (In a larger setup these
// would live in a shared package; duplicated here to keep the scaffold simple.)

export type Mode = "Automatic" | "Focused";

export const SITES = [
  "Crown",
  "Hairline / front",
  "Temples / sides",
  "Back / nape",
  "Scalp (general)",
  "Eyebrows",
  "Eyelashes",
  "Beard / face",
  "Mustache",
  "Arms",
  "Legs",
  "Other",
];

export const TRIGGERS = [
  "Stress",
  "Anxiety",
  "Boredom",
  "Tired",
  "Thinking",
  "Sadness",
  "Itchiness",
  "Screen time",
  "Idle hands",
  "In bed",
  "Bathroom / mirror",
  "Other",
];

export const MODES: Mode[] = ["Automatic", "Focused"];

export interface Entry {
  id: string;
  ts: string; // ISO
  sites: string[];
  triggers: string[];
  mode: Mode | null;
  note: string;
  resisted: boolean;
}

export interface DayPoint {
  key: string;
  count: number;
}

export interface Stats {
  today: number;
  week: number;
  month: number;
  avg: number;
  streak: number;
  streakLabel: string;
  weekSeries: DayPoint[];
  monthSeries: DayPoint[];
}
