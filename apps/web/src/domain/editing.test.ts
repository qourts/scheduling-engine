import { beforeAll, describe, expect, it } from "vitest";
import type { Schedule } from "@engine";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { buildConfig } from "./buildConfig.js";
import { approvalRisks, impactOf, proposeMove, proposeSwap, reasonsOf } from "./editing.js";
import { echelonStyleDay, smallClubDay } from "./samples.js";

const runner = createInlineRunner();
const config = buildConfig(smallClubDay());
let schedule: Schedule;

beforeAll(async () => {
  const { result } = await runner.generate(config, [], 1, 3000);
  schedule = result.options[0]!.schedule;
});

describe("editing through the engine", () => {
  it("rejects a move onto an occupied court slot and explains why", async () => {
    const [a, b] = schedule.assignments;
    const p = await proposeMove(runner, config, schedule, [], [], a!.matchId, { courtId: b!.courtId, day: b!.day, start: b!.start });
    expect(p.valid).toBe(false);
    expect(reasonsOf(p).length).toBeGreaterThan(0);
  });

  it("never lets a locked match move or be swapped", async () => {
    const a = schedule.assignments[0]!;
    const b = schedule.assignments[1]!;
    const move = await proposeMove(runner, config, schedule, [], [a.matchId], a.matchId, { courtId: a.courtId, day: a.day, start: a.start + 5 });
    expect(move.blocked).toMatch(/locked/i);
    expect(move.valid).toBe(false);
    const swap = await proposeSwap(runner, config, schedule, [], [b.matchId], a.matchId, b.matchId);
    expect(swap.blocked).toMatch(/locked/i);
  });

  it("a proposal the engine calls valid really is a valid schedule, and its impact is measured by the engine", async () => {
    const base = (await runner.check(config, schedule, [], [], true)).report!;
    let found = 0;
    for (const a of schedule.assignments.slice(0, 12)) {
      for (const b of schedule.assignments.slice(0, 12)) {
        if (a.matchId >= b.matchId) continue;
        const p = await proposeSwap(runner, config, schedule, [], [], a.matchId, b.matchId);
        if (!p.valid) continue;
        found++;
        const verdict = await runner.check(config, p.candidate, [], [], false);
        expect(verdict.valid).toBe(true);
        const impact = impactOf(base, p.report!, schedule, p.candidate);
        expect(impact.matchesMoved).toBe(2);
        expect(impact.finishMinute.after).not.toBeNull();
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("an invalid proposal never alters the schedule it was proposed against", async () => {
    const before = JSON.stringify(schedule);
    const a = schedule.assignments[0]!;
    await proposeMove(runner, config, schedule, [], [], a.matchId, { courtId: a.courtId, day: a.day, start: 0 });
    expect(JSON.stringify(schedule)).toBe(before);
  });

  it("enforces confirmed mandatory rules on edits", async () => {
    const a = schedule.assignments[0]!;
    const rule = { id: "no-c1", kind: "court_blackout" as const, courtIds: ["C1"], window: { day: a.day, start: 0, end: 1440 }, strength: "mandatory" as const };
    const other = schedule.assignments.find((s) => s.courtId !== "C1")!;
    const p = await proposeMove(runner, config, schedule, [rule], [], other.matchId, { courtId: "C1", day: other.day, start: other.start });
    expect(p.valid).toBe(false);
  });
});

describe("approval risks", () => {
  it("always carries the experimental note for the Echelon-style event", () => {
    const risks = approvalRisks({ warnings: [] } as never, echelonStyleDay().experimentalNote);
    expect(risks[0]).toMatch(/experimental/i);
  });
});
