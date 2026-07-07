# Switch Game Tracker

A personal Nintendo Switch / Switch 2 game tracker. Mark games as **owned** or
**wanted**, and record the physical release type — **Full Cart**, **Key Card**,
**Digital Only**, or **Unknown** (needs review).

Built with Next.js (App Router) + Vercel Postgres (Drizzle ORM). A weekly job
discovers new releases from IGDB.

## Features
- Owned / Wanted tracking per game.
- Physical format tracking (full cart vs. key card vs. code-in-box).
- Search, filter (platform, format, status, availability) and sort.
- Weekly sync (Sundays 05:00 America/New_York) that adds newly announced Switch / Switch 2
  games from IGDB, flagged "needs review" for you to set the physical format.

## Tech
- Next.js 16 (App Router, TypeScript)
- Vercel Postgres + Drizzle ORM
- Vercel Cron for the weekly sync

## Local development
```bash
npm install
cp .env.example .env.local   # then fill in values
npm run db:push              # create tables
npm run db:seed              # load initial catalog from data/games-data.json
npm run dev
```

## Environment variables
| Variable | Purpose |
|---|---|
| `POSTGRES_URL` | Postgres connection (auto-set by Vercel Postgres) |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch app creds for IGDB (sync job) |
| `CRON_SECRET` | Protects `/api/sync`; sent automatically by Vercel Cron |

## API
- `GET /api/games` — list all games
- `PATCH /api/games/:id` — update `status`, `physicalFormat`, or `needsReview`
- `GET /api/sync` — run the IGDB sync (protected by `CRON_SECRET`)

## Deploying on Vercel
1. Import the repo into Vercel (framework auto-detected as Next.js).
2. Add **Vercel Postgres** to the project (Storage tab) — sets `POSTGRES_URL`.
3. Add env vars: `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `CRON_SECRET`.
4. Push schema + seed once (from a machine with `POSTGRES_URL` set):
   `npm run db:push && npm run db:seed`.
5. The cron in `vercel.json` runs `/api/sync` every Sunday at 05:00 Eastern
   (`0 10 * * 0` UTC; 6:00 AM during daylight saving).
