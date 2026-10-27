import type { Id, IsoDate } from "../config/types.js";
import type { MatchId } from "../inventory/types.js";

export interface Assignment {
  matchId: MatchId;
  courtId: Id;
  day: IsoDate;
  /** Minutes since local midnight. The match occupies [start, start + duration). */
  start: number;
}

export interface Schedule {
  tournamentId: Id;
  assignments: Assignment[];
}
