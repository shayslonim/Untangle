# CLAUDE.md — Untangle

Context for Claude Code. Read this first before making changes.

## What this is

**Untangle** is a private web app for tracking trichotillomania (compulsive
hair-pulling). It's a personal self-monitoring tool — the kind used alongside
Habit Reversal Training (HRT) / the Comprehensive Behavioral (ComB) model —
not a medical device and not a substitute for professional care. Keep that
framing in any copy you write: supportive, non-judgmental, no clinical claims,
no diagnosis.

Privacy is a core feature. Data belongs to the user and never leaves the
system except to the user's own backend. Don't add third-party analytics,
trackers, or external data calls.

> **History:** Untangle began as a single offline `untangle.html` file with
> `localStorage`. It is being rebuilt as a client/server app (below). The old
> single-file version may still exist in git history / `untangle.html` as a
> reference for UI, copy, and the therapeutic model — reuse its markup, CSS
> tokens, and wording, but new work targets the architecture described here.

## Architecture

A **React + Vite frontend** talking to a **Node + Fastify backend** over a
JSON REST API, with **SQLite** for storage. SQLite is the right fit: this is a
single-user (at most a handful) app, and the DB is just a file — no service to
run. Postgres is a documented future option if scale ever demands it; the data
layering below is designed so that swap costs almost nothing above the repo.

**Storage backends.** Two `EntryRepo` implementations exist, chosen at boot by
env (see `server/src/index.ts`):
- `db/sqlite/` — local file via Node's `node:sqlite`. The dev default.
- `db/libsql/` — **Turso / libSQL**, for persistent off-box storage in prod
  (Render's disk is ephemeral). Set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
  to enable it. By default it runs as an **embedded replica**: a local file
  (`LIBSQL_REPLICA_FILE`) kept in sync with the remote, so reads are
  local-disk fast and Turso is the durable source of truth. Turso is
  SQLite-compatible, so the schema, migrations, and the `dailyCounts`
  aggregation SQL are identical to the SQLite repo.

```
untangle-repo/
  client/            # React + Vite SPA
    src/
    index.html
    vite.config.ts
  server/            # Node + Fastify API
    src/
      index.ts       # Fastify app + route registration
      routes/        # entry routes — depend on EntryRepo, never on SQL
      domain/        # domain models (Entry, Mode) + API DTO types
      db/
        repo.ts      # EntryRepo interface (the storage boundary)
        sqlite/      # SQLite implementation: row types, mappers, migrations
    package.json
  docs/
    ROADMAP.md
```

### Frontend (`client/`)
- React + Vite, TypeScript. SPA with two views (Today, Trends), same as the
  original app.
- Talks to the backend via a small typed API client (`fetch`) — no data logic
  in components beyond calling the API and rendering.
- Charts stay **hand-drawn SVG** ("soft hills", sage leaf for zero-days). No
  chart library — it's part of the app's identity and keeps the bundle small.
- Carry over the design tokens, copy, and interaction rules below.

### Backend (`server/`)
- Node + Fastify, TypeScript. Exposes a JSON REST API. No server-rendered HTML.
- Owns all persistence and any derived stats that are cheaper to compute in
  SQL (daily counts, streaks).
- Routes depend on the **`EntryRepo` interface**, never on the SQL driver
  directly. See "Data layering" below — this is the boundary that keeps the
  server storage-agnostic.
- In dev, Vite proxies `/api/*` to the Fastify server. In prod (deploy later)
  the API and the built static frontend are served together or on separate
  hosts — TBD at deploy time.

### API surface (initial)
- `GET    /api/entries` — list entries (optionally by date range)
- `POST   /api/entries` — create an entry
- `PATCH  /api/entries/:id` — edit an entry
- `DELETE /api/entries/:id` — remove an entry
- `GET    /api/stats` — derived daily counts / streaks for Trends
- `GET    /api/export?format=csv|json` — export
- `POST   /api/import` — restore from a JSON backup

## How to run (dev)

Requires Node. SQLite needs no separate service — the DB is a local file.

```
# backend
cd server && npm install && npm run dev      # Fastify on :3001, creates ./untangle.db

# frontend (separate terminal)
cd client && npm install && npm run dev       # Vite on :5173, proxies /api → :3001
```

The DB file path is configured via `DATABASE_FILE` in `server/.env` (default
`./untangle.db`). Keep the `.db` file out of git. Deployment is out of scope
for now — **we'll deploy later.**

## Data layering (the storage boundary)

Three representations of an entry, with mappers between them. This is what
lets us change the database later without touching routes or the frontend.

```
   DB rows              domain model          API payloads
  (persistence)   ←→    (server logic)   ←→   (HTTP wire)
   EntryRow             Entry                 EntryDTO
        \___ mapper ___/      \___ toDTO ___/
```

- **`EntryRow`** — shaped by the storage engine. In SQLite, `sites`/`triggers`
  are JSON-encoded `TEXT`, `ts` is an ISO `TEXT` string. Lives in `db/sqlite/`.
- **`Entry`** — the clean domain model the server reasons about: real
  `string[]` arrays, a `Date`, `Mode | null`. Lives in `domain/`.
- **`EntryDTO`** — the wire shape the React client consumes (arrays as-is, `ts`
  as an ISO string). Kept separate from `Entry` so DB/internal fields (like
  `userId`) never leak into the public API by accident.

Rules:
- **Routes talk to `EntryRepo`, which returns `Entry` domain objects.** No SQL
  and no `EntryRow` above the repo; no `EntryDTO` below the route layer.
- All DB-specific encoding (JSON arrays, ISO timestamps, dialect quirks) is
  trapped inside the repo's mappers. A future Postgres repo supplies a new
  `EntryRow` + mapper and nothing above it changes.
- The one genuinely engine-specific spot is aggregation SQL (`dailyStats`) —
  it's isolated in the repo by design, so a swap rewrites exactly that method.

```ts
// db/repo.ts — the contract routes depend on
export interface EntryRepo {
  list(userId: string, range?: DateRange): Promise<Entry[]>;
  create(e: NewEntry): Promise<Entry>;
  update(id: string, patch: Partial<Entry>): Promise<Entry>;
  remove(id: string): Promise<void>;
  dailyStats(userId: string): Promise<DayStat[]>;
}
```

## Data model

SQLite is the source of truth, accessed via Node's built-in **`node:sqlite`**
(`DatabaseSync`) — no native module to compile, no extra dependency. An entry
is one row:

```sql
CREATE TABLE entries (
  id        TEXT PRIMARY KEY,        -- Date.now() + random suffix, or a uuid
  user_id   TEXT NOT NULL,           -- accounts; may be a single fixed user for now
  ts        TEXT NOT NULL,           -- ISO 8601 timestamp of the pull
  sites     TEXT NOT NULL DEFAULT '[]',   -- JSON array, multi-select, may be empty
  triggers  TEXT NOT NULL DEFAULT '[]',   -- JSON array, multi-select, may be empty
  mode      TEXT,                    -- 'Automatic' | 'Focused' | NULL
  note      TEXT NOT NULL DEFAULT ''
);
```

Notes:
- **Counts are derived, never stored.** Group entries by local calendar day to
  get daily counts. Don't add a stored counter — it will drift. Prefer a SQL
  aggregation in the repo's `dailyStats`.
- `sites` / `triggers` are JSON-encoded arrays at rest; the SQLite mapper
  parses them into real `string[]` on the `Entry` domain object. On Postgres
  these would become native `text[]` — only the row type + mapper change.
- `user_id` is the one field the server adds over the original localStorage
  model. Auth can start as a single hardcoded user and grow into real accounts
  later.

### Migrations
Schema changes go through versioned SQL migrations in `server/src/db/sqlite/`.
Never silently drop user data. If you're importing from the old single-file
app's JSON export, map legacy scalar `site` / `trigger` fields to the
`sites` / `triggers` arrays during import.

## Therapeutic grounding (keep accurate)

- **Automatic pulling** = outside awareness (while reading, scrolling, TV).
  Helped by awareness-building + physical barriers.
- **Focused pulling** = deliberate, urge- or emotion-driven. Helped by
  emotion regulation + urge-management.
- Self-monitoring fields that matter: time, count, **site(s)**, **trigger/
  emotion**, **automatic vs focused**, and free note. Logging *resisted
  urges* is valuable too — the note field currently invites this.
- Framing rule: low/zero days are wins (hence the leaf marker and the
  "calm streak" stat). Never scold via copy or color; avoid alarm-red.

## Design tokens (source of truth in the frontend's CSS variables / theme)

- paper `#F7F4F0`, ink `#413B4E`, ink-soft `#7A7488`, line `#EAE4DD`
- periwinkle `#AEB6EC`, sage `#AFD8C4`, blush `#F1C4CF`, butter `#F3E3B0`
- lilac `#8B82D8` (actions), lilac-deep `#6F66C4` (hover/active)
- Display face: **Fraunces** (the big count, headings). UI/body: **Nunito
  Sans**. Both from Google Fonts with system fallbacks.
- Entry left-border encodes mode: periwinkle default, sage = automatic,
  blush = focused. Tag pill colors: site=periwinkle, trigger=blush,
  mode=sage. Keep this mapping consistent if you add UI.

## Conventions

- TypeScript on both client and server. Share entry types between them (a
  shared type module or a small `shared/` package) so the API contract stays
  honest.
- Frontend uses React; keep data/business logic in the API and hooks, not
  scattered through components.
- Charts stay hand-drawn SVG — no chart library.
- No third-party analytics/trackers or external data calls beyond Google Fonts.
- All colors via the design tokens above — no hardcoded hex in new CSS.
- Respect `prefers-reduced-motion` and keep visible focus rings.
- Copy style: sentence case, plain verbs, warm and non-clinical.
- Keep the `EntryRow → Entry → EntryDTO` layering intact; don't let SQL rows
  or DTOs cross their boundaries (see "Data layering").
- Never commit secrets or the `.db` file; use `.env` + `.env.example`.

## Roadmap / backlog

See `docs/ROADMAP.md`. Highest-value next items:
1. **Auth / accounts** — even a single-user login, so `user_id` is real.
2. **JSON import** (restore a backup / migrate from the old single-file app).
3. **"Urge resisted" logging** as a distinct, celebrated action.
4. **Competing-response prompt** (core HRT technique) on log.
5. Trends filters (by site / by mode) and time-of-day heatmap.

## Testing

Aim for unit tests on the server (stats/streak math, the row↔domain mappers,
migrations, import mapping) and API integration tests against a throwaway
SQLite file (or an in-memory `:memory:` DB). Frontend: component tests for the
log form and Trends rendering. A manual smoke checklist lives in
`docs/ROADMAP.md`.
