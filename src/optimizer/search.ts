import type { PlanContext } from "./context.js";
import { computeMetrics, objectiveCost, type ScheduleMetrics, type Weights } from "./metrics.js";
import type { Random } from "./random.js";
import { PlacementState } from "./state.js";

export type StopReason = "iterations" | "time" | "converged";

export interface SearchOptions {
  weights: Weights;
  random: Random;
  /** Maximum number of attempted moves. */
  maxIterations: number;
  /** Absolute clock reading (ms) after which the search stops, or undefined for no time cap. */
  deadline?: number;
  clock: () => number;
  /** Stop after this many consecutive non-improving moves. */
  stagnationLimit?: number;
  /** Extra cost term, evaluated on every candidate (used to push away from other options). */
  extraCost?: (start: readonly number[], court: readonly number[]) => number;
}

export interface SearchResult {
  state: PlacementState;
  metrics: ScheduleMetrics;
  cost: number;
  iterations: number;
  accepted: number;
  stopReason: StopReason;
}

const CHECK_CLOCK_EVERY = 16;
const CANDIDATE_COURTS = 6;
const CANDIDATES_PER_COURT = 3;

/**
 * Seeded local search over complete placements: relocate one match to another
 * feasible slot, or swap the slots of two matches. Every move is tested with
 * the hard-rule feasibility check before it is evaluated, so the search never
 * leaves the feasible region. A move is kept when it does not worsen the
 * weighted cost (plateau moves allowed). The result is a local optimum
 * relative to these moves, not a proven optimum.
 */
export function localSearch(ctx: PlanContext, initial: PlacementState, options: SearchOptions): SearchResult {
  const state = PlacementState.from(ctx, initial.snapshot());
  const movable: number[] = [];
  for (let i = 0; i < ctx.size; i++) if (!ctx.locked.has(i)) movable.push(i);

  const evaluate = () => {
    const metrics = computeMetrics(ctx, state);
    const extra = options.extraCost ? options.extraCost(state.start, state.court) : 0;
    return { metrics, cost: objectiveCost(metrics, options.weights) + extra };
  };

  let current = evaluate();
  let iterations = 0;
  let accepted = 0;
  let sinceImprovement = 0;
  const stagnation = options.stagnationLimit ?? Math.max(1500, ctx.size * 6);
  let stopReason: StopReason = "iterations";

  if (movable.length === 0) return { state, metrics: current.metrics, cost: current.cost, iterations: 0, accepted: 0, stopReason: "converged" };

  while (iterations < options.maxIterations) {
    if (iterations % CHECK_CLOCK_EVERY === 0 && options.deadline !== undefined && options.clock() >= options.deadline) {
      stopReason = "time";
      break;
    }
    if (sinceImprovement >= stagnation) {
      stopReason = "converged";
      break;
    }
    iterations++;

    const moved = options.random.next() < 0.7 ? relocate(ctx, state, movable, current.metrics, options.random) : swap(ctx, state, movable, options.random);
    if (!moved) {
      sinceImprovement++;
      continue;
    }
    const next = evaluate();
    if (next.cost <= current.cost + 1e-9) {
      if (next.cost < current.cost - 1e-9) sinceImprovement = 0;
      else sinceImprovement++;
      current = next;
      accepted++;
    } else {
      moved.undo();
      sinceImprovement++;
    }
  }
  return { state, metrics: current.metrics, cost: current.cost, iterations, accepted, stopReason };
}

interface Move {
  undo(): void;
}

function relocate(ctx: PlanContext, state: PlacementState, movable: readonly number[], metrics: ScheduleMetrics, random: Random): Move | null {
  let match: number;
  if (random.next() < 0.4) {
    const late = movable.filter((i) => state.end(i) >= metrics.finishMinute - 90);
    match = late.length > 0 ? random.pick(late) : random.pick(movable);
  } else {
    match = random.pick(movable);
  }
  const oldCourt = state.court[match]!;
  const oldStart = state.start[match]!;
  state.unplace(match);

  const courts = [...ctx.allowedCourts[match]!];
  for (let k = courts.length - 1; k > 0; k--) {
    const j = random.int(k + 1);
    [courts[k], courts[j]] = [courts[j]!, courts[k]!];
  }
  const candidates: { court: number; start: number }[] = [];
  const lower = state.lowerBound(match);
  const step = Math.max(ctx.granularity, ctx.alignUp(ctx.duration[match]! / 2));
  for (const court of courts.slice(0, CANDIDATE_COURTS)) {
    let from = lower;
    for (let k = 0; k < CANDIDATES_PER_COURT; k++) {
      const start = state.nextFeasible(match, court, from);
      if (start === null) break;
      if (court !== oldCourt || start !== oldStart) candidates.push({ court, start });
      from = start + step;
    }
  }
  if (candidates.length === 0) {
    state.place(match, oldCourt, oldStart);
    return null;
  }
  const chosen = random.pick(candidates);
  state.place(match, chosen.court, chosen.start);
  return {
    undo() {
      state.unplace(match);
      state.place(match, oldCourt, oldStart);
    },
  };
}

function swap(ctx: PlanContext, state: PlacementState, movable: readonly number[], random: Random): Move | null {
  if (movable.length < 2) return null;
  const a = random.pick(movable);
  const b = random.pick(movable);
  if (a === b) return null;
  const ca = state.court[a]!;
  const sa = state.start[a]!;
  const cb = state.court[b]!;
  const sb = state.start[b]!;
  if (ca === cb && sa === sb) return null;
  if (!ctx.allowedCourts[a]!.includes(cb) || !ctx.allowedCourts[b]!.includes(ca)) return null;

  state.unplace(a);
  state.unplace(b);
  const restore = () => {
    state.unplace(a);
    state.unplace(b);
    state.place(a, ca, sa);
    state.place(b, cb, sb);
  };
  if (!state.isFeasible(a, cb, sb)) {
    state.place(a, ca, sa);
    state.place(b, cb, sb);
    return null;
  }
  state.place(a, cb, sb);
  if (!state.isFeasible(b, ca, sa)) {
    state.unplace(a);
    state.place(a, ca, sa);
    state.place(b, cb, sb);
    return null;
  }
  state.place(b, ca, sa);
  return { undo: restore };
}
