import { db } from "@/db";
import { games } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import Dashboard from "@/components/Dashboard";
import type { Game, GameStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = await db
    .select()
    .from(games)
    .orderBy(sql`${games.releaseDate} DESC NULLS LAST`, desc(games.id));

  const initialGames: Game[] = rows.map((r) => ({
    id: r.id,
    igdbId: r.igdbId,
    title: r.title,
    releaseDate: r.releaseDate,
    released: r.released,
    platform: r.platform,
    genre: r.genre ?? [],
    priceUsd: r.priceUsd,
    physicalFormat: r.physicalFormat,
    formatSource: r.formatSource,
    metacriticScore: r.metacriticScore,
    opencriticScore: r.opencriticScore,
    coverImageUrl: r.coverImageUrl,
    howLongToBeatHours: r.howLongToBeatHours,
    isMultiplayer: r.isMultiplayer,
    isLocalCoop: r.isLocalCoop,
    isRemake: r.isRemake,
    fps: r.fps,
    targetLink: r.targetLink,
    iam8bitLink: r.iam8bitLink,
    description: r.description,
    status: (r.status as GameStatus) ?? null,
    needsReview: r.needsReview,
    source: r.source,
  }));

  return <Dashboard initialGames={initialGames} />;
}
