export type GameStatus = "owned" | "wanted" | null;

export const PHYSICAL_FORMATS = [
  "Full Cart",
  "Key Card",
  "Digital Only",
  "Unknown",
] as const;

export interface Game {
  id: number;
  igdbId: number | null;
  title: string;
  releaseDate: string | null;
  released: boolean;
  platform: string;
  genre: string[];
  priceUsd: number | null;
  physicalFormat: string;
  formatSource: string | null;
  metacriticScore: number | null;
  opencriticScore: number | null;
  igdbRating: number | null;
  coverImageUrl: string | null;
  howLongToBeatHours: number | null;
  isMultiplayer: boolean;
  isLocalCoop: boolean;
  isRemake: boolean;
  fps: string | null;
  targetLink: string | null;
  iam8bitLink: string | null;
  description: string | null;
  status: GameStatus;
  hidden: boolean;
  needsReview: boolean;
  source: string;
}
