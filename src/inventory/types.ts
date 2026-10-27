import type { Id, Team, TournamentConfig } from "../config/types.js";

export type MatchId = string;

/**
 * Who plays in one side of a match. Unresolved playoff participants are
 * first-class: a slot may refer to the winner or loser of another match, or to
 * a finishing position in a group that has not finished yet.
 */
export type Slot =
  | { type: "team"; teamId: Id }
  | { type: "winner"; matchId: MatchId }
  | { type: "loser"; matchId: MatchId }
  | { type: "group_rank"; divisionId: Id; stageId: Id; groupId: Id; rank: number };

export type DependencyKind = "winner" | "loser" | "group_complete";

/** `matchId` must finish (plus rest) before the dependent match may start. */
export interface Dependency {
  matchId: MatchId;
  kind: DependencyKind;
}

export type MatchPhase = "group" | "knockout";

export interface Match {
  id: MatchId;
  tournamentId: Id;
  divisionId: Id;
  stageId: Id;
  phase: MatchPhase;
  /** Set for group and round-robin matches. */
  groupId?: Id;
  /** 1-based round within the stage (for groups, within the group). */
  round: number;
  roundLabel: string;
  /** Short label unique within the division, e.g. "A-R2-1", "QF3", "F", "3P". */
  label: string;
  slots: readonly [Slot, Slot];
  durationMinutes: number;
  dependencies: Dependency[];
  /** Knockout only: this is the third-place match. */
  thirdPlace?: boolean;
}

export interface GroupStructure {
  groupId: Id;
  teamIds: Id[];
  matchIds: MatchId[];
  legs: 1 | 2;
}

export interface GroupStageStructure {
  stageId: Id;
  kind: "groups";
  /** A round-robin stage is represented as a single group with id "RR". */
  groups: GroupStructure[];
}

export interface KnockoutStageStructure {
  stageId: Id;
  kind: "knockout";
  size: number;
  roundCount: number;
  /** Entrants in seed order. */
  entrants: Slot[];
  /** Match ids per round, round 1 first. The third-place match is not included. */
  rounds: MatchId[][];
  finalMatchId: MatchId;
  thirdPlaceMatchId?: MatchId;
  /** Same-group qualifiers drawn to meet in their first knockout match (0 when avoidable). */
  sameGroupFirstMatchMeetings: number;
}

export type StageStructure = GroupStageStructure | KnockoutStageStructure;

export interface DivisionStructure {
  divisionId: Id;
  stages: StageStructure[];
}

export interface Inventory {
  config: TournamentConfig;
  /** All matches in deterministic generation order. */
  matches: Match[];
  matchById: ReadonlyMap<MatchId, Match>;
  divisions: DivisionStructure[];
  teamById: ReadonlyMap<Id, Team>;
  divisionOfTeam: ReadonlyMap<Id, Id>;
  /** Group lookup keyed by `${divisionId}|${stageId}|${groupId}`. */
  groupByKey: ReadonlyMap<string, GroupStructure>;
}

export const groupKey = (divisionId: Id, stageId: Id, groupId: Id) => `${divisionId}|${stageId}|${groupId}`;
