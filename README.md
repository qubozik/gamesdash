# Game Tracker

A personal, self-hosted tracker for **Nintendo Switch / Switch 2** and **Steam**
games. Mark what you **own** and **want**, know each Nintendo physical release's
**cart type** (full cartridge, Switch 2 **Game‑Key Card**, or digital), sync your
whole **Steam library + wishlist**, and plan what to play next with a **backlog
completion planner**. New releases, review scores, and cover art are pulled in and
kept up‑to‑date automatically every week.

> Live: `https://gamesdash.vercel.app` (password protected)

---

## Features

- **Libraries & tabs** — `All` · `Switch` · `Switch 2` · `Steam` · `Planner`. Work
  on each library separately or all together.
- **Owned / Wanted tracking** per game, saved to the database (not browser cache).
- **Steam sync** — your owned library (→ owned) and wishlist (→ wanted), one‑way,
  with playtime and store links.
- **Physical format** tracking (Nintendo) — `Full Cart` · `Key Card` · `Digital Only`
  · `Unknown` — editable, with a badge showing how it was determined.
- **Automatic cart‑type detection** for new games (see [Detection pipeline](#detection-pipeline)).
- **Backlog completion planner** — a prioritized, ordered list across all libraries
  with **drag‑and‑drop** (and up/down) reordering, completion tracking, and progress.
- **IGDB critic scores** and **official cover art** across the catalog; covers link
  to the IGDB / Steam store page.
- **Weekly auto‑sync** (Sundays, 5 AM Eastern): discovers new Switch/Switch 2
  releases, refreshes scores/dates/covers, and re‑syncs Steam.
- **Search, filter and sort**; **clickable stat cards** as one‑click filters.
- **Grid and Table views.**
- **Hide** games you'll never want (excluded by default, with a "Show hidden" toggle).
- **Manually add any game** via built-in **IGDB or Steam search** (or an IGDB link).
- **Password protection** for the whole site and API (single shared password).

---

## Tech stack

- **Next.js 16** (App Router, TypeScript, React 19)
- **Vercel Postgres (Neon)** with **Drizzle ORM**
- **Vercel Cron** for the weekly sync
- **Next.js middleware** for password (Basic Auth)
- External data: **IGDB** (via Twitch app), **Steam Web API** + storefront,
  **Brave Search API**, and an optional **OpenAI‑compatible LLM** (e.g. Ollama Cloud)

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
| `title` | game title |
| `library` | `nintendo` · `steam` |
| `igdb_id` / `igdb_url` | IGDB id + page link (Nintendo) |
| `steam_app_id` / `store_url` | Steam AppID + store link (Steam) |
| `release_date`, `released` | refreshed weekly |
| `platform` | `Switch 2` · `Switch` · `Both` · `Steam` |
| `genre` | jsonb array |
| `physical_format` | `Full Cart` · `Key Card` · `Digital Only` · `Unknown` |
| `format_source` | how the format was set |
| `metacritic_score`, `opencritic_score`, `igdb_rating` | review scores |
| `cover_image_url` | cover art (IGDB or Steam) |
| `playtime_minutes` | from Steam |
| `status` | `owned` · `wanted` · `null` |
| `hidden` | excluded from the default view |
| `backlog_order` | position in the backlog planner (`null` = not in backlog) |
| `completed`, `completed_at` | backlog completion |
| `needs_review` | unconfirmed auto‑detected data |
| `source` | `curated` · `igdb` · `steam` |

---

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/games` | GET | List all games |
| `/api/games/:id` | PATCH | Update `status`, `physicalFormat`, `needsReview`, or `hidden` |
| `/api/games/add` | POST | Add a game by IGDB (`igdbId`/`url`) or Steam (`steamAppId`); runs format detection |
| `/api/igdb/search` | GET | Search IGDB for Switch/Switch 2 games (`?q=`) |
| `/api/steam/search` | GET | Search Steam games (`?q=`) |
| `/api/steam/sync` | GET/POST | Sync Steam owned library + wishlist |
| `/api/backlog` | POST | Backlog actions: `add`/`remove`/`up`/`down`/`complete`/`uncomplete`/`reorder` |
| `/api/sync` | GET/POST | Run the weekly sync incl. Steam (guarded by `CRON_SECRET`) |

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_URL` / `DATABASE_URL` | ✅ | Postgres connection (Neon integration may prefix it, e.g. `SGT_POSTGRES_URL` — auto‑detected) |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | ✅ | Twitch app creds for IGDB (games, scores, covers) |
| `STEAM_API_KEY` / `STEAM_ID` | for Steam | Steam Web API key + your SteamID64 (owned library + wishlist) |
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
| `npx tsx scripts/backfill-igdb-urls.ts` | Backfill IGDB page URLs |
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

## Libraries, tabs & the backlog planner

- **Tabs** (`All / Switch / Switch 2 / Steam / Planner`) scope the stats, filters,
  search, and views to one library at a time — or everything under **All**.
- **Steam games** are digital, so the cart‑format UI is hidden; they show playtime
  and link to their Steam store page.
- **Planner** is a prioritized backlog across every library. Add games with the
  **★ Backlog** button; on the Planner tab, **drag rows** (or use ▲/▼) to reorder,
  mark **✓ Done**, and watch the progress bar.

## Steam sync

One‑way **Steam → app**. Owned games become `owned`; wishlist items become
`wanted`. It never deletes games or overwrites your manual edits. Triggered by the
**Sync Steam** button (Steam tab) and folded into the weekly cron. Requires
`STEAM_API_KEY` + `STEAM_ID`, and a **public** Steam profile (profile + game
details + wishlist).

## Adding games

- **Automatically:** the weekly sync discovers new **Switch 2 / cross‑gen** releases
  above a popularity threshold, and re‑syncs your Steam library.
- **Manually:** click **"+ Add game"**, choose **Nintendo** or **Steam**, search,
  and click **Add**. Nintendo adds run format detection; Steam adds go in as wanted.
  (Pasting an IGDB link still works too.)

## Notes & caveats

- Metacritic/OpenCritic and physical format are not available from any single API,
  which is why detection is best‑effort and confirmable. IGDB's `igdb_rating` is a
  critic aggregate (its own number), not a specific Metacritic/OpenCritic value.
- New games are imported only above a popularity threshold to avoid shovelware.
- The weekly refresh never overwrites your personal fields (owned/wanted, format,
  backlog) or an existing cover. Steam sync is one‑way and non‑destructive.
