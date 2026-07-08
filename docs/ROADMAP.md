# Roadmap

> **Architecture note:** Untangle is being rebuilt from the original single-file
> `untangle.html` (localStorage) into a **React + Vite** client and a **Node +
> Fastify** API backed by **SQLite**. Items below marked _(from single-file)_
> describe features that exist in the old app and need porting to the new
> client/server stack. See [`CLAUDE.md`](../CLAUDE.md).

## Foundations (the rebuild)
- Scaffold `client/` (React + Vite) and `server/` (Fastify) with shared types.
- SQLite schema + versioned migrations in `server/src/db/sqlite/`.
- `EntryRepo` interface + SQLite implementation; `EntryRow → Entry → EntryDTO`
  mappers (the storage boundary — see CLAUDE.md "Data layering").
- REST API: entries CRUD, `/api/stats`, `/api/export`, `/api/import`.
- Port the Today + Trends UI, design tokens, and hand-drawn SVG charts.

## Feature parity to port _(from single-file)_
- Today view: instant log, timestamped timeline, per-entry delete.
- Per-entry detail: multi-select **sites**, multi-select **triggers/feelings**,
  automatic-vs-focused, free note.
- Trends: today / week / month / daily-average / calm-streak stats; hand-drawn
  7-day and 30-day SVG charts; zero-day leaf markers.
- CSV + JSON export.
- Responsive (mobile bottom-nav / desktop top-nav), reduced-motion, focus rings.
- Import mapping for legacy single-value `site`/`trigger` → arrays (used when
  importing an old single-file JSON export).

## Next (high value)
1. **Auth / accounts** — even a single-user login, so `user_id` is real and the
   API isn't wide open.
2. **JSON import** — endpoint + file picker that validates and merges/replaces
   entries. Pairs with export; enables backup restore + device moves.
3. **"Urge resisted" action** — a second, celebrated log type (distinct from a
   pull). Store `type: "pull" | "resisted"`; count separately in Trends.
4. **Competing-response prompt** — on log, optionally surface an HRT competing
   response (e.g. clench fists 60s). Configurable.

## Later / nice-to-have
- Trends filters: by site, by mode; time-of-day heatmap to expose patterns.
- Editable timestamp / back-dating an entry.
- Streak/goal encouragement (gentle, opt-in).
- Weekly summary the user can copy to bring to a therapist.
- Light/dark and alternate pastel themes.
- Data reset / "clear all" with confirm.
- Deployment: host the built client + API and provision the SQLite file.

## Constraints to preserve
- Storage access goes through `EntryRepo`; routes never touch SQL directly and
  the `EntryRow`/`Entry`/`EntryDTO` layers don't cross their boundaries.
- Charts stay hand-drawn SVG — no chart library.
- No third-party analytics/trackers or external data calls beyond Google Fonts;
  data stays on the server the user runs.
- Non-judgmental, non-clinical tone; no diagnosis or medical claims.

## Manual smoke test
1. Fresh DB → Today shows count 0, leaf shown, empty timeline.
2. **Log a pull** → count increments, entry appears with time; persists across
   a page reload (data is server-side now, not localStorage).
3. Expand entry → pick multiple sites + triggers, set mode, type note → reload →
   all detail persists; tags render on the row.
4. Delete an entry → count decrements, persists across reload.
5. Trends → stats match; charts render; a day with 0 shows a leaf.
6. Export CSV and JSON → files download; multi-values joined by " | " in CSV.
7. Import a JSON backup → entries appear; legacy `site`/`trigger` map to arrays.
8. Resize to ~360px and to desktop → nav swaps, layout holds.
9. Restart the server → data is still there (SQLite file persisted).
