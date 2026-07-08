# Untangle 🌿

A private tracker for trichotillomania (hair-pulling). A React frontend and a
small Node API, with your data in a local SQLite database — self-hosted, not a
third-party cloud.

> Untangle is a personal self-monitoring aid, not medical advice or a
> substitute for professional care. If you're struggling, a therapist trained
> in Habit Reversal Training (HRT) can help.

## What it does

- **Today** — big count + one large *Log a pull* button. Each entry expands to
  record where (multi-select, head-specific), trigger/feeling (multi-select),
  automatic vs. focused, and a note. Urges you *resisted* are worth logging too.
- **Trends** — today / week / month / daily average / calm streak, plus soft
  bar charts for the last 7 and 30 days. Zero-days show a leaf 🌿.
- **Export** — CSV or JSON, e.g. for backups or to review with a therapist.

## Run it (dev)

Requires Node. SQLite needs no separate service — the database is a local file.

```sh
# backend — Fastify API on :3001, creates ./untangle.db
cd server && npm install && npm run dev

# frontend — Vite on :5173, proxies /api → :3001 (separate terminal)
cd client && npm install && npm run dev
```

Then open http://localhost:5173. Config lives in `server/.env` (`DATABASE_FILE`
defaults to `./untangle.db`); copy `server/.env.example` to start. Deployment
comes later.

## Privacy

Data lives in a SQLite file (`untangle.db`) on the server you run, not in a
third-party cloud. It's never sent to external services. Back up by copying the
`.db` file or using **Export JSON**. The only external request is to Google
Fonts; offline, the app falls back to system fonts.

## Develop

See [`CLAUDE.md`](./CLAUDE.md) for architecture, the data-layering /
`EntryRepo` storage boundary, data model, design tokens, and conventions, and
[`docs/ROADMAP.md`](./docs/ROADMAP.md) for the backlog.

The stack is a **React + Vite** client (`client/`) and a **Node + Fastify** API
(`server/`) over a JSON REST API, backed by **SQLite**. Storage access goes
through a repository interface so the database can be swapped later without
touching routes or the frontend.

## License

Personal project — add a license of your choice.
