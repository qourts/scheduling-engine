import { analyzeFeasibility, type FeasibilityReport } from "../feasibility/analyze.js";
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
  ConstructionMethod,
  FailureReport,
  OptimizeOptions,
  OptimizeResult,
  OptionRelation,
  Recommendation,
  ScheduleOption,
  UnplacedMatch,
} from "./types.js";

const DEFAULT_ITERATIONS = 30_000;
/** Randomised construction retries tried after the deterministic attempts fail. */
const RECOVERY_ATTEMPTS = 8;
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
  /** Local search output failed verification; this is the verified construction baseline instead. */
  fallback?: boolean;
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

  const optionIssues = validateOptions(options);
  if (optionIssues.length > 0) {
    return emptyResult("invalid_options", seed, clock() - startedAt, inventory, { optionIssues });
  }

  const compiled = compileInstructions(inventory, instructions);
  if (!compiled.ok) {
    return emptyResult("invalid_instructions", seed, clock() - startedAt, inventory, { instructionIssues: compiled.error });
  }
  const constraints = compiled.value;
  const ctx = new PlanContext(constraints, options);
  const random = createRandom(seed);
  const strategies = [...new Set(options.strategies ?? STRATEGY_ORDER)].map((id) => STRATEGIES[id]);
  const thresholds: DistinctnessThresholds = { ...DEFAULT_THRESHOLDS, ...options.distinctness };

  const iterations = options.budget?.iterationsPerStrategy ?? DEFAULT_ITERATIONS;
  const capMs = options.budget?.totalMs ?? (options.budget?.iterationsPerStrategy !== undefined ? undefined : ctx.size <= TYPICAL_MATCH_LIMIT ? TYPICAL_BUDGET_MS : LARGE_BUDGET_MS);
  const hardDeadline = capMs === undefined ? undefined : startedAt + capMs;

  const timing = { constructionMs: 0, searchMs: 0, diversificationMs: 0, verificationMs: 0 };
  let lapAt = clock();
  const lap = (): number => {
    const now = clock();
    const elapsed = now - lapAt;
    lapAt = now;
    return elapsed;
  };

  // A failed necessary condition is a proof that no schedule exists, so the fallback ladder cannot help: report the
  // proof with one construction attempt as an example of what does not fit.
  const feasibility = analyzeFeasibility(constraints.inventory);
  if (feasibility.status === "infeasible") {
    const example = construct(ctx, { order: "critical", weights: (strategies[0] ?? STRATEGIES.balanced_operations).weights, candidatesPerCourt: 1 });
    timing.constructionMs = lap();
    return emptyResult("no_schedule", seed, clock() - startedAt, inventory, {
      failure: explainFailure(ctx, feasibility, example),
      warnings: [...constraints.warnings],
    });
  }

  // 1. Construction with bounded fallbacks and retries.
  const built = new Map<StrategyId, ConstructResult>();
  const constructionMethods: Partial<Record<StrategyId, ConstructionMethod>> = {};
  let bestPartial: ConstructResult | null = null;
  for (const strategy of strategies) {
    const baseline = buildBaseline(ctx, strategy, { seed, clock, deadline: hardDeadline });
    if (baseline.result.unplaced.size === 0) {
      built.set(strategy.id, baseline.result);
      constructionMethods[strategy.id] = baseline.method;
    } else if (bestPartial === null || baseline.result.unplaced.size < bestPartial.unplaced.size) bestPartial = baseline.result;
  }
  timing.constructionMs = lap();
  if (built.size === 0) {
    return emptyResult("no_schedule", seed, clock() - startedAt, inventory, {
      failure: explainFailure(ctx, feasibility, bestPartial),
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

  timing.searchMs = lap();

  // 3. Verification by the independent validators.
  const rejected: NonNullable<OptimizeResult["rejected"]> = [];
  const verified: Candidate[] = [];
  for (const candidate of candidates) {
    const check = verify(inventory, constraints.inventory, constraints.locked, instructions, candidate.state);
    if (check.valid) {
      verified.push(candidate);
      continue;
    }
    // The search result failed independent verification: never hide that. Record it,
    // then fall back to the verified construction baseline if that one is valid.
    rejected.push({ strategy: candidate.strategy.id, violations: check.violations, instructionViolations: check.instructionViolations });
    const fallback = built.get(candidate.strategy.id)!.state;
    const again = verify(inventory, constraints.inventory, constraints.locked, instructions, fallback);
    if (again.valid) {
      const metrics = computeMetrics(ctx, fallback);
      verified.push({ ...candidate, state: fallback, metrics, cost: objectiveCost(metrics, candidate.strategy.weights), search: null, budgetExhausted: false, fallback: true });
    }
  }

  timing.verificationMs = lap();

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

  // 5. Fastest Finish must not finish later than another returned option: if one does, continue
  // from that option's schedule under Fastest Finish weights. Any exception is disclosed below.
  const finishPass = ensureEarliestFinish(ctx, verified, { iterations, clock, hardDeadline, seed }, (state) =>
    verify(inventory, constraints.inventory, constraints.locked, instructions, state).valid,
  );
  if (finishPass.replacement) verified[verified.findIndex((c) => c.strategy.id === "fastest_finish")] = finishPass.replacement;
  timing.diversificationMs = lap();

  const ordered = [...verified].sort((a, b) => STRATEGY_ORDER.indexOf(a.strategy.id) - STRATEGY_ORDER.indexOf(b.strategy.id));
  const optionsOut = ordered.map((c): ScheduleOption => toOption(ctx, c));
  const comparison = compare(ordered, optionsOut, thresholds, ctx, diversityAttempts, rejected.length, strategies.length);
  if (finishPass.exception) comparison.explanation.push(finishPass.exception);

  const elapsedMs = clock() - startedAt;
  const finishBest = ordered.length === 0 ? null : Math.min(...ordered.map((c) => c.metrics.finishMinute));
  const lower = ctx.finishLowerBound();
  const result: OptimizeResult = {
    status: ordered.length > 0 ? "ok" : "no_schedule",
    options: optionsOut,
    recommended: recommend(ordered, comparison),
    comparison,
    diagnostics: {
      seed,
      elapsedMs,
      matchCount: ctx.size,
      courtCount: ctx.courts.length,
      granularityMinutes: ctx.granularity,
      finishLowerBoundMinute: lower,
      finishGapToLowerBound: finishBest === null ? null : finishBest - lower,
      warnings: [...constraints.warnings],
      budgetOverrunMs: capMs === undefined ? 0 : Math.max(0, elapsedMs - capMs),
      timing: { ...timing, totalMs: elapsedMs },
      timeLimited: optionsOut.some((o) => o.budgetExhausted),
      construction: constructionMethods,
    },
  };
  if (ordered.length === 0) {
    // Every candidate failed independent verification (for example a lock that contradicts another rule).
    result.failure = explainFailure(ctx, feasibility, null);
  }
  if (rejected.length > 0) result.rejected = rejected;
  return result;
}

function validateOptions(o: OptimizeOptions): string[] {
  const issues: string[] = [];
  const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  if (o.seed !== undefined && !Number.isInteger(o.seed)) issues.push("seed must be an integer");
  if (o.strategies !== undefined) {
    if (!Array.isArray(o.strategies) || o.strategies.length === 0) issues.push("strategies must be a non-empty list");
    else for (const id of o.strategies) if (typeof id !== "string" || !Object.hasOwn(STRATEGIES, id)) issues.push(`unknown strategy ${String(id)}`);
  }
  const b = o.budget;
  if (b?.totalMs !== undefined && !(finite(b.totalMs) && b.totalMs >= 0)) issues.push("budget.totalMs must be a finite number of milliseconds >= 0");
  if (b?.iterationsPerStrategy !== undefined && !(Number.isInteger(b.iterationsPerStrategy) && b.iterationsPerStrategy >= 0)) {
    issues.push("budget.iterationsPerStrategy must be an integer >= 0");
  }
  if (o.diversityAttempts !== undefined && !(Number.isInteger(o.diversityAttempts) && o.diversityAttempts >= 0 && o.diversityAttempts <= 10)) {
    issues.push("diversityAttempts must be an integer from 0 to 10");
  }
  for (const [key, value] of Object.entries(o.distinctness ?? {})) {
    if (!finite(value) || value < 0) issues.push(`distinctness.${key} must be a finite number >= 0`);
  }
  if (o.granularityMinutes !== undefined && !(Number.isInteger(o.granularityMinutes) && o.granularityMinutes >= 1 && 1440 % o.granularityMinutes === 0)) {
    issues.push("granularityMinutes must be a positive divisor of 1440");
  }
  for (const key of ["backToBackMinutes", "comfortRestMinutes"] as const) {
    const value = o[key];
    if (value !== undefined && !(finite(value) && value >= 0)) issues.push(`${key} must be a finite number >= 0`);
  }
  return issues;
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
      budgetOverrunMs: 0,
      timing: { constructionMs: 0, searchMs: 0, diversificationMs: 0, verificationMs: 0, totalMs: elapsedMs },
      timeLimited: false,
      construction: {},
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
function buildBaseline(
  ctx: PlanContext,
  strategy: Strategy,
  recovery: { seed: number; clock: () => number; deadline: number | undefined },
): { result: ConstructResult; method: ConstructionMethod } {
  const fastest = STRATEGIES.fastest_finish;
  const deterministic: [ConstructOptions, ConstructionMethod][] = [
    [{ order: "critical", weights: strategy.weights, candidatesPerCourt: strategy.candidatesPerCourt }, "strategy_weights"],
    [{ order: "time", weights: strategy.weights, candidatesPerCourt: strategy.candidatesPerCourt }, "strategy_weights"],
    [{ order: "critical", weights: strategy.weights, candidatesPerCourt: 1 }, "strategy_weights"],
    [{ order: "critical", weights: fastest.weights, candidatesPerCourt: 1 }, "fastest_finish_weights"],
    [{ order: "time", weights: fastest.weights, candidatesPerCourt: 1 }, "fastest_finish_weights"],
    [{ order: "tail", weights: fastest.weights, candidatesPerCourt: 1 }, "fastest_finish_weights"],
  ];
  let best: ConstructResult | null = null;
  for (const [attempt, method] of deterministic) {
    const result = construct(ctx, attempt);
    if (result.unplaced.size === 0) return { result, method };
    if (best === null || result.unplaced.size < best.unplaced.size) best = result;
  }
  // Bounded recovery for difficult cases: seeded, randomised placements that vary the order, the
  // weights and the number of candidates. They stop at the time cap and are limited in number, so
  // failing here means "not found", never "impossible".
  for (let r = 0; r < RECOVERY_ATTEMPTS; r++) {
    if (recovery.deadline !== undefined && recovery.clock() >= recovery.deadline) break;
    const result = construct(ctx, {
      order: r % 2 === 0 ? "critical" : "time",
      weights: r % 3 === 0 ? strategy.weights : fastest.weights,
      candidatesPerCourt: 1 + (r % 3),
      noise: 0.6,
      random: createRandom(recovery.seed * 31 + r + 1 + strategy.label.charCodeAt(0) * 1009),
    });
    if (result.unplaced.size === 0) return { result, method: "randomized_retry" };
    if (result.unplaced.size < best!.unplaced.size) best = result;
  }
  return { result: best!, method: "randomized_retry" };
}

/** Classifies a failure honestly: a proof, a contradiction in the instructions, or "not found". */
function explainFailure(ctx: PlanContext, feasibility: FeasibilityReport, partial: ConstructResult | null): FailureReport {
  const unplaced: UnplacedMatch[] = partial ? [...partial.unplaced].map(([m, reason]) => ({ matchId: ctx.matches[m]!.id, reason })) : [];
  const lockedProblems = partial ? [...partial.unplaced].filter(([m]) => ctx.locked.has(m)).map(([m]) => ctx.matches[m]!.id) : [];
  const proof: string[] = feasibility.checks.filter((c) => !c.passed).map((c) => c.message);
  ctx.matches.forEach((match, i) => {
    if (ctx.allowedCourts[i]!.every((court) => ctx.startRanges(i, court).length === 0)) {
      proof.push(`${match.id} has no court and start time that satisfy court availability, division windows and the mandatory instructions`);
    }
  });

  if (!partial) {
    return {
      kind: "verification_failed",
      statement: "Schedules were constructed, but every candidate was rejected by the independent validators, so none is returned. The violations are in `rejected`. This is not a proof that no schedule exists.",
      proof,
      unplaced,
      feasibility,
      lockedProblems,
    };
  }
  if (proof.length === 0 && lockedProblems.length > 0) {
    return {
      kind: "contradictory_instructions",
      statement: `The locked placements of ${lockedProblems.join(", ")} contradict the tournament rules or other instructions. Move or remove the locks.`,
      proof,
      unplaced,
      feasibility,
      lockedProblems,
    };
  }
  if (proof.length > 0) {
    return {
      kind: "proven_infeasible",
      statement: `No schedule exists: at least one necessary condition fails. This is a proof, not a search outcome. Each failed condition is listed in \`proof\`, with the remedies in \`feasibility\`.${lockedProblems.length > 0 ? ` Locked placements of ${lockedProblems.join(", ")} also conflict with the rules.` : ""}`,
      proof,
      unplaced,
      feasibility,
      lockedProblems,
    };
  }
  return {
    kind: "not_found",
    statement:
      "No schedule was found. The construction heuristics, including any randomised retries the time budget allowed, did not place every match. This is NOT a proof that no schedule exists: relaxing mandatory windows or court rules, adding court time or day length, or raising the budget may succeed.",
    proof: [],
    unplaced,
    feasibility,
    lockedProblems,
  };
}

/**
 * Fastest Finish should not finish later than another returned option. If it does, continue from the
 * earliest-finishing option's schedule under Fastest Finish weights. Returns a disclosure when that fails.
 */
function ensureEarliestFinish(
  ctx: PlanContext,
  verified: readonly Candidate[],
  budget: { iterations: number; clock: () => number; hardDeadline: number | undefined; seed: number },
  isValid: (state: PlacementState) => boolean,
): { replacement?: Candidate; exception?: string } {
  const fastest = verified.find((c) => c.strategy.id === "fastest_finish");
  if (!fastest) return {};
  const earliest = verified.reduce((best, c) => (c.metrics.finishMinute < best.metrics.finishMinute ? c : best), fastest);
  if (earliest.metrics.finishMinute >= fastest.metrics.finishMinute) return {};

  const strategy = STRATEGIES.fastest_finish;
  const remaining = budget.hardDeadline === undefined ? undefined : Math.max(0, budget.hardDeadline - budget.clock());
  const gapMinutes = Math.round(fastest.metrics.finishMinute - earliest.metrics.finishMinute);
  if (remaining === 0) {
    return { exception: `Fastest Finish finishes ${gapMinutes} minutes later than ${earliest.strategy.name}, and the time budget was used up before the continuation search could run.` };
  }
  const result = localSearch(ctx, earliest.state, {
    weights: amplified(strategy, [], 1),
    random: createRandom(budget.seed * 104729 + 7),
    maxIterations: budget.iterations,
    ...(remaining === undefined ? {} : { deadline: budget.clock() + remaining / 2 }),
    clock: budget.clock,
  });
  // Accept only a genuinely different schedule: a mere copy of the other option would undo the distinctness work.
  const copiesEarliest = assignmentDistance(result.state, earliest.state) === 0;
  if (!copiesEarliest && isValid(result.state) && result.metrics.finishMinute <= earliest.metrics.finishMinute) {
    return {
      replacement: {
        strategy,
        state: result.state,
        metrics: result.metrics,
        cost: objectiveCost(result.metrics, strategy.weights),
        search: result,
        attempts: fastest.attempts,
        budgetExhausted: result.stopReason === "time",
      },
    };
  }
  return {
    exception: `Fastest Finish finishes ${gapMinutes} minutes later than ${earliest.strategy.name}. A continuation search from that schedule under Fastest Finish weights could not reach its finish with a schedule of its own, so Fastest Finish does not hold the earliest finish in this result.`,
  };
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
      stopReason: c.fallback ? "fallback_baseline" : (c.search?.stopReason ?? "converged"),
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
  requested: number,
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
  if (ordered.length < requested) {
    explanation.push(
      `Only ${ordered.length} of ${requested} requested options could be produced${rejectedCount > 0 ? " (some candidates failed independent validation and were discarded)" : ""}.`,
    );
  }
  if (equivalent.length > 0) {
    for (const e of equivalent) {
      const name = (id: StrategyId) => STRATEGIES[id].name;
      const rel = relations.find((r) => (r.a === e.equivalentTo && r.b === e.strategy) || (r.b === e.equivalentTo && r.a === e.strategy))!;
      const cause =
        rel.assignmentDistance < thresholds.minAssignmentDistance
          ? `only ${(rel.assignmentDistance * 100).toFixed(0)}% of matches are placed differently, below the ${(thresholds.minAssignmentDistance * 100).toFixed(0)}% minimum`
          : `${(rel.assignmentDistance * 100).toFixed(0)}% of matches are placed differently but no headline measure differs beyond the thresholds`;
      explanation.push(`${name(e.strategy)} is materially equivalent to ${name(e.equivalentTo)} (${cause}).`);
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
    // Only a material difference can override the default: a dominance inside the equivalence thresholds is noise.
    const dominatedBy = comparison.relations.find(
      (r) => r.materiallyDifferent && ((r.a === "balanced_operations" && r.dominance === "b_dominates") || (r.b === "balanced_operations" && r.dominance === "a_dominates")),
    );
    if (!dominatedBy) {
      const fast = ordered.find((c) => c.strategy.id === "fastest_finish");
      const detail = fast ? ` ${describeTradeOff(fast.strategy.name, fast.metrics, balanced.strategy.name, balanced.metrics, materialDifferences(fast.metrics, balanced.metrics))}` : "";
      const equivalent = comparison.equivalent.length > 0 ? " Some options are materially equivalent to each other (see the comparison), so the choice makes little practical difference." : "";
      return { strategy: "balanced_operations", reason: `Balanced Operations is the default recommendation.${detail}${equivalent}` };
    }
    const better = dominatedBy.a === "balanced_operations" ? dominatedBy.b : dominatedBy.a;
    return { strategy: better, reason: `${name(better)} is at least as good as Balanced Operations on every measured objective and strictly better on at least one, so it is recommended instead.` };
  }
  if (ordered.length === 1) {
    const only = ordered[0]!;
    return { strategy: only.strategy.id, reason: `${only.strategy.name} is the only option that could be produced.` };
  }
  const undominated = ordered.filter((c) => !comparison.relations.some((r) =>
    (r.a === c.strategy.id && r.dominance === "b_dominates") || (r.b === c.strategy.id && r.dominance === "a_dominates")));
  if (undominated.length === 1) {
    const best = undominated[0]!;
    return { strategy: best.strategy.id, reason: `Balanced Operations is not among the options; ${best.strategy.name} is at least as good as every other option on every measured objective.` };
  }
  return null;
}

