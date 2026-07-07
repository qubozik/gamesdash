/**
 * Minimal IGDB client. IGDB authenticates via a Twitch application
 * (client credentials flow). Docs: https://api-docs.igdb.com/
 */

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";

// Nintendo Switch platform id is a stable, well-known IGDB id.
const SWITCH_PLATFORM_ID = 130;

// Only import games with some traction, to avoid flooding the tracker with
// obscure shovelware. `hypes` = pre-release wishlist interest; total_rating_count
// = number of critic/user ratings. Tunable via env vars.
const MIN_HYPES = Number(process.env.SYNC_MIN_HYPES ?? 5);
const MIN_RATINGS = Number(process.env.SYNC_MIN_RATINGS ?? 8);

let cachedToken: { token: string; expiresAt: number } | null = null;

function creds() {
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are not set. Add them in Vercel project env vars.",
    );
  }
  return { clientId, clientSecret };
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const { clientId, clientSecret } = creds();
  const url = `${TWITCH_TOKEN_URL}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Twitch token error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function igdb<T>(endpoint: string, body: string): Promise<T> {
  const { clientId } = creds();
  const token = await getAccessToken();
  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`IGDB ${endpoint} error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Resolve the "Nintendo Switch 2" platform id dynamically (it may change / be new). */
let switch2Id: number | null | undefined;
async function getSwitch2PlatformId(): Promise<number | null> {
  if (switch2Id !== undefined) return switch2Id;
  const rows = await igdb<{ id: number; name: string }[]>(
    "platforms",
    `fields id,name; where name ~ *"Switch 2"*; limit 10;`,
  );
  switch2Id = rows[0]?.id ?? null;
  return switch2Id;
}

export type IgdbGame = {
  id: number;
  name: string;
  first_release_date?: number; // unix seconds
  summary?: string;
  genres?: { name: string }[];
  cover?: { image_id: string };
  platforms?: number[];
  involved_companies?: { company?: { name?: string }; publisher?: boolean }[];
};

function coverUrl(imageId?: string): string | null {
  if (!imageId) return null;
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}

/**
 * Fetch Switch / Switch 2 games released or releasing within the given window.
 * `sinceDays` looks back, `untilDays` looks forward (to catch upcoming titles).
 */
export async function fetchRecentSwitchGames(opts?: {
  sinceDays?: number;
  untilDays?: number;
}): Promise<
  {
    igdbId: number;
    title: string;
    releaseDate: string | null;
    released: boolean;
    platform: string;
    genre: string[];
    coverImageUrl: string | null;
    description: string | null;
    publisher: string | null;
  }[]
> {
  const sinceDays = opts?.sinceDays ?? 120;
  const untilDays = opts?.untilDays ?? 400;
  const now = Math.floor(Date.now() / 1000);
  const from = now - sinceDays * 86400;
  const to = now + untilDays * 86400;

  const s2 = await getSwitch2PlatformId();
  const platformList = s2
    ? `(${SWITCH_PLATFORM_ID},${s2})`
    : `(${SWITCH_PLATFORM_ID})`;

  const rows = await igdb<IgdbGame[]>(
    "games",
    `fields id,name,first_release_date,summary,genres.name,cover.image_id,platforms,involved_companies.company.name,involved_companies.publisher;
     where platforms = ${platformList}
       & first_release_date >= ${from}
       & first_release_date <= ${to}
       & game_type = 0
       & (hypes >= ${MIN_HYPES} | total_rating_count >= ${MIN_RATINGS});
     sort first_release_date desc;
     limit 500;`,
  );

  return rows.map((r) => {
    const hasS2 = s2 ? r.platforms?.includes(s2) : false;
    const hasS1 = r.platforms?.includes(SWITCH_PLATFORM_ID);
    const platform =
      hasS1 && hasS2 ? "Both" : hasS2 ? "Switch 2" : "Switch";
    const releaseUnix = r.first_release_date;
    const releaseDate = releaseUnix
      ? new Date(releaseUnix * 1000).toISOString().slice(0, 10)
      : null;
    const publisher =
      r.involved_companies?.find((c) => c.publisher)?.company?.name ??
      r.involved_companies?.[0]?.company?.name ??
      null;
    return {
      igdbId: r.id,
      title: r.name,
      releaseDate,
      released: releaseUnix ? releaseUnix * 1000 <= Date.now() : false,
      platform,
      genre: (r.genres ?? []).map((g) => g.name),
      coverImageUrl: coverUrl(r.cover?.image_id),
      description: r.summary ?? null,
      publisher,
    };
  });
}
