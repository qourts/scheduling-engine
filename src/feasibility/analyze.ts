import type { Division, Id, TournamentConfig } from "../config/types.js";
import { buildDependencyGraph, type DependencyGraph } from "../inventory/graph.js";
import { ParticipantModel } from "../inventory/participants.js";
import type { Inventory, Match, MatchId } from "../inventory/types.js";
import { Timeline } from "../schedule/timeline.js";
import { formatClock, intersectIntervals, MINUTES_PER_DAY, mergeIntervals, subtractIntervals, type Interval } from "../util/time.js";

/**
 * Feasibility analysis: necessary conditions only.
 *
 * Each check is a relaxation of the real problem, so a failed check proves the
 * requirements cannot be met, while passing every check proves nothing more
 * than "no blocking issue was found". Only an independently validated schedule
 * demonstrates feasibility. Remedies are quantified suggestions; the engine
 * never applies them.
 */

export type FeasibilityCheckKind = "window_fit" | "division_capacity" | "shared_capacity" | "dependency_chain" | "player_load";

export type RemedyKind = "shorten_match_duration" | "add_courts" | "extend_last_day" | "reduce_rest" | "reduce_turnover";

export interface Remedy {
  kind: RemedyKind;
  /** The new value (minutes, or number of extra courts) that resolves this check on its own. */
  value: number;
  divisionId?: Id;
  message: string;
}

export interface FeasibilityCheck {
  id: string;
  kind: FeasibilityCheckKind;
  passed: boolean;
  divisionId?: Id;
  playerId?: Id;
  /** Null when the requirement cannot be met at all (e.g. the chain never fits). */
  required: number | null;
  available: number;
  unit: "matches" | "match-minutes" | "minute-of-tournament";
  message: string;
  /** Each remedy resolves this check in isolation; other checks may still fail. */
  remedies: Remedy[];
}

export interface DivisionEstimate {
  divisionId: Id;
  matchCount: number;
  /** Lower bound on when the division's last match can end, ignoring court contention. Null if it cannot fit at all. */
  earliestFinish: { day: string; minute: number } | null;
}

export interface FeasibilityReport {
  /** "infeasible" is proven; "no_blocking_issue_found" is not a feasibility guarantee. */
  status: "infeasible" | "no_blocking_issue_found";
  checks: FeasibilityCheck[];
  divisions: DivisionEstimate[];
  totals: { matches: number; matchMinutes: number; courtMinutes: number };
}

interface DivisionContext {
  division: Division;
  matches: Match[];
  rest: number;
  /** Eligible court ids, aligned with courtIntervals. */
  courtIds: Id[];
  /** Usable intervals per eligible court (court availability ∩ division windows). */
  courtIntervals: Interval[][];
}

const MAX_EXTRA_COURTS = 64;

export function analyzeFeasibility(inventory: Inventory): FeasibilityReport {
  const { config } = inventory;
  const timeline = new Timeline(config);
  const graph = buildDependencyGraph(inventory);
  const participants = new ParticipantModel(inventory, graph);
  const turnover = config.rules.courtTurnoverMinutes;
  const checks: FeasibilityCheck[] = [];
  const estimates: DivisionEstimate[] = [];
  const contexts = config.divisions.map((d) => divisionContext(inventory, d, timeline));
  const fmt = (t: number) => formatAbsolute(config, t);

  for (const ctx of contexts) {
    const { division, matches, rest, courtIntervals } = ctx;
    // Relaxations use the shortest match of the division so that a longer medal match can never make a proof unsound.
    const d = Math.min(division.matchDurationMinutes, division.medalMatchDurationMinutes ?? division.matchDurationMinutes);
    const longest = Math.max(0, ...courtIntervals.flat().map((i) => i.end - i.start));

    // 1. Every match must fit inside a single usable window.
    const fits = longest >= d;
    checks.push({
      id: `window_fit:${division.id}`,
      kind: "window_fit",
      passed: fits,
      divisionId: division.id,
      required: d,
      available: longest,
      unit: "match-minutes",
      message: fits
        ? `${division.name}: the longest usable window (${longest} min) fits a ${d}-minute match`
        : longest === 0
          ? `${division.name}: no eligible court is available during the division's play windows`
          : `${division.name}: no usable window is long enough for a ${d}-minute match (longest is ${longest} min)`,
      remedies: !fits && longest > 0 ? [{ kind: "shorten_match_duration", divisionId: division.id, value: longest, message: `Allocate at most ${longest} min per match` }] : [],
    });

    // 2. Enough court slots for this division on its eligible courts.
    const capacity = slotCapacity(courtIntervals, d, turnover);
    const capOk = capacity >= matches.length;
    const remedies: Remedy[] = [];
    if (!capOk) {
      const shorter = largestPassing(d - 1, (x) => slotCapacity(courtIntervals, x, turnover) >= matches.length);
      if (shorter !== null) remedies.push({ kind: "shorten_match_duration", divisionId: division.id, value: shorter, message: `Allocate ${shorter} min per match instead of ${d}` });
      const best = [...courtIntervals].sort((a, b) => slotCapacity([b], d, turnover) - slotCapacity([a], d, turnover))[0] ?? [];
      const extra = smallestPassing(1, MAX_EXTRA_COURTS, (k) => slotCapacity([...courtIntervals, ...Array(k).fill(best)], d, turnover) >= matches.length);
      if (extra !== null) remedies.push({ kind: "add_courts", divisionId: division.id, value: extra, message: `Add ${extra} eligible court(s) with the same hours as the longest-open eligible court` });
      const ext = smallestPassing(5, MINUTES_PER_DAY, (x) => slotCapacity(courtIntervals.map((c) => extendLastDay(c, x, config)), d, turnover) >= matches.length, 5);
      if (ext !== null) remedies.push({ kind: "extend_last_day", divisionId: division.id, value: ext, message: `Extend the last day by ${ext} min on the division's courts` });
      if (turnover > 0) {
        const t = largestPassing(turnover - 1, (x) => slotCapacity(courtIntervals, d, x) >= matches.length, 0);
        if (t !== null) remedies.push({ kind: "reduce_turnover", value: t, message: `Reduce court turnover to ${t} min` });
      }
    }
    checks.push({
      id: `division_capacity:${division.id}`,
      kind: "division_capacity",
      passed: capOk,
      divisionId: division.id,
      required: matches.length,
      available: capacity,
      unit: "matches",
      message: capOk
        ? `${division.name}: ${matches.length} matches, room for at most ${capacity} on its eligible courts`
        : `${division.name}: needs ${matches.length} match slots but its eligible courts offer at most ${capacity}`,
      remedies,
    });

    // 3. Dependency chain: rounds must be played in sequence with rest.
    const finish = chainFinish(ctx, graph, participants, d, rest);
    const lastEnd = Math.max(0, ...courtIntervals.flat().map((i) => i.end));
    const chainOk = finish !== null;
    const chainRemedies: Remedy[] = [];
    if (!chainOk) {
      const shorter = largestPassing(d - 1, (x) => chainFinish(ctx, graph, participants, x, rest) !== null);
      if (shorter !== null) chainRemedies.push({ kind: "shorten_match_duration", divisionId: division.id, value: shorter, message: `Allocate ${shorter} min per match instead of ${d}` });
      if (rest > 0) {
        const r = largestPassing(rest - 1, (x) => chainFinish(ctx, graph, participants, d, x) !== null, 0);
        if (r !== null) chainRemedies.push({ kind: "reduce_rest", divisionId: division.id, value: r, message: `Reduce minimum rest to ${r} min` });
      }
      const ext = smallestPassing(5, MINUTES_PER_DAY, (x) => chainFinish({ ...ctx, courtIntervals: courtIntervals.map((c) => extendLastDay(c, x, config)) }, graph, participants, d, rest) !== null, 5);
      if (ext !== null) chainRemedies.push({ kind: "extend_last_day", divisionId: division.id, value: ext, message: `Extend the last day by ${ext} min` });
    }
    checks.push({
      id: `dependency_chain:${division.id}`,
      kind: "dependency_chain",
      passed: chainOk,
      divisionId: division.id,
      required: finish,
      available: lastEnd,
      unit: "minute-of-tournament",
      message: chainOk
        ? `${division.name}: even with unlimited courts the last match cannot end before ${fmt(finish)}`
        : `${division.name}: the rounds cannot be played in sequence with ${rest} min rest inside the available windows; adding courts does not help`,
      remedies: chainRemedies,
    });
    estimates.push({
      divisionId: division.id,
      matchCount: matches.length,
      earliestFinish: finish === null ? null : splitAbsolute(config, finish),
    });
  }

  checks.push(...sharedCapacityChecks(contexts, turnover, config));
  checks.push(...playerLoadChecks(inventory, contexts, graph, participants, timeline));

  const matchMinutes = inventory.matches.reduce((s, m) => s + m.durationMinutes, 0);
  const courtMinutes = config.courts.reduce((s, c) => s + c.availability.reduce((x, w) => x + (w.end - w.start), 0), 0);
  return {
    status: checks.every((c) => c.passed) ? "no_blocking_issue_found" : "infeasible",
    checks,
    divisions: estimates,
    totals: { matches: inventory.matches.length, matchMinutes, courtMinutes },
  };
}

function divisionContext(inventory: Inventory, division: Division, timeline: Timeline): DivisionContext {
  const { config } = inventory;
  const allowed = division.playWindows ? division.playWindows.map((w) => timeline.window(w)) : [timeline.wholeTournament()];
  const courts = config.courts.filter((c) => !division.eligibleCourtIds || division.eligibleCourtIds.includes(c.id));
  return {
    division,
    matches: inventory.matches.filter((m) => m.divisionId === division.id),
    rest: division.minRestMinutes ?? config.rules.minRestMinutes,
    courtIds: courts.map((c) => c.id),
    courtIntervals: courts.map((c) => intersectIntervals(c.availability.map((w) => timeline.window(w)), allowed)),
  };
}

/** Upper bound on matches of duration d that fit, given turnover t between matches on a court. */
export function slotCapacity(courtIntervals: readonly Interval[][], d: number, t: number): number {
  let total = 0;
  for (const intervals of courtIntervals) {
    for (const i of mergeIntervals(intervals)) total += Math.max(0, Math.floor((i.end - i.start + t) / (d + t)));
  }
  return total;
}

/** Earliest start >= t such that [start, start + d) lies inside one interval. */
export function earliestFit(intervals: readonly Interval[], t: number, d: number): number | null {
  let best: number | null = null;
  for (const i of intervals) {
    const start = Math.max(t, i.start);
    if (start + d <= i.end && (best === null || start < best)) best = start;
  }
  return best;
}

/**
 * Lower bound on the division's finish time with unlimited courts: each team's
 * group matches are played one after another with rest, the group cannot be
 * shorter than its number of rounds, and every knockout match waits for its
 * prerequisites plus rest. Returns null when the chain does not fit.
 */
function chainFinish(ctx: DivisionContext, graph: DependencyGraph, participants: ParticipantModel, d: number, rest: number): number | null {
  const intervals = ctx.courtIntervals.flat();
  const end = new Map<MatchId, number>();

  // Group stage: completion bound per group, applied to every match of the group.
  const groupEnd = new Map<string, number>();
  const groups = new Map<string, Match[]>();
  for (const m of ctx.matches) {
    if (m.phase !== "group") continue;
    const key = `${m.stageId}|${m.groupId}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const [key, list] of groups) {
    const teamCounts = new Map<Id, number>();
    for (const m of list) for (const id of participants.possibleTeams(m.id)) teamCounts.set(id, (teamCounts.get(id) ?? 0) + 1);
    let bound = 0;
    for (const count of teamCounts.values()) {
      const f = sequence(intervals, 0, count, d, rest);
      if (f === null) return null;
      bound = Math.max(bound, f);
    }
    const perRound = Math.floor(teamCounts.size / 2);
    const rounds = Math.ceil(list.length / Math.max(1, perRound));
    const roundsEnd = sequence(intervals, 0, rounds, d, 0);
    if (roundsEnd === null) return null;
    groupEnd.set(key, Math.max(bound, roundsEnd));
  }

  let finish = 0;
  const byId = new Map(ctx.matches.map((m) => [m.id, m]));
  for (const id of graph.order) {
    const m = byId.get(id);
    if (!m) continue;
    let t: number;
    if (m.phase === "group") {
      t = groupEnd.get(`${m.stageId}|${m.groupId}`)!;
      end.set(id, t);
      finish = Math.max(finish, t);
      continue;
    }
    t = 0;
    for (const dep of m.dependencies) {
      const depEnd = end.get(dep.matchId);
      if (depEnd === undefined) continue;
      t = Math.max(t, depEnd + rest);
    }
    const start = earliestFit(intervals, t, d);
    if (start === null) return null;
    end.set(id, start + d);
    finish = Math.max(finish, start + d);
  }
  return finish;
}

/** End of `count` back-to-back matches separated by `gap`, starting no earlier than t. */
function sequence(intervals: readonly Interval[], t: number, count: number, d: number, gap: number): number | null {
  let cursor = t;
  let last = t;
  for (let k = 0; k < count; k++) {
    const start = earliestFit(intervals, cursor, d);
    if (start === null) return null;
    last = start + d;
    cursor = last + gap;
  }
  return last;
}

/**
 * Hall-type condition: divisions restricted to a set of courts must fit, in
 * total, into those courts' usable minutes.
 */
function sharedCapacityChecks(contexts: DivisionContext[], turnover: number, config: TournamentConfig): FeasibilityCheck[] {
  const allCourtIds = config.courts.map((c) => c.id);
  const courtSetOf = (d: Division) => [...(d.eligibleCourtIds ?? allCourtIds)].sort();
  const sets = new Map<string, Id[]>([[allCourtIds.slice().sort().join(","), allCourtIds.slice().sort()]]);
  for (const ctx of contexts) sets.set(courtSetOf(ctx.division).join(","), courtSetOf(ctx.division));

  const checks: FeasibilityCheck[] = [];
  for (const [key, courtIds] of sets) {
    const members = contexts.filter((ctx) => courtSetOf(ctx.division).every((id) => courtIds.includes(id)));
    if (members.length < 2) continue;
    const demand = members.reduce((s, ctx) => s + ctx.matches.reduce((sum, m) => sum + m.durationMinutes + turnover, 0), 0);
    // Supply: every court of the set, during any window in which some member division may play.
    const supply = courtIds.reduce((s, courtId) => {
      const windows = mergeIntervals(
        members.flatMap((ctx) => {
          const position = ctx.courtIds.indexOf(courtId);
          return position === -1 ? [] : ctx.courtIntervals[position]!;
        }),
      );
      return s + windows.reduce((x, i) => x + (i.end - i.start + turnover), 0);
    }, 0);
    const passed = demand <= supply;
    const shortfall = demand - supply;
    const perCourt = Math.max(1, ...courtIds.map((id) => courtMinutes(config, id) + turnover));
    const label = key === allCourtIds.slice().sort().join(",") ? "all courts" : `courts ${courtIds.join(", ")}`;
    checks.push({
      id: `shared_capacity:${key}`,
      kind: "shared_capacity",
      passed,
      required: demand,
      available: supply,
      unit: "match-minutes",
      message: passed
        ? `${members.length} divisions need ${demand} court-minutes (incl. turnover) on ${label}; ${supply} available`
        : `${members.length} divisions need ${demand} court-minutes (incl. turnover) on ${label}, but only ${supply} are available (short by ${demand - supply})`,
      remedies: passed
        ? []
        : [
            {
              kind: "add_courts",
              value: Math.ceil(shortfall / perCourt),
              message: `Add at least ${Math.ceil(shortfall / perCourt)} court(s) with the hours of the longest-open court, or add about ${Math.ceil(shortfall / courtIds.length)} min of play time per court`,
            },
          ],
    });
  }
  return checks;
}

/**
 * A player must be able to play every match they could be required to play
 * (group matches plus the longest bracket path in every division they entered),
 * one after another with rest, inside the windows where they can play.
 */
function playerLoadChecks(
  inventory: Inventory,
  contexts: DivisionContext[],
  graph: DependencyGraph,
  participants: ParticipantModel,
  timeline: Timeline,
): FeasibilityCheck[] {
  const { config } = inventory;
  const ctxByDivision = new Map(contexts.map((c) => [c.division.id, c]));
  const teamsOfPlayer = new Map<Id, Id[]>();
  for (const team of inventory.teamById.values()) {
    for (const p of team.playerIds) teamsOfPlayer.set(p, [...(teamsOfPlayer.get(p) ?? []), team.id]);
  }

  const checks: FeasibilityCheck[] = [];
  for (const [playerId, teamIds] of teamsOfPlayer) {
    let needed = 0;
    let minDuration = Number.POSITIVE_INFINITY;
    let rest = Number.POSITIVE_INFINITY;
    let windows: Interval[] = [];
    for (const teamId of teamIds) {
      const ctx = ctxByDivision.get(inventory.divisionOfTeam.get(teamId)!)!;
      needed += maxMatchesForTeam(teamId, ctx.matches, graph, participants);
      minDuration = Math.min(minDuration, ctx.division.matchDurationMinutes, ctx.division.medalMatchDurationMinutes ?? ctx.division.matchDurationMinutes);
      rest = Math.min(rest, ctx.rest);
      windows = windows.concat(ctx.courtIntervals.flat());
    }
    const blocked = (config.restrictions ?? [])
      .filter((r) => (r.subject.type === "player" && r.subject.id === playerId) || (r.subject.type === "team" && teamIds.includes(r.subject.id)))
      .map((r) => timeline.window(r.window));
    const free = subtractIntervals(mergeIntervals(windows), blocked);
    const cap = config.rules.maxMatchesPerPlayerPerDay;
    const capacityWithRest = (r: number) => {
      const fit = free.reduce((s, i) => s + Math.max(0, Math.floor((i.end - i.start + r) / (minDuration + r))), 0);
      return cap === undefined ? fit : Math.min(fit, cap * config.days.length);
    };
    const capacity = capacityWithRest(rest);
    // Single-entry players without restrictions are covered by the division chain check.
    if (teamIds.length < 2 && blocked.length === 0) continue;
    const passed = needed <= capacity;
    checks.push({
      id: `player_load:${playerId}`,
      kind: "player_load",
      passed,
      playerId,
      required: needed,
      available: capacity,
      unit: "matches",
      message: passed
        ? `${playerId} (${teamIds.length} entries) could have to play ${needed} matches; time allows at most ${capacity}`
        : `${playerId} (${teamIds.length} entries) could have to play ${needed} matches, but their available time with ${rest} min rest fits at most ${capacity}`,
      remedies: passed ? [] : playerRemedies(playerId, rest, needed, capacityWithRest),
    });
  }
  return checks.sort((a, b) => (a.id < b.id ? -1 : 1));
}

function playerRemedies(playerId: Id, rest: number, needed: number, capacityWithRest: (r: number) => number): Remedy[] {
  const r = rest > 0 ? largestPassing(rest - 1, (x) => capacityWithRest(x) >= needed, 0) : null;
  if (r !== null) return [{ kind: "reduce_rest", value: r, message: `Reduce minimum rest to ${r} min for ${playerId}'s divisions` }];
  return [];
}

/** Group matches plus the longest possible knockout path for the team. */
function maxMatchesForTeam(teamId: Id, matches: Match[], graph: DependencyGraph, participants: ParticipantModel): number {
  const own = new Set(matches.map((m) => m.id));
  const longest = new Map<MatchId, number>();
  let groupCount = 0;
  let best = 0;
  for (const id of graph.order) {
    if (!own.has(id) || !participants.possibleTeams(id).has(teamId)) continue;
    const m = participants.inventory.matchById.get(id)!;
    if (m.phase === "group") {
      groupCount++;
      continue;
    }
    let prev = 0;
    for (const slot of m.slots) {
      if (slot.type === "winner" || slot.type === "loser") prev = Math.max(prev, longest.get(slot.matchId) ?? 0);
    }
    longest.set(id, prev + 1);
    best = Math.max(best, prev + 1);
  }
  return groupCount + best;
}

function extendLastDay(intervals: readonly Interval[], minutes: number, config: TournamentConfig): Interval[] {
  const lastDayStart = (config.days.length - 1) * MINUTES_PER_DAY;
  const dayEnd = config.days.length * MINUTES_PER_DAY;
  const list = intervals.map((i) => ({ ...i }));
  const onLastDay = list.filter((i) => i.start >= lastDayStart);
  const last = onLastDay.sort((a, b) => b.end - a.end)[0];
  if (last) last.end = Math.min(dayEnd, last.end + minutes);
  return list;
}

function courtMinutes(config: TournamentConfig, courtId: Id): number {
  return config.courts.find((c) => c.id === courtId)!.availability.reduce((s, w) => s + (w.end - w.start), 0);
}

/** Largest x in [min, start] (searching downward) for which test passes. */
function largestPassing(start: number, test: (x: number) => boolean, min = 1): number | null {
  for (let x = start; x >= min; x--) if (test(x)) return x;
  return null;
}

/** Smallest x in [from, to] (in steps) for which test passes. */
function smallestPassing(from: number, to: number, test: (x: number) => boolean, step = 1): number | null {
  for (let x = from; x <= to; x += step) if (test(x)) return x;
  return null;
}

/** An end time as day + minute; an end exactly at midnight belongs to the day that ends. */
function splitAbsolute(config: TournamentConfig, t: number): { day: string; minute: number } {
  const day = Math.max(0, Math.floor((t - 1) / MINUTES_PER_DAY));
  return { day: config.days[day]!, minute: t - day * MINUTES_PER_DAY };
}

function formatAbsolute(config: TournamentConfig, t: number | null): string {
  if (t === null) return "never";
  const { day, minute } = splitAbsolute(config, t);
  return `${day} ${formatClock(minute)}`;
}
