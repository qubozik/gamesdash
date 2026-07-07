import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  doublePrecision,
  date,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// Physical format values: "Full Cart" | "Key Card" | "Digital Only" | "Unknown"
// Platform values: "Switch 2" | "Switch" | "Both"
// Status values: "owned" | "wanted" | null (untracked)
// Source values: "curated" | "igdb"

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  igdbId: integer("igdb_id").unique(),

  title: text("title").notNull().unique(),
  releaseDate: date("release_date"),
  released: boolean("released").default(false).notNull(),
  platform: text("platform").default("Switch 2").notNull(),
  genre: jsonb("genre").$type<string[]>().default([]).notNull(),
  priceUsd: doublePrecision("price_usd"),
  physicalFormat: text("physical_format").default("Unknown").notNull(),
  // How the physical format was determined: 'seed' | 'nintendo' | 'brave' | 'manual' | null
  formatSource: text("format_source"),
  metacriticScore: integer("metacritic_score"),
  opencriticScore: integer("opencritic_score"),
  igdbRating: integer("igdb_rating"),
  coverImageUrl: text("cover_image_url"),
  howLongToBeatHours: doublePrecision("how_long_to_beat_hours"),
  isMultiplayer: boolean("is_multiplayer").default(false).notNull(),
  isLocalCoop: boolean("is_local_coop").default(false).notNull(),
  isRemake: boolean("is_remake").default(false).notNull(),
  remakeOriginalTitle: text("remake_original_title"),
  remakeOriginalYear: integer("remake_original_year"),
  remakeOriginalConsole: text("remake_original_console"),
  fps: text("fps"),
  targetLink: text("target_link"),
  iam8bitLink: text("iam8bit_link"),
  specialPhysicalRetailers: jsonb("special_physical_retailers")
    .$type<string[]>()
    .default([])
    .notNull(),
  description: text("description"),

  // Personal tracking (original goal)
  status: text("status"), // "owned" | "wanted" | null
  hidden: boolean("hidden").default(false).notNull(),

  // Sync bookkeeping
  needsReview: boolean("needs_review").default(false).notNull(),
  source: text("source").default("curated").notNull(),

  lastUpdated: timestamp("last_updated", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
