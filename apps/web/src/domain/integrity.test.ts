import { beforeAll, describe, expect, it } from "vitest";
import type { Schedule } from "@engine";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { approvalConsistent, enforceApprovalIntegrity, reconcileApproval } from "./integrity.js";
import { inputsKey, newProject, type Project } from "./project.js";
import { smallClubDay } from "./samples.js";
import { buildConfig } from "./buildConfig.js";

const runner = createInlineRunner();
let schedule: Schedule;

beforeAll(async () => {
  const { result } = await runner.generate(buildConfig(smallClubDay()), [], 1, 3000);
  schedule = result.options[0]!.schedule;
});

function approved(): Project {
  const base = newProject(smallClubDay());
  const revision = { id: "rev-1", at: 1, label: "Approved", status: "approved" as const, schedule: structuredClone(schedule), locks: [], acknowledgedRisks: [], inputsKey: inputsKey(base.spec, base.rules) };
  return { ...base, working: { basedOn: "fastest_finish", schedule: structuredClone(schedule), locks: [] }, revisions: [revision], status: "approved", approvedRevisionId: "rev-1" };
}

const moved = (p: Project): Project => ({ ...p, working: { ...p.working!, schedule: { ...p.working!.schedule, assignments: p.working!.schedule.assignments.map((a, i) => (i === 0 ? { ...a, start: a.start + 5 } : a)) } } });

describe("approval integrity", () => {
  it("holds for a project whose working schedule, locks, setup and rules are exactly what was approved", () => {
    expect(approvalConsistent(approved())).toBe(true);
    expect(enforceApprovalIntegrity(approved()).status).toBe("approved");
  });

  it.each([
    ["moving a match (drag)", (p: Project) => moved(p)],
    ["swapping two matches", (p: Project) => ({ ...p, working: { ...p.working!, schedule: { ...p.working!.schedule, assignments: p.working!.schedule.assignments.map((a, i, all) => (i === 0 ? { ...a, courtId: all[1]!.courtId, day: all[1]!.day, start: all[1]!.start } : i === 1 ? { ...a, courtId: all[0]!.courtId, day: all[0]!.day, start: all[0]!.start } : a)) } } })],
    ["locking a match", (p: Project) => ({ ...p, working: { ...p.working!, locks: [p.working!.schedule.assignments[0]!.matchId] } })],
    ["changing the event setup", (p: Project) => ({ ...p, spec: { ...p.spec, recoveryMinutes: p.spec.recoveryMinutes + 5 } })],
    ["adding a confirmed rule", (p: Project) => ({ ...p, rules: [...p.rules, { instruction: { id: "r1", kind: "same_day_preliminaries" as const, strength: "preference" as const, weight: 3 }, sourceText: null, origin: "manual" as const, confirmedAt: 1 }] })],
    ["replacing the schedule by regeneration", (p: Project) => ({ ...p, working: { basedOn: "balanced_operations" as const, schedule: { ...schedule, assignments: [...schedule.assignments].reverse().map((a, i) => ({ ...a, start: schedule.assignments[i]!.start })) }, locks: [] } })],
    ["clearing the schedule", (p: Project) => ({ ...p, working: null })],
  ])("is withdrawn after %s", (_n, edit) => {
    const edited = enforceApprovalIntegrity(edit(approved()));
    expect(edited.status).toBe("draft");
    expect(edited.approvedRevisionId).toBeNull();
    expect(edited.revisions).toHaveLength(1); // the approved revision itself is preserved
  });

  it("stays a draft after an undo that happens to restore the approved schedule (re-approval is required)", () => {
    const draft = enforceApprovalIntegrity(moved(approved()));
    const undone = enforceApprovalIntegrity({ ...draft, working: { ...draft.working!, schedule: structuredClone(schedule) } });
    expect(undone.status).toBe("draft");
  });

  it("does not trust an imported file that claims approval for a schedule that differs from the approved revision", async () => {
    const forged = moved(approved());
    const { project, notes } = await reconcileApproval(runner, forged);
    expect(project.status).toBe("draft");
    expect(notes.join(" ")).toMatch(/does not match/i);
  });

  it("does not trust an imported approval for a schedule the engine rejects", async () => {
    const bad = approved();
    const clash = (s: Schedule): Schedule => ({ ...s, assignments: s.assignments.map((a, i, all) => (i === 1 ? { ...a, courtId: all[0]!.courtId, day: all[0]!.day, start: all[0]!.start } : a)) });
    bad.working = { ...bad.working!, schedule: clash(bad.working!.schedule) };
    bad.revisions = [{ ...bad.revisions[0]!, schedule: clash(bad.revisions[0]!.schedule) }];
    const { project, notes } = await reconcileApproval(runner, bad);
    expect(project.status).toBe("draft");
    expect(notes.join(" ")).toMatch(/no longer passes the rules/i);
  });

  it("keeps a genuine, valid imported approval", async () => {
    const { project, notes } = await reconcileApproval(runner, approved());
    expect(project.status).toBe("approved");
    expect(notes).toEqual([]);
  });
});
