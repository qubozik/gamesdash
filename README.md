# Switch Game Tracker

A personal, self-hosted tracker for Nintendo **Switch** and **Switch 2** games.
Mark what you **own** and **want**, and — most importantly — know each physical
release's **cart type**: full game on cartridge, Switch 2 **Game‑Key Card**, or
digital. New releases, review scores, and cover art are pulled in and kept
up‑to‑date automatically every week.

> Live: `https://switch-dashboard-iota.vercel.app` (password protected)

---

## Features

- **Owned / Wanted tracking** per game, saved to the database (not browser cache).
- **Physical format** tracking — `Full Cart` · `Key Card` · `Digital Only` · `Unknown`
  — editable per game, with a badge showing how it was determined.
- **Automatic cart‑type detection** for new games (see [Detection pipeline](#detection-pipeline)).
- **IGDB critic scores** and **official cover art** across the whole catalog.
- **Weekly auto‑sync** (Sundays, 5 AM Eastern): discovers new Switch/Switch 2
  releases, and refreshes existing games' scores, release dates, and missing covers.
- **Search, filter and sort** — by platform, format, status, availability; sort by
  release date, title, or score.
- **Clickable stat cards** (Total / Owned / Wanted / Released / Upcoming / Needs review)
  that act as one‑click filters.
- **Grid and Table views.**
- **Hide** games you'll never want (excluded by default, with a "Show hidden" toggle).
- **Manually add any game** (including Switch 1 titles) by pasting its IGDB link.
- **Password protection** for the whole site and API (single shared password).

---

## Tech stack

- **Next.js 16** (App Router, TypeScript, React 19)
- **Vercel Postgres (Neon)** with **Drizzle ORM**
- **Vercel Cron** for the weekly sync
- **Next.js middleware** for password (Basic Auth)
- External data: **IGDB** (via Twitch app), **Brave Search API**, and an optional
  **OpenAI‑compatible LLM** (e.g. Ollama Cloud)

---

## Detection pipeline

Physical format is genuinely hard data — no single API provides it — so new games
are classified best‑effort, and anything uncertain is left **"needs review"** for
you to confirm. For each new game:

1. **Nintendo first‑party prior** — Nintendo never ships its own games as
   Game‑Key Cards, so a Nintendo‑published title is marked **Full Cart** (high confidence).
2. **Brave Search** retrieves web results for the title.
3. **LLM snippet reader** (if configured) reads those results and classifies the
   format (handles "is **not** a game‑key card" vs. generic mentions). Falls back
   to a regex heuristic if no LLM is configured.
4. Confidence gating: **high** → applied and confirmed; **medium** → applied but
   flagged for review; otherwise left **Unknown / needs review**.

Each game records its `format_source`: `seed` · `nintendo` · `brave` · `llm` · `manual`.

---

## Data model (`games` table)

Key columns:

| Column | Notes |
|---|---|
| `title` | unique |
| `igdb_id` | linked IGDB id (nullable) |
| `igdb_url` | link to the game's IGDB page (cover art links here) |
| `release_date`, `released` | refreshed weekly |
| `platform` | `Switch 2` · `Switch` · `Both` |
| `genre` | jsonb array |
| `physical_format` | `Full Cart` · `Key Card` · `Digital Only` · `Unknown` |
| `format_source` | how the format was set |
| `metacritic_score`, `opencritic_score`, `igdb_rating` | review scores |
| `cover_image_url` | IGDB cover art |
| `status` | `owned` · `wanted` · `null` |
| `hidden` | excluded from the default view |
| `needs_review` | unconfirmed auto‑detected data |
| `source` | `curated` · `igdb` |

---

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/games` | GET | List all games |
| `/api/games/:id` | PATCH | Update `status`, `physicalFormat`, `needsReview`, or `hidden` |
| `/api/games/add` | POST | Add a game by IGDB link/slug (`{ "url": "https://www.igdb.com/games/<slug>" }`); runs format detection |
| `/api/sync` | GET/POST | Run the weekly sync (guarded by `CRON_SECRET`) |

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_URL` / `DATABASE_URL` | ✅ | Postgres connection (Neon integration may prefix it, e.g. `SGT_POSTGRES_URL` — auto‑detected) |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | ✅ | Twitch app creds for IGDB (games, scores, covers) |
| `CRON_SECRET` | ✅ | Protects `/api/sync`; sent automatically by Vercel Cron |
| `BRAVE_API_KEY` | optional | Enables web search for format detection |
| `LLM_API_KEY` | optional | Enables the LLM snippet reader |
| `LLM_BASE_URL` | optional | OpenAI‑compatible base URL (default `https://api.openai.com/v1`; Ollama Cloud: `https://ollama.com/v1`) |
| `LLM_MODEL` | optional | Model name (default `gpt-4o-mini`) |
| `APP_PASSWORD` | optional | Shared password for the whole site; unset = open |
| `SYNC_MAX_FORMAT_LOOKUPS` | optional | Max Brave/LLM lookups per sync run (default 15) |
| `SYNC_MIN_HYPES` / `SYNC_MIN_RATINGS` | optional | Popularity thresholds for importing new games (default 5 / 8) |

---

## Local development

```bash
npm install
cp .env.example .env.local     # fill in values (POSTGRES_URL points at a local Postgres)
npm run db:push                # create tables
npm run db:seed                # load initial catalog from data/games-data.json
npm run dev
```

### Scripts

| Command | What it does |
|---|---|
| `npm run db:push` | Apply the Drizzle schema to the database |
| `npm run db:seed` | Seed from `data/games-data.json` (upserts by title) |
| `npx tsx scripts/backfill-formats.ts` | Detect physical format for unconfirmed games |
| `npx tsx scripts/backfill-scores.ts` | Backfill IGDB critic ratings |
| `npx tsx scripts/fix-covers.ts [--apply]` | Replace local covers with IGDB art |
| `npx tsx scripts/sync-once.ts` | Run the discovery sync locally |

---

## Deploying on Vercel

1. Import the repo into Vercel (framework auto‑detected as Next.js).
2. **Storage → Create Database → Postgres (Neon)** and connect it (sets the DB URL).
3. Add env vars: `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `CRON_SECRET`, and
   optionally `BRAVE_API_KEY`, `LLM_*`, and `APP_PASSWORD`.
4. Push the schema and seed once (from a machine with the DB URL set):
   `npm run db:push && npm run db:seed`.
5. The cron in `vercel.json` runs `/api/sync` every Sunday at **05:00 America/New_York**
   (`0 10 * * 0` UTC).

---

## Adding games

- **Automatically:** the weekly sync discovers new **Switch 2 / cross-gen** releases
  above a popularity threshold.
- **Manually:** click **"+ Add game"**, paste a game's **IGDB link** (from
  [igdb.com](https://www.igdb.com)), and it's fetched and added with cover art,
  score, release info, and best-effort format detection. This is how you add
  specific **Switch 1** titles without importing the whole Switch 1 catalog.

## Notes & caveats

- Metacritic/OpenCritic and physical format are not available from any single API,
  which is why detection is best‑effort and confirmable. IGDB's `igdb_rating` is a
  critic aggregate (its own number), not a specific Metacritic/OpenCritic value.
- New games are imported only above a popularity threshold to avoid shovelware.
- The weekly refresh never overwrites your personal fields (owned/wanted, format)
  or an existing cover.
