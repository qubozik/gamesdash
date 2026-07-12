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
  source: "nintendo" | "brave" | "llm" | "none";
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

const VALID_FORMATS = new Set<PhysicalFormat>([
  "Full Cart",
  "Key Card",
  "Digital Only",
  "Unknown",
]);

/**
 * Use an LLM to read the Brave snippets and classify the format. Works with any
 * OpenAI-compatible chat API. Configure with:
 *   LLM_API_KEY   (required to enable)
 *   LLM_BASE_URL  (default https://api.openai.com/v1)
 *   LLM_MODEL     (default gpt-4o-mini)
 */
async function classifyWithLLM(
  title: string,
  results: BraveResult[],
): Promise<FormatDetection | null> {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  const snippets = results
    .slice(0, 8)
    .map(
      (r, i) =>
        `${i + 1}. ${(r.title ?? "").trim()} — ${(r.description ?? "").replace(/<[^>]+>/g, "").trim()}`,
    )
    .join("\n");
  if (!snippets.trim()) return null;

  const system =
    "You classify the PHYSICAL release format of a Nintendo Switch / Switch 2 game from web-search snippets. " +
    "Definitions: " +
    '"Full Cart" = the entire game is on the physical cartridge/game card; ' +
    '"Key Card" = a Nintendo Switch 2 Game-Key Card (the cartridge is only a key and the game must be downloaded); ' +
    '"Digital Only" = no physical release, or a physical box that only contains a download code; ' +
    '"Unknown" = the snippets do not clearly say. ' +
    'Respond ONLY with strict JSON: {"format":"Full Cart|Key Card|Digital Only|Unknown","confidence":"high|medium|low"}. ' +
    "Use high only when snippets explicitly state the format for THIS game.";
  const user = `Game: ${title}\n\nSearch results:\n${snippets}`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const post = (jsonMode: boolean) =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

  try {
    // Prefer JSON-object mode; some models (e.g. gpt-5-nano) reject
    // response_format, so retry once without it. The prompt still enforces
    // strict JSON and the parser below tolerates prose/code fences.
    let res = await post(true);
    if (!res.ok) res = await post(false);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    // Tolerate models that wrap JSON in prose or code fences.
    let jsonText = content.trim();
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) jsonText = match[0];
    const parsed = JSON.parse(jsonText) as {
      format?: string;
      confidence?: string;
    };
    const format = (parsed.format ?? "Unknown") as PhysicalFormat;
    if (!VALID_FORMATS.has(format)) return null;
    const confidence = (["high", "medium", "low"].includes(
      parsed.confidence ?? "",
    )
      ? parsed.confidence
      : "medium") as Confidence;
    return { format, confidence, source: "llm" };
  } catch {
    return null;
  }
}

export async function detectFormat(opts: {
  title: string;
  publisher?: string | null;
}): Promise<FormatDetection> {
  // 1. Nintendo first-party prior.
  if (opts.publisher && /nintendo/i.test(opts.publisher)) {
    return { format: "Full Cart", confidence: "high", source: "nintendo" };
  }
  // 2. Brave web search for retrieval.
  const key = process.env.BRAVE_API_KEY;
  if (!key) return { format: "Unknown", confidence: "low", source: "none" };
  try {
    const results = await braveSearch(
      `is "${opts.title}" a game-key card Nintendo Switch 2`,
      key,
    );
    // 3. Prefer the LLM snippet-reader when configured; else regex heuristic.
    const llm = await classifyWithLLM(opts.title, results);
    if (llm) return llm;
    return classify(results);
  } catch {
    return { format: "Unknown", confidence: "low", source: "none" };
  }
}
