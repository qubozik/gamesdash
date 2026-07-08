import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { games, type NewGame } from "@/db/schema";
import { fetchGameById, fetchGameBySlug, parseIgdbSlug } from "@/lib/igdb";
import { detectFormat } from "@/lib/format-detect";
import { eq, or } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { url?: unknown; igdbId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let g;
  try {
    if (typeof body.igdbId === "number") {
      g = await fetchGameById(body.igdbId);
    } else {
      const slug = parseIgdbSlug(typeof body.url === "string" ? body.url : "");
      if (!slug) {
        return NextResponse.json(
          {
            error:
              "Search for a game or paste an IGDB link (e.g. https://www.igdb.com/games/<slug>).",
          },
          { status: 400 },
        );
      }
      g = await fetchGameBySlug(slug);
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  if (!g) {
    return NextResponse.json(
      { error: "That game couldn't be found on IGDB." },
      { status: 404 },
    );
  }

  const existing = await db
    .select({ id: games.id, title: games.title })
    .from(games)
    .where(or(eq(games.igdbId, g.igdbId), eq(games.title, g.title)));
  if (existing.length) {
    return NextResponse.json(
      { error: `"${existing[0].title}" is already in your library.`, duplicate: true },
      { status: 409 },
    );
  }

  const det = await detectFormat({ title: g.title, publisher: g.publisher });
  const applied = det.format !== "Unknown" && det.confidence !== "low";

  const row: NewGame = {
    igdbId: g.igdbId,
    igdbUrl: g.igdbUrl,
    title: g.title,
    releaseDate: g.releaseDate,
    released: g.released,
    platform: g.platform,
    genre: g.genre,
    coverImageUrl: g.coverImageUrl,
    description: g.description,
    igdbRating: g.igdbRating,
    physicalFormat: applied ? det.format : "Unknown",
    formatSource: applied ? det.source : null,
    needsReview: !(applied && det.confidence === "high"),
    source: "igdb",
  };

  const inserted = await db.insert(games).values(row).returning();
  return NextResponse.json({ game: inserted[0] });
}
