import type { Division, Id } from "../config/types.js";
import { groupKey, type Inventory, type MatchId, type Slot } from "../inventory/types.js";
import { err, ok, type Result } from "../util/result.js";
import { computeGroupStandings } from "./standings.js";
import type {
  AppliedEvent,
  GroupStandings,
  MatchResult,
  MatchStatus,
  ProgressionError,
  ProgressionEvent,
  ProgressionState,
} from "./types.js";

/**
 * Competition progression as an append-only event log.
 *
 * State is always re-derived from the inventory plus the accepted results, so
 * there is exactly one way to arrive at standings and bracket participants.
 * Completed matches are protected: a correction is rejected if it would change
 * who played in any other completed match.
 */
export function initialState(inventory: Inventory): ProgressionState {
  return derive(inventory, new Map(), []);
}

export function applyEvent(
  inventory: Inventory,
  state: ProgressionState,
  event: ProgressionEvent,
): Result<AppliedEvent, ProgressionError> {
  const fail = (code: ProgressionError["code"], message: string, matchIds?: MatchId[]) =>
    err<ProgressionError>(matchIds ? { code, message, eventId: event.eventId, matchIds } : { code, message, eventId: event.eventId });

  if (state.log.some((e) => e.eventId === event.eventId)) return fail("DUPLICATE_EVENT", `Event ${event.eventId} was already applied`);
  const match = inventory.matchById.get(event.matchId);
  if (!match) return fail("UNKNOWN_MATCH", `Match ${event.matchId} does not exist`);
  const division = divisionOf(inventory, match.divisionId);

  const scoreProblem = checkScore(event.result, division.scoring.bestOf);
  if (scoreProblem) return fail("INVALID_SCORE", scoreProblem);

  if (event.type === "result_recorded") {
    if (state.results.has(match.id)) {
      return fail("ALREADY_COMPLETED", `Match ${match.label} already has a result; submit a correction instead`);
    }
    const [a, b] = state.participants.get(match.id)!;
    if (a === null || b === null) {
      return fail("PARTICIPANTS_UNRESOLVED", `Match ${match.label} cannot be played before both participants are known`);
    }
  } else {
    if (!state.results.has(match.id)) return fail("NOT_COMPLETED", `Match ${match.label} has no result to correct`);
    if (!event.reason.trim()) return fail("MISSING_REASON", "A correction needs a reason for the audit trail");
  }

  const results = new Map(state.results);
  results.set(match.id, event.result);
  const next = derive(inventory, results, [...state.log, event]);

  const changed: MatchId[] = [];
  const changedCompleted: MatchId[] = [];
  for (const m of inventory.matches) {
    if (m.id === match.id) continue;
    const before = state.participants.get(m.id)!;
    const after = next.participants.get(m.id)!;
    if (before[0] === after[0] && before[1] === after[1]) continue;
    changed.push(m.id);
    if (state.results.has(m.id)) changedCompleted.push(m.id);
  }
  if (changedCompleted.length > 0) {
    return fail(
      "DOWNSTREAM_COMPLETED",
      `Correction would change participants of completed matches: ${changedCompleted.join(", ")}`,
      changedCompleted,
    );
  }
  return ok({ state: next, affectedMatchIds: changed });
}

/** Applies events in order; stops at the first rejected event. */
export function replay(inventory: Inventory, events: readonly ProgressionEvent[]): Result<ProgressionState, ProgressionError> {
  let state = initialState(inventory);
  for (const event of events) {
    const applied = applyEvent(inventory, state, event);
    if (!applied.ok) return applied;
    state = applied.value.state;
  }
  return ok(state);
}

/** Events concerning one match, oldest first. */
export function auditTrail(state: ProgressionState, matchId: MatchId): ProgressionEvent[] {
  return state.log.filter((e) => e.matchId === matchId);
}

function derive(inventory: Inventory, results: ReadonlyMap<MatchId, MatchResult>, log: readonly ProgressionEvent[]): ProgressionState {
  const standings = new Map<string, GroupStandings>();
  for (const division of inventory.config.divisions) {
    const structure = inventory.divisions.find((d) => d.divisionId === division.id)!;
    for (const stage of structure.stages) {
      if (stage.kind !== "groups") continue;
      for (const group of stage.groups) {
        standings.set(groupKey(division.id, stage.stageId, group.groupId), {
          divisionId: division.id,
          stageId: stage.stageId,
          groupId: group.groupId,
          complete: group.matchIds.every((id) => results.has(id)),
          rows: computeGroupStandings(inventory, division, group, results),
        });
      }
    }
  }

  const participants = new Map<MatchId, readonly [Id | null, Id | null]>();
  const resolveSlot = (slot: Slot): Id | null => {
    switch (slot.type) {
      case "team":
        return slot.teamId;
      case "group_rank": {
        const table = standings.get(groupKey(slot.divisionId, slot.stageId, slot.groupId))!;
        return table.complete ? table.rows[slot.rank - 1]!.teamId : null;
      }
      case "winner":
      case "loser": {
        const result = results.get(slot.matchId);
        const feeder = participants.get(slot.matchId);
        if (!result || !feeder) return null;
        const side = slot.type === "winner" ? result.winner : result.winner === 0 ? 1 : 0;
        return feeder[side];
      }
    }
  };
  // Generation order lists feeders before the matches they feed.
  for (const match of inventory.matches) {
    participants.set(match.id, [resolveSlot(match.slots[0]), resolveSlot(match.slots[1])]);
  }

  const status = new Map<MatchId, MatchStatus>();
  for (const match of inventory.matches) {
    const [a, b] = participants.get(match.id)!;
    status.set(match.id, results.has(match.id) ? "completed" : a !== null && b !== null ? "ready" : "waiting");
  }
  return { results, participants, status, standings, log };
}

function divisionOf(inventory: Inventory, divisionId: Id): Division {
  return inventory.config.divisions.find((d) => d.id === divisionId)!;
}

/** Returns a description of the problem, or null if the score is consistent. */
export function checkScore(result: MatchResult, bestOf: 1 | 3 | 5): string | null {
  if (result.winner !== 0 && result.winner !== 1) return "winner must be 0 or 1";
  for (const g of result.games) {
    if (!Number.isInteger(g.a) || !Number.isInteger(g.b) || g.a < 0 || g.b < 0) return "Game scores must be non-negative integers";
    if (g.a === g.b) return "A game cannot end level";
  }
  const needed = Math.ceil(bestOf / 2);
  const won = [0, 0];
  result.games.forEach((g) => won[g.a > g.b ? 0 : 1]!++);
  const winnerGames = won[result.winner]!;
  const loserGames = won[result.winner === 0 ? 1 : 0]!;

  switch (result.outcome) {
    case "walkover":
      return result.games.length === 0 ? null : "A walkover has no games";
    case "retired":
      if (result.games.length > bestOf) return `At most ${bestOf} games can be played`;
      if (loserGames >= needed) return "The retiring side cannot already have won the match";
      if (winnerGames >= needed) return "The winner had already won; record it as played";
      return null;
    case "played": {
      if (winnerGames !== needed) return `The winner must win exactly ${needed} game(s) in a best of ${bestOf}`;
      if (loserGames >= needed) return "Both sides cannot win the match";
      const last = result.games[result.games.length - 1]!;
      if ((last.a > last.b ? 0 : 1) !== result.winner) return "The match ends when the winner takes the deciding game";
      return null;
    }
    default:
      return `Unknown outcome "${String(result.outcome)}"`;
  }
}
