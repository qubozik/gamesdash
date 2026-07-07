/**
 * One-off local sync runner for testing (bypasses the Next.js server).
 * Uses the same IGDB fetch + merge logic as /api/sync.
 *
 *   npx tsx scripts/sync-once.ts
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray, sql } from "drizzle-orm";
import { games, type NewGame } from "../src/db/schema";
import { fetchRecentSwitchGames } from "../src/lib/igdb";

async function main() {
  const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  if (!cs) throw new Error("POSTGRES_URL not set");
  const client = postgres(cs, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { games } });

  console.log("Fetching from IGDB...");
  const candidates = await fetchRecentSwitchGames();
  console.log(`IGDB returned ${candidates.length} candidate games.`);

  const igdbIds = candidates.map((c) => c.igdbId);
  const titles = candidates.map((c) => c.title);
  const existing = igdbIds.length
    ? await db
        .select({ igdbId: games.igdbId, title: games.title })
        .from(games)
        .where(
          sql`${inArray(games.igdbId, igdbIds)} OR ${inArray(games.title, titles)}`,
        )
    : [];
  const existingIgdb = new Set(
    existing.map((e) => e.igdbId).filter((x): x is number => x != null),
  );
  const existingTitles = new Set(existing.map((e) => e.title.toLowerCase()));

  const toInsert: NewGame[] = candidates
    .filter(
      (c) =>
        !existingIgdb.has(c.igdbId) &&
        !existingTitles.has(c.title.toLowerCase()),
    )
    .map((c) => ({
      igdbId: c.igdbId,
      title: c.title,
      releaseDate: c.releaseDate,
      released: c.released,
      platform: c.platform,
      genre: c.genre,
      coverImageUrl: c.coverImageUrl,
      description: c.description,
      physicalFormat: "Unknown",
      source: "igdb",
      needsReview: true,
    }));

  let added = 0;
  const addedTitles: string[] = [];
  for (const row of toInsert) {
    const res = await db
      .insert(games)
      .values(row)
      .onConflictDoNothing()
      .returning({ title: games.title });
    if (res.length) {
      added++;
      addedTitles.push(res[0].title);
    }
  }

  console.log(`Added ${added}, skipped ${candidates.length - added}.`);
  console.log("Added titles:");
  addedTitles.slice(0, 40).forEach((t) => console.log("  -", t));
  if (addedTitles.length > 40) console.log(`  ...and ${addedTitles.length - 40} more`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
