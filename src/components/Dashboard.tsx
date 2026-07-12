"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import type { Game, GameStatus } from "@/lib/types";
import { PHYSICAL_FORMATS } from "@/lib/types";

const FORMAT_STYLES: Record<string, string> = {
  "Full Cart": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Key Card": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Digital Only": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Unknown: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

type SortKey = "release" | "title" | "score";
type Tab = "All" | "Switch" | "Switch 2" | "Steam" | "Planner";
const TABS: Tab[] = ["All", "Switch", "Switch 2", "Steam", "Planner"];
type AddSource = "nintendo" | "steam";

type AddResult = {
  key: number;
  name: string;
  sub: string;
  coverUrl: string | null;
  payload: { igdbId?: number; steamAppId?: number };
};

function matchesTab(g: Game, tab: Tab): boolean {
  if (tab === "All" || tab === "Planner") return true;
  if (tab === "Steam") return g.library === "steam";
  if (tab === "Switch")
    return g.library === "nintendo" && (g.platform === "Switch" || g.platform === "Both");
  if (tab === "Switch 2")
    return g.library === "nintendo" && (g.platform === "Switch 2" || g.platform === "Both");
  return true;
}

function playtimeLabel(mins: number | null): string | null {
  if (mins == null || mins <= 0) return null;
  const h = mins / 60;
  return h < 1 ? `${mins}m played` : `${h.toFixed(h < 10 ? 1 : 0)}h played`;
}

// If a Steam capsule image 404s (older games lack library_600x900), fall back to
// the header image, which always exists.
function onCoverError(
  e: { currentTarget: HTMLImageElement },
  steamAppId: number | null,
) {
  const img = e.currentTarget;
  if (img.dataset.fb || !steamAppId) return;
  img.dataset.fb = "1";
  img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
}

export default function Dashboard({ initialGames }: { initialGames: Game[] }) {
  const [games, setGames] = useState<Game[]>(initialGames);
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("All");
  const [format, setFormat] = useState("All");
  const [status, setStatus] = useState("All");
  const [released, setReleased] = useState("All");
  const [onlyReview, setOnlyReview] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("release");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [showHidden, setShowHidden] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addSource, setAddSource] = useState<AddSource>("nintendo");
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<AddResult[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addingKey, setAddingKey] = useState<number | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<number>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  const [steamSyncing, setSteamSyncing] = useState(false);
  const [steamMsg, setSteamMsg] = useState<string | null>(null);

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    setGames((prev) => prev.map((g) => (g.id === id ? ({ ...g, ...body } as Game) : g)));
    try {
      const res = await fetch(`/api/games/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const { game } = await res.json();
      setGames((prev) => prev.map((g) => (g.id === id ? game : g)));
    } catch (e) {
      console.error(e);
      alert("Failed to save change. See console.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleStatus(g: Game, next: GameStatus) {
    patch(g.id, { status: g.status === next ? null : next });
  }
  function toggleHidden(g: Game) {
    patch(g.id, { hidden: !g.hidden });
  }
  function setFormatFor(g: Game, value: string) {
    patch(g.id, { physicalFormat: value, needsReview: false });
  }

  async function backlogAction(
    id: number,
    action: "add" | "remove" | "up" | "down" | "complete" | "uncomplete",
  ) {
    try {
      const res = await fetch("/api/backlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Backlog update failed");
      const updated: Game[] = data.games ?? [];
      setGames((prev) =>
        prev.map((g) => {
          const u = updated.find((x) => x.id === g.id);
          return u ? ({ ...g, ...u } as Game) : g;
        }),
      );
    } catch (e) {
      console.error(e);
      alert("Failed to update backlog.");
    }
  }

  async function reorderBacklog(ids: number[]) {
    setGames((prev) =>
      prev.map((g) => {
        const idx = ids.indexOf(g.id);
        return idx === -1 ? g : ({ ...g, backlogOrder: idx + 1 } as Game);
      }),
    );
    try {
      const res = await fetch("/api/backlog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorder", ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const updated: Game[] = data.games ?? [];
      setGames((prev) =>
        prev.map((g) => {
          const u = updated.find((x) => x.id === g.id);
          return u ? ({ ...g, ...u } as Game) : g;
        }),
      );
    } catch (e) {
      console.error(e);
      alert("Failed to reorder backlog.");
    }
  }

  async function addGame(
    payload: { igdbId?: number; steamAppId?: number; url?: string },
    resultKey?: number,
  ) {
    if (resultKey != null) setAddingKey(resultKey);
    setAddError(null);
    try {
      const res = await fetch("/api/games/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add game");
      setGames((prev) => [data.game as Game, ...prev]);
      if (resultKey != null) setAddedKeys((prev) => new Set(prev).add(resultKey));
      else setAddOpen(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingKey(null);
    }
  }

  async function syncSteam() {
    setSteamSyncing(true);
    setSteamMsg(null);
    try {
      const res = await fetch("/api/steam/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Sync failed");
      const g = await fetch("/api/games");
      const gd = await g.json();
      if (gd.games) setGames(gd.games as Game[]);
      setSteamMsg(
        `Synced ${data.ownedSynced} owned, +${data.wishlistAdded} wishlist` +
          (data.wishlistPending ? ` (${data.wishlistPending} more pending — run again)` : ""),
      );
    } catch (e) {
      setSteamMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSteamSyncing(false);
    }
  }

  // Debounced Add search (Nintendo IGDB or Steam).
  useEffect(() => {
    if (!addOpen) return;
    const q = addQuery.trim();
    if (addSource === "nintendo" && /igdb\.com\/games\//i.test(q)) {
      setAddResults([]);
      setAddSearching(false);
      return;
    }
    if (q.length < 2) {
      setAddResults([]);
      setAddSearching(false);
      return;
    }
    setAddSearching(true);
    const t = setTimeout(async () => {
      try {
        if (addSource === "steam") {
          const res = await fetch(`/api/steam/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          setAddResults(
            (data.results ?? []).map(
              (r: { steamAppId: number; name: string; coverUrl: string | null }) => ({
                key: r.steamAppId,
                name: r.name,
                sub: "Steam",
                coverUrl: r.coverUrl,
                payload: { steamAppId: r.steamAppId },
              }),
            ),
          );
        } else {
          const res = await fetch(`/api/igdb/search?q=${encodeURIComponent(q)}`);
          const data = await res.json();
          setAddResults(
            (data.results ?? []).map(
              (r: {
                igdbId: number;
                name: string;
                year: number | null;
                coverUrl: string | null;
                platform: string;
              }) => ({
                key: r.igdbId,
                name: r.name,
                sub: `${r.year ?? "TBA"} · ${r.platform}`,
                coverUrl: r.coverUrl,
                payload: { igdbId: r.igdbId },
              }),
            ),
          );
        }
      } catch {
        setAddResults([]);
      } finally {
        setAddSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [addQuery, addOpen, addSource]);

  const tabbed = useMemo(() => games.filter((g) => matchesTab(g, tab)), [games, tab]);

  const stats = useMemo(() => {
    const visible = tabbed.filter((g) => !g.hidden);
    return {
      total: visible.length,
      owned: visible.filter((g) => g.status === "owned").length,
      wanted: visible.filter((g) => g.status === "wanted").length,
      released: visible.filter((g) => g.released).length,
      upcoming: visible.filter((g) => !g.released).length,
      review: visible.filter((g) => g.needsReview).length,
      hidden: tabbed.filter((g) => g.hidden).length,
    };
  }, [tabbed]);

  function selectStat(
    kind: "total" | "owned" | "wanted" | "released" | "upcoming" | "review",
  ) {
    setSearch("");
    setPlatform("All");
    setFormat("All");
    setStatus("All");
    setReleased("All");
    setOnlyReview(false);
    if (kind === "owned") setStatus("owned");
    else if (kind === "wanted") setStatus("wanted");
    else if (kind === "released") setReleased("Released");
    else if (kind === "upcoming") setReleased("Upcoming");
    else if (kind === "review") setOnlyReview(true);
  }

  const noFilters =
    !search &&
    platform === "All" &&
    format === "All" &&
    status === "All" &&
    released === "All" &&
    !onlyReview;

  const filtered = useMemo(() => {
    let list = tabbed.filter((g) => (showHidden ? g.hidden : !g.hidden));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.title.toLowerCase().includes(q));
    }
    if (platform !== "All") list = list.filter((g) => g.platform === platform);
    if (format !== "All") list = list.filter((g) => g.physicalFormat === format);
    if (status !== "All") {
      if (status === "untracked") list = list.filter((g) => !g.status);
      else list = list.filter((g) => g.status === status);
    }
    if (released !== "All") {
      const want = released === "Released";
      list = list.filter((g) => g.released === want);
    }
    if (onlyReview) list = list.filter((g) => g.needsReview);

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortBy === "title") return dir * a.title.localeCompare(b.title);
      if (sortBy === "score")
        return (
          dir *
          ((a.opencriticScore ?? a.metacriticScore ?? a.igdbRating ?? -1) -
            (b.opencriticScore ?? b.metacriticScore ?? b.igdbRating ?? -1))
        );
      const ad = a.releaseDate ?? "";
      const bd = b.releaseDate ?? "";
      return dir * ad.localeCompare(bd);
    });
    return list;
  }, [tabbed, search, platform, format, status, released, onlyReview, showHidden, sortBy, sortDir]);

  // Backlog (across all libraries, ignores the active tab)
  const backlogActive = useMemo(
    () =>
      games
        .filter((g) => g.backlogOrder != null && !g.completed)
        .sort((a, b) => (a.backlogOrder ?? 0) - (b.backlogOrder ?? 0)),
    [games],
  );
  const backlogDone = useMemo(
    () =>
      games
        .filter((g) => g.backlogOrder != null && g.completed)
        .sort((a, b) => (a.backlogOrder ?? 0) - (b.backlogOrder ?? 0)),
    [games],
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-lg bg-blue-600 grid place-items-center text-red-600 font-black text-sm"
              style={{ WebkitTextStroke: "0.75px black" }}
            >
              GD
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                Games <span className="italic">Dash</span>
              </h1>
              <p className="text-xs text-zinc-400">
                Own it, want it, plan your backlog.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setAddError(null);
              setAddQuery("");
              setAddResults([]);
              setAddedKeys(new Set());
              setAddSource(tab === "Steam" ? "steam" : "nintendo");
              setAddOpen(true);
            }}
            className="rounded-md bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-3 py-2"
          >
            + Add game
          </button>
        </div>
        {/* Tabs */}
        <div className="mx-auto max-w-7xl px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === t
                  ? "border-red-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t === "Planner"
                ? `Planner${backlogActive.length ? ` (${backlogActive.length})` : ""}`
                : t}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "Planner" ? (
          <Planner
            active={backlogActive}
            done={backlogDone}
            onAction={backlogAction}
            onReorder={reorderBacklog}
          />
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <Stat label="Total" value={stats.total} onClick={() => selectStat("total")} active={noFilters} />
              <Stat label="Owned" value={stats.owned} accent="text-emerald-400" onClick={() => selectStat("owned")} active={status === "owned"} />
              <Stat label="Wanted" value={stats.wanted} accent="text-pink-400" onClick={() => selectStat("wanted")} active={status === "wanted"} />
              <Stat label="Released" value={stats.released} onClick={() => selectStat("released")} active={released === "Released"} />
              <Stat label="Upcoming" value={stats.upcoming} onClick={() => selectStat("upcoming")} active={released === "Upcoming"} />
              <Stat label="Needs review" value={stats.review} accent="text-amber-400" onClick={() => selectStat("review")} active={onlyReview} />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search games..."
                className="flex-1 min-w-[180px] rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
              <Select value={format} onChange={setFormat} label="Format" options={["All", ...PHYSICAL_FORMATS]} />
              <Select value={status} onChange={setStatus} label="Status" options={[["All", "All"], ["owned", "Owned"], ["wanted", "Wanted"], ["untracked", "Untracked"]]} />
              <Select value={released} onChange={setReleased} label="Availability" options={["All", "Released", "Upcoming"]} />
              <Select value={sortBy} onChange={(v) => setSortBy(v as SortKey)} label="Sort" options={[["release", "Release date"], ["title", "Title"], ["score", "Score"]]} />
              <button
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                className="rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm hover:border-zinc-600"
                title="Toggle sort direction"
              >
                {sortDir === "asc" ? "↑" : "↓"}
              </button>
              <div className="flex rounded-md border border-zinc-800 overflow-hidden">
                <button onClick={() => setView("grid")} className={`px-3 py-2 text-sm ${view === "grid" ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}>Grid</button>
                <button onClick={() => setView("table")} className={`px-3 py-2 text-sm ${view === "table" ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}>Table</button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <p className="text-xs text-zinc-500">
                Showing {filtered.length}
                {showHidden ? " hidden" : ""} of {showHidden ? stats.hidden : stats.total}
              </p>
              <div className="flex items-center gap-3">
                {tab === "Steam" && (
                  <>
                    {steamMsg && <span className="text-xs text-zinc-400">{steamMsg}</span>}
                    <button
                      onClick={syncSteam}
                      disabled={steamSyncing}
                      className="text-xs rounded-md border border-zinc-700 px-2.5 py-1 hover:border-zinc-500 disabled:opacity-50"
                    >
                      {steamSyncing ? "Syncing Steam…" : "Sync Steam"}
                    </button>
                  </>
                )}
                {(stats.hidden > 0 || showHidden) && (
                  <button
                    onClick={() => setShowHidden((v) => !v)}
                    className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
                  >
                    {showHidden ? "← Back to library" : `Show hidden (${stats.hidden})`}
                  </button>
                )}
              </div>
            </div>

            {view === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filtered.map((g) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    busy={busyId === g.id}
                    onStatus={toggleStatus}
                    onFormat={setFormatFor}
                    onHide={toggleHidden}
                    onBacklog={backlogAction}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-sm min-w-[760px]">
                  <thead className="bg-zinc-900/60 text-zinc-400 text-xs">
                    <tr>
                      <th className="text-left font-medium px-3 py-2 w-10"></th>
                      <th className="text-left font-medium px-3 py-2">Title</th>
                      <th className="text-left font-medium px-3 py-2">Platform</th>
                      <th className="text-left font-medium px-3 py-2">Format</th>
                      <th className="text-left font-medium px-3 py-2">Release</th>
                      <th className="text-left font-medium px-3 py-2">Score</th>
                      <th className="text-left font-medium px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((g) => (
                      <GameRow
                        key={g.id}
                        game={g}
                        busy={busyId === g.id}
                        onStatus={toggleStatus}
                        onFormat={setFormatFor}
                        onHide={toggleHidden}
                        onBacklog={backlogAction}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {filtered.length === 0 && (
              <div className="text-center text-zinc-500 py-20">No games found.</div>
            )}
          </>
        )}
      </main>

      {addOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 grid place-items-start justify-center p-4 pt-16 overflow-y-auto"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Add a game</h2>
              <button onClick={() => setAddOpen(false)} className="text-zinc-400 hover:text-zinc-200" aria-label="Close">✕</button>
            </div>

            <div className="mt-3 flex rounded-md border border-zinc-800 overflow-hidden w-fit">
              <button
                onClick={() => { setAddSource("nintendo"); setAddResults([]); setAddedKeys(new Set()); }}
                className={`px-3 py-1.5 text-sm ${addSource === "nintendo" ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              >
                Nintendo
              </button>
              <button
                onClick={() => { setAddSource("steam"); setAddResults([]); setAddedKeys(new Set()); }}
                className={`px-3 py-1.5 text-sm ${addSource === "steam" ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              >
                Steam
              </button>
            </div>
            <p className="text-xs text-zinc-400 mt-2 mb-3">
              {addSource === "steam"
                ? "Search Steam and click Add (adds to your wishlist / wanted)."
                : "Search IGDB and click Add — or paste an IGDB link."}
            </p>

            <input
              autoFocus
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
              placeholder={addSource === "steam" ? "Search Steam..." : "Search games..."}
              className="w-full rounded-md bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-zinc-500"
            />
            {addError && <p className="text-xs text-red-400 mt-2">{addError}</p>}

            <div className="mt-3 max-h-[50vh] overflow-y-auto">
              {addSource === "nintendo" && /igdb\.com\/games\//i.test(addQuery) ? (
                <button
                  onClick={() => addGame({ url: addQuery })}
                  className="w-full rounded-md bg-red-600 hover:bg-red-500 text-white text-sm font-semibold px-3 py-2"
                >
                  Add from this link
                </button>
              ) : addSearching ? (
                <p className="text-sm text-zinc-500 py-4 text-center">Searching…</p>
              ) : addQuery.trim().length < 2 ? (
                <p className="text-sm text-zinc-600 py-4 text-center">Type at least 2 characters to search.</p>
              ) : addResults.length === 0 ? (
                <p className="text-sm text-zinc-500 py-4 text-center">No games found.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {addResults.map((r) => {
                    const added = addedKeys.has(r.key);
                    return (
                      <li key={r.key} className="flex items-center gap-3 rounded-md p-2 hover:bg-zinc-800/50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {r.coverUrl ? (
                          <img src={r.coverUrl} alt="" onError={(e) => onCoverError(e, r.payload.steamAppId ?? null)} className="h-12 w-9 object-cover rounded shrink-0" />
                        ) : (
                          <div className="h-12 w-9 rounded bg-zinc-800 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{r.name}</div>
                          <div className="text-xs text-zinc-500">{r.sub}</div>
                        </div>
                        <button
                          onClick={() => addGame(r.payload, r.key)}
                          disabled={added || addingKey === r.key}
                          className={`shrink-0 rounded-md text-xs font-semibold px-3 py-1.5 border ${
                            added
                              ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                              : "bg-red-600 hover:bg-red-500 text-white border-red-600 disabled:opacity-50"
                          }`}
                        >
                          {added ? "Added ✓" : addingKey === r.key ? "Adding…" : "Add"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = "text-zinc-100",
  onClick,
  active = false,
}: {
  label: string;
  value: number;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-lg border px-4 py-3 transition-colors ${
        active
          ? "border-zinc-500 bg-zinc-800/70 ring-1 ring-zinc-500"
          : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600 hover:bg-zinc-800/50"
      }`}
    >
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="text-xs text-zinc-400">{label}</div>
    </button>
  );
}

function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: (string | [string, string])[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-2 text-sm outline-none focus:border-zinc-600"
    >
      {options.map((o) => {
        const [val, text] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={val} value={val}>
            {label}: {text}
          </option>
        );
      })}
    </select>
  );
}

function FormatSourceBadge({ game: g }: { game: Game }) {
  if (g.physicalFormat === "Unknown" || g.library === "steam") return null;
  const src = g.formatSource;
  if (src === "manual") {
    return (
      <span title="You confirmed this format" className="text-[10px] rounded px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        ✓ confirmed
      </span>
    );
  }
  if (src === "brave" || src === "nintendo" || src === "llm") {
    return g.needsReview ? (
      <span title={`Auto-detected (${src}) — please verify`} className="text-[10px] rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-300 border border-amber-500/30">
        auto?
      </span>
    ) : (
      <span title={`Auto-detected (${src})`} className="text-[10px] rounded px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 border border-zinc-600">
        auto
      </span>
    );
  }
  return null;
}

function PriceTag({ game: g }: { game: Game }) {
  if (g.library !== "steam" || g.steamPriceCents == null) return null;
  if (g.steamPriceCents === 0) {
    return (
      <span className="text-[10px] rounded px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 border border-zinc-600">
        Free
      </span>
    );
  }
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  const onSale = (g.steamDiscountPct ?? 0) > 0;
  return (
    <span
      className={`text-[10px] rounded px-1.5 py-0.5 border font-semibold ${
        onSale
          ? "bg-green-600/20 text-green-300 border-green-600/40"
          : "bg-zinc-800 text-zinc-200 border-zinc-700"
      }`}
      title={onSale ? "On sale" : "Current Steam price"}
    >
      {onSale && <span className="mr-1">-{g.steamDiscountPct}%</span>}
      {onSale && g.steamInitialCents != null && (
        <span className="line-through text-zinc-500 mr-1">{fmt(g.steamInitialCents)}</span>
      )}
      {fmt(g.steamPriceCents)}
    </span>
  );
}

function BacklogButton({
  game: g,
  onBacklog,
  full = false,
}: {
  game: Game;
  onBacklog: (id: number, action: "add" | "remove") => void;
  full?: boolean;
}) {
  const inBacklog = g.backlogOrder != null;
  return (
    <button
      onClick={() => onBacklog(g.id, inBacklog ? "remove" : "add")}
      title={inBacklog ? "Remove from backlog" : "Add to backlog planner"}
      className={`rounded-md text-xs py-1 border ${full ? "" : "px-2"} ${
        inBacklog
          ? "border-indigo-500/40 text-indigo-300 bg-indigo-500/10"
          : "border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600"
      }`}
    >
      {inBacklog ? "★ In backlog" : "☆ Backlog"}
    </button>
  );
}

function GameCard({
  game: g,
  busy,
  onStatus,
  onFormat,
  onHide,
  onBacklog,
}: {
  game: Game;
  busy: boolean;
  onStatus: (g: Game, s: GameStatus) => void;
  onFormat: (g: Game, v: string) => void;
  onHide: (g: Game) => void;
  onBacklog: (id: number, action: "add" | "remove") => void;
}) {
  const link = g.igdbUrl || g.storeUrl;
  const isSteam = g.library === "steam";
  const playtime = playtimeLabel(g.playtimeMinutes);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden flex flex-col">
      <div className="relative aspect-[3/4] bg-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {g.coverImageUrl ? (
          link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="block h-full w-full" title="View store / IGDB page">
              <img src={g.coverImageUrl} alt={g.title} loading="lazy" onError={(e) => onCoverError(e, g.steamAppId)} className="h-full w-full object-cover" />
            </a>
          ) : (
            <img src={g.coverImageUrl} alt={g.title} loading="lazy" onError={(e) => onCoverError(e, g.steamAppId)} className="h-full w-full object-cover" />
          )
        ) : (
          <div className="h-full w-full grid place-items-center text-zinc-600 text-sm">No cover</div>
        )}
        {g.needsReview && !isSteam && (
          <span className="absolute top-2 left-2 rounded-full bg-amber-500/90 text-black text-[10px] font-bold px-2 py-0.5">
            NEW · REVIEW
          </span>
        )}
        {g.status && (
          <span className={`absolute top-2 right-2 rounded-full text-[10px] font-bold px-2 py-0.5 ${g.status === "owned" ? "bg-emerald-500 text-black" : "bg-pink-500 text-black"}`}>
            {g.status.toUpperCase()}
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight">{g.title}</h3>
          <div className="shrink-0 flex flex-col items-end gap-0.5">
            {g.metacriticScore != null && (
              <span title="Metacritic" className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-zinc-800 text-zinc-200">MC {g.metacriticScore}</span>
            )}
            {g.opencriticScore != null && (
              <span title="OpenCritic" className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-zinc-800 text-zinc-200">OC {g.opencriticScore}</span>
            )}
            {g.igdbRating != null && (
              <span title="IGDB critic rating" className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-zinc-800 text-zinc-200">IGDB {g.igdbRating}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300">{g.platform}</span>
          {!isSteam && (
            <span className={`text-[10px] rounded border px-1.5 py-0.5 ${FORMAT_STYLES[g.physicalFormat] ?? FORMAT_STYLES.Unknown}`}>
              {g.physicalFormat}
            </span>
          )}
          <FormatSourceBadge game={g} />
          <PriceTag game={g} />
          {playtime && (
            <span className="text-[10px] rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400">{playtime}</span>
          )}
          {g.releaseDate && (
            <span className="text-[10px] rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400">{g.releaseDate}</span>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => onStatus(g, "owned")}
              className={`flex-1 rounded-md text-xs font-semibold py-1.5 border transition ${g.status === "owned" ? "bg-emerald-500 text-black border-emerald-500" : "border-zinc-700 text-zinc-300 hover:border-emerald-500/60"}`}
            >
              Owned
            </button>
            <button
              disabled={busy}
              onClick={() => onStatus(g, "wanted")}
              className={`flex-1 rounded-md text-xs font-semibold py-1.5 border transition ${g.status === "wanted" ? "bg-pink-500 text-black border-pink-500" : "border-zinc-700 text-zinc-300 hover:border-pink-500/60"}`}
            >
              Wanted
            </button>
          </div>
          {!isSteam && (
            <select
              disabled={busy}
              value={g.physicalFormat}
              onChange={(e) => onFormat(g, e.target.value)}
              className="rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-zinc-500"
              title="Physical format"
            >
              {PHYSICAL_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <BacklogButton game={g} onBacklog={onBacklog} />
            <button
              disabled={busy}
              onClick={() => onHide(g)}
              className="flex-1 rounded-md border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 text-xs py-1"
            >
              {g.hidden ? "Unhide" : "Hide"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GameRow({
  game: g,
  busy,
  onStatus,
  onFormat,
  onHide,
  onBacklog,
}: {
  game: Game;
  busy: boolean;
  onStatus: (g: Game, s: GameStatus) => void;
  onFormat: (g: Game, v: string) => void;
  onHide: (g: Game) => void;
  onBacklog: (id: number, action: "add" | "remove") => void;
}) {
  const score = g.opencriticScore ?? g.metacriticScore ?? g.igdbRating;
  const link = g.igdbUrl || g.storeUrl;
  const isSteam = g.library === "steam";
  return (
    <tr className="border-t border-zinc-800 hover:bg-zinc-900/40">
      <td className="px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {g.coverImageUrl ? (
          link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" title="View store / IGDB page">
              <img src={g.coverImageUrl} alt="" loading="lazy" onError={(e) => onCoverError(e, g.steamAppId)} className="h-10 w-8 object-cover rounded" />
            </a>
          ) : (
            <img src={g.coverImageUrl} alt="" loading="lazy" onError={(e) => onCoverError(e, g.steamAppId)} className="h-10 w-8 object-cover rounded" />
          )
        ) : (
          <div className="h-10 w-8 rounded bg-zinc-800" />
        )}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{g.title}</div>
        {g.needsReview && !isSteam && <span className="text-[10px] text-amber-400">needs review</span>}
      </td>
      <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{g.platform}</td>
      <td className="px-3 py-2">
        {isSteam ? (
          g.steamPriceCents != null ? (
            <PriceTag game={g} />
          ) : (
            <span className="text-xs text-zinc-500">Digital</span>
          )
        ) : (
          <div className="flex items-center gap-2">
            <select
              disabled={busy}
              value={g.physicalFormat}
              onChange={(e) => onFormat(g, e.target.value)}
              className="rounded bg-zinc-950 border border-zinc-700 px-1.5 py-1 text-xs outline-none focus:border-zinc-500"
            >
              {PHYSICAL_FORMATS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <FormatSourceBadge game={g} />
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{g.releaseDate ?? "—"}</td>
      <td className="px-3 py-2 text-zinc-300">{score != null ? score : "—"}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button
            disabled={busy}
            onClick={() => onStatus(g, "owned")}
            className={`rounded px-2 py-1 text-xs border ${g.status === "owned" ? "bg-emerald-500 text-black border-emerald-500" : "border-zinc-700 text-zinc-300 hover:border-emerald-500/60"}`}
          >
            Owned
          </button>
          <button
            disabled={busy}
            onClick={() => onStatus(g, "wanted")}
            className={`rounded px-2 py-1 text-xs border ${g.status === "wanted" ? "bg-pink-500 text-black border-pink-500" : "border-zinc-700 text-zinc-300 hover:border-pink-500/60"}`}
          >
            Wanted
          </button>
          <button
            onClick={() => onBacklog(g.id, g.backlogOrder != null ? "remove" : "add")}
            className={`rounded px-2 py-1 text-xs border ${g.backlogOrder != null ? "border-indigo-500/40 text-indigo-300 bg-indigo-500/10" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}
            title="Backlog"
          >
            {g.backlogOrder != null ? "★" : "☆"}
          </button>
          <button
            disabled={busy}
            onClick={() => onHide(g)}
            className="rounded px-2 py-1 text-xs border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600"
          >
            {g.hidden ? "Unhide" : "Hide"}
          </button>
        </div>
      </td>
    </tr>
  );
}

function Planner({
  active,
  done,
  onAction,
  onReorder,
}: {
  active: Game[];
  done: Game[];
  onAction: (
    id: number,
    action: "add" | "remove" | "up" | "down" | "complete" | "uncomplete",
  ) => void;
  onReorder: (ids: number[]) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const total = active.length + done.length;
  if (total === 0) {
    return (
      <div className="text-center text-zinc-500 py-20">
        Your backlog is empty. Add games with the ☆ Backlog button on any game.
      </div>
    );
  }

  function drop() {
    if (dragId != null && overId != null && dragId !== overId) {
      const ids = active.map((g) => g.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(overId);
      if (from !== -1 && to !== -1) {
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        onReorder(ids);
      }
    }
    setDragId(null);
    setOverId(null);
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Backlog planner</h2>
        <span className="text-sm text-zinc-400">
          {done.length} of {total} completed
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 mb-4 overflow-hidden">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${total ? (done.length / total) * 100 : 0}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        Drag rows to reorder, or use the arrows.
      </p>

      <ul className="flex flex-col gap-2">
        {active.map((g, i) => (
          <PlannerRow
            key={g.id}
            game={g}
            index={i + 1}
            count={active.length}
            onAction={onAction}
            drag={{
              dragging: dragId === g.id,
              over: overId === g.id && dragId !== g.id,
              onDragStart: () => setDragId(g.id),
              onDragOver: (e) => {
                e.preventDefault();
                setOverId(g.id);
              },
              onDrop: drop,
              onDragEnd: () => {
                setDragId(null);
                setOverId(null);
              },
            }}
          />
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-zinc-400 mt-8 mb-2">Completed</h3>
          <ul className="flex flex-col gap-2">
            {done.map((g) => (
              <PlannerRow key={g.id} game={g} onAction={onAction} completedRow />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PlannerRow({
  game: g,
  index,
  count,
  onAction,
  completedRow = false,
  drag,
}: {
  game: Game;
  index?: number;
  count?: number;
  onAction: (
    id: number,
    action: "add" | "remove" | "up" | "down" | "complete" | "uncomplete",
  ) => void;
  completedRow?: boolean;
  drag?: {
    dragging: boolean;
    over: boolean;
    onDragStart: () => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
}) {
  return (
    <li
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      className={`flex items-center gap-3 rounded-lg border bg-zinc-900/50 p-2 ${
        drag?.over ? "border-red-500" : "border-zinc-800"
      } ${drag?.dragging ? "opacity-50" : ""}`}
    >
      {drag && (
        <span className="cursor-grab text-zinc-600 select-none px-1" title="Drag to reorder">
          ⠿
        </span>
      )}
      {!completedRow && (
        <div className="flex flex-col">
          <button
            onClick={() => onAction(g.id, "up")}
            disabled={index === 1}
            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 leading-none text-xs"
            title="Move up"
          >
            ▲
          </button>
          <button
            onClick={() => onAction(g.id, "down")}
            disabled={index === count}
            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-30 leading-none text-xs"
            title="Move down"
          >
            ▼
          </button>
        </div>
      )}
      {!completedRow && <div className="w-6 text-center text-sm font-bold text-zinc-500">{index}</div>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {g.coverImageUrl ? (
        <img src={g.coverImageUrl} alt="" onError={(e) => onCoverError(e, g.steamAppId)} className="h-12 w-9 object-cover rounded shrink-0" />
      ) : (
        <div className="h-12 w-9 rounded bg-zinc-800 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium truncate ${completedRow ? "line-through text-zinc-500" : ""}`}>
          {g.title}
        </div>
        <div className="text-xs text-zinc-500">{g.platform}</div>
      </div>
      <button
        onClick={() => onAction(g.id, completedRow ? "uncomplete" : "complete")}
        className={`rounded-md text-xs font-semibold px-2.5 py-1.5 border ${
          completedRow
            ? "border-zinc-700 text-zinc-300 hover:border-zinc-500"
            : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
        }`}
      >
        {completedRow ? "Undo" : "✓ Done"}
      </button>
      <button
        onClick={() => onAction(g.id, "remove")}
        className="rounded-md text-xs px-2 py-1.5 border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:border-zinc-600"
        title="Remove from backlog"
      >
        ✕
      </button>
    </li>
  );
}
