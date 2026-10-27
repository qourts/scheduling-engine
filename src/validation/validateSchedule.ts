import type { Division, Id } from "../config/types.js";
import { buildDependencyGraph, type DependencyGraph } from "../inventory/graph.js";
import { ParticipantModel, type Resolution } from "../inventory/participants.js";
import type { Inventory, Match, MatchId } from "../inventory/types.js";
import type { Assignment, Schedule } from "../schedule/types.js";
import { Timeline } from "../schedule/timeline.js";
import { MINUTES_PER_DAY, overlaps, type Interval } from "../util/time.js";

/**
 * Independent hard-constraint validator.
 *
 * It shares only the domain model (inventory, dependency graph, participant
 * sets) with the rest of the engine and never any scheduling logic, so a
 * scheduler bug cannot hide itself. Every hard rule is checked for every
 * possible tournament outcome: "possible" violations involve playoff fixtures
 * whose participants are not decided yet and are just as invalid as
 * "definite" ones.
 */

export type ViolationCode =
  | "WRONG_TOURNAMENT"
  | "UNKNOWN_MATCH"
  | "UNKNOWN_COURT"
  | "UNKNOWN_DAY"
  | "INVALID_START"
  | "DUPLICATE_ASSIGNMENT"
  | "UNSCHEDULED_MATCH"
  | "COURT_NOT_ELIGIBLE"
  | "OUTSIDE_COURT_AVAILABILITY"
  | "OUTSIDE_DIVISION_WINDOW"
  | "COURT_OVERLAP"
  | "COURT_TURNOVER"
  | "DEPENDENCY_ORDER"
  | "PLAYER_OVERLAP"
  | "PLAYER_REST"
  | "PARTICIPANT_UNAVAILABLE"
  | "PLAYER_DAILY_CAP"
  | "FROZEN_MATCH_CHANGED";

export interface Violation {
  code: ViolationCode;
  /** "possible" = would occur for at least one outcome of undecided matches. */
  certainty: "definite" | "possible";
  message: string;
  matchIds: MatchId[];
  courtId?: Id;
  playerIds?: Id[];
}

export interface ValidationOptions {
  /** Validate a partial schedule (e.g. a draft); otherwise every match must be scheduled. */
  allowPartial?: boolean;
  /** Assignments that must appear unchanged (locked, in progress or completed matches). */
  frozen?: readonly Assignment[];
  /** Known participants (e.g. from progression), which narrows possible-participant sets. */
  resolution?: Resolution;
}

export interface ValidationReport {
  valid: boolean;
  violations: Violation[];
}

interface Placed {
  assignment: Assignment;
  match: Match;
  division: Division;
  interval: Interval;
  rest: number;
}

export function validateSchedule(inventory: Inventory, schedule: Schedule, options: ValidationOptions = {}): ValidationReport {
  const { config } = inventory;
  const violations: Violation[] = [];
  const add = (v: Violation) => violations.push(v);
  const timeline = new Timeline(config);
  const graph = buildDependencyGraph(inventory);
  const participants = new ParticipantModel(inventory, graph, options.resolution);
  const courts = new Map(config.courts.map((c) => [c.id, c]));
  const divisions = new Map(config.divisions.map((d) => [d.id, d]));
  const name = (m: Match) => `${m.divisionId} ${m.label}`;

  if (schedule.tournamentId !== config.id) {
    add({ code: "WRONG_TOURNAMENT", certainty: "definite", matchIds: [], message: `Schedule is for "${schedule.tournamentId}", not "${config.id}"` });
  }

  // Structural checks.
  const placed = new Map<MatchId, Placed>();
  for (const a of schedule.assignments) {
    const match = inventory.matchById.get(a.matchId);
    if (!match) {
      add({ code: "UNKNOWN_MATCH", certainty: "definite", matchIds: [a.matchId], message: `Match ${a.matchId} does not exist` });
      continue;
    }
    if (placed.has(a.matchId)) {
      add({ code: "DUPLICATE_ASSIGNMENT", certainty: "definite", matchIds: [a.matchId], message: `${name(match)} is scheduled more than once` });
      continue;
    }
    if (!courts.has(a.courtId)) {
      add({ code: "UNKNOWN_COURT", certainty: "definite", matchIds: [a.matchId], courtId: a.courtId, message: `Court ${a.courtId} does not exist` });
      continue;
    }
    if (!timeline.hasDay(a.day)) {
      add({ code: "UNKNOWN_DAY", certainty: "definite", matchIds: [a.matchId], message: `${a.day} is not a tournament day` });
      continue;
    }
    if (!Number.isInteger(a.start) || a.start < 0 || a.start >= MINUTES_PER_DAY) {
      add({ code: "INVALID_START", certainty: "definite", matchIds: [a.matchId], message: `Start ${a.start} is not a minute of the day` });
      continue;
    }
    const division = divisions.get(match.divisionId)!;
    const start = timeline.absolute(a.day, a.start);
    placed.set(a.matchId, {
      assignment: a,
      match,
      division,
      interval: { start, end: start + match.durationMinutes },
      rest: division.minRestMinutes ?? config.rules.minRestMinutes,
    });
  }
  if (!options.allowPartial) {
    for (const match of inventory.matches) {
      if (!placed.has(match.id)) {
        add({ code: "UNSCHEDULED_MATCH", certainty: "definite", matchIds: [match.id], message: `${name(match)} is not scheduled` });
      }
    }
  }

  // Court eligibility, court availability and division windows.
  for (const p of placed.values()) {
    const { match, division, interval, assignment } = p;
    const court = courts.get(assignment.courtId)!;
    if (division.eligibleCourtIds && !division.eligibleCourtIds.includes(court.id)) {
      add({ code: "COURT_NOT_ELIGIBLE", certainty: "definite", matchIds: [match.id], courtId: court.id, message: `${name(match)} is not allowed on ${court.name}` });
    }
    const within = (windows: readonly { day: string; start: number; end: number }[]) =>
      windows.some((w) => {
        const iv = timeline.window(w);
        return interval.start >= iv.start && interval.end <= iv.end;
      });
    if (!within(court.availability)) {
      add({ code: "OUTSIDE_COURT_AVAILABILITY", certainty: "definite", matchIds: [match.id], courtId: court.id, message: `${name(match)} does not fit inside an availability window of ${court.name}` });
    }
    if (division.playWindows && !within(division.playWindows)) {
      add({ code: "OUTSIDE_DIVISION_WINDOW", certainty: "definite", matchIds: [match.id], message: `${name(match)} is outside the play windows of ${division.name}` });
    }
  }

  // Court overlap and turnover.
  const turnover = config.rules.courtTurnoverMinutes;
  const byCourt = groupBy([...placed.values()], (p) => p.assignment.courtId);
  for (const [courtId, list] of byCourt) {
    list.sort((x, y) => x.interval.start - y.interval.start);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (b.interval.start >= a.interval.end + turnover) break;
        const overlap = overlaps(a.interval, b.interval);
        add({
          code: overlap ? "COURT_OVERLAP" : "COURT_TURNOVER",
          certainty: "definite",
          matchIds: [a.match.id, b.match.id],
          courtId,
          message: overlap
            ? `${name(a.match)} and ${name(b.match)} overlap on ${courtId}`
            : `${name(a.match)} and ${name(b.match)} are less than the ${turnover}-minute turnover apart on ${courtId}`,
        });
      }
    }
  }

  // Dependencies: a match starts no earlier than each prerequisite's end plus rest.
  for (const p of placed.values()) {
    for (const dep of p.match.dependencies) {
      const before = placed.get(dep.matchId);
      if (!before) continue;
      const earliest = before.interval.end + p.rest;
      if (p.interval.start < earliest) {
        add({
          code: "DEPENDENCY_ORDER",
          certainty: "definite",
          matchIds: [dep.matchId, p.match.id],
          message: `${name(p.match)} starts ${earliest - p.interval.start} min too early after ${name(before.match)} (${dep.kind}; needs end + ${p.rest} min rest)`,
        });
      }
    }
  }

  checkPlayerConflicts([...placed.values()], participants, add, name);
  checkUnavailability(inventory, [...placed.values()], participants, timeline, add, name);
  checkDailyCap(inventory, [...placed.values()], participants, graph, timeline, add);

  // Frozen assignments.
  for (const f of options.frozen ?? []) {
    const p = placed.get(f.matchId);
    const a = p?.assignment;
    if (!a || a.courtId !== f.courtId || a.day !== f.day || a.start !== f.start) {
      add({ code: "FROZEN_MATCH_CHANGED", certainty: "definite", matchIds: [f.matchId], message: `Locked match ${f.matchId} was moved or removed` });
    }
  }

  return { valid: violations.length === 0, violations };
}

function checkPlayerConflicts(
  list: Placed[],
  participants: ParticipantModel,
  add: (v: Violation) => void,
  name: (m: Match) => string,
) {
  const sorted = [...list].sort((a, b) => a.interval.start - b.interval.start);
  const maxRest = Math.max(0, ...sorted.map((p) => p.rest));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.interval.start >= a.interval.end + maxRest) break;
      const required = Math.max(a.rest, b.rest);
      const gap = b.interval.start - a.interval.end;
      if (gap >= required && !overlaps(a.interval, b.interval)) continue;
      const shared = participants.sharedPlayers(a.match.id, b.match.id);
      if (shared.playerIds.length === 0) continue;
      const overlap = overlaps(a.interval, b.interval);
      const qualifier = shared.certainty === "possible" ? " (possible, depending on results)" : "";
      add({
        code: overlap ? "PLAYER_OVERLAP" : "PLAYER_REST",
        certainty: shared.certainty,
        matchIds: [a.match.id, b.match.id],
        playerIds: shared.playerIds,
        message: overlap
          ? `${name(a.match)} and ${name(b.match)} overlap for ${shared.playerIds.join(", ")}${qualifier}`
          : `Only ${gap} min between ${name(a.match)} and ${name(b.match)} for ${shared.playerIds.join(", ")}; ${required} min rest required${qualifier}`,
      });
    }
  }
}

function checkUnavailability(
  inventory: Inventory,
  list: Placed[],
  participants: ParticipantModel,
  timeline: Timeline,
  add: (v: Violation) => void,
  name: (m: Match) => string,
) {
  for (const r of inventory.config.restrictions ?? []) {
    const window = timeline.window(r.window);
    for (const p of list) {
      if (!overlaps(p.interval, window)) continue;
      let affected: Id[] = [];
      let definite = false;
      if (r.subject.type === "team") {
        if (!participants.possibleTeams(p.match.id).has(r.subject.id)) continue;
        affected = [...inventory.teamById.get(r.subject.id)!.playerIds];
        definite = [participants.knownTeam(p.match.id, 0), participants.knownTeam(p.match.id, 1)].includes(r.subject.id);
      } else {
        if (!participants.possiblePlayers(p.match.id).has(r.subject.id)) continue;
        affected = [r.subject.id];
        const known = [participants.knownTeam(p.match.id, 0), participants.knownTeam(p.match.id, 1)];
        definite = known.some((t) => t !== null && inventory.teamById.get(t)!.playerIds.includes(r.subject.id));
      }
      add({
        code: "PARTICIPANT_UNAVAILABLE",
        certainty: definite ? "definite" : "possible",
        matchIds: [p.match.id],
        playerIds: affected,
        message: `${name(p.match)} overlaps restriction ${r.id} (${r.subject.type} ${r.subject.id} unavailable)`,
      });
    }
  }
}

/**
 * For each player and day, the most matches they could be required to play:
 * fixed matches plus the longest possible bracket path on that day.
 */
function checkDailyCap(
  inventory: Inventory,
  list: Placed[],
  participants: ParticipantModel,
  graph: DependencyGraph,
  timeline: Timeline,
  add: (v: Violation) => void,
) {
  const cap = inventory.config.rules.maxMatchesPerPlayerPerDay;
  if (cap === undefined) return;
  const dayOf = new Map(list.map((p) => [p.match.id, timeline.dayOf(p.interval.start)]));

  for (const day of inventory.config.days) {
    const perPlayer = new Map<Id, { count: number; definite: number; matchIds: MatchId[] }>();
    for (const team of inventory.teamById.values()) {
      const { count, definite, matchIds } = maxTeamMatchesOnDay(team.id, day, dayOf, participants, graph, inventory);
      for (const playerId of team.playerIds) {
        const entry = perPlayer.get(playerId) ?? { count: 0, definite: 0, matchIds: [] };
        entry.count += count;
        entry.definite += definite;
        entry.matchIds.push(...matchIds);
        perPlayer.set(playerId, entry);
      }
    }
    for (const [playerId, entry] of perPlayer) {
      if (entry.count <= cap) continue;
      add({
        code: "PLAYER_DAILY_CAP",
        certainty: entry.definite > cap ? "definite" : "possible",
        matchIds: entry.matchIds,
        playerIds: [playerId],
        message: `${playerId} could have to play ${entry.count} matches on ${day} (cap ${cap})`,
      });
    }
  }
}

function maxTeamMatchesOnDay(
  teamId: Id,
  day: string,
  dayOf: ReadonlyMap<MatchId, string>,
  participants: ParticipantModel,
  graph: DependencyGraph,
  inventory: Inventory,
): { count: number; definite: number; matchIds: MatchId[] } {
  const groupMatches: MatchId[] = [];
  // best[m] = the path through the bracket ending at m with the most matches on `day`.
  const best = new Map<MatchId, MatchId[]>();
  let definite = 0;
  for (const id of graph.order) {
    if (!participants.possibleTeams(id).has(teamId)) continue;
    const onDay = dayOf.get(id) === day;
    if (onDay && (participants.knownTeam(id, 0) === teamId || participants.knownTeam(id, 1) === teamId)) definite++;
    const match = inventory.matchById.get(id)!;
    if (match.phase === "group") {
      if (onDay) groupMatches.push(id);
      continue;
    }
    let prev: MatchId[] = [];
    for (const slot of match.slots) {
      if (slot.type !== "winner" && slot.type !== "loser") continue;
      const path = best.get(slot.matchId);
      if (path && path.length > prev.length) prev = path;
    }
    best.set(id, onDay ? [...prev, id] : prev);
  }
  let longest: MatchId[] = [];
  for (const path of best.values()) if (path.length > longest.length) longest = path;
  return { count: groupMatches.length + longest.length, definite, matchIds: [...groupMatches, ...longest] };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}
