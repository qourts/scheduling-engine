import { PREFERENCE_SCALE, type Weights } from "./metrics.js";
import type { PlanContext } from "./context.js";
import type { Random } from "./random.js";
import { PlacementState } from "./state.js";

/**
 * Order in which ready matches are placed:
 * - "time": earliest feasible start first (a time sweep).
 * - "critical": largest earliest-start plus remaining critical path first
 *   (minimum slack), so long chains are not squeezed out late in the day.
 * - "tail": longest remaining critical path first, regardless of time.
 */
export type ConstructOrder = "time" | "critical" | "tail";

export interface ConstructOptions {
  /** Placement order; default "time". */
  order?: ConstructOrder;
  weights: Weights;
  candidatesPerCourt: number;
  /**
   * A later candidate is only considered while it starts at most this many
   * minutes after the earliest feasible start on that court and the match's
   * remaining critical path still fits before the last court closes. Keeps
   * recovery-friendly delays from consuming the horizon. Default 90.
   */
  maxDelayMinutes?: number;
  /** Relative random perturbation of candidate costs (0 = deterministic greedy). */
  noise?: number;
  random?: Random;
}

export interface ConstructResult {
  state: PlacementState;
  /** Matches that could not be placed, with the reason. */
  unplaced: Map<number, string>;
}

/**
 * Constructive, dependency-aware list scheduling.
 *
 * Matches become ready when every prerequisite is placed; the ready match with
 * the longest remaining critical path goes first. Each is placed in the
 * feasible slot (court and start) with the lowest weighted cost under the
 * strategy's weights. Locked placements are fixed first. A match that fits
 * nowhere is reported, and so are the matches that depend on it.
 */
export function construct(ctx: PlanContext, options: ConstructOptions): ConstructResult {
  const state = new PlacementState(ctx);
  const unplaced = new Map<number, string>();
  const n = ctx.size;

  for (const [match, slot] of ctx.locked) state.place(match, slot.court, slot.start);
  for (const [match, slot] of ctx.locked) {
    state.unplace(match);
    if (!state.isFeasible(match, slot.court, slot.start)) {
      unplaced.set(match, "locked placement breaks a hard rule given the other locked placements");
    }
    state.place(match, slot.court, slot.start);
  }

  const pendingPreds = new Array<number>(n).fill(0);
  const remaining = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (ctx.locked.has(i)) continue;
    remaining.add(i);
    pendingPreds[i] = ctx.preds[i]!.filter((l) => !state.isPlaced(l.other)).length;
  }
  const ready = new Set<number>([...remaining].filter((i) => pendingPreds[i] === 0));

  const failDescendants = (root: number) => {
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const link of ctx.succs[current]!) {
        if (!remaining.has(link.other) || unplaced.has(link.other)) continue;
        unplaced.set(link.other, `depends on ${ctx.matches[root]!.id}, which could not be placed`);
        remaining.delete(link.other);
        ready.delete(link.other);
        stack.push(link.other);
      }
    }
  };

  const order = options.order ?? "time";
  const key = new Map<number, number>();
  const earliest = (match: number): number | null => {
    const lower = ctx.alignUp(state.lowerBound(match));
    let best: number | null = null;
    for (const court of ctx.allowedCourts[match]!) {
      const s = state.nextFeasible(match, court, lower);
      if (s !== null && (best === null || s < best)) best = s;
    }
    return best;
  };
  // Adding placements can only push a match's earliest start later, so for the
  // time sweep cached keys are lower bounds refreshed lazily at the front. The
  // other orders depend on keys in a way that breaks that, so they refresh all.
  const better = (a: number, b: number): boolean => {
    const ka = key.get(a)!;
    const kb = key.get(b)!;
    if (order === "critical") {
      const pa = ka + ctx.tail[a]!;
      const pb = kb + ctx.tail[b]!;
      return pa > pb || (pa === pb && (ka < kb || (ka === kb && a < b)));
    }
    if (order === "tail") {
      return ctx.tail[a]! > ctx.tail[b]! || (ctx.tail[a] === ctx.tail[b] && (ka < kb || (ka === kb && a < b)));
    }
    return ka < kb || (ka === kb && (ctx.tail[a]! > ctx.tail[b]! || (ctx.tail[a] === ctx.tail[b] && a < b)));
  };
  const nextReady = (): number => {
    let pick = -1;
    for (const i of ready) if (pick === -1 || better(i, pick)) pick = i;
    return pick;
  };
  for (const i of ready) key.set(i, earliest(i) ?? Infinity);

  while (ready.size > 0) {
    if (order !== "time") for (const i of ready) key.set(i, earliest(i) ?? Infinity);
    const pick = nextReady();
    const fresh = order === "time" ? earliest(pick) : key.get(pick)! === Infinity ? null : key.get(pick)!;
    if (order === "time" && fresh !== null && fresh > key.get(pick)!) {
      key.set(pick, fresh);
      continue;
    }
    ready.delete(pick);
    remaining.delete(pick);

    const slot = fresh === null ? null : bestSlot(ctx, state, pick, options);
    if (!slot) {
      unplaced.set(pick, diagnose(ctx, state, pick));
      failDescendants(pick);
      continue;
    }
    state.place(pick, slot.court, slot.start);
    for (const link of ctx.succs[pick]!) {
      if (!remaining.has(link.other)) continue;
      pendingPreds[link.other] = pendingPreds[link.other]! - 1;
      if (pendingPreds[link.other] === 0) {
        ready.add(link.other);
        key.set(link.other, earliest(link.other) ?? Infinity);
      }
    }
  }
  return { state, unplaced };
}

interface Slot {
  court: number;
  start: number;
  cost: number;
}

/** Lowest-cost feasible slot for an unplaced match, or null when none exists. */
export function bestSlot(ctx: PlanContext, state: PlacementState, match: number, options: ConstructOptions): Slot | null {
  const lower = ctx.alignUp(state.lowerBound(match));
  const maxDelay = options.maxDelayMinutes ?? 90;
  let best: Slot | null = null;
  for (const court of ctx.allowedCourts[match]!) {
    let from = lower;
    let earliest = -1;
    for (let k = 0; k < options.candidatesPerCourt; k++) {
      const start = state.nextFeasible(match, court, from);
      if (start === null) break;
      if (k === 0) earliest = start;
      else if (start - earliest > maxDelay || start + ctx.tail[match]! > ctx.horizonEnd) break;
      let cost = candidateCost(ctx, state, match, court, start, options.weights);
      if (options.noise && options.random) cost *= 1 + options.noise * (options.random.next() - 0.5);
      if (best === null || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && (start < best.start || (start === best.start && court < best.court)))) {
        best = { court, start, cost };
      }
      from = start + Math.max(ctx.granularity, ctx.alignUp(ctx.duration[match]! / 2));
    }
  }
  return best;
}

function candidateCost(ctx: PlanContext, state: PlacementState, match: number, court: number, start: number, w: Weights): number {
  const duration = ctx.duration[match]!;
  const end = start + duration;
  let cost = w.finish * (end / 60);

  const entries = state.courtEntries(court);
  let at = 0;
  while (at < entries.length && entries[at]!.start < start) at++;
  const previous = at > 0 ? entries[at - 1]! : null;
  const following = at < entries.length ? entries[at]! : null;
  const day = Math.floor(start / 1440);

  let gapBefore: number;
  if (previous && Math.floor(previous.start / 1440) === day) gapBefore = Math.max(0, start - previous.end - ctx.turnover);
  else gapBefore = Math.max(0, start - (windowStart(ctx, court, start) ?? start));
  let gapAfter = 0;
  if (following && Math.floor(following.start / 1440) === day) gapAfter = Math.max(0, following.start - end - ctx.turnover);
  const unusable = gapAfter > 0 && gapAfter < ctx.minDuration ? gapAfter : 0;
  cost += (w.idle * (gapBefore + unusable)) / 60;

  let b2b = 0;
  let short = 0;
  let shortfall = 0;
  const addGap = (gap: number, factor: number) => {
    if (gap < ctx.backToBack) b2b += factor;
    if (gap < ctx.comfortRest) {
      short += factor;
      shortfall += factor * (ctx.comfortRest - gap);
    }
  };
  for (const conflict of ctx.conflicts[match]!) {
    if (!state.isPlaced(conflict.other)) continue;
    const otherStart = state.start[conflict.other]!;
    const otherEnd = state.end(conflict.other);
    addGap(start >= otherEnd ? start - otherEnd : otherStart - end, conflict.definite ? 1 : 0.4);
  }
  for (const link of ctx.preds[match]!) {
    if (link.sameParticipant && state.isPlaced(link.other)) addGap(start - state.end(link.other), 1);
  }
  for (const link of ctx.succs[match]!) {
    if (link.sameParticipant && state.isPlaced(link.other)) addGap(state.start[link.other]! - end, 1);
  }
  cost += w.backToBack * b2b + w.shortRecovery * short + (w.shortfall * shortfall) / 60;

  if (previous && ctx.divisionOf[previous.match] !== ctx.divisionOf[match]) cost += w.courtSwitch;
  if (following && ctx.divisionOf[following.match] !== ctx.divisionOf[match]) cost += w.courtSwitch;

  const prefs = ctx.constraints.localPreferences.get(ctx.matches[match]!.id);
  if (prefs) {
    const courtId = ctx.courts[court]!.id;
    let penalty = 0;
    for (const p of prefs) penalty += p(courtId, start, duration);
    cost += PREFERENCE_SCALE * penalty;
  }
  return cost;
}

function windowStart(ctx: PlanContext, court: number, minute: number): number | null {
  for (const w of ctx.courts[court]!.windows) if (minute >= w.start && minute < w.end) return w.start;
  return null;
}

function diagnose(ctx: PlanContext, state: PlacementState, match: number): string {
  const courts = ctx.allowedCourts[match]!;
  if (courts.length === 0) return "no court is allowed for this match by the division's eligible courts and the mandatory instructions";
  if (courts.every((c) => ctx.startRanges(match, c).length === 0)) {
    return "no allowed court has availability that fits the match inside its allowed time windows";
  }
  const lower = state.lowerBound(match);
  return `no start time at or after minute ${lower} satisfies court occupancy, rest, dependency, restriction and daily-cap rules on any allowed court`;
}
