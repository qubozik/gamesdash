"use client";

import { useMemo, useState } from "react";
import type { Game, GameStatus } from "@/lib/types";
import { PHYSICAL_FORMATS } from "@/lib/types";

const FORMAT_STYLES: Record<string, string> = {
  "Full Cart": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  "Key Card": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Digital Only": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  Unknown: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

type SortKey = "release" | "title" | "score";

export default function Dashboard({ initialGames }: { initialGames: Game[] }) {
  const [games, setGames] = useState<Game[]>(initialGames);
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

  async function patch(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    // optimistic update
    setGames((prev) =>
      prev.map((g) => (g.id === id ? ({ ...g, ...body } as Game) : g)),
    );
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

  function setFormatFor(g: Game, value: string) {
    patch(g.id, { physicalFormat: value, needsReview: false });
  }

  const stats = useMemo(() => {
    return {
      total: games.length,
      owned: games.filter((g) => g.status === "owned").length,
      wanted: games.filter((g) => g.status === "wanted").length,
      released: games.filter((g) => g.released).length,
      upcoming: games.filter((g) => !g.released).length,
      review: games.filter((g) => g.needsReview).length,
    };
  }, [games]);

  function selectStat(kind: "total" | "owned" | "wanted" | "released" | "upcoming" | "review") {
    // reset everything, then apply the chosen filter
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
    let list = [...games];
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
      // release
      const ad = a.releaseDate ?? "";
      const bd = b.releaseDate ?? "";
      return dir * ad.localeCompare(bd);
    });
    return list;
  }, [
    games,
    search,
    platform,
    format,
    status,
    released,
    onlyReview,
    sortBy,
    sortDir,
  ]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-red-600 grid place-items-center font-black">
              N
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                Switch Game Tracker
              </h1>
              <p className="text-xs text-zinc-400">
                Own it, want it, and know the cart type.
              </p>
            </div>
          </div>
          <div className="flex rounded-md border border-zinc-800 overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={`px-3 py-1.5 text-sm ${view === "grid" ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              title="Grid view"
            >
              Grid
            </button>
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-sm ${view === "table" ? "bg-zinc-700 text-white" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"}`}
              title="Table view"
            >
              Table
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <Stat label="Total" value={stats.total} onClick={() => selectStat("total")} active={noFilters} />
          <Stat label="Owned" value={stats.owned} accent="text-emerald-400" onClick={() => selectStat("owned")} active={status === "owned"} />
          <Stat label="Wanted" value={stats.wanted} accent="text-pink-400" onClick={() => selectStat("wanted")} active={status === "wanted"} />
          <Stat label="Released" value={stats.released} onClick={() => selectStat("released")} active={released === "Released"} />
          <Stat label="Upcoming" value={stats.upcoming} onClick={() => selectStat("upcoming")} active={released === "Upcoming"} />
          <Stat
            label="Needs review"
            value={stats.review}
            accent="text-amber-400"
            onClick={() => selectStat("review")}
            active={onlyReview}
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search games..."
            className="flex-1 min-w-[180px] rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm outline-none focus:border-zinc-600"
          />
          <Select value={platform} onChange={setPlatform} label="Platform" options={["All", "Switch 2", "Both", "Switch"]} />
          <Select value={format} onChange={setFormat} label="Format" options={["All", ...PHYSICAL_FORMATS]} />
          <Select value={status} onChange={setStatus} label="Status" options={[["All","All"],["owned","Owned"],["wanted","Wanted"],["untracked","Untracked"]]} />
          <Select value={released} onChange={setReleased} label="Availability" options={["All", "Released", "Upcoming"]} />
          <Select value={sortBy} onChange={(v) => setSortBy(v as SortKey)} label="Sort" options={[["release","Release date"],["title","Title"],["score","Score"]]} />
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-md bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm hover:border-zinc-600"
            title="Toggle sort direction"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-300 ml-1">
            <input
              type="checkbox"
              checked={onlyReview}
              onChange={(e) => setOnlyReview(e.target.checked)}
              className="accent-amber-500"
            />
            Needs review
          </label>
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-zinc-500">
            Showing {filtered.length} of {games.length}
          </p>
        </div>

        {/* Grid / Table */}
        {view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                busy={busyId === g.id}
                onStatus={toggleStatus}
                onFormat={setFormatFor}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm min-w-[720px]">
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
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center text-zinc-500 py-20">No games found.</div>
        )}
      </main>
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
  if (g.physicalFormat === "Unknown") return null;
  const src = g.formatSource;
  if (src === "manual") {
    return (
      <span
        title="You confirmed this format"
        className="text-[10px] rounded px-1.5 py-0.5 bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
      >
        ✓ confirmed
      </span>
    );
  }
  if (src === "brave" || src === "nintendo" || src === "llm") {
    if (g.needsReview) {
      return (
        <span
          title={`Auto-detected (${src}) — please verify`}
          className="text-[10px] rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-300 border border-amber-500/30"
        >
          auto?
        </span>
      );
    }
    return (
      <span
        title={`Auto-detected (${src})`}
        className="text-[10px] rounded px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 border border-zinc-600"
      >
        auto
      </span>
    );
  }
  return null;
}

function GameRow({
  game: g,
  busy,
  onStatus,
  onFormat,
}: {
  game: Game;
  busy: boolean;
  onStatus: (g: Game, s: GameStatus) => void;
  onFormat: (g: Game, v: string) => void;
}) {
  const score = g.opencriticScore ?? g.metacriticScore ?? g.igdbRating;
  return (
    <tr className="border-t border-zinc-800 hover:bg-zinc-900/40">
      <td className="px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {g.coverImageUrl ? (
          <img
            src={g.coverImageUrl}
            alt=""
            loading="lazy"
            className="h-10 w-8 object-cover rounded"
          />
        ) : (
          <div className="h-10 w-8 rounded bg-zinc-800" />
        )}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{g.title}</div>
        {g.needsReview && (
          <span className="text-[10px] text-amber-400">needs review</span>
        )}
      </td>
      <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">{g.platform}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <select
            disabled={busy}
            value={g.physicalFormat}
            onChange={(e) => onFormat(g, e.target.value)}
            className="rounded bg-zinc-950 border border-zinc-700 px-1.5 py-1 text-xs outline-none focus:border-zinc-500"
          >
            {PHYSICAL_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <FormatSourceBadge game={g} />
        </div>
      </td>
      <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
        {g.releaseDate ?? "—"}
      </td>
      <td className="px-3 py-2 text-zinc-300">{score != null ? score : "—"}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <button
            disabled={busy}
            onClick={() => onStatus(g, "owned")}
            className={`rounded px-2 py-1 text-xs border ${
              g.status === "owned"
                ? "bg-emerald-500 text-black border-emerald-500"
                : "border-zinc-700 text-zinc-300 hover:border-emerald-500/60"
            }`}
          >
            Owned
          </button>
          <button
            disabled={busy}
            onClick={() => onStatus(g, "wanted")}
            className={`rounded px-2 py-1 text-xs border ${
              g.status === "wanted"
                ? "bg-pink-500 text-black border-pink-500"
                : "border-zinc-700 text-zinc-300 hover:border-pink-500/60"
            }`}
          >
            Wanted
          </button>
        </div>
      </td>
    </tr>
  );
}

function GameCard({
  game: g,
  busy,
  onStatus,
  onFormat,
}: {
  game: Game;
  busy: boolean;
  onStatus: (g: Game, s: GameStatus) => void;
  onFormat: (g: Game, v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden flex flex-col">
      <div className="relative aspect-[3/4] bg-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {g.coverImageUrl ? (
          <img
            src={g.coverImageUrl}
            alt={g.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full grid place-items-center text-zinc-600 text-sm">
            No cover
          </div>
        )}
        {g.needsReview && (
          <span className="absolute top-2 left-2 rounded-full bg-amber-500/90 text-black text-[10px] font-bold px-2 py-0.5">
            NEW · REVIEW
          </span>
        )}
        {g.status && (
          <span
            className={`absolute top-2 right-2 rounded-full text-[10px] font-bold px-2 py-0.5 ${
              g.status === "owned"
                ? "bg-emerald-500 text-black"
                : "bg-pink-500 text-black"
            }`}
          >
            {g.status.toUpperCase()}
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight">{g.title}</h3>
          <div className="shrink-0 flex flex-col items-end gap-0.5">
            {g.metacriticScore != null && (
              <span
                title="Metacritic"
                className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-zinc-800 text-zinc-200"
              >
                MC {g.metacriticScore}
              </span>
            )}
            {g.opencriticScore != null && (
              <span
                title="OpenCritic"
                className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-zinc-800 text-zinc-200"
              >
                OC {g.opencriticScore}
              </span>
            )}
            {g.igdbRating != null && (
              <span
                title="IGDB critic rating"
                className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-zinc-800 text-zinc-200"
              >
                IGDB {g.igdbRating}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          <span className="text-[10px] rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300">
            {g.platform}
          </span>
          <span
            className={`text-[10px] rounded border px-1.5 py-0.5 ${
              FORMAT_STYLES[g.physicalFormat] ?? FORMAT_STYLES.Unknown
            }`}
          >
            {g.physicalFormat}
          </span>
          <FormatSourceBadge game={g} />
          {g.releaseDate && (
            <span className="text-[10px] rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400">
              {g.releaseDate}
            </span>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => onStatus(g, "owned")}
              className={`flex-1 rounded-md text-xs font-semibold py-1.5 border transition ${
                g.status === "owned"
                  ? "bg-emerald-500 text-black border-emerald-500"
                  : "border-zinc-700 text-zinc-300 hover:border-emerald-500/60"
              }`}
            >
              Owned
            </button>
            <button
              disabled={busy}
              onClick={() => onStatus(g, "wanted")}
              className={`flex-1 rounded-md text-xs font-semibold py-1.5 border transition ${
                g.status === "wanted"
                  ? "bg-pink-500 text-black border-pink-500"
                  : "border-zinc-700 text-zinc-300 hover:border-pink-500/60"
              }`}
            >
              Wanted
            </button>
          </div>
          <select
            disabled={busy}
            value={g.physicalFormat}
            onChange={(e) => onFormat(g, e.target.value)}
            className="rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-xs outline-none focus:border-zinc-500"
            title="Physical format"
          >
            {PHYSICAL_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
