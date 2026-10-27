import type { Id } from "../config/types.js";
import type { Inventory, MatchId } from "../inventory/types.js";
import type { Schedule } from "../schedule/types.js";
import { Timeline } from "../schedule/timeline.js";
import { MINUTES_PER_DAY } from "../util/time.js";
import { SelectorIndex } from "./selector.js";
import { isMandatory, weightOf, type InstructionKind, type SchedulingInstruction, type TimeBound } from "./types.js";

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

export interface PreferenceMeasure {
  instructionId: Id;
  kind: InstructionKind;
  weight: number;
  /** How many things violate the preference (see `unit`). 0 means fully satisfied. */
  violated: number;
  unit: "matches" | "recoveries" | "minutes" | "teams";
  detail: string;
}

/**
 * Measures every preference instruction against a schedule, directly from its definition and independently of the
 * optimizer, so a report can say exactly which preferences are violated and by how much.
 */
export function measurePreferences(inventory: Inventory, schedule: Schedule, instructions: readonly SchedulingInstruction[]): PreferenceMeasure[] {
  const timeline = new Timeline(inventory.config);
  const selectors = new SelectorIndex(inventory);
  const rows = schedule.assignments
    .filter((a) => inventory.matchById.has(a.matchId) && timeline.hasDay(a.day))
    .map((a) => {
      const match = inventory.matchById.get(a.matchId)!;
      const start = timeline.absolute(a.day, a.start);
      return { a, match, start, end: start + match.durationMinutes, offset: Math.floor(start / MINUTES_PER_DAY) * MINUTES_PER_DAY };
    });
  const bound = (b: TimeBound, dayOffset: number) => (b.day !== undefined ? timeline.absolute(b.day, b.minute) : dayOffset + b.minute);
  const out: PreferenceMeasure[] = [];

  for (const i of instructions) {
    if (isMandatory(i)) continue;
    const base = { instructionId: i.id, kind: i.kind, weight: weightOf(i) };
    switch (i.kind) {
      case "time_window": {
        const bad = rows.filter(
          (r) =>
            selectors.matches(i.selector, r.match) &&
            ((i.earliestStart !== undefined && r.start < bound(i.earliestStart, r.offset)) ||
              (i.latestStart !== undefined && r.start > bound(i.latestStart, r.offset)) ||
              (i.latestEnd !== undefined && r.end > bound(i.latestEnd, r.offset))),
        );
        out.push({ ...base, violated: bad.length, unit: "matches", detail: `${bad.length} selected matches are outside the preferred window` });
        break;
      }
      case "court_allowlist": {
        const bad = rows.filter((r) => selectors.matches(i.selector, r.match) && !i.courtIds.includes(r.a.courtId));
        out.push({ ...base, violated: bad.length, unit: "matches", detail: `${bad.length} selected matches are off the preferred courts` });
        break;
      }
      case "court_reservation": {
        const bad = rows.filter((r) => !selectors.matches(i.selector, r.match) && i.courtIds.includes(r.a.courtId));
        out.push({ ...base, violated: bad.length, unit: "matches", detail: `${bad.length} other matches use the reserved courts` });
        break;
      }
      case "court_blackout": {
        const window = timeline.window(i.window);
        const minutes = rows
          .filter((r) => i.courtIds.includes(r.a.courtId))
          .reduce((s, r) => s + Math.max(0, Math.min(window.end, r.end) - Math.max(window.start, r.start)), 0);
        out.push({ ...base, violated: minutes, unit: "minutes", detail: `${minutes} match-minutes fall inside the preferred blackout` });
        break;
      }
      case "min_rest": {
        const divisions = new Set(i.divisionIds);
        const byTeam = new Map<string, typeof rows>();
        for (const r of rows) {
          if (!divisions.has(r.match.divisionId)) continue;
          for (const s of r.match.slots) if (s.type === "team") byTeam.set(s.teamId, [...(byTeam.get(s.teamId) ?? []), r]);
        }
        let short = 0;
        for (const list of byTeam.values()) {
          list.sort((x, y) => x.start - y.start);
          for (let k = 1; k < list.length; k++) if (list[k]!.start - list[k - 1]!.end < i.minutes) short++;
        }
        out.push({ ...base, violated: short, unit: "recoveries", detail: `${short} recoveries are shorter than ${i.minutes} minutes` });
        break;
      }
      case "consecutive_blocks": {
        const spans = i.divisionIds.map((id) => {
          const own = rows.filter((r) => r.match.divisionId === id);
          return { start: Math.min(...own.map((r) => r.start)), end: Math.max(...own.map((r) => r.end)) };
        });
        let overlap = 0;
        for (let x = 0; x < spans.length; x++) {
          for (let y = x + 1; y < spans.length; y++) overlap += Math.max(0, Math.min(spans[x]!.end, spans[y]!.end) - Math.max(spans[x]!.start, spans[y]!.start));
        }
        out.push({ ...base, violated: overlap, unit: "minutes", detail: `the divisions' time spans overlap by ${overlap} minutes` });
        break;
      }
      case "same_day_preliminaries": {
        const divisions = i.divisionIds ? new Set(i.divisionIds) : null;
        const days = new Map<string, Set<number>>();
        for (const r of rows) {
          if (r.match.phase !== "group" || (divisions && !divisions.has(r.match.divisionId))) continue;
          for (const s of r.match.slots) if (s.type === "team") days.set(s.teamId, (days.get(s.teamId) ?? new Set<number>()).add(Math.floor(r.start / MINUTES_PER_DAY)));
        }
        const split = [...days.values()].filter((set) => set.size > 1).length;
        out.push({ ...base, violated: split, unit: "teams", detail: `${split} teams play their preliminary matches on more than one day` });
        break;
      }
      case "locked_placement":
        break;
    }
  }
  return out;
}
