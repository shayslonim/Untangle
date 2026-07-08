// Domain model for a logged pull (or resisted urge, later).
// This is what the server reasons about: real arrays, a Date, a typed mode.
// It is deliberately separate from the DB row shape (see db/sqlite) and from
// the API DTO (below) — that layering is the storage boundary described in
// CLAUDE.md.

export type Mode = "Automatic" | "Focused";

export const MODES: Mode[] = ["Automatic", "Focused"];

export interface Entry {
  id: string;
  userId: string;
  ts: Date;
  sites: string[];
  triggers: string[];
  mode: Mode | null;
  note: string;
  resisted: boolean; // an urge the user resisted, not a pull — never counted
}

// Fields accepted when creating/updating from the client. `id`/`ts` are
// server-assigned on create; everything else is optional-with-defaults.
export interface EntryInput {
  ts?: string; // ISO; defaults to now on create
  sites?: string[];
  triggers?: string[];
  mode?: Mode | null;
  note?: string;
  resisted?: boolean;
}

// The wire shape the client consumes. Kept separate from `Entry` so internal
// fields (like userId) never leak into the public API by accident.
export interface EntryDTO {
  id: string;
  ts: string; // ISO 8601
  sites: string[];
  triggers: string[];
  mode: Mode | null;
  note: string;
  resisted: boolean;
}

export function toDTO(e: Entry): EntryDTO {
  return {
    id: e.id,
    ts: e.ts.toISOString(),
    sites: e.sites,
    triggers: e.triggers,
    mode: e.mode,
    note: e.note,
    resisted: e.resisted,
  };
}

function isMode(v: unknown): v is Mode {
  return v === "Automatic" || v === "Focused";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

// Normalise raw JSON from the client into a validated EntryInput.
export function parseInput(body: unknown): EntryInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const input: EntryInput = {};
  if (typeof b.ts === "string") input.ts = b.ts;
  if ("sites" in b) input.sites = asStringArray(b.sites);
  if ("triggers" in b) input.triggers = asStringArray(b.triggers);
  if ("mode" in b) input.mode = isMode(b.mode) ? b.mode : null;
  if (typeof b.note === "string") input.note = b.note;
  if ("resisted" in b) input.resisted = b.resisted === true;
  return input;
}
