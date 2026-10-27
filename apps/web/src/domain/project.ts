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
  statement: string | null;
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

export const lockedAssignments = (w: WorkingSchedule): Assignment[] => w.schedule.assignments.filter((a) => w.locks.includes(a.matchId));

/** Stable fingerprint of what generation depends on: the event spec and the confirmed rules. */
export function inputsKey(spec: EventSpec, rules: ConfirmedRule[]): string {
  const text = JSON.stringify({ spec, rules: rules.map((r) => r.instruction) });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}
