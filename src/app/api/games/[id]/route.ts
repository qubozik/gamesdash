import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { games } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const STATUS = new Set(["owned", "wanted"]);
const FORMATS = new Set(["Full Cart", "Key Card", "Digital Only", "Unknown"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = { lastUpdated: sql`now()` };

  if ("status" in body) {
    const s = body.status;
    if (s === null || (typeof s === "string" && STATUS.has(s))) {
      update.status = s;
    } else {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
  }

  if ("physicalFormat" in body) {
    const f = body.physicalFormat;
    if (typeof f === "string" && FORMATS.has(f)) {
      update.physicalFormat = f;
      update.formatSource = "manual";
    } else {
      return NextResponse.json(
        { error: "Invalid physicalFormat" },
        { status: 400 },
      );
    }
  }

  if ("needsReview" in body && typeof body.needsReview === "boolean") {
    update.needsReview = body.needsReview;
  }

  if ("hidden" in body && typeof body.hidden === "boolean") {
    update.hidden = body.hidden;
  }

  const rows = await db
    .update(games)
    .set(update)
    .where(eq(games.id, gameId))
    .returning();

  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ game: rows[0] });
}
