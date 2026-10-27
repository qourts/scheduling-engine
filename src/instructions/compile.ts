import type { Id, TimeWindow, TournamentConfig } from "../config/types.js";
import type { Inventory, Match, MatchId } from "../inventory/types.js";
import type { Assignment } from "../schedule/types.js";
import { Timeline } from "../schedule/timeline.js";
import { err, ok, type Result } from "../util/result.js";
import { intersectIntervals, MINUTES_PER_DAY, mergeIntervals, subtractIntervals, type Interval } from "../util/time.js";
import { SelectorIndex } from "./selector.js";
import { validateInstructions } from "./validate.js";
import {
  isMandatory,
  type InstructionIssue,
  type SchedulingInstruction,
  type TimeWindowInstruction,
} from "./types.js";

/** Hard limits that apply to one match, beyond what the tournament configuration already says. */
export interface MatchLimits {
  /** Courts the match may use (already combined with the division's eligible courts). Null = every court. */
  allowedCourts: ReadonlySet<Id> | null;
  /** Allowed start instants as half-open ranges of absolute minutes. Null = unrestricted. */
  startRanges: readonly Interval[] | null;
}

/**
 * Measures how far a placement is from one preference, in weighted units
 * (0 = fully satisfied). Local preferences depend only on the match's own
 * placement; global ones (rest targets, consecutive blocks) are measured by
 * the metrics module.
 */
export type LocalPreference = (courtId: Id, absoluteStart: number, durationMinutes: number) => number;

export interface CompiledConstraints {
  /**
   * The tournament as the engine must schedule it: the original configuration
   * with mandatory instructions that map onto existing rules applied (court
   * blackouts shrink availability, mandatory minimum rest replaces the
   * division value). Validate schedules against this inventory.
   */
  inventory: Inventory;
  /** The original, unmodified inventory. */
  original: Inventory;
  instructions: readonly SchedulingInstruction[];
  limits: ReadonlyMap<MatchId, MatchLimits>;
  locked: readonly Assignment[];
  localPreferences: ReadonlyMap<MatchId, readonly LocalPreference[]>;
  /** Preference instructions that are measured globally by the metrics module. */
  globalPreferences: readonly SchedulingInstruction[];
  /** Warnings from validation (errors make compilation fail). */
  warnings: readonly InstructionIssue[];
}

/**
 * Validates and compiles structured instructions. Fails with the full list of
 * issues when any instruction is invalid; the engine never guesses.
 */
export function compileInstructions(
  inventory: Inventory,
  instructions: readonly SchedulingInstruction[] = [],
): Result<CompiledConstraints, InstructionIssue[]> {
  const validation = validateInstructions(inventory, instructions);
  if (!validation.ok) return err(validation.issues);

  const config = inventory.config;
  const timeline = new Timeline(config);
  const selectors = new SelectorIndex(inventory);
  const mandatory = instructions.filter(isMandatory);
  const preferences = instructions.filter((i) => !isMandatory(i));

  const effective = applyConfigRules(config, mandatory);
  const effectiveInventory: Inventory = { ...inventory, config: effective };

  const limits = new Map<MatchId, MatchLimits>();
  for (const match of inventory.matches) {
    limits.set(match.id, matchLimits(match, config, timeline, selectors, mandatory));
  }

  const locked: Assignment[] = [];
  for (const i of mandatory) {
    if (i.kind === "locked_placement") locked.push({ matchId: i.matchId, courtId: i.courtId, day: i.day, start: i.start });
  }

  const localPreferences = new Map<MatchId, LocalPreference[]>();
  const globalPreferences: SchedulingInstruction[] = [];
  for (const p of preferences) {
    if (p.kind === "min_rest" || p.kind === "consecutive_blocks") {
      globalPreferences.push(p);
      continue;
    }
    for (const match of inventory.matches) {
      const local = localPreference(p, match, timeline, selectors);
      if (!local) continue;
      const list = localPreferences.get(match.id) ?? [];
      list.push(local);
      localPreferences.set(match.id, list);
    }
  }

  return ok({
    inventory: effectiveInventory,
    original: inventory,
    instructions,
    limits,
    locked,
    localPreferences,
    globalPreferences,
    warnings: validation.issues.filter((i) => i.severity === "warning"),
  });
}

function applyConfigRules(config: TournamentConfig, mandatory: readonly SchedulingInstruction[]): TournamentConfig {
  const blackouts = new Map<Id, TimeWindow[]>();
  const rest = new Map<Id, number>();
  for (const i of mandatory) {
    if (i.kind === "court_blackout") {
      for (const courtId of i.courtIds) blackouts.set(courtId, [...(blackouts.get(courtId) ?? []), i.window]);
    } else if (i.kind === "min_rest") {
      for (const divisionId of i.divisionIds) rest.set(divisionId, Math.max(rest.get(divisionId) ?? 0, i.minutes));
    }
  }
  if (blackouts.size === 0 && rest.size === 0) return config;

  return {
    ...config,
    courts: config.courts.map((court) => {
      const cuts = blackouts.get(court.id);
      if (!cuts) return court;
      const availability = court.availability.flatMap((w) => {
        const sameDay = cuts.filter((c) => c.day === w.day);
        return subtractIntervals([{ start: w.start, end: w.end }], sameDay).map((piece) => ({ day: w.day, start: piece.start, end: piece.end }));
      });
      return { ...court, availability };
    }),
    divisions: config.divisions.map((d) => (rest.has(d.id) ? { ...d, minRestMinutes: rest.get(d.id)! } : d)),
  };
}

/** Allowed start ranges implied by a time-window instruction, one per tournament day. */
export function timeWindowStartRanges(timeline: Timeline, days: readonly string[], i: TimeWindowInstruction, durationMinutes: number): Interval[] {
  const out: Interval[] = [];
  const at = (b: { day?: string; minute: number }, dayOffset: number) => (b.day !== undefined ? timeline.absolute(b.day, b.minute) : dayOffset + b.minute);
  days.forEach((_, index) => {
    const offset = index * MINUTES_PER_DAY;
    let lo = offset;
    let hi = offset + MINUTES_PER_DAY - 1;
    if (i.earliestStart) lo = Math.max(lo, at(i.earliestStart, offset));
    if (i.latestStart) hi = Math.min(hi, at(i.latestStart, offset));
    if (i.latestEnd) hi = Math.min(hi, at(i.latestEnd, offset) - durationMinutes);
    if (lo <= hi) out.push({ start: lo, end: hi + 1 });
  });
  return out;
}

function matchLimits(
  match: Match,
  config: TournamentConfig,
  timeline: Timeline,
  selectors: SelectorIndex,
  mandatory: readonly SchedulingInstruction[],
): MatchLimits {
  const division = config.divisions.find((d) => d.id === match.divisionId)!;
  let courts: Set<Id> | null = division.eligibleCourtIds ? new Set(division.eligibleCourtIds) : null;
  let ranges: Interval[] | null = null;
  const restrictCourts = (keep: (id: Id) => boolean) => {
    const base = courts ?? new Set(config.courts.map((c) => c.id));
    courts = new Set([...base].filter(keep));
  };
  for (const i of mandatory) {
    if (i.kind === "court_allowlist" && selectors.matches(i.selector, match)) {
      const allowed = new Set(i.courtIds);
      restrictCourts((c) => allowed.has(c));
    } else if (i.kind === "court_reservation" && !selectors.matches(i.selector, match)) {
      const reserved = new Set(i.courtIds);
      restrictCourts((c) => !reserved.has(c));
    } else if (i.kind === "time_window" && selectors.matches(i.selector, match)) {
      const own = timeWindowStartRanges(timeline, config.days, i, match.durationMinutes);
      ranges = ranges === null ? mergeIntervals(own) : intersectIntervals(ranges, own);
    }
  }
  return { allowedCourts: courts, startRanges: ranges };
}

function localPreference(
  p: SchedulingInstruction,
  match: Match,
  timeline: Timeline,
  selectors: SelectorIndex,
): LocalPreference | null {
  const weight = p.strength === "preference" ? p.weight : 0;
  switch (p.kind) {
    case "time_window": {
      if (!selectors.matches(p.selector, match)) return null;
      const at = (b: { day?: string; minute: number }, offset: number) => (b.day !== undefined ? timeline.absolute(b.day, b.minute) : offset + b.minute);
      return (_court, start, duration) => {
        const offset = Math.floor(start / MINUTES_PER_DAY) * MINUTES_PER_DAY;
        let minutes = 0;
        if (p.earliestStart) minutes += Math.max(0, at(p.earliestStart, offset) - start);
        if (p.latestStart) minutes += Math.max(0, start - at(p.latestStart, offset));
        if (p.latestEnd) minutes += Math.max(0, start + duration - at(p.latestEnd, offset));
        return (weight * minutes) / 60;
      };
    }
    case "court_allowlist": {
      if (!selectors.matches(p.selector, match)) return null;
      const allowed = new Set(p.courtIds);
      return (court) => (allowed.has(court) ? 0 : weight);
    }
    case "court_reservation": {
      if (selectors.matches(p.selector, match)) return null;
      const reserved = new Set(p.courtIds);
      return (court) => (reserved.has(court) ? weight : 0);
    }
    case "court_blackout": {
      const window = timeline.window(p.window);
      const courts = new Set(p.courtIds);
      return (court, start, duration) => {
        if (!courts.has(court)) return 0;
        const overlap = Math.min(window.end, start + duration) - Math.max(window.start, start);
        return overlap > 0 ? (weight * overlap) / 60 : 0;
      };
    }
    default:
      return null;
  }
}
