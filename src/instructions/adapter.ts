import type { Id, TournamentConfig } from "../config/types.js";
import type { Inventory } from "../inventory/types.js";
import type { Schedule } from "../schedule/types.js";
import { validateSchedule, type ValidationOptions, type ValidationReport } from "../validation/validateSchedule.js";
import { err, ok, type Result } from "../util/result.js";
import { formatClock } from "../util/time.js";
import { checkInstructions, type InstructionViolation } from "./check.js";
import { compileInstructions } from "./compile.js";
import { validateInstructions } from "./validate.js";
import type { InstructionIssue, MatchSelector, SchedulingInstruction, TimeBound } from "./types.js";

/**
 * Adapter boundary for future instruction sources (a natural-language
 * interpreter, a form, an import). The engine defines the contract and never
 * calls an LLM itself. An adapter proposes structured instructions; the
 * caller shows them to the organizer, and only `acceptProposal` output may
 * reach the optimizer, so an interpreter can never inject an invalid or
 * unreviewed rule.
 */

/** The vocabulary an interpreter may resolve names against. Contains IDs and display names only. */
export interface InstructionVocabulary {
  tournamentId: Id;
  days: string[];
  courts: { id: Id; name: string; tags: string[] }[];
  categories: { id: Id; name: string }[];
  divisions: { id: Id; name: string; categoryId: Id; skillLevel?: string; ageGroup?: string; stageIds: Id[] }[];
}

export function buildVocabulary(config: TournamentConfig): InstructionVocabulary {
  return {
    tournamentId: config.id,
    days: [...config.days],
    courts: config.courts.map((c) => ({ id: c.id, name: c.name, tags: [...(c.tags ?? [])] })),
    categories: config.categories.map((c) => ({ id: c.id, name: c.name })),
    divisions: config.divisions.map((d) => ({
      id: d.id,
      name: d.name,
      categoryId: d.categoryId,
      ...(d.skillLevel !== undefined ? { skillLevel: d.skillLevel } : {}),
      ...(d.ageGroup !== undefined ? { ageGroup: d.ageGroup } : {}),
      stageIds: d.stages.map((s) => s.id),
    })),
  };
}

/** What an interpreter returns: structured instructions plus whatever it could not understand. */
export interface InstructionProposal {
  instructions: SchedulingInstruction[];
  /** Source phrases the interpreter could not turn into instructions, with the reason. */
  unresolved: { text: string; reason: string }[];
}

/** Implemented outside this package (for example by an LLM-backed service). */
export interface InstructionAdapter {
  interpret(text: string, vocabulary: InstructionVocabulary): InstructionProposal | Promise<InstructionProposal>;
}

export interface AcceptedProposal {
  instructions: SchedulingInstruction[];
  /** Deterministic plain-language rendering, for the organizer to confirm. */
  descriptions: { instructionId: Id; text: string }[];
  warnings: InstructionIssue[];
  unresolved: { text: string; reason: string }[];
}

/** Validates a proposal. Fails with every issue if any instruction is invalid. */
export function acceptProposal(inventory: Inventory, proposal: InstructionProposal): Result<AcceptedProposal, InstructionIssue[]> {
  const result = validateInstructions(inventory, proposal.instructions);
  if (!result.ok) return err(result.issues);
  return ok({
    instructions: proposal.instructions,
    descriptions: proposal.instructions.map((i) => ({ instructionId: i.id, text: describeInstruction(i, inventory.config) })),
    warnings: result.issues.filter((i) => i.severity === "warning"),
    unresolved: proposal.unresolved,
  });
}

/** Deterministic plain-language description of an instruction. */
export function describeInstruction(i: SchedulingInstruction, config: TournamentConfig): string {
  const courtName = (id: Id) => config.courts.find((c) => c.id === id)?.name ?? id;
  const divisionName = (id: Id) => config.divisions.find((d) => d.id === id)?.name ?? id;
  const courts = (ids: readonly Id[]) => ids.map(courtName).join(", ");
  const divisions = (ids: readonly Id[]) => ids.map(divisionName).join(", ");
  const bound = (b: TimeBound) => `${formatClock(b.minute)}${b.day ? ` on ${b.day}` : " each day"}`;
  const strength = i.strength === "mandatory" ? "Must" : `Should (weight ${i.weight})`;
  const target = (s: MatchSelector) => describeSelector(s, divisionName);

  switch (i.kind) {
    case "time_window": {
      const parts: string[] = [];
      if (i.earliestStart) parts.push(`start no earlier than ${bound(i.earliestStart)}`);
      if (i.latestStart) parts.push(`start no later than ${bound(i.latestStart)}`);
      if (i.latestEnd) parts.push(`finish by ${bound(i.latestEnd)}`);
      return `${strength}: ${target(i.selector)} ${parts.join(" and ")}.`;
    }
    case "court_allowlist":
      return `${strength}: ${target(i.selector)} be played only on ${courts(i.courtIds)}.`;
    case "court_reservation":
      return `${strength}: ${courts(i.courtIds)} be kept free for ${target(i.selector)}.`;
    case "court_blackout":
      return `${strength}: ${courts(i.courtIds)} host no matches on ${i.window.day} from ${formatClock(i.window.start)} to ${formatClock(i.window.end)}.`;
    case "min_rest":
      return `${strength}: players in ${divisions(i.divisionIds)} get at least ${i.minutes} minutes of rest between matches.`;
    case "locked_placement":
      return `${strength}: match ${i.matchId} be on ${courtName(i.courtId)} at ${formatClock(i.start)} on ${i.day}.`;
    case "consecutive_blocks":
      return `${strength}: ${divisions(i.divisionIds)} be played in consecutive blocks, in this order.`;
    case "same_day_preliminaries":
      return `${strength}: each team's preliminary matches in ${i.divisionIds ? divisions(i.divisionIds) : "every division"} stay on one day.`;
  }
}

function describeSelector(s: MatchSelector, divisionName: (id: Id) => string): string {
  const adjective = s.roles ? s.roles.join(" or ").replace(/_/g, " ") : s.phases ? s.phases.join(" or ") : "";
  const noun = adjective === "" ? "matches" : `${adjective} matches`;
  const scope: string[] = [];
  if (s.matchIds) scope.push(`${s.matchIds.join(", ")}`);
  if (s.divisionIds) scope.push(s.divisionIds.map(divisionName).join(" and "));
  if (s.categoryIds) scope.push(`categories ${s.categoryIds.join(", ")}`);
  if (s.stageIds) scope.push(`stages ${s.stageIds.join(", ")}`);
  if (scope.length > 0) return `${noun} of ${scope.join(", ")}`;
  return adjective === "" ? "all matches" : noun;
}

export interface InstructionAwareReport extends ValidationReport {
  instructionViolations: InstructionViolation[];
}

/**
 * Validates a schedule against the tournament rules and every mandatory
 * instruction. `valid` is true only when both validators pass. Use this for
 * manually edited schedules as well as optimizer output.
 */
export function validateScheduleWithInstructions(
  inventory: Inventory,
  schedule: Schedule,
  instructions: readonly SchedulingInstruction[],
  options: ValidationOptions = {},
): Result<InstructionAwareReport, InstructionIssue[]> {
  const compiled = compileInstructions(inventory, instructions);
  if (!compiled.ok) return err(compiled.error);
  const base = validateSchedule(compiled.value.inventory, schedule, {
    ...options,
    frozen: [...(options.frozen ?? []), ...compiled.value.locked],
  });
  const instructionViolations = checkInstructions(inventory, schedule, instructions);
  return ok({ valid: base.valid && instructionViolations.length === 0, violations: base.violations, instructionViolations });
}
