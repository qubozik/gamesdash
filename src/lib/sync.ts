import { db } from "@/db";
import { games, type NewGame } from "@/db/schema";
import { fetchRecentSwitchGames } from "@/lib/igdb";
import { detectFormat, type FormatDetection } from "@/lib/format-detect";
import { inArray, sql } from "drizzle-orm";

export type SyncResult = {
  added: number;
  skipped: number;
  formatsDetected: number;
  braveLookups: number;
  addedTitles: string[];
  ranAt: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pull recent/upcoming Switch & Switch 2 releases from IGDB, add the new ones,
 * and best-effort detect each one's physical format (Nintendo prior + Brave).
 * High-confidence results are applied and confirmed; medium-confidence are
 * applied but left "needs review"; everything else stays Unknown/needs review.
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
  const existingTitles = new Set(existing.map((e) => e.title.toLowerCase()));

  const newGames = candidates.filter(
    (c) =>
      !existingIgdb.has(c.igdbId) &&
      !existingTitles.has(c.title.toLowerCase()),
  );

  const hasBrave = !!process.env.BRAVE_API_KEY;
  const maxLookups = Number(process.env.SYNC_MAX_FORMAT_LOOKUPS ?? 40);
  let braveLookups = 0;
  let formatsDetected = 0;

  const toInsert: NewGame[] = [];
  for (const c of newGames) {
    const isNintendo = !!c.publisher && /nintendo/i.test(c.publisher);

    let det: FormatDetection = {
      format: "Unknown",
      confidence: "low",
      source: "none",
    };
    if (isNintendo) {
      det = await detectFormat({ title: c.title, publisher: c.publisher });
    } else if (hasBrave && braveLookups < maxLookups) {
      det = await detectFormat({ title: c.title, publisher: c.publisher });
      braveLookups++;
      await sleep(1100); // Brave free tier: ~1 req/sec
    }

    const applied = det.format !== "Unknown" && det.confidence !== "low";
    if (applied) formatsDetected++;

    toInsert.push({
      igdbId: c.igdbId,
      title: c.title,
      releaseDate: c.releaseDate,
      released: c.released,
      platform: c.platform,
      genre: c.genre,
      coverImageUrl: c.coverImageUrl,
      description: c.description,
      physicalFormat: applied ? det.format : "Unknown",
      formatSource: applied ? det.source : null,
      needsReview: !(applied && det.confidence === "high"),
      source: "igdb",
    });
  }

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
    formatsDetected,
    braveLookups,
    addedTitles,
    ranAt: new Date().toISOString(),
  };
}
