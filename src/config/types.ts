/**
 * Tournament configuration: the complete, explicit input to the engine.
 *
 * The engine never fills in missing values silently. Every rule that affects
 * match generation or schedule validity must be stated here; the only implicit
 * meaning is "absent restriction = no restriction" (for example a division with
 * no `playWindows` may play whenever an eligible court is available).
 *
 * Times are integer minutes since local midnight of the referenced day.
 */

export type Id = string;
export type IsoDate = string;

export interface TimeWindow {
  /** ISO date of a tournament day, e.g. "2026-11-14". Must be listed in `days`. */
  day: IsoDate;
  /** Minutes since midnight, inclusive. */
  start: number;
  /** Minutes since midnight, exclusive. At most 1440. */
  end: number;
}

export interface TournamentConfig {
  id: Id;
  name: string;
  /** Tournament days in ascending order. */
  days: IsoDate[];
  courts: Court[];
  players: Player[];
  categories: Category[];
  divisions: Division[];
  rules: GlobalRules;
  restrictions?: Restriction[];
}

export interface Court {
  id: Id;
  name: string;
  /** Free-form tags, e.g. "feature", "indoor". Used by eligibility rules. */
  tags?: string[];
  /** When the court can host matches. Windows on the same day must not overlap. */
  availability: TimeWindow[];
}

export interface Player {
  id: Id;
  name: string;
}

export type Discipline = "singles" | "doubles";
export type Gender = "men" | "women" | "mixed" | "open";

/** The kind of event, e.g. Men's Doubles. Divisions belong to a category. */
export interface Category {
  id: Id;
  name: string;
  discipline: Discipline;
  gender: Gender;
}

export interface Team {
  id: Id;
  name: string;
  /** Exactly 1 player for singles, exactly 2 for doubles. */
  playerIds: Id[];
  /** 1 = strongest. Optional; seeded teams are placed before unseeded ones. */
  seed?: number;
}

export type Tiebreaker =
  | "wins"
  | "head_to_head"
  | "game_difference"
  | "point_difference"
  | "points_for"
  | "seed"
  | "draw";

export interface ScoringRules {
  /** Games per match. Pickleball commonly uses 1 game to 11/15/21 or best of 3. */
  bestOf: 1 | 3 | 5;
}

export interface StandingsRules {
  /**
   * Ordered tiebreakers. Must end with "draw" so that ranking is always a total
   * order. "draw" is a deterministic hash-based draw, reproducible from IDs.
   */
  tiebreakers: Tiebreaker[];
}

/** A skill/age bracket within a category, e.g. "Men's Doubles 3.5". */
export interface Division {
  id: Id;
  name: string;
  categoryId: Id;
  skillLevel?: string;
  ageGroup?: string;
  teams: Team[];
  /** One stage, or a group stage followed by a knockout stage. */
  stages: StageConfig[];
  /** Court time allocated per match, in minutes (playing time plus warm-up). */
  matchDurationMinutes: number;
  scoring: ScoringRules;
  standings: StandingsRules;
  /** Overrides `rules.minRestMinutes` for players while playing in this division. */
  minRestMinutes?: number;
  /** If set, matches of this division may only be played inside these windows. */
  playWindows?: TimeWindow[];
  /** If set, matches of this division may only be played on these courts. */
  eligibleCourtIds?: Id[];
}

export type StageConfig = RoundRobinStageConfig | GroupStageConfig | KnockoutStageConfig;

/** Every team plays every other team `legs` times. */
export interface RoundRobinStageConfig {
  id: Id;
  kind: "round_robin";
  name?: string;
  legs: 1 | 2;
}

/** Teams are split into `groupCount` round-robin groups. */
export interface GroupStageConfig {
  id: Id;
  kind: "groups";
  name?: string;
  groupCount: number;
  legs: 1 | 2;
  /**
   * "snake": seeds are dealt A,B,C,C,B,A,... (balanced strength).
   * "sequential": teams in listed order fill A first, then B, ...
   */
  allocation: "snake" | "sequential";
}

export type KnockoutSource =
  /** Entrants are the division's teams, ordered by seed. */
  | { type: "teams" }
  /** Entrants are the top `perGroup` finishers of every group of the previous stage. */
  | { type: "qualifiers"; fromStageId: Id; perGroup: number };

export interface KnockoutStageConfig {
  id: Id;
  kind: "single_elimination";
  name?: string;
  source: KnockoutSource;
  thirdPlaceMatch: boolean;
}

export interface GlobalRules {
  /** Minimum gap between two matches on the same court. */
  courtTurnoverMinutes: number;
  /** Minimum rest for a player between the end of one match and the start of the next. */
  minRestMinutes: number;
  /** Optional hard cap on the number of matches a player may play per day. */
  maxMatchesPerPlayerPerDay?: number;
}

export type RestrictionSubject = { type: "player"; id: Id } | { type: "team"; id: Id };

/** Hard restriction: the subject cannot play during the window. */
export interface Restriction {
  id: Id;
  kind: "unavailable";
  subject: RestrictionSubject;
  window: TimeWindow;
  reason?: string;
}

/** Recommended tiebreak order. Callers must pass it explicitly; it is not applied by default. */
export const STANDARD_TIEBREAKERS: readonly Tiebreaker[] = [
  "wins",
  "head_to_head",
  "game_difference",
  "point_difference",
  "points_for",
  "draw",
];
