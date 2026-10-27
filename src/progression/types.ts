import type { Id } from "../config/types.js";
import type { MatchId } from "../inventory/types.js";

/** 0 = the match's first slot, 1 = the second slot. */
export type Side = 0 | 1;

/** Points for each side in one game, in slot order. */
export interface GameScore {
  a: number;
  b: number;
}

export type ResultOutcome = "played" | "retired" | "walkover";

export interface MatchResult {
  winner: Side;
  outcome: ResultOutcome;
  /** Completed (or, for retirements, partial) games. Empty for walkovers. */
  games: GameScore[];
}

interface EventBase {
  /** Caller-supplied unique id, e.g. a UUID from the operator console. */
  eventId: string;
  /** ISO-8601 timestamp supplied by the caller; the engine never reads the clock. */
  at: string;
  /** Who made the change (operator id or system component). */
  actor: string;
}

export interface ResultRecordedEvent extends EventBase {
  type: "result_recorded";
  matchId: MatchId;
  result: MatchResult;
}

export interface ResultCorrectedEvent extends EventBase {
  type: "result_corrected";
  matchId: MatchId;
  result: MatchResult;
  reason: string;
}

export type ProgressionEvent = ResultRecordedEvent | ResultCorrectedEvent;

export type MatchStatus = "waiting" | "ready" | "completed";

export interface StandingRow {
  teamId: Id;
  played: number;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface GroupStandings {
  divisionId: Id;
  stageId: Id;
  groupId: Id;
  /** True once every match of the group has a result; only then are ranks final. */
  complete: boolean;
  /** Ordered by rank (index 0 = first place). Provisional while incomplete. */
  rows: StandingRow[];
}

export interface ProgressionState {
  results: ReadonlyMap<MatchId, MatchResult>;
  participants: ReadonlyMap<MatchId, readonly [Id | null, Id | null]>;
  status: ReadonlyMap<MatchId, MatchStatus>;
  /** Keyed like Inventory.groupByKey. */
  standings: ReadonlyMap<string, GroupStandings>;
  /** Every applied event, in order. Rejected events are never logged. */
  log: readonly ProgressionEvent[];
}

export type ProgressionErrorCode =
  | "UNKNOWN_MATCH"
  | "DUPLICATE_EVENT"
  | "ALREADY_COMPLETED"
  | "NOT_COMPLETED"
  | "PARTICIPANTS_UNRESOLVED"
  | "INVALID_SCORE"
  | "DOWNSTREAM_COMPLETED"
  | "MISSING_REASON";

export interface ProgressionError {
  code: ProgressionErrorCode;
  message: string;
  eventId: string;
  /** For DOWNSTREAM_COMPLETED: completed matches whose participants would change. */
  matchIds?: MatchId[];
}

export interface AppliedEvent {
  state: ProgressionState;
  /** Matches (other than the event's own) whose participants changed. */
  affectedMatchIds: MatchId[];
}
