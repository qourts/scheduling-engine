import type { Assignment } from "@engine";
import type { EngineRunner } from "../engine/runner.js";
import { buildConfig } from "./buildConfig.js";
import { lockedAssignments } from "./locks.js";
import { inputsKey, type Project } from "./project.js";

/**
 * Approval is a statement about one exact schedule under one exact setup. It holds only while the working schedule, its locks,
 * the event setup and the confirmed rules are all identical to what was approved. Anything else withdraws it back to draft.
 * This is enforced centrally on every project update, so no edit path (drag, swap, undo, regeneration, restore, setup or rule
 * changes) can leave a stale approval behind.
 */
const canonical = (assignments: readonly Assignment[]) =>
  JSON.stringify([...assignments].sort((a, b) => a.matchId.localeCompare(b.matchId)).map((a) => [a.matchId, a.courtId, a.day, a.start]));

const sameLocks = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function approvalConsistent(p: Project): boolean {
  if (p.status === "draft") return true;
  const revision = p.revisions.find((r) => r.id === p.approvedRevisionId);
  if (!revision || !p.working || revision.status !== "approved") return false;
  if (revision.inputsKey !== inputsKey(p.spec, p.rules)) return false;
  return canonical(revision.schedule.assignments) === canonical(p.working.schedule.assignments) && sameLocks(revision.locks, p.working.locks);
}

/** Returns the project unchanged when its approval is sound, otherwise the same project withdrawn to draft. */
export function enforceApprovalIntegrity(p: Project): Project {
  return approvalConsistent(p) ? p : { ...p, status: "draft", approvedRevisionId: null };
}

export interface Reconciled {
  project: Project;
  notes: string[];
}

/**
 * For projects arriving from outside (an imported file, an old save): approval is kept only if it is internally consistent AND the
 * engine still passes the approved schedule. A hand-edited file cannot carry an approval the engine would not give.
 */
export async function reconcileApproval(runner: EngineRunner, p: Project): Promise<Reconciled> {
  if (p.status === "draft") return { project: p, notes: [] };
  if (!approvalConsistent(p)) {
    return { project: enforceApprovalIntegrity(p), notes: ["The file said it was approved, but its schedule or setup does not match the approved version. It was opened as a draft; review and approve it again."] };
  }
  const config = buildConfig(p.spec);
  const schedule = p.working!.schedule;
  const verdict = await runner.check(config, schedule, p.rules.map((r) => r.instruction), lockedAssignments(schedule, p.working!.locks), false);
  if (!verdict.valid) {
    return { project: enforceApprovalIntegrity({ ...p, revisions: p.revisions.map((r) => (r.id === p.approvedRevisionId ? { ...r, status: "draft" as const } : r)) }), notes: ["The imported schedule no longer passes the rules, so its approval was removed. It was opened as a draft."] };
  }
  return { project: p, notes: [] };
}
