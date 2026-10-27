import type { Id } from "../config/types.js";
import type { Inventory } from "../inventory/types.js";
import { Timeline } from "../schedule/timeline.js";
import { formatClock, isIsoDate, MINUTES_PER_DAY } from "../util/time.js";
import { SelectorIndex } from "./selector.js";
import {
  isMandatory,
  type InstructionIssue,
  type InstructionIssueCode,
  type InstructionIssueSeverity,
  type InstructionValidationResult,
  type MatchSelector,
  type SchedulingInstruction,
  type TimeBound,
} from "./types.js";

/** Upper bound on a preference weight; larger values would overflow the objective to Infinity. */
const MAX_WEIGHT = 1_000_000;
const PHASES = new Set(["group", "knockout"]);
const MATCH_ROLES = new Set(["final", "third_place", "medal", "semifinal", "quarterfinal"]);

/**
 * Validates structured instructions against a tournament. Never throws and
 * never mutates its input: problems come back as structured issues so that a
 * UI or a natural-language adapter can show them. Instructions with an
 * error-severity issue must not be handed to the optimizer.
 */
export function validateInstructions(inventory: Inventory, instructions: readonly SchedulingInstruction[]): InstructionValidationResult {
  const { config } = inventory;
  const issues: InstructionIssue[] = [];
  const selectors = new SelectorIndex(inventory);
  const divisions = new Map(config.divisions.map((d) => [d.id, d]));
  const categories = new Set(config.categories.map((c) => c.id));
  const courts = new Set(config.courts.map((c) => c.id));
  const stageIds = new Set(config.divisions.flatMap((d) => d.stages.map((s) => s.id)));
  const days = new Set(config.days);
  const seen = new Set<Id>();
  const locks = new Map<string, Id>();

  const add = (severity: InstructionIssueSeverity, code: InstructionIssueCode, instructionId: Id | null, message: string) =>
    issues.push({ severity, code, instructionId, message });
  const error = (code: InstructionIssueCode, id: Id | null, message: string) => add("error", code, id, message);

  const checkBound = (id: Id, label: string, bound: TimeBound | undefined) => {
    if (!bound) return;
    if (!Number.isInteger(bound.minute) || bound.minute < 0 || bound.minute > 1440) {
      error("INVALID_TIME", id, `${label}: minute ${bound.minute} must be an integer from 0 to 1440`);
    }
    if (bound.day !== undefined && !days.has(bound.day)) error("UNKNOWN_DAY", id, `${label}: ${bound.day} is not a tournament day`);
  };
  const checkCourts = (id: Id, courtIds: readonly Id[]) => {
    if (courtIds.length === 0) error("EMPTY_LIST", id, "courtIds must not be empty");
    for (const c of courtIds) if (!courts.has(c)) error("UNKNOWN_COURT", id, `Unknown court ${c}`);
  };
  const checkDivisions = (id: Id, divisionIds: readonly Id[]) => {
    if (divisionIds.length === 0) error("EMPTY_LIST", id, "divisionIds must not be empty");
    for (const d of divisionIds) if (!divisions.has(d)) error("UNKNOWN_DIVISION", id, `Unknown division ${d}`);
  };
  const checkSelector = (id: Id, selector: MatchSelector) => {
    const before = issues.length;
    for (const d of selector.divisionIds ?? []) if (!divisions.has(d)) error("UNKNOWN_DIVISION", id, `Unknown division ${d}`);
    for (const c of selector.categoryIds ?? []) if (!categories.has(c)) error("UNKNOWN_CATEGORY", id, `Unknown category ${c}`);
    for (const s of selector.stageIds ?? []) if (!stageIds.has(s)) error("UNKNOWN_STAGE", id, `Unknown stage ${s}`);
    for (const m of selector.matchIds ?? []) if (!inventory.matchById.has(m)) error("UNKNOWN_MATCH", id, `Unknown match ${m}`);
    for (const r of selector.roles ?? []) if (!MATCH_ROLES.has(r)) error("INVALID_VALUE", id, `Unknown match role ${r}`);
    for (const p of selector.phases ?? []) if (!PHASES.has(p)) error("INVALID_VALUE", id, `Unknown phase ${p} (use "group" or "knockout")`);
    for (const [field, list] of Object.entries(selector)) {
      if (Array.isArray(list) && list.length === 0) error("EMPTY_LIST", id, `selector.${field} must not be empty (omit it to select all)`);
    }
    if (issues.length === before && selectors.select(selector).length === 0) {
      add("warning", "EMPTY_SELECTION", id, "The selector matches no matches, so the instruction has no effect");
    }
  };

  for (const instruction of instructions) {
    if (instruction === null || typeof instruction !== "object") {
      error("INVALID_VALUE", null, "Every instruction must be an object");
      continue;
    }
    const id = instruction.id;
    if (typeof id !== "string" || id === "") {
      error("INVALID_VALUE", null, "Every instruction needs a non-empty id");
      continue;
    }
    if (seen.has(id)) error("DUPLICATE_ID", id, `Instruction id ${id} is used more than once`);
    seen.add(id);

    if (instruction.strength === "preference") {
      if (!Number.isFinite(instruction.weight) || instruction.weight <= 0 || instruction.weight > MAX_WEIGHT) {
        error("INVALID_WEIGHT", id, `A preference needs a finite weight greater than 0 and at most ${MAX_WEIGHT}`);
      }
    } else if (instruction.strength !== "mandatory") {
      error("INVALID_VALUE", id, 'strength must be "mandatory" or "preference"');
    }

    try {
    switch (instruction.kind) {
      case "time_window": {
        checkSelector(id, instruction.selector);
        checkBound(id, "earliestStart", instruction.earliestStart);
        checkBound(id, "latestStart", instruction.latestStart);
        checkBound(id, "latestEnd", instruction.latestEnd);
        const a = instruction.earliestStart;
        const b = instruction.latestStart;
        const c = instruction.latestEnd;
        if (!a && !b && !c) error("EMPTY_LIST", id, "time_window needs at least one of earliestStart, latestStart or latestEnd");
        const ordered = (x: TimeBound | undefined, y: TimeBound | undefined, what: string) => {
          if (!x || !y) return;
          const sameClock = x.day === y.day && x.minute > y.minute;
          const dayBackwards = x.day !== undefined && y.day !== undefined && x.day > y.day;
          if (sameClock || dayBackwards) error("CONTRADICTORY_BOUNDS", id, what);
        };
        ordered(a, b, "earliestStart is after latestStart");
        ordered(a, c, "earliestStart is after latestEnd");
        ordered(b, c, "latestStart is after latestEnd");
        break;
      }
      case "court_allowlist":
      case "court_reservation":
        checkSelector(id, instruction.selector);
        checkCourts(id, instruction.courtIds);
        break;
      case "court_blackout": {
        checkCourts(id, instruction.courtIds);
        const w = instruction.window;
        if (!days.has(w.day)) error("UNKNOWN_DAY", id, `${w.day} is not a tournament day`);
        if (!Number.isInteger(w.start) || !Number.isInteger(w.end) || w.start < 0 || w.end > 1440 || w.start >= w.end) {
          error("INVALID_TIME", id, "window needs integer minutes with 0 <= start < end <= 1440");
        }
        break;
      }
      case "min_rest": {
        checkDivisions(id, instruction.divisionIds);
        if (!Number.isInteger(instruction.minutes) || instruction.minutes < 0) {
          error("INVALID_VALUE", id, "minutes must be a non-negative integer");
        } else if (isMandatory(instruction)) {
          for (const divisionId of instruction.divisionIds) {
            const division = divisions.get(divisionId);
            const current = division?.minRestMinutes ?? config.rules.minRestMinutes;
            if (division && instruction.minutes < current) {
              add("warning", "MIN_REST_LOWERED", id, `Lowers the minimum rest of ${divisionId} from ${current} to ${instruction.minutes} minutes`);
            }
          }
        }
        break;
      }
      case "locked_placement": {
        if (!inventory.matchById.has(instruction.matchId)) error("UNKNOWN_MATCH", id, `Unknown match ${instruction.matchId}`);
        if (!courts.has(instruction.courtId)) error("UNKNOWN_COURT", id, `Unknown court ${instruction.courtId}`);
        if (!isIsoDate(instruction.day) || !days.has(instruction.day)) error("UNKNOWN_DAY", id, `${instruction.day} is not a tournament day`);
        if (!Number.isInteger(instruction.start) || instruction.start < 0 || instruction.start >= 1440) {
          error("INVALID_TIME", id, "start must be an integer minute of the day");
        }
        if (!isMandatory(instruction)) {
          error("UNSUPPORTED_MANDATORY", id, "A locked placement is a hard fact; use a time_window or court_allowlist preference instead");
        }
        const earlier = locks.get(instruction.matchId);
        if (earlier) error("CONFLICTING_LOCKS", id, `Match ${instruction.matchId} is already locked by ${earlier}`);
        locks.set(instruction.matchId, id);
        break;
      }
      case "consecutive_blocks":
        checkDivisions(id, instruction.divisionIds);
        if (new Set(instruction.divisionIds).size !== instruction.divisionIds.length) error("INVALID_VALUE", id, "divisionIds must not repeat");
        if (instruction.divisionIds.length < 2) error("INVALID_VALUE", id, "consecutive_blocks needs at least two divisions");
        if (isMandatory(instruction)) {
          error("UNSUPPORTED_MANDATORY", id, "Consecutive blocks are supported as a preference only; a mandatory block rule is not implemented");
        }
        break;
      default: {
        const unknown = instruction as { id?: Id; kind?: string };
        error(
          "INVALID_VALUE",
          unknown.id ?? null,
          `Unsupported instruction kind "${unknown.kind}". It was not applied. Supported kinds: time_window, court_allowlist, court_reservation, court_blackout, min_rest, locked_placement, consecutive_blocks.`,
        );
      }
    }
    } catch {
      // Untrusted input (for example an adapter proposal) can be structurally malformed: report it, never throw.
      error("INVALID_VALUE", id, "The instruction is malformed (a required field is missing or has the wrong type)");
    }
  }

  checkLockedPlacements(inventory, instructions, issues, selectors);

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

/**
 * Static contradictions involving locked placements, found before any scheduling: a lock that sits
 * outside court availability or a division window, on a court another mandatory instruction forbids,
 * inside a blackout or outside a mandatory time window, two locks that overlap on a court, or two
 * locked dependent matches that break the dependency-plus-rest order. Each message names the
 * instruction and says what to change.
 */
function checkLockedPlacements(
  inventory: Inventory,
  instructions: readonly SchedulingInstruction[],
  issues: InstructionIssue[],
  selectors: SelectorIndex,
): void {
  const { config } = inventory;
  const timeline = new Timeline(config);
  const broken = new Set(issues.filter((i) => i.severity === "error" && i.instructionId !== null).map((i) => i.instructionId));
  const fail = (code: InstructionIssueCode, instructionId: Id, message: string) => issues.push({ severity: "error", code, instructionId, message });

  type Lock = { id: Id; matchId: string; courtId: Id; start: number; end: number; clock: string };
  const locks: Lock[] = [];
  for (const i of instructions) {
    if (i === null || typeof i !== "object" || i.kind !== "locked_placement" || i.strength !== "mandatory" || broken.has(i.id)) continue;
    const match = inventory.matchById.get(i.matchId);
    if (!match || !config.courts.some((c) => c.id === i.courtId) || !config.days.includes(i.day)) continue;
    const start = timeline.absolute(i.day, i.start);
    locks.push({ id: i.id, matchId: i.matchId, courtId: i.courtId, start, end: start + match.durationMinutes, clock: `${formatClock(i.start)} on ${i.day}` });
  }

  const within = (windows: readonly { day: string; start: number; end: number }[], lock: Lock) =>
    windows.some((w) => {
      const iv = timeline.window(w);
      return lock.start >= iv.start && lock.end <= iv.end;
    });
  const bound = (b: TimeBound, dayOffset: number) => (b.day !== undefined ? timeline.absolute(b.day, b.minute) : dayOffset + b.minute);

  for (const lock of locks) {
    const match = inventory.matchById.get(lock.matchId)!;
    const court = config.courts.find((c) => c.id === lock.courtId)!;
    const division = config.divisions.find((d) => d.id === match.divisionId)!;
    const label = `${match.divisionId} ${match.label}`;
    const where = `Locked match ${label} (${lock.id}) on ${court.name} at ${lock.clock}`;
    if (!within(court.availability, lock)) fail("LOCKED_OUTSIDE_RULES", lock.id, `${where} does not fit inside any availability window of ${court.name}. Move the lock into the court's open hours.`);
    if (division.eligibleCourtIds && !division.eligibleCourtIds.includes(court.id)) {
      fail("LOCKED_OUTSIDE_RULES", lock.id, `${where}: ${court.name} is not an eligible court for ${division.name}. Choose one of ${division.eligibleCourtIds.join(", ")}.`);
    }
    if (division.playWindows && !within(division.playWindows, lock)) {
      fail("LOCKED_OUTSIDE_RULES", lock.id, `${where} is outside the play windows of ${division.name}. Move the lock inside a play window.`);
    }
    const offset = Math.floor(lock.start / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    for (const i of instructions) {
      if (i === null || typeof i !== "object" || i.strength !== "mandatory" || broken.has(i.id) || i.id === lock.id) continue;
      if (i.kind === "court_allowlist" && selectors.matches(i.selector, match) && !i.courtIds.includes(court.id)) {
        fail("LOCKED_OUTSIDE_RULES", lock.id, `${where} contradicts the court allowlist ${i.id} (allowed: ${i.courtIds.join(", ")}). Change the locked court or the allowlist.`);
      } else if (i.kind === "court_reservation" && !selectors.matches(i.selector, match) && i.courtIds.includes(court.id)) {
        fail("LOCKED_OUTSIDE_RULES", lock.id, `${where} uses ${court.name}, which ${i.id} reserves for other matches. Change the locked court or the reservation.`);
      } else if (i.kind === "court_blackout" && i.courtIds.includes(court.id)) {
        const window = timeline.window(i.window);
        if (lock.start < window.end && window.start < lock.end) {
          fail("LOCKED_OUTSIDE_RULES", lock.id, `${where} overlaps the blackout ${i.id} (${formatClock(i.window.start)}-${formatClock(i.window.end)} on ${i.window.day}). Move the lock or the blackout.`);
        }
      } else if (i.kind === "time_window" && selectors.matches(i.selector, match)) {
        const problems: string[] = [];
        if (i.earliestStart && lock.start < bound(i.earliestStart, offset)) problems.push("starts before the earliest allowed start");
        if (i.latestStart && lock.start > bound(i.latestStart, offset)) problems.push("starts after the latest allowed start");
        if (i.latestEnd && lock.end > bound(i.latestEnd, offset)) problems.push("ends after the latest allowed end");
        if (problems.length > 0) fail("LOCKED_OUTSIDE_RULES", lock.id, `${where} ${problems.join(" and ")} set by ${i.id}. Move the lock or change the time window.`);
      }
    }
  }

  const turnover = config.rules.courtTurnoverMinutes;
  for (let a = 0; a < locks.length; a++) {
    for (let b = a + 1; b < locks.length; b++) {
      const x = locks[a]!;
      const y = locks[b]!;
      if (x.courtId === y.courtId && x.start < y.end + turnover && y.start < x.end + turnover) {
        fail("CONFLICTING_LOCKS", y.id, `Locked matches ${x.matchId} (${x.id}) and ${y.matchId} (${y.id}) overlap or are closer than the ${turnover}-minute turnover on ${x.courtId}. Move one of them.`);
      }
    }
  }
  const byMatch = new Map(locks.map((l) => [l.matchId, l]));
  const restOf = (divisionId: Id) => {
    const mandatoryRest = instructions
      .filter((i) => i !== null && typeof i === "object" && i.kind === "min_rest" && i.strength === "mandatory" && !broken.has(i.id) && i.divisionIds.includes(divisionId))
      .map((i) => (i.kind === "min_rest" ? i.minutes : 0));
    const division = config.divisions.find((d) => d.id === divisionId)!;
    return mandatoryRest.length > 0 ? Math.max(...mandatoryRest) : (division.minRestMinutes ?? config.rules.minRestMinutes);
  };
  for (const lock of locks) {
    const match = inventory.matchById.get(lock.matchId)!;
    for (const dep of match.dependencies) {
      const before = byMatch.get(dep.matchId);
      if (!before) continue;
      const rest = restOf(match.divisionId);
      if (lock.start < before.end + rest) {
        fail("LOCKED_OUTSIDE_RULES", lock.id, `Locked match ${lock.matchId} (${lock.id}) starts less than ${rest} minutes after its prerequisite ${before.matchId} (${before.id}) ends. Move one of the locks.`);
      }
    }
  }
}
