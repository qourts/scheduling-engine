import type { Assignment, InstructionIssue, Schedule, SchedulingInstruction } from "@engine";

/**
 * Locks are ordinary mandatory `locked_placement` instructions as far as the engine is concerned: the optimizer fixes those
 * matches and builds everything else around them, and the validator rejects any schedule that moves them. They are derived
 * from the working schedule at generation time, so they are never stored as separate rules that could drift.
 */
export const LOCK_PREFIX = "lock-";

export const lockInstructionId = (matchId: string) => `${LOCK_PREFIX}${matchId}`;

export const lockedAssignments = (schedule: Schedule, locks: readonly string[]): Assignment[] => schedule.assignments.filter((a) => locks.includes(a.matchId));

export function lockRules(schedule: Schedule, locks: readonly string[]): SchedulingInstruction[] {
  return lockedAssignments(schedule, locks).map((a) => ({ id: lockInstructionId(a.matchId), kind: "locked_placement" as const, matchId: a.matchId, courtId: a.courtId, day: a.day, start: a.start, strength: "mandatory" as const }));
}

/** Match ids of the locks the engine named in instruction issues (conflicts between locks, or locks outside the rules). */
export function lockedMatchesInIssues(issues: readonly InstructionIssue[]): string[] {
  const ids = new Set<string>();
  for (const issue of issues) {
    if (issue.severity !== "error") continue;
    if (issue.instructionId?.startsWith(LOCK_PREFIX)) ids.add(issue.instructionId.slice(LOCK_PREFIX.length));
    // Messages for two clashing locks name both matches, but only the second is the instruction id; recover the first too.
    for (const m of issue.message.matchAll(/Locked matches (\S+) \(/g)) ids.add(m[1]!);
  }
  return [...ids];
}
