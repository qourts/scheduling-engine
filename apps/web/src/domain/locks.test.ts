import { beforeAll, describe, expect, it } from "vitest";
import type { Schedule } from "@engine";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { buildConfig } from "./buildConfig.js";
import { lockRules, lockedMatchesInIssues } from "./locks.js";
import { smallClubDay } from "./samples.js";

const runner = createInlineRunner();
const config = buildConfig(smallClubDay());
let schedule: Schedule;

beforeAll(async () => {
  const { result } = await runner.generate(config, [], 1, 3000);
  schedule = result.options[0]!.schedule;
});

const same = (a: Schedule, matchId: string, ref: Schedule) => JSON.stringify(a.assignments.find((x) => x.matchId === matchId)) === JSON.stringify(ref.assignments.find((x) => x.matchId === matchId));

describe("regeneration around locked matches", () => {
  it("keeps every locked match exactly where it was, in all options, and the result passes the independent validator", async () => {
    // Lock a spread of matches, including late ones, so the optimizer genuinely has to build around them.
    const sorted = [...schedule.assignments].sort((a, b) => a.start - b.start);
    const locks = [sorted[0]!, sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!].map((a) => a.matchId);
    const instructions = lockRules(schedule, locks);
    expect(instructions).toHaveLength(3);
    const { result } = await runner.generate(config, instructions, 1, 3000);
    expect(result.status).toBe("ok");
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      for (const id of locks) expect(same(option.schedule, id, schedule), `${option.strategy} moved ${id}`).toBe(true);
      const verdict = await runner.check(config, option.schedule, instructions, [], false);
      expect(verdict.valid).toBe(true);
    }
  });

  it("changes nothing when nothing is locked", () => {
    expect(lockRules(schedule, [])).toEqual([]);
  });

  it("names the clashing locks when two locked matches collide, instead of dropping either", async () => {
    const [a, b] = schedule.assignments;
    const clashing: Schedule = { ...schedule, assignments: schedule.assignments.map((x) => (x.matchId === b!.matchId ? { ...x, courtId: a!.courtId, day: a!.day, start: a!.start } : x)) };
    const { result } = await runner.generate(config, lockRules(clashing, [a!.matchId, b!.matchId]), 1, 2000);
    expect(result.status).toBe("invalid_instructions");
    const implicated = lockedMatchesInIssues(result.instructionIssues ?? []);
    expect(implicated).toEqual(expect.arrayContaining([a!.matchId, b!.matchId]));
  });

  it("reports a lock that contradicts a confirmed rule, naming that lock", async () => {
    const target = schedule.assignments[3]!;
    const blackout = { id: "no-court", kind: "court_blackout" as const, courtIds: [target.courtId], window: { day: target.day, start: 0, end: 1440 }, strength: "mandatory" as const };
    const { result } = await runner.generate(config, [blackout, ...lockRules(schedule, [target.matchId])], 1, 2000);
    expect(result.status).toBe("invalid_instructions");
    expect(lockedMatchesInIssues(result.instructionIssues ?? [])).toEqual([target.matchId]);
  });

  it("flags a locked knockout match placed before the pool matches it depends on", async () => {
    const last = [...schedule.assignments].sort((a, b) => b.start - a.start)[0]!;
    const early: Schedule = { ...schedule, assignments: schedule.assignments.map((x) => (x.matchId === last.matchId ? { ...x, start: 9 * 60 } : x)) };
    const { result } = await runner.generate(config, lockRules(early, [last.matchId]), 1, 2000);
    expect(result.status).not.toBe("ok");
  });
});
