/**
 * Pure engine calls. This file and ./worker.ts are the only places the UI touches the scheduling engine.
 * It must stay free of DOM and React so it can later run on a server (see runner.ts).
 */
import {
  acceptProposal,
  analyzeFeasibility,
  analyzeSchedule,
  buildInventory,
  buildVocabulary,
  describeInstruction,
  describeTimeAllocation,
  optimizeSchedules,
  validateConfig,
  validateInstructions,
  validateScheduleWithInstructions,
  type Assignment,
  type ConfigIssue,
  type FeasibilityReport,
  type InstructionIssue,
  type InstructionProposal,
  type InstructionVocabulary,
  type InstructionViolation,
  type Inventory,
  type OptimizeResult,
  type Schedule,
  type ScheduleReport,
  type SchedulingInstruction,
  type TimeAllocation,
  type TournamentConfig,
  type Violation,
} from "@engine";
import { inspect, kindOf, medalMatchIds, slotShort, type MatchDetail, type MatchKind } from "./inspect.js";

export type { MatchDetail } from "./inspect.js";

export interface PrepareResult {
  valid: boolean;
  issues: ConfigIssue[];
  matchCount: number;
  feasibility: FeasibilityReport | null;
  timeAllocation: TimeAllocation[];
  vocabulary: InstructionVocabulary | null;
}

export interface GenerateResult {
  result: OptimizeResult;
  reports: Record<string, ScheduleReport>;
}

export interface CheckResult {
  valid: boolean;
  violations: Violation[];
  instructionViolations: InstructionViolation[];
  instructionIssues: InstructionIssue[];
  report: ScheduleReport | null;
}

export interface InterpretCheck {
  ok: boolean;
  issues: InstructionIssue[];
  descriptions: { instructionId: string; text: string }[];
  warnings: InstructionIssue[];
}

export interface MatchInfo {
  id: string;
  /** Presentation class: preliminary, other knockout, or medal (final and third place). */
  kind: MatchKind;
  categoryId: string;
  /** Short description of each side: a team name or a qualification placeholder. */
  sides: [string, string];
  divisionId: string;
  label: string;
  phase: string;
  durationMinutes: number;
  thirdPlace: boolean;
  roundLabel: string;
}

let cache: { key: string; inventory: Inventory } | null = null;

/** Inventory for a config, memoised on its serialised form. */
export function inventoryFor(config: TournamentConfig): Inventory {
  const key = JSON.stringify(config);
  if (cache && cache.key === key) return cache.inventory;
  const inventory = buildInventory(config);
  cache = { key, inventory };
  return inventory;
}

export function prepare(config: TournamentConfig): PrepareResult {
  const validation = validateConfig(config);
  if (!validation.valid) return { valid: false, issues: validation.issues, matchCount: 0, feasibility: null, timeAllocation: [], vocabulary: null };
  const inventory = inventoryFor(config);
  return {
    valid: true,
    issues: validation.issues,
    matchCount: inventory.matches.length,
    feasibility: analyzeFeasibility(inventory),
    timeAllocation: describeTimeAllocation(config),
    vocabulary: buildVocabulary(config),
  };
}

export function generate(config: TournamentConfig, instructions: SchedulingInstruction[], seed: number, budgetMs: number): GenerateResult {
  const inventory = inventoryFor(config);
  const result = optimizeSchedules(inventory, { seed, instructions, budget: { totalMs: budgetMs } });
  const reports: Record<string, ScheduleReport> = {};
  for (const o of result.options) reports[o.strategy] = analyzeSchedule(inventory, o.schedule);
  return { result, reports };
}

/** The single validity decision for any schedule: hard rules, mandatory instructions and locked matches. */
export function check(config: TournamentConfig, schedule: Schedule, instructions: SchedulingInstruction[], locked: Assignment[], withReport: boolean): CheckResult {
  const inventory = inventoryFor(config);
  const r = validateScheduleWithInstructions(inventory, schedule, instructions, { frozen: locked });
  if (!r.ok) return { valid: false, violations: [], instructionViolations: [], instructionIssues: r.error, report: null };
  const { valid, violations, instructionViolations } = r.value;
  return { valid, violations, instructionViolations, instructionIssues: [], report: withReport ? analyzeSchedule(inventory, schedule) : null };
}

export function checkInstructionProposal(config: TournamentConfig, proposal: InstructionProposal): InterpretCheck {
  const accepted = acceptProposal(inventoryFor(config), proposal);
  if (!accepted.ok) return { ok: false, issues: accepted.error, descriptions: [], warnings: [] };
  return { ok: true, issues: [], descriptions: accepted.value.descriptions, warnings: accepted.value.warnings };
}

export function validateRules(config: TournamentConfig, instructions: SchedulingInstruction[]): InstructionIssue[] {
  return validateInstructions(inventoryFor(config), instructions).issues;
}

export function describe(config: TournamentConfig, instruction: SchedulingInstruction): string {
  return describeInstruction(instruction, config);
}

export function inspectMatch(config: TournamentConfig, schedule: Schedule, matchId: string): MatchDetail | null {
  return inspect(inventoryFor(config), config, schedule, matchId);
}

export function matchInfo(config: TournamentConfig): MatchInfo[] {
  const inventory = inventoryFor(config);
  const medals = medalMatchIds(inventory);
  const categoryOf = new Map(config.divisions.map((d) => [d.id, d.categoryId]));
  return inventory.matches.map((m) => ({
    id: m.id,
    kind: kindOf(m, medals),
    categoryId: categoryOf.get(m.divisionId) ?? "",
    sides: [slotShort(inventory, m.slots[0]), slotShort(inventory, m.slots[1])],
    divisionId: m.divisionId,
    label: m.label,
    phase: m.phase,
    durationMinutes: m.durationMinutes,
    thirdPlace: m.thirdPlace === true,
    roundLabel: m.roundLabel,
  }));
}
