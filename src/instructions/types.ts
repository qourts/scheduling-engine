import type { Id, IsoDate, TimeWindow } from "../config/types.js";
import type { MatchId } from "../inventory/types.js";

/**
 * Structured scheduling instructions.
 *
 * These are plain, JSON-compatible, LLM-independent objects. A future
 * natural-language adapter only has to produce them (see `InstructionAdapter`);
 * the engine never interprets free text. Names are never used here, only IDs.
 *
 * Every instruction is either **mandatory** (a hard rule: the scheduler never
 * violates it and the independent checker rejects schedules that do) or a
 * **preference** (measured, weighted and optimised, never enforced).
 */

export type InstructionStrength = { strength: "mandatory" } | { strength: "preference"; weight: number };

/** Roles a knockout match can have within its stage. */
export type MatchRole = "final" | "third_place" | "medal" | "semifinal" | "quarterfinal";

/**
 * Picks matches. All given fields must match (logical AND); within a field any
 * listed value matches (logical OR). An empty selector selects every match.
 * `medal` means the final or the third-place match.
 */
export interface MatchSelector {
  divisionIds?: Id[];
  categoryIds?: Id[];
  stageIds?: Id[];
  phases?: ("group" | "knockout")[];
  roles?: MatchRole[];
  matchIds?: MatchId[];
}

/**
 * A point in time. With `day` it is an absolute instant. Without `day` it is a
 * clock rule that repeats on every tournament day.
 */
export interface TimeBound {
  day?: IsoDate;
  /** Minutes since midnight, 0..1440. */
  minute: number;
}

/** Limits when selected matches may start and finish. */
export interface TimeWindowInstruction {
  id: Id;
  kind: "time_window";
  selector: MatchSelector;
  /** Matches may not start before this. */
  earliestStart?: TimeBound;
  /** Matches may not start after this. */
  latestStart?: TimeBound;
  /** Matches must end by this (a deadline or "finish before noon"). */
  latestEnd?: TimeBound;
  note?: string;
}

/** Selected matches may only use the listed courts. */
export interface CourtAllowlistInstruction {
  id: Id;
  kind: "court_allowlist";
  selector: MatchSelector;
  courtIds: Id[];
  note?: string;
}

/** Only selected matches may use the listed courts; the courts are kept free for them. */
export interface CourtReservationInstruction {
  id: Id;
  kind: "court_reservation";
  courtIds: Id[];
  selector: MatchSelector;
  note?: string;
}

/** The listed courts host no matches during the window. */
export interface CourtBlackoutInstruction {
  id: Id;
  kind: "court_blackout";
  courtIds: Id[];
  window: TimeWindow;
  note?: string;
}

/**
 * Minimum rest, in minutes, between a player's consecutive matches in the
 * listed divisions. Mandatory: replaces the division minimum (it may lower it
 * below the tournament default, which is reported as a warning).
 * Preference: the engine tries to keep every gap at or above this value.
 */
export interface MinRestInstruction {
  id: Id;
  kind: "min_rest";
  divisionIds: Id[];
  minutes: number;
  note?: string;
}

/** A match fixed to a court and start time. */
export interface LockedPlacementInstruction {
  id: Id;
  kind: "locked_placement";
  matchId: MatchId;
  courtId: Id;
  day: IsoDate;
  /** Minutes since midnight. */
  start: number;
  note?: string;
}

/**
 * Selected divisions are played in consecutive operational blocks, in the
 * listed order: the time span of one division should not overlap the next.
 * Supported as a preference only.
 */
export interface ConsecutiveBlocksInstruction {
  id: Id;
  kind: "consecutive_blocks";
  divisionIds: Id[];
  note?: string;
}

export type InstructionBody =
  | TimeWindowInstruction
  | CourtAllowlistInstruction
  | CourtReservationInstruction
  | CourtBlackoutInstruction
  | MinRestInstruction
  | LockedPlacementInstruction
  | ConsecutiveBlocksInstruction;

export type InstructionKind = InstructionBody["kind"];

/** An instruction body plus whether it is mandatory or a weighted preference. */
export type SchedulingInstruction = InstructionBody & InstructionStrength;

export type InstructionIssueSeverity = "error" | "warning";

export type InstructionIssueCode =
  | "DUPLICATE_ID"
  | "UNKNOWN_DIVISION"
  | "UNKNOWN_CATEGORY"
  | "UNKNOWN_STAGE"
  | "UNKNOWN_COURT"
  | "UNKNOWN_MATCH"
  | "UNKNOWN_DAY"
  | "INVALID_TIME"
  | "INVALID_WEIGHT"
  | "INVALID_VALUE"
  | "EMPTY_LIST"
  | "EMPTY_SELECTION"
  | "CONTRADICTORY_BOUNDS"
  | "UNSUPPORTED_MANDATORY"
  | "MIN_REST_LOWERED"
  | "CONFLICTING_LOCKS"
  | "LOCKED_OUTSIDE_RULES";

export interface InstructionIssue {
  severity: InstructionIssueSeverity;
  code: InstructionIssueCode;
  instructionId: Id | null;
  message: string;
}

export interface InstructionValidationResult {
  ok: boolean;
  issues: InstructionIssue[];
}

export const isMandatory = (i: SchedulingInstruction): boolean => i.strength === "mandatory";
export const weightOf = (i: SchedulingInstruction): number => (i.strength === "preference" ? i.weight : 0);
