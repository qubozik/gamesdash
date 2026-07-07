/**
 * Best-effort physical-format detection for Switch / Switch 2 games.
 *
 * Strategy (no paid LLM):
 *   1. Nintendo first-party prior — Nintendo never ships its own games as
 *      game-key cards, so a Nintendo-published title is a Full Cart (high conf).
 *   2. Brave Search — query the web and read result titles/descriptions for
 *      verb-anchored statements ("is a game-key card" / "is NOT a game-key card"
 *      / "full game on the cart" / "code in a box"). Only returns a confident
 *      answer when the signal is clear; otherwise "Unknown".
 *
 * Confidence is used by the caller to decide whether to auto-apply the format or
 * leave the game flagged "needs review".
 */

export type PhysicalFormat =
  | "Full Cart"
  | "Key Card"
  | "Digital Only"
  | "Unknown";

export type Confidence = "high" | "medium" | "low";

export interface FormatDetection {
  format: PhysicalFormat;
  confidence: Confidence;
  source: "nintendo" | "brave" | "none";
}

const KC = String.raw`game[\s-]*key[\s-]*card`;
const POS = new RegExp(
  String.raw`(?:is|are|will be|uses|using|comes|ships?|sold|released?|available)\b[\w\s,'-]{0,20}` +
    KC,
  "i",
);
const POS2 = new RegExp(
  KC + String.raw`\b[\w\s,'-]{0,15}(?:release|edition|version|format|game)`,
  "i",
);
const NEG = new RegExp(
  String.raw`(?:not|isn'?t|no,|does\s?n'?t|won'?t|never|rather than|instead of|unlike)\b[\w\s,'-]{0,25}` +
    KC,
  "i",
);
const FULL = new RegExp(
  String.raw`full game (?:is )?on the (?:game )?(?:cart|card)|entire game (?:is )?on the (?:cart|card)|complete game on the (?:cart|card)|(?:cart|cartridge) (?:contains|includes|holds) the (?:full|entire|complete)|full copy of the game on`,
  "i",
);
const CODE = new RegExp(
  String.raw`code[\s-]*in[\s-]*a?[\s-]*box|download code (?:in|inside)|voucher code`,
  "i",
);

interface BraveResult {
  title?: string;
  description?: string;
}

async function braveSearch(query: string, key: string): Promise<BraveResult[]> {
  const url =
    "https://api.search.brave.com/res/v1/web/search?" +
    new URLSearchParams({ q: query, count: "12" }).toString();
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!res.ok) {
    throw new Error(`Brave search error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { web?: { results?: BraveResult[] } };
  return data.web?.results ?? [];
}

function classify(results: BraveResult[]): FormatDetection {
  let pos = 0,
    neg = 0,
    full = 0,
    code = 0;
  for (const r of results) {
    const t = `${r.title ?? ""}. ${r.description ?? ""}`
      .replace(/<[^>]+>/g, " ")
      .toLowerCase();
    const negHit = NEG.test(t);
    const posHit = POS.test(t) || POS2.test(t);
    if (negHit) neg++;
    else if (posHit) pos++;
    if (FULL.test(t)) full++;
    if (CODE.test(t)) code++;
  }

  if (neg > 0 && neg >= pos) {
    return { format: "Full Cart", confidence: neg >= 2 ? "high" : "medium", source: "brave" };
  }
  if (full > 0 && pos === 0) {
    return { format: "Full Cart", confidence: "medium", source: "brave" };
  }
  if (pos > 0) {
    return {
      format: "Key Card",
      confidence: pos >= 2 && neg === 0 ? "high" : "medium",
      source: "brave",
    };
  }
  if (code >= 2 && pos === 0) {
    // "Code in a box" (physical box, download code, no game data on cart). The
    // app has no dedicated value for this yet, so flag for manual review.
    return { format: "Unknown", confidence: "low", source: "brave" };
  }
  return { format: "Unknown", confidence: "low", source: "none" };
}

export async function detectFormat(opts: {
  title: string;
  publisher?: string | null;
}): Promise<FormatDetection> {
  // 1. Nintendo first-party prior.
  if (opts.publisher && /nintendo/i.test(opts.publisher)) {
    return { format: "Full Cart", confidence: "high", source: "nintendo" };
  }
  // 2. Brave web search.
  const key = process.env.BRAVE_API_KEY;
  if (!key) return { format: "Unknown", confidence: "low", source: "none" };
  try {
    const results = await braveSearch(
      `is "${opts.title}" a game-key card Nintendo Switch 2`,
      key,
    );
    return classify(results);
  } catch {
    return { format: "Unknown", confidence: "low", source: "none" };
  }
}
