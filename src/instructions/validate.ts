import type { Id } from "../config/types.js";
import type { Inventory } from "../inventory/types.js";
import { isIsoDate } from "../util/time.js";
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
    for (const [field, list] of Object.entries(selector)) {
      if (Array.isArray(list) && list.length === 0) error("EMPTY_LIST", id, `selector.${field} must not be empty (omit it to select all)`);
    }
    if (issues.length === before && selectors.select(selector).length === 0) {
      add("warning", "EMPTY_SELECTION", id, "The selector matches no matches, so the instruction has no effect");
    }
  };

  for (const instruction of instructions) {
    const id = instruction.id;
    if (typeof id !== "string" || id === "") {
      error("INVALID_VALUE", null, "Every instruction needs a non-empty id");
      continue;
    }
    if (seen.has(id)) error("DUPLICATE_ID", id, `Instruction id ${id} is used more than once`);
    seen.add(id);

    if (instruction.strength === "preference") {
      if (!Number.isFinite(instruction.weight) || instruction.weight <= 0) error("INVALID_WEIGHT", id, "A preference needs a finite weight greater than 0");
    } else if (instruction.strength !== "mandatory") {
      error("INVALID_VALUE", id, 'strength must be "mandatory" or "preference"');
    }

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
        error("INVALID_VALUE", unknown.id ?? null, `Unknown instruction kind ${unknown.kind}`);
      }
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
