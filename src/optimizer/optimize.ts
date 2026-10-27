import { analyzeFeasibility } from "../feasibility/analyze.js";
import { checkInstructions } from "../instructions/check.js";
import { compileInstructions } from "../instructions/compile.js";
import type { Inventory } from "../inventory/types.js";
import type { Schedule } from "../schedule/types.js";
import { validateSchedule } from "../validation/validateSchedule.js";
import {
  assignmentDistance,
  DEFAULT_THRESHOLDS,
  describeTradeOff,
  dominance,
  materialDifferences,
  type DistinctnessThresholds,
} from "./compare.js";
import { PlanContext } from "./context.js";
import { construct, type ConstructOptions, type ConstructResult } from "./construct.js";
import { computeMetrics, objectiveCost, type ScheduleMetrics, type Weights } from "./metrics.js";
import { createRandom, type Random } from "./random.js";
import { localSearch, type SearchResult } from "./search.js";
import { PlacementState } from "./state.js";
import { STRATEGIES, STRATEGY_ORDER, type Strategy, type StrategyId } from "./strategies.js";
import type {
  Comparison,
  OptimizeOptions,
  OptimizeResult,
  OptionRelation,
  Recommendation,
  ScheduleOption,
  UnplacedMatch,
} from "./types.js";

const DEFAULT_ITERATIONS = 30_000;
const TYPICAL_MATCH_LIMIT = 300;
const TYPICAL_BUDGET_MS = 8_000;
const LARGE_BUDGET_MS = 24_000;
/** Share of the remaining time given to the main search; the rest is kept for diversification. */
const MAIN_SEARCH_SHARE = 0.7;

/** High-resolution clock where the host has one (Node, browsers, edge runtimes), else `Date.now`. */
const defaultClock = (): number => {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
};

interface Candidate {
  strategy: Strategy;
  state: PlacementState;
  metrics: ScheduleMetrics;
  cost: number;
  search: SearchResult | null;
  attempts: number;
  budgetExhausted: boolean;
}

/**
 * Generates up to three hard-valid schedule options (Fastest Finish, Balanced
 * Operations, Player-First) for one tournament, with structured instructions.
 *
 * The pipeline per strategy: constructive list scheduling (with fallbacks),
 * seeded local search under the strategy's weights, then verification of the
 * result by the independent `validateSchedule` and `checkInstructions`.
 * Options that are duplicates or materially equivalent are detected, and the
 * engine tries to produce a different one; if it cannot, it says why. No
 * result is claimed to be optimal.
 */
export function optimizeSchedules(inventory: Inventory, options: OptimizeOptions = {}): OptimizeResult {
  const clock = options.clock ?? defaultClock;
  const startedAt = clock();
  const seed = options.seed ?? 1;
  const instructions = options.instructions ?? [];

  const compiled = compileInstructions(inventory, instructions);
  if (!compiled.ok) {
    return emptyResult("invalid_instructions", seed, clock() - startedAt, inventory, { instructionIssues: compiled.error });
  }
  const constraints = compiled.value;
  const ctx = new PlanContext(constraints, options);
  const random = createRandom(seed);
  const strategies = (options.strategies ?? STRATEGY_ORDER).map((id) => STRATEGIES[id]);
  const thresholds: DistinctnessThresholds = { ...DEFAULT_THRESHOLDS, ...options.distinctness };

  const iterations = options.budget?.iterationsPerStrategy ?? DEFAULT_ITERATIONS;
  const capMs = options.budget?.totalMs ?? (options.budget?.iterationsPerStrategy !== undefined ? undefined : ctx.size <= TYPICAL_MATCH_LIMIT ? TYPICAL_BUDGET_MS : LARGE_BUDGET_MS);
  const hardDeadline = capMs === undefined ? undefined : startedAt + capMs;

  // 1. Construction with fallbacks.
  const built = new Map<StrategyId, ConstructResult>();
  let bestPartial: ConstructResult | null = null;
  for (const strategy of strategies) {
    const result = buildBaseline(ctx, strategy);
    if (result.unplaced.size === 0) built.set(strategy.id, result);
    else if (bestPartial === null || result.unplaced.size < bestPartial.unplaced.size) bestPartial = result;
  }
  if (built.size === 0) {
    const partial = bestPartial!;
    const unplaced: UnplacedMatch[] = [...partial.unplaced].map(([m, reason]) => ({ matchId: ctx.matches[m]!.id, reason }));
    const lockedProblems = [...partial.unplaced].filter(([m]) => ctx.locked.has(m)).map(([m]) => ctx.matches[m]!.id);
    return emptyResult("no_schedule", seed, clock() - startedAt, inventory, {
      failure: { unplaced, feasibility: analyzeFeasibility(constraints.inventory), lockedProblems },
      warnings: [...constraints.warnings],
    });
  }

  // 2. Local search per strategy.
  const searchStrategies = strategies.filter((s) => built.has(s.id));
  const candidates: Candidate[] = [];
  const mainDeadline = hardDeadline === undefined ? undefined : clock() + (hardDeadline - clock()) * MAIN_SEARCH_SHARE;
  for (const [index, strategy] of searchStrategies.entries()) {
    const baseline = built.get(strategy.id)!.state;
    let deadline: number | undefined;
    if (mainDeadline !== undefined) {
      const now = clock();
      deadline = now + Math.max(0, (mainDeadline - now) / (searchStrategies.length - index));
    }
    const result = localSearch(ctx, baseline, {
      weights: strategy.weights,
      random: createRandom(seed * 7919 + index + 1),
      maxIterations: iterations,
      ...(deadline !== undefined ? { deadline } : {}),
      clock,
    });
    candidates.push({
      strategy,
      state: result.state,
      metrics: result.metrics,
      cost: result.cost,
      search: result,
      attempts: 0,
      budgetExhausted: result.stopReason === "time",
    });
  }

  // 3. Verification by the independent validators.
  const rejected: NonNullable<OptimizeResult["rejected"]> = [];
  const verified: Candidate[] = [];
  for (const candidate of candidates) {
    const check = verify(inventory, constraints.inventory, constraints.locked, instructions, candidate.state);
    if (check.valid) {
      verified.push(candidate);
      continue;
    }
    const fallback = built.get(candidate.strategy.id)!.state;
    const again = verify(inventory, constraints.inventory, constraints.locked, instructions, fallback);
    if (again.valid) {
      const metrics = computeMetrics(ctx, fallback);
      verified.push({ ...candidate, state: fallback, metrics, cost: objectiveCost(metrics, candidate.strategy.weights), search: null });
    } else {
      rejected.push({ strategy: candidate.strategy.id, violations: check.violations, instructionViolations: check.instructionViolations });
    }
  }

  // 4. Distinctness: detect equivalent options and try to produce real alternatives.
  const diversityAttempts = options.diversityAttempts ?? 2;
  for (let attempt = 1; attempt <= diversityAttempts; attempt++) {
    if (hardDeadline !== undefined && clock() >= hardDeadline) break;
    const target = pickEquivalentTarget(verified, thresholds);
    if (!target) break;
    const reworked = rework(ctx, built, target, attempt, random, { iterations, clock, hardDeadline, seed });
    if (!reworked) continue;
    const check = verify(inventory, constraints.inventory, constraints.locked, instructions, reworked.state);
    if (!check.valid) continue;
    if (!isGenuineAlternative(reworked, target.twins, thresholds)) continue;
    const at = verified.findIndex((c) => c.strategy.id === target.strategy.id);
    verified[at] = { ...reworked, attempts: attempt };
  }
  for (const c of verified) c.attempts = Math.max(c.attempts, 0);

  const ordered = [...verified].sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy.id) - STRATEGY_ORDER.indexOf(b.strategy.id));
  const optionsOut = ordered.map((c): ScheduleOption => toOption(ctx, c));
  const comparison = compare(ordered, optionsOut, thresholds, ctx, diversityAttempts, rejected.length);

  const finishBest = ordered.length === 0 ? null : Math.min(...ordered.map((c) => c.metrics.finishMinute));
  const lower = ctx.finishLowerBound();
  const result: OptimizeResult = {
    status: ordered.length > 0 ? "ok" : "no_schedule",
    options: optionsOut,
    recommended: recommend(ordered, comparison),
    comparison,
    diagnostics: {
      seed,
      elapsedMs: clock() - startedAt,
      matchCount: ctx.size,
      courtCount: ctx.courts.length,
      granularityMinutes: ctx.granularity,
      finishLowerBoundMinute: lower,
      finishGapToLowerBound: finishBest === null ? null : finishBest - lower,
      warnings: [...constraints.warnings],
    },
  };
  if (rejected.length > 0) result.rejected = rejected;
  return result;
}

function emptyResult(
  status: OptimizeResult["status"],
  seed: number,
  elapsedMs: number,
  inventory: Inventory,
  extra: Partial<OptimizeResult> & { warnings?: OptimizeResult["diagnostics"]["warnings"] },
): OptimizeResult {
  const { warnings, ...rest } = extra;
  return {
    status,
    options: [],
    recommended: null,
    comparison: { relations: [], equivalent: [], explanation: [] },
    diagnostics: {
      seed,
      elapsedMs,
      matchCount: inventory.matches.length,
      courtCount: inventory.config.courts.length,
      granularityMinutes: 0,
      finishLowerBoundMinute: 0,
      finishGapToLowerBound: null,
      warnings: warnings ?? [],
    },
    ...rest,
  };
}

/**
 * Constructive placement with progressively simpler fallbacks until every
 * match is placed. Recovery-oriented weights can fill the day too early, so
 * the last resort is the Fastest Finish weights, whose schedule the local
 * search then reshapes under the strategy's own weights.
 */
function buildBaseline(ctx: PlanContext, strategy: Strategy): ConstructResult {
  const fastest = STRATEGIES.fastest_finish;
  const attempts: ConstructOptions[] = [
    { order: "critical", weights: strategy.weights, candidatesPerCourt: strategy.candidatesPerCourt },
    { order: "time", weights: strategy.weights, candidatesPerCourt: strategy.candidatesPerCourt },
    { order: "critical", weights: strategy.weights, candidatesPerCourt: 1 },
    { order: "critical", weights: fastest.weights, candidatesPerCourt: 1 },
    { order: "time", weights: fastest.weights, candidatesPerCourt: 1 },
    { order: "tail", weights: fastest.weights, candidatesPerCourt: 1 },
  ];
  let best: ConstructResult | null = null;
  for (const attempt of attempts) {
    const result = construct(ctx, attempt);
    if (result.unplaced.size === 0) return result;
    if (best === null || result.unplaced.size < best.unplaced.size) best = result;
  }
  return best!;
}

function verify(
  original: Inventory,
  effective: Inventory,
  locked: readonly { matchId: string; courtId: string; day: string; start: number }[],
  instructions: NonNullable<OptimizeOptions["instructions"]>,
  state: PlacementState,
) {
  const schedule: Schedule = { tournamentId: effective.config.id, assignments: state.toAssignments() };
  const report = validateSchedule(effective, schedule, { frozen: locked });
  const instructionViolations = checkInstructions(original, schedule, instructions);
  return { valid: report.valid && instructionViolations.length === 0, violations: report.violations, instructionViolations, schedule };
}

function relate(a: Candidate, b: Candidate, thresholds: DistinctnessThresholds): OptionRelation {
  const distance = assignmentDistance(a.state, b.state);
  const differsOn = materialDifferences(a.metrics, b.metrics, thresholds);
  const materially = distance >= thresholds.minAssignmentDistance && differsOn.length > 0;
  return {
    a: a.strategy.id,
    b: b.strategy.id,
    assignmentDistance: distance,
    identical: distance === 0,
    materiallyDifferent: materially,
    differsOn,
    dominance: dominance(a.metrics, b.metrics),
    summary: describeTradeOff(a.strategy.name, a.metrics, b.strategy.name, b.metrics, differsOn),
  };
}

/** The option to rework: Balanced if it is equivalent to a neighbour, otherwise the later of an equivalent pair. */
function pickEquivalentTarget(candidates: readonly Candidate[], thresholds: DistinctnessThresholds): { strategy: Strategy; twins: Candidate[] } | null {
  const twinsOf = (c: Candidate) => candidates.filter((o) => o !== c && !relate(c, o, thresholds).materiallyDifferent);
  const balanced = candidates.find((c) => c.strategy.id === "balanced_operations");
  if (balanced) {
    const twins = twinsOf(balanced);
    if (twins.length > 0) return { strategy: balanced.strategy, twins };
  }
  for (const c of [...candidates].reverse()) {
    const twins = twinsOf(c);
    if (twins.length > 0) return { strategy: c.strategy, twins };
  }
  return null;
}

/**
 * A reworked option only replaces an equivalent one when it offers a real
 * trade-off: materially different from every twin and never worse than a twin
 * on every measure. A schedule that merely differs by being worse is not an
 * alternative.
 */
function isGenuineAlternative(reworked: Candidate, twins: readonly Candidate[], thresholds: DistinctnessThresholds): boolean {
  return twins.every((twin) => {
    const relation = relate(reworked, twin, thresholds);
    return relation.materiallyDifferent && relation.dominance !== "b_dominates";
  });
}

const blend = (a: Weights, b: Weights, t: number): Weights => ({
  finish: a.finish + (b.finish - a.finish) * t,
  idle: a.idle + (b.idle - a.idle) * t,
  backToBack: a.backToBack + (b.backToBack - a.backToBack) * t,
  shortRecovery: a.shortRecovery + (b.shortRecovery - a.shortRecovery) * t,
  shortfall: a.shortfall + (b.shortfall - a.shortfall) * t,
  fairness: a.fairness + (b.fairness - a.fairness) * t,
  courtSwitch: a.courtSwitch + (b.courtSwitch - a.courtSwitch) * t,
});

/** Pushes a strategy's weights further toward its own character (or, for Balanced, away from its twin). */
function amplified(strategy: Strategy, twins: readonly Candidate[], attempt: number): Weights {
  const w = strategy.weights;
  if (strategy.id === "fastest_finish") {
    return { ...w, finish: w.finish * (1 + 2 * attempt), idle: w.idle * (1 + attempt), backToBack: w.backToBack / (1 + attempt), shortRecovery: w.shortRecovery / (1 + attempt), shortfall: w.shortfall / (1 + attempt), fairness: w.fairness / (1 + attempt) };
  }
  if (strategy.id === "player_first") {
    const k = 1 + 2 * attempt;
    return { ...w, finish: w.finish / (1 + attempt), idle: w.idle / (1 + attempt), backToBack: w.backToBack * k, shortRecovery: w.shortRecovery * k, shortfall: w.shortfall * k, fairness: w.fairness * k };
  }
  const nearA = twins.some((t) => t.strategy.id === "fastest_finish");
  const away = nearA ? STRATEGIES.player_first.weights : STRATEGIES.fastest_finish.weights;
  return blend(w, away, Math.min(0.9, 0.35 * attempt));
}

function rework(
  ctx: PlanContext,
  built: ReadonlyMap<StrategyId, ConstructResult>,
  target: { strategy: Strategy; twins: Candidate[] },
  attempt: number,
  random: Random,
  budget: { iterations: number; clock: () => number; hardDeadline: number | undefined; seed: number },
): Candidate | null {
  const weights = amplified(target.strategy, target.twins, attempt);
  const noisy = construct(ctx, { order: "critical", weights, candidatesPerCourt: target.strategy.candidatesPerCourt, noise: 0.05 * attempt, random });
  const start = noisy.unplaced.size === 0 ? noisy.state : built.get(target.strategy.id)!.state;
  const remaining = budget.hardDeadline === undefined ? undefined : Math.max(0, budget.hardDeadline - budget.clock());
  const pull = 8 * attempt;
  const refs = target.twins.map((t) => t.state);
  const result = localSearch(ctx, start, {
    weights,
    random: createRandom(budget.seed * 104729 + attempt * 31 + (target.strategy.label.charCodeAt(0))),
    maxIterations: budget.iterations,
    ...(remaining === undefined ? {} : { deadline: budget.clock() + remaining / 2 }),
    clock: budget.clock,
    extraCost: (starts, courts) => {
      let same = 0;
      for (const ref of refs) {
        let n = 0;
        for (let i = 0; i < starts.length; i++) if (starts[i] === ref.start[i] && courts[i] === ref.court[i]) n++;
        same += starts.length === 0 ? 0 : n / starts.length;
      }
      return pull * same;
    },
  });
  const metrics = computeMetrics(ctx, result.state);
  return {
    strategy: target.strategy,
    state: result.state,
    metrics,
    cost: objectiveCost(metrics, target.strategy.weights),
    search: result,
    attempts: attempt,
    budgetExhausted: result.stopReason === "time",
  };
}

function toOption(ctx: PlanContext, c: Candidate): ScheduleOption {
  return {
    strategy: c.strategy.id,
    label: c.strategy.label,
    name: c.strategy.name,
    summary: c.strategy.summary,
    schedule: { tournamentId: ctx.inventory.config.id, assignments: c.state.toAssignments() },
    metrics: c.metrics,
    cost: c.cost,
    validated: true,
    search: {
      iterations: c.search?.iterations ?? 0,
      stopReason: c.search?.stopReason ?? "converged",
      diversificationAttempts: c.attempts,
    },
    budgetExhausted: c.budgetExhausted,
  };
}

function compare(
  ordered: readonly Candidate[],
  options: readonly ScheduleOption[],
  thresholds: DistinctnessThresholds,
  ctx: PlanContext,
  attempts: number,
  rejectedCount: number,
): Comparison {
  const relations: OptionRelation[] = [];
  const equivalent: Comparison["equivalent"] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const relation = relate(ordered[i]!, ordered[j]!, thresholds);
      relations.push(relation);
      if (!relation.materiallyDifferent) equivalent.push({ strategy: relation.b, equivalentTo: relation.a });
    }
  }

  const explanation: string[] = [];
  if (ordered.length < STRATEGY_ORDER.length) {
    explanation.push(
      `Only ${ordered.length} of ${STRATEGY_ORDER.length} options could be produced${rejectedCount > 0 ? " (some candidates failed independent validation and were discarded)" : ""}.`,
    );
  }
  if (equivalent.length > 0) {
    for (const e of equivalent) {
      const name = (id: StrategyId) => STRATEGIES[id].name;
      const rel = relations.find((r) => (r.a === e.equivalentTo && r.b === e.strategy) || (r.b === e.equivalentTo && r.a === e.strategy))!;
      explanation.push(
        `${name(e.strategy)} is materially equivalent to ${name(e.equivalentTo)} (${(rel.assignmentDistance * 100).toFixed(0)}% of matches placed differently; no headline measure differs beyond the thresholds).`,
      );
    }
    const lowerGap = Math.min(...options.map((o) => o.metrics.finishMinute)) - ctx.finishLowerBound();
    if (lowerGap <= 30) {
      explanation.push(
        `The best finish is within ${Math.max(0, Math.round(lowerGap))} minutes of an optimistic lower bound, so there is little room to trade finish time for recovery.`,
      );
    }
    if (options.every((o) => o.metrics.backToBackCount === 0 && o.metrics.shortRecoveryCount === 0)) {
      explanation.push("No option has back-to-back matches or short recoveries, so a Player-First variant has nothing further to improve.");
    }
    explanation.push(
      `Up to ${attempts} diversification ${attempts === 1 ? "attempt was" : "attempts were"} made. Failing to find a materially different schedule within the budget does not prove none exists.`,
    );
  }
  return { relations, equivalent, explanation };
}

function recommend(ordered: readonly Candidate[], comparison: Comparison): Recommendation | null {
  if (ordered.length === 0) return null;
  const balanced = ordered.find((c) => c.strategy.id === "balanced_operations");
  const name = (id: StrategyId) => STRATEGIES[id].name;
  if (balanced) {
    const dominatedBy = comparison.relations.find(
      (r) => (r.a === "balanced_operations" && r.dominance === "b_dominates") || (r.b === "balanced_operations" && r.dominance === "a_dominates"),
    );
    if (!dominatedBy) {
      const fast = ordered.find((c) => c.strategy.id === "fastest_finish");
      const detail = fast ? ` ${describeTradeOff(fast.strategy.name, fast.metrics, balanced.strategy.name, balanced.metrics, materialDifferences(fast.metrics, balanced.metrics))}` : "";
      return { strategy: "balanced_operations", reason: `Balanced Operations is the default recommendation.${detail}` };
    }
    const better = dominatedBy.a === "balanced_operations" ? dominatedBy.b : dominatedBy.a;
    return { strategy: better, reason: `${name(better)} is at least as good as Balanced Operations on every measured objective and strictly better on at least one, so it is recommended instead.` };
  }
  const first = ordered[0]!;
  return { strategy: first.strategy.id, reason: `${first.strategy.name} is the only option that could be produced.` };
}

