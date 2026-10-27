import type { Id } from "../config/types.js";
import type { CompiledConstraints } from "../instructions/compile.js";
import { buildDependencyGraph, type DependencyGraph } from "../inventory/graph.js";
import { ParticipantModel } from "../inventory/participants.js";
import type { Inventory, Match, MatchId } from "../inventory/types.js";
import { Timeline } from "../schedule/timeline.js";
import { intersectIntervals, MINUTES_PER_DAY, mergeIntervals, type Interval } from "../util/time.js";

/** Two matches that might need the same player: they must keep `required` minutes apart. */
export interface Conflict {
  other: number;
  required: number;
  /** Both participants are known, so the shared player certainly plays both. */
  definite: boolean;
}

/** A dependency edge: this match starts at least `rest` after the other ends. */
export interface Link {
  other: number;
  rest: number;
  /** The same participant plays both matches (winner/loser feeders), so the gap is real recovery. */
  sameParticipant: boolean;
}

export interface CourtInfo {
  id: Id;
  /** Availability windows as absolute intervals, sorted. */
  windows: Interval[];
}

export interface ContextOptions {
  /** Start times are multiples of this many minutes (must divide 1440). Default 5. */
  granularityMinutes?: number;
  /** A gap below this is a back-to-back. Default: the largest minimum rest plus 10 minutes. */
  backToBackMinutes?: number;
  /** A gap below this is a short recovery. Default: twice the back-to-back threshold. */
  comfortRestMinutes?: number;
}

/**
 * Everything the optimizer precomputes once per tournament: indices, rest and
 * dependency links, player-conflict lists, blocked intervals, court windows
 * and critical-path priorities. Immutable after construction.
 */
export class PlanContext {
  readonly inventory: Inventory;
  readonly matches: readonly Match[];
  readonly index: ReadonlyMap<MatchId, number>;
  readonly graph: DependencyGraph;
  readonly timeline: Timeline;
  readonly granularity: number;
  readonly turnover: number;
  readonly courts: readonly CourtInfo[];
  readonly courtIndex: ReadonlyMap<Id, number>;
  readonly duration: readonly number[];
  readonly rest: readonly number[];
  readonly divisionOf: readonly string[];
  readonly preds: readonly (readonly Link[])[];
  readonly succs: readonly (readonly Link[])[];
  readonly conflicts: readonly (readonly Conflict[])[];
  readonly blocked: readonly (readonly Interval[])[];
  readonly allowedCourts: readonly (readonly number[])[];
  /** Critical-path length from the start of each match to the end of the tournament, in minutes. */
  readonly tail: readonly number[];
  readonly locked: ReadonlyMap<number, { court: number; start: number }>;
  readonly dailyCap: number | undefined;
  /** Absolute minute at which the last court closes. */
  readonly horizonEnd: number;
  /** Shortest match duration; a gap shorter than this on a court cannot be reused. */
  readonly minDuration: number;
  readonly backToBack: number;
  readonly comfortRest: number;
  /** Players with at least one definite match, and those matches. */
  readonly playerMatches: ReadonlyMap<Id, readonly number[]>;
  /** For the daily cap: matches in which a team could play, in dependency order. */
  readonly teamMatches: ReadonlyMap<Id, readonly number[]>;
  readonly teamsOfPlayer: ReadonlyMap<Id, readonly Id[]>;
  readonly possibleTeamsOf: readonly (readonly Id[])[];
  readonly possiblePlayersOf: readonly (readonly Id[])[];

  private readonly rangeCache = new Map<number, readonly Interval[]>();
  private readonly divisionById: ReadonlyMap<Id, Inventory["config"]["divisions"][number]>;

  constructor(readonly constraints: CompiledConstraints, options: ContextOptions = {}) {
    const inventory = constraints.inventory;
    const { config } = inventory;
    this.inventory = inventory;
    this.matches = inventory.matches;
    this.index = new Map(inventory.matches.map((m, i) => [m.id, i]));
    this.graph = buildDependencyGraph(inventory);
    this.timeline = new Timeline(config);
    this.granularity = options.granularityMinutes ?? 5;
    if (!Number.isInteger(this.granularity) || this.granularity < 1 || MINUTES_PER_DAY % this.granularity !== 0) {
      throw new Error(`granularityMinutes must be a positive divisor of 1440, got ${this.granularity}`);
    }
    this.turnover = config.rules.courtTurnoverMinutes;
    this.dailyCap = config.rules.maxMatchesPerPlayerPerDay;

    this.divisionById = new Map(config.divisions.map((d) => [d.id, d]));
    const n = inventory.matches.length;
    this.duration = inventory.matches.map((m) => m.durationMinutes);
    this.minDuration = n === 0 ? 0 : Math.min(...this.duration);
    this.divisionOf = inventory.matches.map((m) => m.divisionId);
    this.rest = inventory.matches.map((m) => this.divisionById.get(m.divisionId)!.minRestMinutes ?? config.rules.minRestMinutes);
    const maxRest = Math.max(config.rules.minRestMinutes, ...config.divisions.map((d) => d.minRestMinutes ?? 0));
    this.backToBack = options.backToBackMinutes ?? maxRest + 10;
    this.comfortRest = options.comfortRestMinutes ?? 2 * this.backToBack;

    this.courts = config.courts.map((c) => ({
      id: c.id,
      windows: mergeIntervals(c.availability.map((w) => this.timeline.window(w))),
    }));
    this.courtIndex = new Map(this.courts.map((c, i) => [c.id, i]));
    this.horizonEnd = Math.max(0, ...this.courts.flatMap((c) => c.windows.map((w) => w.end)));

    const preds: Link[][] = Array.from({ length: n }, () => []);
    const succs: Link[][] = Array.from({ length: n }, () => []);
    inventory.matches.forEach((m, i) => {
      for (const dep of m.dependencies) {
        const p = this.index.get(dep.matchId)!;
        const same = dep.kind === "winner" || dep.kind === "loser";
        preds[i]!.push({ other: p, rest: this.rest[i]!, sameParticipant: same });
        succs[p]!.push({ other: i, rest: this.rest[i]!, sameParticipant: same });
      }
    });
    this.preds = preds;
    this.succs = succs;

    const tail = new Array<number>(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      const i = this.index.get(this.graph.order[r]!)!;
      let longest = 0;
      for (const s of succs[i]!) longest = Math.max(longest, s.rest + tail[s.other]!);
      tail[i] = this.duration[i]! + longest;
    }
    this.tail = tail;

    const participants = new ParticipantModel(inventory, this.graph);
    this.possibleTeamsOf = inventory.matches.map((m) => [...participants.possibleTeams(m.id)].sort());
    this.possiblePlayersOf = inventory.matches.map((m) => [...participants.possiblePlayers(m.id)].sort());
    this.conflicts = this.buildConflicts(participants);
    this.blocked = this.buildBlocked(participants);

    const allCourts = this.courts.map((_, i) => i);
    this.allowedCourts = inventory.matches.map((m) => {
      const limit = constraints.limits.get(m.id)?.allowedCourts ?? null;
      return limit === null ? allCourts : allCourts.filter((c) => limit.has(this.courts[c]!.id));
    });

    const locked = new Map<number, { court: number; start: number }>();
    for (const a of constraints.locked) {
      locked.set(this.index.get(a.matchId)!, { court: this.courtIndex.get(a.courtId)!, start: this.timeline.absolute(a.day, a.start) });
    }
    this.locked = locked;

    const playerMatches = new Map<Id, number[]>();
    inventory.matches.forEach((m, i) => {
      for (const side of [0, 1] as const) {
        const slot = m.slots[side];
        if (slot.type !== "team") continue;
        for (const p of inventory.teamById.get(slot.teamId)!.playerIds) {
          const list = playerMatches.get(p) ?? [];
          list.push(i);
          playerMatches.set(p, list);
        }
      }
    });
    this.playerMatches = playerMatches;

    const teamMatches = new Map<Id, number[]>();
    for (const id of this.graph.order) {
      const i = this.index.get(id)!;
      for (const t of this.possibleTeamsOf[i]!) {
        const list = teamMatches.get(t) ?? [];
        list.push(i);
        teamMatches.set(t, list);
      }
    }
    this.teamMatches = teamMatches;
    const teamsOfPlayer = new Map<Id, Id[]>();
    for (const team of inventory.teamById.values()) {
      for (const p of team.playerIds) teamsOfPlayer.set(p, [...(teamsOfPlayer.get(p) ?? []), team.id]);
    }
    this.teamsOfPlayer = teamsOfPlayer;
  }

  get size(): number {
    return this.matches.length;
  }

  /** Absolute start ranges (half-open) in which `match` may start on `court`. */
  startRanges(match: number, court: number): readonly Interval[] {
    const key = match * this.courts.length + court;
    const cached = this.rangeCache.get(key);
    if (cached) return cached;
    const duration = this.duration[match]!;
    const toStarts = (windows: readonly Interval[]) =>
      windows.map((w) => ({ start: w.start, end: w.end - duration + 1 })).filter((r) => r.end > r.start);
    let ranges = mergeIntervals(toStarts(this.courts[court]!.windows));
    const division = this.divisionById.get(this.divisionOf[match]!)!;
    if (division.playWindows) ranges = intersectIntervals(ranges, toStarts(division.playWindows.map((w) => this.timeline.window(w))));
    const extra = this.constraints.limits.get(this.matches[match]!.id)?.startRanges;
    if (extra) ranges = intersectIntervals(ranges, extra);
    this.rangeCache.set(key, ranges);
    return ranges;
  }

  /** Lowest absolute minute at which any court opens. */
  firstOpening(): number {
    let first = Infinity;
    for (const c of this.courts) for (const w of c.windows) first = Math.min(first, w.start);
    return Number.isFinite(first) ? first : 0;
  }

  alignUp(minute: number): number {
    const g = this.granularity;
    return Math.ceil(minute / g) * g;
  }

  /** Optimistic lower bound on the absolute end of the tournament; not a tight bound. */
  finishLowerBound(): number {
    const opening = this.firstOpening();
    const longestChain = Math.max(0, ...this.tail);
    const totalWork = this.duration.reduce((a, b) => a + b, 0);
    const courtCount = Math.max(1, this.courts.length);
    return opening + Math.max(longestChain, Math.ceil(totalWork / courtCount));
  }

  private buildConflicts(participants: ParticipantModel): Conflict[][] {
    const n = this.size;
    const byPlayer = new Map<Id, number[]>();
    this.possiblePlayersOf.forEach((players, i) => {
      for (const p of players) byPlayer.set(p, [...(byPlayer.get(p) ?? []), i]);
    });
    const seen = new Set<number>();
    const out: Conflict[][] = Array.from({ length: n }, () => []);
    for (const list of byPlayer.values()) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const a = list[x]!;
          const b = list[y]!;
          const key = a * n + b;
          if (seen.has(key)) continue;
          seen.add(key);
          const shared = participants.sharedPlayers(this.matches[a]!.id, this.matches[b]!.id);
          if (shared.playerIds.length === 0) continue;
          const required = Math.max(this.rest[a]!, this.rest[b]!);
          const definite = shared.certainty === "definite";
          out[a]!.push({ other: b, required, definite });
          out[b]!.push({ other: a, required, definite });
        }
      }
    }
    return out;
  }

  private buildBlocked(participants: ParticipantModel): Interval[][] {
    const out: Interval[][] = Array.from({ length: this.size }, () => []);
    for (const r of this.inventory.config.restrictions ?? []) {
      const window = this.timeline.window(r.window);
      this.matches.forEach((m, i) => {
        const hit = r.subject.type === "team" ? participants.possibleTeams(m.id).has(r.subject.id) : participants.possiblePlayers(m.id).has(r.subject.id);
        if (hit) out[i]!.push(window);
      });
    }
    return out.map((list) => mergeIntervals(list));
  }
}
