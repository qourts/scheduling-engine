import type { Id } from "../config/types.js";
import type { Assignment } from "../schedule/types.js";
import { MINUTES_PER_DAY } from "../util/time.js";
import type { PlanContext } from "./context.js";

interface Entry {
  start: number;
  end: number;
  match: number;
}

export interface Snapshot {
  start: readonly number[];
  court: readonly number[];
}

const UNPLACED = -1;

/**
 * Mutable partial or complete placement of every match, with the hard-rule
 * feasibility test the scheduler and the local search both rely on.
 *
 * `blockedUntil` answers, for one candidate (match, court, start): is every
 * hard rule satisfied against what is already placed? It checks court
 * occupancy and turnover, dependencies in both directions, player conflicts
 * (including possible participants of undecided playoffs), restrictions and
 * the daily cap. Court availability, division windows, eligible courts and
 * mandatory instruction windows are folded into `PlanContext.startRanges`.
 * This is a search aid only: the independent `validateSchedule` still has the
 * final word on every schedule that leaves the optimizer.
 */
export class PlacementState {
  readonly start: number[];
  readonly court: number[];
  private readonly byCourt: Entry[][];

  constructor(readonly ctx: PlanContext) {
    this.start = new Array<number>(ctx.size).fill(UNPLACED);
    this.court = new Array<number>(ctx.size).fill(UNPLACED);
    this.byCourt = ctx.courts.map(() => []);
  }

  static from(ctx: PlanContext, snapshot: Snapshot): PlacementState {
    const state = new PlacementState(ctx);
    snapshot.start.forEach((s, m) => {
      if (s !== UNPLACED) state.place(m, snapshot.court[m]!, s);
    });
    return state;
  }

  snapshot(): Snapshot {
    return { start: [...this.start], court: [...this.court] };
  }

  isPlaced(match: number): boolean {
    return this.start[match] !== UNPLACED;
  }

  end(match: number): number {
    return this.start[match]! + this.ctx.duration[match]!;
  }

  placedCount(): number {
    return this.start.reduce((n, s) => (s === UNPLACED ? n : n + 1), 0);
  }

  place(match: number, court: number, start: number): void {
    const list = this.byCourt[court]!;
    const entry: Entry = { start, end: start + this.ctx.duration[match]!, match };
    list.splice(this.insertionIndex(list, start), 0, entry);
    this.start[match] = start;
    this.court[match] = court;
  }

  unplace(match: number): void {
    const court = this.court[match]!;
    if (court === UNPLACED) return;
    const list = this.byCourt[court]!;
    const at = list.findIndex((e) => e.match === match);
    if (at >= 0) list.splice(at, 1);
    this.start[match] = UNPLACED;
    this.court[match] = UNPLACED;
  }

  /** Placed matches on a court in time order. */
  courtEntries(court: number): readonly Entry[] {
    return this.byCourt[court]!;
  }

  /** Earliest start the placed predecessors allow. */
  lowerBound(match: number): number {
    let bound = this.ctx.firstOpening();
    for (const link of this.ctx.preds[match]!) {
      if (this.isPlaced(link.other)) bound = Math.max(bound, this.end(link.other) + link.rest);
    }
    return bound;
  }

  /**
   * 0 when placing `match` on `court` at `start` satisfies every hard rule
   * against the current placement; otherwise the smallest later start worth
   * trying, or Infinity when no later start can work. `match` itself must be
   * unplaced while asking.
   */
  blockedUntil(match: number, court: number, start: number): number {
    const { ctx } = this;
    const duration = ctx.duration[match]!;
    const end = start + duration;
    let next = 0;

    for (const link of ctx.preds[match]!) {
      if (!this.isPlaced(link.other)) continue;
      const need = this.end(link.other) + link.rest;
      if (start < need) next = Math.max(next, need);
    }
    for (const link of ctx.succs[match]!) {
      if (this.isPlaced(link.other) && end + link.rest > this.start[link.other]!) return Infinity;
    }

    const turnover = ctx.turnover;
    const list = this.byCourt[court]!;
    for (let k = this.firstEndingAfter(list, start - turnover); k < list.length; k++) {
      const entry = list[k]!;
      if (entry.start >= end + turnover) break;
      if (entry.match !== match) next = Math.max(next, entry.end + turnover);
    }

    for (const conflict of ctx.conflicts[match]!) {
      const other = conflict.other;
      if (!this.isPlaced(other)) continue;
      const otherStart = this.start[other]!;
      const otherEnd = otherStart + ctx.duration[other]!;
      if (start < otherEnd + conflict.required && otherStart < end + conflict.required) {
        next = Math.max(next, otherEnd + conflict.required);
      }
    }

    for (const window of ctx.blocked[match]!) {
      if (start < window.end && window.start < end) next = Math.max(next, window.end);
    }

    if (next === 0 && ctx.dailyCap !== undefined) {
      const day = Math.floor(start / MINUTES_PER_DAY);
      if (this.exceedsDailyCap(match, day)) next = (day + 1) * MINUTES_PER_DAY;
    }
    return next;
  }

  /** First feasible start at or after `from` on `court`, or null if none exists. */
  nextFeasible(match: number, court: number, from: number): number | null {
    const ranges = this.ctx.startRanges(match, court);
    let s = Math.max(0, from);
    let r = 0;
    for (let guard = 0; guard < 50_000; guard++) {
      while (r < ranges.length && s >= ranges[r]!.end) r++;
      if (r >= ranges.length) return null;
      if (s < ranges[r]!.start) s = ranges[r]!.start;
      const next = this.blockedUntil(match, court, s);
      if (next === 0) return s;
      if (next === Infinity) return null;
      s = this.ctx.alignUp(next);
    }
    return null;
  }

  isFeasible(match: number, court: number, start: number): boolean {
    const ranges = this.ctx.startRanges(match, court);
    if (!ranges.some((r) => start >= r.start && start < r.end)) return false;
    return this.blockedUntil(match, court, start) === 0;
  }

  toAssignments(): Assignment[] {
    const out: Assignment[] = [];
    this.ctx.matches.forEach((m, i) => {
      if (!this.isPlaced(i)) return;
      const day = this.ctx.timeline.dayOf(this.start[i]!);
      const dayIndex = this.ctx.timeline.config.days.indexOf(day);
      out.push({ matchId: m.id, courtId: this.ctx.courts[this.court[i]!]!.id, day, start: this.start[i]! - dayIndex * MINUTES_PER_DAY });
    });
    return out;
  }

  private insertionIndex(list: readonly Entry[], start: number): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.start < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Index of the first entry whose end is after `minute` (entries on one court never overlap). */
  private firstEndingAfter(list: readonly Entry[], minute: number): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.end <= minute) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Mirrors the validator's rule: a player's maximum possible matches on a day
   * is their group matches plus the longest possible bracket path that day,
   * summed over every team they belong to. Evaluated with the candidate on `day`.
   */
  private exceedsDailyCap(candidate: number, day: number): boolean {
    const { ctx } = this;
    const cap = ctx.dailyCap!;
    const teamCount = new Map<Id, number>();
    const countFor = (teamId: Id): number => {
      const cached = teamCount.get(teamId);
      if (cached !== undefined) return cached;
      let groupMatches = 0;
      const bestPath = new Map<number, number>();
      let longest = 0;
      for (const i of ctx.teamMatches.get(teamId) ?? []) {
        const onDay = i === candidate || (this.isPlaced(i) && Math.floor(this.start[i]! / MINUTES_PER_DAY) === day);
        const match = ctx.matches[i]!;
        if (match.phase === "group") {
          if (onDay) groupMatches++;
          continue;
        }
        let previous = 0;
        for (const slot of match.slots) {
          if (slot.type !== "winner" && slot.type !== "loser") continue;
          previous = Math.max(previous, bestPath.get(ctx.index.get(slot.matchId)!) ?? 0);
        }
        const length = previous + (onDay ? 1 : 0);
        bestPath.set(i, length);
        longest = Math.max(longest, length);
      }
      const total = groupMatches + longest;
      teamCount.set(teamId, total);
      return total;
    };
    for (const player of ctx.possiblePlayersOf[candidate]!) {
      let total = 0;
      for (const teamId of ctx.teamsOfPlayer.get(player) ?? []) total += countFor(teamId);
      if (total > cap) return true;
    }
    return false;
  }
}
