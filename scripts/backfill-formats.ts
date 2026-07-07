/**
 * Backfill physical formats for existing games with Unknown format.
 * Pulls publisher info from IGDB (for the Nintendo prior) then uses Brave.
 *
 *   npx tsx scripts/backfill-formats.ts
 *
 * Requires POSTGRES_URL/DATABASE_URL, IGDB_CLIENT_ID/SECRET, BRAVE_API_KEY.
 */
import "dotenv/config";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql as dsql } from "drizzle-orm";
import { games } from "../src/db/schema";
import { fetchRecentSwitchGames } from "../src/lib/igdb";
import { detectFormat } from "../src/lib/format-detect";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  if (!cs) throw new Error("POSTGRES_URL not set");
  const client = postgres(cs, { prepare: false, max: 1 });
  const db = drizzle(client, { schema: { games } });

  // Build publisher lookup from IGDB (title + igdbId -> publisher).
  console.log("Fetching IGDB catalog for publisher info...");
  const catalog = await fetchRecentSwitchGames({ sinceDays: 900, untilDays: 500 });
  const pubByTitle = new Map<string, string | null>();
  const pubByIgdb = new Map<number, string | null>();
  for (const c of catalog) {
    pubByTitle.set(c.title.toLowerCase(), c.publisher);
    pubByIgdb.set(c.igdbId, c.publisher);
  }

  const targets = await db
    .select({ id: games.id, title: games.title, igdbId: games.igdbId })
    .from(games)
    .where(eq(games.physicalFormat, "Unknown"));

  console.log(`Detecting formats for ${targets.length} Unknown games...`);
  let applied = 0;
  const counts: Record<string, number> = {};
  for (const g of targets) {
    const publisher =
      (g.igdbId != null ? pubByIgdb.get(g.igdbId) : undefined) ??
      pubByTitle.get(g.title.toLowerCase()) ??
      null;
    const isNintendo = !!publisher && /nintendo/i.test(publisher);

    const det = await detectFormat({ title: g.title, publisher });
    if (!isNintendo) await sleep(1100); // throttle Brave

    if (det.format !== "Unknown" && det.confidence !== "low") {
      await db
        .update(games)
        .set({
          physicalFormat: det.format,
          formatSource: det.source,
          needsReview: det.confidence !== "high",
          lastUpdated: dsql`now()`,
        })
        .where(eq(games.id, g.id));
      applied++;
      const key = `${det.format} (${det.source}/${det.confidence})`;
      counts[key] = (counts[key] ?? 0) + 1;
      console.log(`  ✓ ${g.title} -> ${det.format} [${det.source}/${det.confidence}]`);
    }
  }

  console.log(`\nApplied ${applied}/${targets.length}. Breakdown:`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}  ${k}`);
  }
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
