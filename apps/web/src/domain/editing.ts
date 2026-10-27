import type { InstructionViolation, Schedule, ScheduleReport, SchedulingInstruction, TournamentConfig, Violation, Assignment } from "@engine";
import type { EngineRunner } from "../engine/runner.js";

/** A proposed edit, already evaluated by the engine. Nothing here decides validity itself. */
export interface Proposal {
  kind: "move" | "swap";
  matchIds: string[];
  candidate: Schedule;
  valid: boolean;
  violations: Violation[];
  instructionViolations: InstructionViolation[];
  report: ScheduleReport | null;
  /** Set when the edit cannot even be evaluated (a locked match, an unknown match). */
  blocked: string | null;
}

export interface Slot {
  courtId: string;
  day: string;
  start: number;
}

const replace = (schedule: Schedule, changes: Map<string, Assignment>): Schedule => ({
  ...schedule,
  assignments: schedule.assignments.map((a) => changes.get(a.matchId) ?? a),
});

const blockedProposal = (kind: Proposal["kind"], matchIds: string[], schedule: Schedule, reason: string): Proposal => ({
  kind,
  matchIds,
  candidate: schedule,
  valid: false,
  violations: [],
  instructionViolations: [],
  report: null,
  blocked: reason,
});

/** Moves one match to another court and time. Locked matches cannot move. */
export async function proposeMove(runner: EngineRunner, config: TournamentConfig, schedule: Schedule, rules: SchedulingInstruction[], locks: string[], matchId: string, to: Slot): Promise<Proposal> {
  const current = schedule.assignments.find((a) => a.matchId === matchId);
  if (!current) return blockedProposal("move", [matchId], schedule, "That match is not in the schedule.");
  if (locks.includes(matchId)) return blockedProposal("move", [matchId], schedule, "This match is locked. Unlock it first.");
  const candidate = replace(schedule, new Map([[matchId, { ...current, courtId: to.courtId, day: to.day, start: to.start }]]));
  return evaluate(runner, config, "move", [matchId], candidate, rules, locks);
}

/** Swaps the court and time of two matches. Locked matches cannot move. */
export async function proposeSwap(runner: EngineRunner, config: TournamentConfig, schedule: Schedule, rules: SchedulingInstruction[], locks: string[], a: string, b: string): Promise<Proposal> {
  const x = schedule.assignments.find((s) => s.matchId === a);
  const y = schedule.assignments.find((s) => s.matchId === b);
  if (!x || !y) return blockedProposal("swap", [a, b], schedule, "One of the matches is not in the schedule.");
  if (locks.includes(a) || locks.includes(b)) return blockedProposal("swap", [a, b], schedule, "A locked match cannot be swapped. Unlock it first.");
  const candidate = replace(
    schedule,
    new Map([
      [a, { ...x, courtId: y.courtId, day: y.day, start: y.start }],
      [b, { ...y, courtId: x.courtId, day: x.day, start: x.start }],
    ]),
  );
  return evaluate(runner, config, "swap", [a, b], candidate, rules, locks);
}

async function evaluate(runner: EngineRunner, config: TournamentConfig, kind: Proposal["kind"], matchIds: string[], candidate: Schedule, rules: SchedulingInstruction[], locks: string[]): Promise<Proposal> {
  const locked = candidate.assignments.filter((a) => locks.includes(a.matchId));
  const r = await runner.check(config, candidate, rules, locked, true);
  if (r.instructionIssues.length) return blockedProposal(kind, matchIds, candidate, r.instructionIssues[0]?.message ?? "The rules could not be evaluated.");
  return { kind, matchIds, candidate, valid: r.valid, violations: r.violations, instructionViolations: r.instructionViolations, report: r.report, blocked: null };
}

/** Plain-language reasons for a rejected proposal, taken verbatim from the engine. */
export const reasonsOf = (p: Proposal): string[] => [
  ...(p.blocked ? [p.blocked] : []),
  ...p.violations.map((v) => `${v.certainty === "possible" ? "Possible: " : ""}${v.message}`),
  ...p.instructionViolations.map((v) => v.message),
];

export interface Impact {
  matchesMoved: number;
  finishMinute: { before: number | null; after: number | null };
  idleCourtMinutes: { before: number; after: number };
  backToBacks: { before: number; after: number };
  shortestRecovery: { before: number | null; after: number | null };
  newWarnings: string[];
  resolvedWarnings: string[];
}

const finishOf = (r: ScheduleReport) => (r.finish ? r.finish.minute : null);

/** Before-and-after consequences of an edit, computed only from two engine reports. */
export function impactOf(before: ScheduleReport, after: ScheduleReport, base: Schedule, candidate: Schedule): Impact {
  const key = (w: { code: string; message: string }) => `${w.code}|${w.message}`;
  const was = new Set(before.warnings.map(key));
  const now = new Set(after.warnings.map(key));
  const placed = new Map(base.assignments.map((a) => [a.matchId, `${a.courtId}|${a.day}|${a.start}`]));
  return {
    matchesMoved: candidate.assignments.filter((a) => placed.get(a.matchId) !== `${a.courtId}|${a.day}|${a.start}`).length,
    finishMinute: { before: finishOf(before), after: finishOf(after) },
    idleCourtMinutes: { before: before.idleCourtMinutes, after: after.idleCourtMinutes },
    backToBacks: { before: before.recovery.backToBackOccurrences, after: after.recovery.backToBackOccurrences },
    shortestRecovery: { before: before.recovery.minMinutes, after: after.recovery.minMinutes },
    newWarnings: after.warnings.filter((w) => !was.has(key(w))).map((w) => w.message),
    resolvedWarnings: before.warnings.filter((w) => !now.has(key(w))).map((w) => w.message),
  };
}

/** Risks an approver must acknowledge: risk-level engine warnings, zero-slack cases, and any experimental-assumption note. */
export function approvalRisks(report: ScheduleReport, experimentalNote: string | null): string[] {
  const risks = report.warnings.filter((w) => w.severity === "risk" || w.code === "NO_SLACK" || w.code === "MEDAL_OVERRUN_RISK").map((w) => w.message);
  return [...(experimentalNote ? [`Experimental assumptions: ${experimentalNote}`] : []), ...risks];
}
