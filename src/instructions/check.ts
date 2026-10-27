import type { Id } from "../config/types.js";
import type { Inventory, MatchId } from "../inventory/types.js";
import type { Schedule } from "../schedule/types.js";
import { Timeline } from "../schedule/timeline.js";
import { MINUTES_PER_DAY } from "../util/time.js";
import { SelectorIndex } from "./selector.js";
import { isMandatory, type SchedulingInstruction, type TimeBound } from "./types.js";

export type InstructionViolationCode =
  | "INSTRUCTION_TIME_WINDOW"
  | "INSTRUCTION_COURT_NOT_ALLOWED"
  | "INSTRUCTION_COURT_RESERVED"
  | "INSTRUCTION_COURT_BLACKOUT"
  | "INSTRUCTION_LOCK_MOVED";

export interface InstructionViolation {
  code: InstructionViolationCode;
  instructionId: Id;
  matchIds: MatchId[];
  message: string;
}

/**
 * Independent check of mandatory instructions against a schedule.
 *
 * It evaluates each instruction directly from its definition and shares no
 * code with `compileInstructions`, so a compiler bug cannot hide a violation.
 * Mandatory minimum rest is enforced by `validateSchedule` on the compiled
 * inventory (see `validateScheduleWithInstructions`), not here. Assignments
 * that reference unknown matches or days are ignored: `validateSchedule`
 * reports those.
 */
export function checkInstructions(inventory: Inventory, schedule: Schedule, instructions: readonly SchedulingInstruction[]): InstructionViolation[] {
  const timeline = new Timeline(inventory.config);
  const selectors = new SelectorIndex(inventory);
  const violations: InstructionViolation[] = [];
  const bound = (b: TimeBound, dayOffset: number) => (b.day !== undefined ? timeline.absolute(b.day, b.minute) : dayOffset + b.minute);

  for (const a of schedule.assignments) {
    const match = inventory.matchById.get(a.matchId);
    if (!match || !timeline.hasDay(a.day)) continue;
    const start = timeline.absolute(a.day, a.start);
    const end = start + match.durationMinutes;
    const offset = Math.floor(start / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    const label = `${match.divisionId} ${match.label}`;

    for (const i of instructions) {
      if (!isMandatory(i)) continue;
      if (i.kind === "time_window" && selectors.matches(i.selector, match)) {
        const problems: string[] = [];
        if (i.earliestStart && start < bound(i.earliestStart, offset)) problems.push("starts before the earliest allowed start");
        if (i.latestStart && start > bound(i.latestStart, offset)) problems.push("starts after the latest allowed start");
        if (i.latestEnd && end > bound(i.latestEnd, offset)) problems.push("ends after the latest allowed end");
        if (problems.length > 0) {
          violations.push({ code: "INSTRUCTION_TIME_WINDOW", instructionId: i.id, matchIds: [match.id], message: `${label} ${problems.join(" and ")} (${i.id})` });
        }
      } else if (i.kind === "court_allowlist" && selectors.matches(i.selector, match) && !i.courtIds.includes(a.courtId)) {
        violations.push({ code: "INSTRUCTION_COURT_NOT_ALLOWED", instructionId: i.id, matchIds: [match.id], message: `${label} is on ${a.courtId}, which is not in its allowed courts (${i.id})` });
      } else if (i.kind === "court_reservation" && !selectors.matches(i.selector, match) && i.courtIds.includes(a.courtId)) {
        violations.push({ code: "INSTRUCTION_COURT_RESERVED", instructionId: i.id, matchIds: [match.id], message: `${label} uses ${a.courtId}, which is reserved for other matches (${i.id})` });
      } else if (i.kind === "court_blackout" && i.courtIds.includes(a.courtId)) {
        const window = timeline.window(i.window);
        if (start < window.end && window.start < end) {
          violations.push({ code: "INSTRUCTION_COURT_BLACKOUT", instructionId: i.id, matchIds: [match.id], message: `${label} overlaps the blackout of ${a.courtId} (${i.id})` });
        }
      }
    }
  }

  for (const i of instructions) {
    if (i.kind !== "locked_placement" || !isMandatory(i)) continue;
    const a = schedule.assignments.find((x) => x.matchId === i.matchId);
    if (!a || a.courtId !== i.courtId || a.day !== i.day || a.start !== i.start) {
      violations.push({ code: "INSTRUCTION_LOCK_MOVED", instructionId: i.id, matchIds: [i.matchId], message: `Locked match ${i.matchId} is not at its locked court and time (${i.id})` });
    }
  }
  return violations;
}
