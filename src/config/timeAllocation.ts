import type { Id, TournamentConfig } from "./types.js";

/**
 * The time-allocation model, one entry per division. Five quantities are kept apart so that nothing is counted twice:
 *
 * - **Active playing time** (`activePlayMinutes`): optional, informational.
 * - **Transition allowance** (`transitionAllowanceMinutes`): warm-up and changeover that is already INSIDE the scheduled slot.
 * - **Scheduled court occupancy** (`scheduledSlotMinutes`): `matchDurationMinutes`, the time a match holds its court.
 *   For a medal match it is the configurable planning estimate `medalMatchDurationMinutes`, which is an estimate only:
 *   a match with no time cap may run longer, and the engine does not reserve extra time for that.
 * - **Additional turnover buffer** (`additionalTurnoverMinutes`): `rules.courtTurnoverMinutes`, extra court time between two
 *   matches on one court. It is 0 unless explicitly configured, and should stay 0 when the slot already includes the transition.
 * - **Participant recovery** (`minimumRecoveryMinutes`): minimum time between the end of one occupied slot and the start of the
 *   same participant's next match. Court turnover is not part of it.
 *
 * Derived: the earliest a court can start its next match is `scheduledSlotMinutes + additionalTurnoverMinutes` after a start
 * (`courtCycleMinutes`); the earliest a participant can start their next match is `scheduledSlotMinutes + minimumRecoveryMinutes`
 * (`participantCycleMinutes`).
 */
export interface TimeAllocation {
  divisionId: Id;
  activePlayMinutes: number | null;
  transitionAllowanceMinutes: number | null;
  scheduledSlotMinutes: number;
  medalPlanningEstimateMinutes: number;
  additionalTurnoverMinutes: number;
  minimumRecoveryMinutes: number;
  courtCycleMinutes: number;
  participantCycleMinutes: number;
}

export function describeTimeAllocation(config: TournamentConfig): TimeAllocation[] {
  return config.divisions.map((division) => {
    const slot = division.matchDurationMinutes;
    const turnover = config.rules.courtTurnoverMinutes;
    const recovery = division.minRestMinutes ?? config.rules.minRestMinutes;
    return {
      divisionId: division.id,
      activePlayMinutes: division.playMinutes ?? null,
      transitionAllowanceMinutes: division.transitionMinutes ?? null,
      scheduledSlotMinutes: slot,
      medalPlanningEstimateMinutes: division.medalMatchDurationMinutes ?? slot,
      additionalTurnoverMinutes: turnover,
      minimumRecoveryMinutes: recovery,
      courtCycleMinutes: slot + turnover,
      participantCycleMinutes: slot + recovery,
    };
  });
}
