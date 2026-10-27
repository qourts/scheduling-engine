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
