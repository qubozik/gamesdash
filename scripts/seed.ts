/**
 * Seed the database from the original curated data (data/games-data.json).
 * Safe to re-run: it upserts by title so personal `status` is preserved.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as dsql } from "drizzle-orm";
import { games, type NewGame } from "../src/db/schema";

type RawGame = {
  title: string;
  release_date: string | null;
  released: boolean;
  platform: string;
  genre: string[];
  price_usd: number | null;
  physical_format: string;
  metacritic_score: number | null;
  opencritic_score: number | null;
  cover_image_url: string | null;
  how_long_to_beat_hours: number | null;
  is_multiplayer: boolean;
  is_local_coop: boolean;
  is_remake: boolean;
  remake_original_title: string | null;
  remake_original_year: number | null;
  remake_original_console: string | null;
  fps: string | null;
  target_link: string | null;
  iam8bit_link: string | null;
  special_physical_retailers: string[];
  description: string | null;
};

function isoDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

async function main() {
  const connectionString =
    process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  if (!connectionString) throw new Error("POSTGRES_URL not set");

  const client = postgres(connectionString, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { games } });

  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "data", "games-data.json"), "utf8"),
  ) as { games: RawGame[] };

  const rows: NewGame[] = raw.games.map((g) => ({
    title: g.title,
    releaseDate: isoDate(g.release_date),
    released: g.released,
    platform: g.platform,
    genre: g.genre ?? [],
    priceUsd: g.price_usd,
    physicalFormat: g.physical_format || "Unknown",
    formatSource: "seed",
    metacriticScore: g.metacritic_score,
    opencriticScore: g.opencritic_score,
    coverImageUrl: g.cover_image_url,
    howLongToBeatHours: g.how_long_to_beat_hours,
    isMultiplayer: !!g.is_multiplayer,
    isLocalCoop: !!g.is_local_coop,
    isRemake: !!g.is_remake,
    remakeOriginalTitle: g.remake_original_title,
    remakeOriginalYear: g.remake_original_year,
    remakeOriginalConsole: g.remake_original_console,
    fps: g.fps,
    targetLink: g.target_link,
    iam8bitLink: g.iam8bit_link,
    specialPhysicalRetailers: g.special_physical_retailers ?? [],
    description: g.description,
    source: "curated",
    needsReview: false,
  }));

  let inserted = 0;
  for (const row of rows) {
    // Upsert by title; do not clobber personal status on re-seed.
    await db
      .insert(games)
      .values(row)
      .onConflictDoUpdate({
        target: games.title,
        set: {
          releaseDate: row.releaseDate,
          released: row.released,
          platform: row.platform,
          genre: row.genre,
          priceUsd: row.priceUsd,
          physicalFormat: row.physicalFormat,
          metacriticScore: row.metacriticScore,
          opencriticScore: row.opencriticScore,
          coverImageUrl: row.coverImageUrl,
          howLongToBeatHours: row.howLongToBeatHours,
          description: row.description,
          lastUpdated: dsql`now()`,
        },
      });
    inserted++;
  }

  console.log(`Seeded ${inserted} games.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
