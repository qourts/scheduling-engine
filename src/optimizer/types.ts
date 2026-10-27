import type { Id } from "../config/types.js";
import type { FeasibilityReport } from "../feasibility/analyze.js";
import type { InstructionIssue, SchedulingInstruction } from "../instructions/types.js";
import type { MatchId } from "../inventory/types.js";
import type { Schedule } from "../schedule/types.js";
import type { Violation } from "../validation/validateSchedule.js";
import type { InstructionViolation } from "../instructions/check.js";
import type { Dominance, DistinctnessThresholds, Headline } from "./compare.js";
import type { ContextOptions } from "./context.js";
import type { ScheduleMetrics } from "./metrics.js";
import type { StopReason } from "./search.js";
import type { StrategyId } from "./strategies.js";

export interface OptimizeBudget {
  /**
   * Wall-clock cap for the whole run, in milliseconds. Results are only
   * bit-for-bit reproducible when no cap is hit (set `iterationsPerStrategy`
   * and leave this unset for fully deterministic runs).
   * Default: 8000 up to 300 matches, 24000 above (engineering targets of 10 s
   * and 30 s for generating and evaluating all three options).
   */
  totalMs?: number;
  /** Local-search moves per strategy. Default 30000. */
  iterationsPerStrategy?: number;
}

export interface OptimizeOptions extends ContextOptions {
  /** Seed for every random choice. Default 1. */
  seed?: number;
  /** Mandatory constraints and weighted preferences (see `SchedulingInstruction`). */
  instructions?: readonly SchedulingInstruction[];
  budget?: OptimizeBudget;
  /** Which strategies to run. Default: all three. */
  strategies?: readonly StrategyId[];
  /** How many times to try to make an equivalent option materially different. Default 2. */
  diversityAttempts?: number;
  distinctness?: Partial<DistinctnessThresholds>;
  /** Millisecond clock; inject one in tests. Default `performance.now`. */
  clock?: () => number;
}

export interface ScheduleOption {
  strategy: StrategyId;
  label: "A" | "B" | "C";
  name: string;
  summary: string;
  schedule: Schedule;
  metrics: ScheduleMetrics;
  /** Weighted objective value under this strategy's own weights (lower is better; only comparable within one strategy). */
  cost: number;
  /** The option passed `validateSchedule` and the mandatory-instruction checker. Options that did not are never returned. */
  validated: true;
  /**
   * `fallback_baseline` means local search produced a schedule that failed independent
   * verification, so the verified construction baseline is returned instead (and the
   * discarded candidate is listed in `rejected`). `iterations` is then 0.
   */
  search: { iterations: number; stopReason: StopReason | "fallback_baseline"; diversificationAttempts: number };
  /** True when the time budget ended the search; the schedule is valid but may be improvable. */
  budgetExhausted: boolean;
}

export interface OptionRelation {
  a: StrategyId;
  b: StrategyId;
  /** Fraction of matches placed differently. */
  assignmentDistance: number;
  identical: boolean;
  materiallyDifferent: boolean;
  differsOn: Headline[];
  dominance: Dominance;
  /** Measurement-based description of how b differs from a. */
  summary: string;
}

export interface Comparison {
  relations: OptionRelation[];
  /** Strategies whose option is materially equivalent to another. Empty when all options are distinct. */
  equivalent: { strategy: StrategyId; equivalentTo: StrategyId }[];
  /** Why distinct options could not be produced, when that is the case. Never claims optimality. */
  explanation: string[];
}

export interface Recommendation {
  strategy: StrategyId;
  reason: string;
}

export interface UnplacedMatch {
  matchId: MatchId;
  reason: string;
}

export interface OptimizeDiagnostics {
  seed: number;
  elapsedMs: number;
  matchCount: number;
  courtCount: number;
  granularityMinutes: number;
  /** Optimistic lower bound on the absolute finish minute (ignores court contention, rest and availability gaps). */
  finishLowerBoundMinute: number;
  /** Minutes between the best finish found and the optimistic lower bound. Not a measure of distance to the optimum. */
  finishGapToLowerBound: number | null;
  warnings: InstructionIssue[];
  /** Milliseconds by which the run exceeded `budget.totalMs` (construction and verification are not interruptible). 0 when within budget. */
  budgetOverrunMs: number;
  /** Wall-clock time per phase, in milliseconds. Construction and verification are not covered by the search time cap. */
  timing: { constructionMs: number; searchMs: number; diversificationMs: number; verificationMs: number; totalMs: number };
  /** True when the time budget ended any search early: the options are valid but may be improvable. */
  timeLimited: boolean;
  /** How each strategy's starting schedule was constructed (see `ConstructionMethod`). */
  construction: Partial<Record<StrategyId, ConstructionMethod>>;
}

/**
 * Which construction attempt produced a strategy's starting schedule.
 * `strategy_weights` is the normal path; the others are bounded fallbacks that
 * exist because greedy construction can fail on tight events.
 */
export type ConstructionMethod = "strategy_weights" | "fastest_finish_weights" | "randomized_retry";

/**
 * Why no schedule was returned. The kinds are deliberately distinct:
 * - `proven_infeasible`: a necessary condition fails, so no schedule exists (a proof).
 * - `contradictory_instructions`: locked placements contradict each other or other rules.
 * - `not_found`: the heuristics did not place every match. This is NOT a proof of impossibility.
 */
export interface FailureReport {
  kind: "proven_infeasible" | "contradictory_instructions" | "not_found";
  /** Plain-language statement of what is and is not established. */
  statement: string;
  /** The failed necessary conditions behind a `proven_infeasible` result; empty otherwise. */
  proof: string[];
  unplaced: UnplacedMatch[];
  feasibility: FeasibilityReport;
  lockedProblems: Id[];
}

export type OptimizeStatus = "ok" | "no_schedule" | "invalid_instructions" | "invalid_options";

export interface OptimizeResult {
  status: OptimizeStatus;
  /** Valid, distinct-as-far-as-found options, in A, B, C order. May be shorter than three; see `comparison`. */
  options: ScheduleOption[];
  recommended: Recommendation | null;
  comparison: Comparison;
  diagnostics: OptimizeDiagnostics;
  /** Present when `status` is "no_schedule": what could not be placed, and the feasibility analysis. */
  failure?: FailureReport;
  /** Present when `status` is "invalid_options": every problem found in the options. */
  optionIssues?: string[];
  /** Present when `status` is "invalid_instructions". */
  instructionIssues?: InstructionIssue[];
  /** Set when an internal consistency check rejected a candidate; should never happen. */
  rejected?: { strategy: StrategyId; violations: Violation[]; instructionViolations: InstructionViolation[] }[];
}
