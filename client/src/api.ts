import type { Entry, Stats } from "./types";

// Thin typed API client. No business logic here — just fetch + JSON.
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  listEntries: () => fetch("/api/entries").then(json<Entry[]>),

  createEntry: (patch: Partial<Entry> = {}) =>
    fetch("/api/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<Entry>),

  updateEntry: (id: string, patch: Partial<Entry>) =>
    fetch(`/api/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<Entry>),

  deleteEntry: async (id: string) => {
    const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  },

  stats: () => {
    const tzOffset = new Date().getTimezoneOffset();
    const today = localDayKey(new Date());
    return fetch(`/api/stats?tzOffset=${tzOffset}&today=${today}`).then(json<Stats>);
  },

  exportUrl: (format: "csv" | "json") => `/api/export?format=${format}`,

  importEntries: (entries: unknown[], replace: boolean) =>
    fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, replace }),
    }).then(json<{ imported: number }>),
};

export function localDayKey(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
