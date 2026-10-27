import type { Tiebreaker } from "@engine";

/**
 * What an operator types into the wizard. It is deliberately smaller than the engine's TournamentConfig:
 * `buildConfig` expands it. Everything here is JSON-serialisable and is what gets saved.
 */

export interface DayWindow {
  /** Minutes since midnight. */
  start: number;
  end: number;
}

export interface CourtSpec {
  id: string;
  name: string;
  tags: string[];
  /** Per-day exceptions to the daily window. `null` closes the court that day. */
  overrides: Record<string, DayWindow | null>;
}

export interface CategorySpec {
  id: string;
  name: string;
  discipline: "singles" | "doubles";
  gender: "men" | "women" | "mixed" | "open";
}

export type FormatKind = "pools_playoff" | "round_robin" | "knockout";

export interface FormatSpec {
  kind: FormatKind;
  /** pools_playoff: number of pools. */
  groupCount: number;
  /** pools_playoff: how many teams per pool advance automatically. */
  perPool: number;
  /** pools_playoff: one extra qualifier from the next-best finishing position (0 or 1; the engine supports one seat). */
  wildcard: 0 | 1;
  /** Knockout stages include a third-place match. */
  thirdPlace: boolean;
  /** round_robin: play every team twice. */
  doubleRoundRobin: boolean;
}

export interface DivisionSpec {
  id: string;
  name: string;
  categoryId: string;
  skillLevel: string;
  /** One team per line; "Ana Cruz / Ben Lim" names the players, a bare name gets placeholder players. */
  teams: string[];
  format: FormatSpec;
  /** Court time for a pool or knockout match (playing time plus warm-up). */
  matchMinutes: number;
  /** Court time for the final and third-place match, when different. */
  medalMinutes: number | null;
  bestOf: 1 | 3 | 5;
  /** Division-specific recovery; null uses the event default. */
  recoveryMinutes: number | null;
  /** Restrict this division to a daily time window (for example a category slot). */
  window: DayWindow | null;
  tiebreakers: Tiebreaker[];
}

export interface EventSpec {
  name: string;
  days: string[];
  /** Default court opening hours on every day. */
  dayWindow: DayWindow;
  courts: CourtSpec[];
  categories: CategorySpec[];
  divisions: DivisionSpec[];
  /** Minimum minutes between the end of a player's match slot and the start of their next. */
  recoveryMinutes: number;
  /** Extra court buffer between matches, on top of each slot. Usually 0 because the slot already includes transition. */
  courtTurnoverMinutes: number;
  maxMatchesPerPlayerPerDay: number | null;
  /** Free-text caveats shown wherever this event appears, for example "experimental assumption". */
  experimentalNote: string | null;
}

export const DEFAULT_TIEBREAKERS: Tiebreaker[] = ["wins", "head_to_head", "game_difference", "point_difference", "points_for", "draw"];

export const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function parseClockInput(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 && h * 60 + min <= 1440 ? h * 60 + min : null;
}

export function emptyFormat(kind: FormatKind = "pools_playoff"): FormatSpec {
  return { kind, groupCount: 2, perPool: 2, wildcard: 0, thirdPlace: true, doubleRoundRobin: false };
}

export function newCourts(count: number, existing: CourtSpec[] = []): CourtSpec[] {
  return Array.from({ length: count }, (_, i) => existing[i] ?? { id: `C${i + 1}`, name: `Court ${i + 1}`, tags: [], overrides: {} });
}

export function blankEvent(): EventSpec {
  const today = new Date();
  const iso = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 14)).toISOString().slice(0, 10);
  return {
    name: "New tournament",
    days: [iso],
    dayWindow: { start: 8 * 60, end: 19 * 60 },
    courts: newCourts(6),
    categories: [{ id: "MD", name: "Men's Doubles", discipline: "doubles", gender: "men" }],
    divisions: [],
    recoveryMinutes: 20,
    courtTurnoverMinutes: 0,
    maxMatchesPerPlayerPerDay: null,
    experimentalNote: null,
  };
}
