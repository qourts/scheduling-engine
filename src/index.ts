export * from "./config/types.js";
export { validateConfig, assertValidConfig, InvalidConfigError, type ConfigIssue, type ConfigValidationResult, type IssueSeverity } from "./config/validate.js";

export { roundRobinPairings, roundRobinMatchCount, roundRobinRoundCount, type Pairing } from "./competition/roundRobin.js";
export { planKnockout, seedLineOrder, nextPowerOfTwo, earliestMeetingRound, knockoutRoundLabel, type KnockoutPlan, type PlannedMatch, type Feed } from "./competition/knockout.js";
export { allocateGroups, orderBySeed, groupLabel } from "./competition/groups.js";
export { crossoverSeeds, type CrossoverResult, type QualifierToken } from "./competition/crossover.js";

export * from "./inventory/types.js";
export { buildInventory } from "./inventory/build.js";
export { buildDependencyGraph, areOrdered, descendantsOf, DependencyCycleError, type DependencyGraph } from "./inventory/graph.js";
export { ParticipantModel, type Resolution } from "./inventory/participants.js";

export * from "./progression/types.js";
export { initialState, applyEvent, replay, auditTrail, checkScore } from "./progression/state.js";
export { computeGroupStandings } from "./progression/standings.js";

export * from "./schedule/types.js";
export { Timeline } from "./schedule/timeline.js";
export { validateSchedule, type Violation, type ViolationCode, type ValidationOptions, type ValidationReport } from "./validation/validateSchedule.js";

export {
  analyzeFeasibility,
  slotCapacity,
  earliestFit,
  type FeasibilityReport,
  type FeasibilityCheck,
  type FeasibilityCheckKind,
  type Remedy,
  type RemedyKind,
  type DivisionEstimate,
} from "./feasibility/analyze.js";

export { parseClock, formatClock, type Interval } from "./util/time.js";
export type { Result } from "./util/result.js";

export * from "./instructions/types.js";
export { validateInstructions } from "./instructions/validate.js";
export { compileInstructions, timeWindowStartRanges, type CompiledConstraints, type MatchLimits, type LocalPreference } from "./instructions/compile.js";
export { checkInstructions, type InstructionViolation, type InstructionViolationCode } from "./instructions/check.js";
export { SelectorIndex, matchRoles } from "./instructions/selector.js";
export {
  acceptProposal,
  buildVocabulary,
  describeInstruction,
  validateScheduleWithInstructions,
  type AcceptedProposal,
  type InstructionAdapter,
  type InstructionAwareReport,
  type InstructionProposal,
  type InstructionVocabulary,
} from "./instructions/adapter.js";

export { optimizeSchedules } from "./optimizer/optimize.js";
export type {
  Comparison,
  OptimizeBudget,
  OptimizeDiagnostics,
  OptimizeOptions,
  OptimizeResult,
  OptimizeStatus,
  OptionRelation,
  Recommendation,
  ScheduleOption,
  UnplacedMatch,
} from "./optimizer/types.js";
export { STRATEGIES, STRATEGY_ORDER, type Strategy, type StrategyId } from "./optimizer/strategies.js";
export { computeMetrics, type ScheduleMetrics, type Weights } from "./optimizer/metrics.js";
export { assignmentDistance, dominance, materialDifferences, DEFAULT_THRESHOLDS, type DistinctnessThresholds, type Headline, type Dominance } from "./optimizer/compare.js";
