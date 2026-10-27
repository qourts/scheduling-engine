import type { Id } from "../config/types.js";
import type { Inventory, Match, MatchId, Slot } from "../inventory/types.js";
import { Timeline } from "../schedule/timeline.js";
import type { Schedule } from "../schedule/types.js";

/**
 * Exhaustive check of every reachable playoff outcome for one schedule.
 *
 * `validateSchedule` protects unresolved participants conservatively, through the set of teams that could reach a
 * match. This module re-derives the same protection from first principles, by enumeration, and shares none of that
 * logic: for each division it lists every combination of pool finishing orders the bracket can depend on (any team may
 * win a pool, any team may finish second, any second-placed team may be the best one) and every semifinal outcome, works
 * out who then plays in each knockout match, and checks every pair of matches for a player collision or a recovery gap
 * shorter than the larger minimum rest.
 *
 * What it establishes: no outcome of the playoffs can put one player in two matches too close together, because every
 * outcome has been examined. Divisions are independent (no team is in two divisions' brackets), so pairs of matches in
 * different divisions are checked exactly by the set of players each knockout match can ever contain.
 *
 * What it assumes: every ordering of teams inside a pool is reachable (true for arbitrary results), and wildcard
 * qualifiers are the single `count: 1` kind. Divisions whose structure is outside that, or whose outcome space exceeds
 * `maxOutcomesPerDivision`, are listed in `skipped` and are NOT covered by this check.
 *
 * What it does not cover: tiebreaker matches the plan does not contain, and results that change the format.
 */

export interface OutcomeViolation {
  kind: "within_division" | "across_divisions";
  matchIds: [MatchId, MatchId];
  playerIds: Id[];
  /** Minutes between the end of the earlier match and the start of the later one (negative when they overlap). */
  gapMinutes: number;
  requiredMinutes: number;
}

export interface OutcomeCheckReport {
  /** Divisions that were enumerated completely, with the number of distinct outcomes examined. */
  enumerated: { divisionId: Id; outcomes: number }[];
  /** Divisions that could not be enumerated, with the reason. Nothing is claimed for them. */
  skipped: { divisionId: Id; reason: string }[];
  pairsChecked: number;
  violations: OutcomeViolation[];
}

export interface OutcomeCheckOptions {
  /** Divisions with more reachable outcomes than this are skipped. Default 200000. */
  maxOutcomesPerDivision?: number;
}

interface Placed {
  start: number;
  end: number;
  rest: number;
}

export function verifyAllQualifierOutcomes(inventory: Inventory, schedule: Schedule, options: OutcomeCheckOptions = {}): OutcomeCheckReport {
  const limit = options.maxOutcomesPerDivision ?? 200_000;
  const timeline = new Timeline(inventory.config);
  const placed = new Map<MatchId, Placed>();
  for (const a of schedule.assignments) {
    const match = inventory.matchById.get(a.matchId);
    if (!match || !timeline.hasDay(a.day)) continue;
    const division = inventory.config.divisions.find((d) => d.id === match.divisionId)!;
    const start = timeline.absolute(a.day, a.start);
    placed.set(a.matchId, { start, end: start + match.durationMinutes, rest: division.minRestMinutes ?? inventory.config.rules.minRestMinutes });
  }

  const report: OutcomeCheckReport = { enumerated: [], skipped: [], pairsChecked: 0, violations: [] };
  /** Every player that can appear in each match over all reachable outcomes. */
  const reachable = new Map<MatchId, Set<Id>>();
  const playersOf = (teamId: Id) => inventory.teamById.get(teamId)!.playerIds;

  for (const division of inventory.config.divisions) {
    const own = inventory.matches.filter((m) => m.divisionId === division.id);
    const pools = own.filter((m) => m.phase === "group");
    const knockout = own.filter((m) => m.phase === "knockout");
    for (const m of pools) reachable.set(m.id, new Set(m.slots.flatMap((s) => (s.type === "team" ? playersOf(s.teamId) : []))));
    for (const m of knockout) reachable.set(m.id, new Set());
    const outcomes = enumerate(inventory, division.id, knockout, limit);
    if (typeof outcomes === "string") {
      report.skipped.push({ divisionId: division.id, reason: outcomes });
      continue;
    }
    const ids = own.map((m) => m.id).filter((id) => placed.has(id));
    for (const participants of outcomes) {
      for (const m of knockout) {
        const set = reachable.get(m.id)!;
        for (const team of participants.get(m.id)!) for (const p of playersOf(team)) set.add(p);
      }
      // Pairs inside the division, for this single outcome.
      const actual = new Map<MatchId, Set<Id>>();
      for (const m of pools) actual.set(m.id, reachable.get(m.id)!);
      for (const m of knockout) actual.set(m.id, new Set(participants.get(m.id)!.flatMap(playersOf)));
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const violation = collision(ids[i]!, ids[j]!, actual, placed);
          if (violation) report.violations.push({ kind: "within_division", ...violation });
        }
      }
    }
    report.pairsChecked += (outcomes.length * (ids.length * (ids.length - 1))) / 2;
    report.enumerated.push({ divisionId: division.id, outcomes: outcomes.length });
  }

  // Pairs across divisions: independent brackets, so the union of possible players decides.
  const all = inventory.matches.filter((m) => placed.has(m.id));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (a.divisionId === b.divisionId) continue;
      report.pairsChecked++;
      const violation = collision(a.id, b.id, reachable, placed);
      if (violation) report.violations.push({ kind: "across_divisions", ...violation });
    }
  }

  const seen = new Set<string>();
  report.violations = report.violations.filter((v) => {
    const key = `${v.kind}|${v.matchIds.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return report;
}

function collision(a: MatchId, b: MatchId, players: ReadonlyMap<MatchId, ReadonlySet<Id>>, placed: ReadonlyMap<MatchId, Placed>): Omit<OutcomeViolation, "kind"> | null {
  const pa = players.get(a);
  const pb = players.get(b);
  if (!pa || !pb) return null;
  const shared = [...pa].filter((p) => pb.has(p));
  if (shared.length === 0) return null;
  const x = placed.get(a)!;
  const y = placed.get(b)!;
  const [first, second] = x.start <= y.start ? [x, y] : [y, x];
  const required = Math.max(x.rest, y.rest);
  const gap = second.start - first.end;
  return gap >= required ? null : { matchIds: [a, b], playerIds: shared.sort(), gapMinutes: gap, requiredMinutes: required };
}

/**
 * Every reachable assignment of teams to the knockout matches of a division, or a reason it cannot be enumerated.
 * Each returned map gives, per knockout match, the two teams that play in it.
 */
function enumerate(inventory: Inventory, divisionId: Id, knockout: Match[], limit: number): Map<MatchId, [Id, Id]>[] | string {
  if (knockout.length === 0) return [new Map()];
  const structure = inventory.divisions.find((d) => d.divisionId === divisionId)!;
  const poolStage = structure.stages.find((s) => s.kind === "groups");
  if (!poolStage || poolStage.kind !== "groups") return "the knockout is not fed by a group stage";

  const entry = knockout.flatMap((m) => m.slots).filter((s): s is Extract<Slot, { type: "group_rank" | "wildcard" }> => s.type === "group_rank" || s.type === "wildcard");
  const wildcards = entry.filter((s): s is Extract<Slot, { type: "wildcard" }> => s.type === "wildcard");
  if (wildcards.length > 1) return "more than one wildcard seat is not enumerated";
  const wildcard = wildcards[0];

  const groups = poolStage.groups;
  const depthOf = new Map<Id, number>(groups.map((g) => [g.groupId, 0]));
  for (const s of entry) if (s.type === "group_rank") depthOf.set(s.groupId, Math.max(depthOf.get(s.groupId)!, s.rank));

  // Ordered finishing prefixes of a given depth for one group.
  const prefixes = (teams: readonly Id[], depth: number): Id[][] => {
    if (depth === 0) return [[]];
    return teams.flatMap((t) =>
      prefixes(
        teams.filter((u) => u !== t),
        depth - 1,
      ).map((rest) => [t, ...rest]),
    );
  };

  const choiceSets: { wildcardGroup: Id | null; picks: Map<Id, Id[]>[] }[] = [];
  const sources: (Id | null)[] = wildcard ? groups.map((g) => g.groupId) : [null];
  for (const source of sources) {
    let combos: Map<Id, Id[]>[] = [new Map()];
    for (const g of groups) {
      const depth = source === g.groupId ? Math.max(depthOf.get(g.groupId)!, wildcard!.rank) : depthOf.get(g.groupId)!;
      const options = prefixes(g.teamIds, depth);
      if (combos.length * options.length > limit) return `more than ${limit} reachable pool outcomes`;
      combos = combos.flatMap((c) => options.map((o) => new Map(c).set(g.groupId, o)));
    }
    choiceSets.push({ wildcardGroup: source, picks: combos });
  }

  const results: Map<MatchId, [Id, Id]>[] = [];
  const feeders = knockout.filter((m) => knockout.some((o) => o.slots.some((s) => (s.type === "winner" || s.type === "loser") && s.matchId === m.id)));
  for (const { wildcardGroup, picks } of choiceSets) {
    for (const pick of picks) {
      // Every combination of winners of the knockout matches that feed other matches.
      for (let mask = 0; mask < 1 << feeders.length; mask++) {
        const winnerSide = new Map<MatchId, 0 | 1>(feeders.map((m, i) => [m.id, ((mask >> i) & 1) as 0 | 1]));
        const teams = new Map<MatchId, [Id, Id]>();
        const resolve = (s: Slot): Id => {
          if (s.type === "group_rank") return pick.get(s.groupId)![s.rank - 1]!;
          if (s.type === "wildcard") return pick.get(wildcardGroup!)![s.rank - 1]!;
          if (s.type === "team") return s.teamId;
          const [a, b] = teams.get(s.matchId)!;
          const side = winnerSide.get(s.matchId)!;
          return s.type === "winner" ? (side === 0 ? a : b) : side === 0 ? b : a;
        };
        for (const m of knockout) teams.set(m.id, [resolve(m.slots[0]), resolve(m.slots[1])]);
        results.push(teams);
        if (results.length > limit) return `more than ${limit} reachable outcomes`;
      }
    }
  }
  return results;
}
