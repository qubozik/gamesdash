import { db } from "@/db";
import { games, type NewGame } from "@/db/schema";
import { fetchRecentSwitchGames } from "@/lib/igdb";
import { inArray, sql } from "drizzle-orm";

export type SyncResult = {
  added: number;
  skipped: number;
  addedTitles: string[];
  ranAt: string;
};

/**
 * Pull recent/upcoming Switch & Switch 2 releases from IGDB and add any that we
 * don't already have. New games are flagged `needsReview` with an "Unknown"
 * physical format for you to confirm (IGDB can't tell cart vs. key-card).
 */
export async function runSync(): Promise<SyncResult> {
  const candidates = await fetchRecentSwitchGames();

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
  const existingTitles = new Set(
    existing.map((e) => e.title.toLowerCase()),
  );

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
  if (toInsert.length) {
    const inserted = await db
      .insert(games)
      .values(toInsert)
      .onConflictDoNothing()
      .returning({ title: games.title });
    added = inserted.length;
    addedTitles.push(...inserted.map((r) => r.title));
  }

  return {
    added,
    skipped: candidates.length - added,
    addedTitles,
    ranAt: new Date().toISOString(),
  };
}
