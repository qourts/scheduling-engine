import type { Assignment, Schedule, SchedulingInstruction, StrategyId } from "@engine";
import type { EventSpec } from "./spec.js";

export const PROJECT_SCHEMA_VERSION = 1;

export type ProjectStatus = "draft" | "approved" | "published";

/** A rule the operator has reviewed. Only these ever reach the scheduler. */
export interface ConfirmedRule {
  instruction: SchedulingInstruction;
  /** What the operator typed, when it came from plain English. */
  sourceText: string | null;
  origin: "parser" | "claude" | "manual" | "lock";
  confirmedAt: number;
}

export interface StoredOption {
  strategy: StrategyId;
  label: string;
  name: string;
  summary: string;
  schedule: Schedule;
}

export interface Generation {
  at: number;
  seed: number;
  /** Fingerprint of the event and rules the options were generated from; a mismatch marks them stale. */
  inputsKey: string;
  options: StoredOption[];
  recommended: StrategyId | null;
  /** Why the engine recommends that option, in its own words. */
  reason: string | null;
  /** Honest notes about the set: equivalent options, why fewer than three, time-limited search. */
  notes: string[];
}

export interface Revision {
  id: string;
  at: number;
  label: string;
  status: ProjectStatus;
  schedule: Schedule;
  locks: string[];
  /** Risks the operator accepted when approving (for example a zero-slack schedule). */
  acknowledgedRisks: string[];
  /** Fingerprint of the setup and rules this revision was made under; approval holds only while it still matches. */
  inputsKey: string;
}

export interface WorkingSchedule {
  basedOn: StrategyId | "import";
  schedule: Schedule;
  /** Match ids pinned by the operator. */
  locks: string[];
}

export interface Project {
  schemaVersion: number;
  id: string;
  createdAt: number;
  updatedAt: number;
  spec: EventSpec;
  rules: ConfirmedRule[];
  generation: Generation | null;
  working: WorkingSchedule | null;
  revisions: Revision[];
  status: ProjectStatus;
  approvedRevisionId: string | null;
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newProject(spec: EventSpec): Project {
  const now = Date.now();
  return { schemaVersion: PROJECT_SCHEMA_VERSION, id: newId("proj"), createdAt: now, updatedAt: now, spec, rules: [], generation: null, working: null, revisions: [], status: "draft", approvedRevisionId: null };
}

/**
 * Stable fingerprint of what generation depends on: the event spec, the confirmed rules and, when regenerating around them,
 * the locked placements. Approvals fingerprint the spec and rules only (locks are compared separately).
 */
export function inputsKey(spec: EventSpec, rules: ConfirmedRule[], locked: readonly Assignment[] = []): string {
  const text = JSON.stringify({ spec, rules: rules.map((r) => r.instruction), locked: [...locked].sort((a, b) => a.matchId.localeCompare(b.matchId)).map((a) => [a.matchId, a.courtId, a.day, a.start]) });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}
