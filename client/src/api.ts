import type { Entry, Stats } from "./types";
import { ApiError } from "./sync";

// Thin typed API client. No business logic here — just fetch + JSON. A non-2xx
// response throws ApiError (carrying the status, so the outbox can distinguish
// a permanent 4xx from a transient 5xx); a failed fetch rejects with the native
// TypeError, which the outbox reads as a network failure.
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status, res.statusText);
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
    if (!res.ok) throw new ApiError(res.status, res.statusText);
  },

  stats: () => {
    const tzOffset = new Date().getTimezoneOffset();
    const today = localDayKey(new Date());
    return fetch(`/api/stats?tzOffset=${tzOffset}&today=${today}`).then(json<Stats>);
  },

  exportText: (format: "csv" | "json") =>
    fetch(`/api/export?format=${format}`).then(async (res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    }),

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
