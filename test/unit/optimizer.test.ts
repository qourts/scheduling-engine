import { describe, expect, it } from "vitest";
import {
  buildInventory,
  optimizeSchedules,
  validateSchedule,
  validateScheduleWithInstructions,
  type Inventory,
  type OptimizeOptions,
  type OptimizeResult,
  type Schedule,
  type SchedulingInstruction,
} from "../../src/index.js";
import { courts, DAY1, DAY2, fullDay, stages, tournament } from "../support/fixtures.js";

const budget = { iterationsPerStrategy: 800 };

const build = () =>
  buildInventory(
    tournament({
      days: [DAY1, DAY2],
      courts: courts(5, [fullDay(DAY1), fullDay(DAY2)]),
      divisions: [
        { id: "ADV", categoryId: "MD", teamCount: 6, stages: stages.groupsToKnockout(2, 2, true) },
        { id: "INT", categoryId: "WD", teamCount: 4, stages: stages.roundRobin() },
        { id: "BEG", categoryId: "XD", teamCount: 5, stages: stages.roundRobin() },
      ],
    }),
  );

const mandatory = <T extends object>(i: T) => ({ ...i, strength: "mandatory" as const }) as unknown as SchedulingInstruction;
const preference = <T extends object>(i: T, weight = 1) => ({ ...i, strength: "preference" as const, weight }) as unknown as SchedulingInstruction;

const run = (inventory: Inventory, instructions: SchedulingInstruction[] = [], extra: OptimizeOptions = {}): OptimizeResult =>
  optimizeSchedules(inventory, { seed: 5, budget, instructions, ...extra });

const interval = (inventory: Inventory, schedule: Schedule, matchId: string) => {
  const a = schedule.assignments.find((x) => x.matchId === matchId)!;
  const dayIndex = inventory.config.days.indexOf(a.day);
  const start = dayIndex * 1440 + a.start;
  return { start, end: start + inventory.matchById.get(matchId)!.durationMinutes, court: a.courtId, day: a.day };
};

const expectAllValid = (inventory: Inventory, result: OptimizeResult, instructions: SchedulingInstruction[] = []) => {
  expect(result.status).toBe("ok");
  expect(result.options.length).toBeGreaterThan(0);
  for (const option of result.options) {
    expect(validateSchedule(inventory, option.schedule).violations).toEqual([]);
    const full = validateScheduleWithInstructions(inventory, option.schedule, instructions);
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.value.violations).toEqual([]);
      expect(full.value.instructionViolations).toEqual([]);
    }
  }
};

describe("optimizer: three options", () => {
  const inventory = build();
  const result = run(inventory);

  it("returns Fastest Finish, Balanced Operations and Player-First, each independently valid", () => {
    expectAllValid(inventory, result);
    expect(result.options.map((o) => [o.label, o.strategy])).toEqual([
      ["A", "fastest_finish"],
      ["B", "balanced_operations"],
      ["C", "player_first"],
    ]);
    expect(result.options.every((o) => o.validated)).toBe(true);
    for (const o of result.options) expect(o.schedule.assignments).toHaveLength(inventory.matches.length);
  });

  it("recommends Balanced Operations unless another option dominates it, and says why", () => {
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.reason.length).toBeGreaterThan(10);
    const dominated = result.comparison.relations.some(
      (r) => (r.a === "balanced_operations" && r.dominance === "b_dominates") || (r.b === "balanced_operations" && r.dominance === "a_dominates"),
    );
    expect(result.recommended!.strategy === "balanced_operations").toBe(!dominated);
  });

  it("Player-First never has more back-to-backs than Fastest Finish and Fastest Finish never finishes later than Player-First", () => {
    const [a, , c] = result.options;
    expect(c!.metrics.backToBackCount).toBeLessThanOrEqual(a!.metrics.backToBackCount);
    expect(a!.metrics.finishMinute).toBeLessThanOrEqual(c!.metrics.finishMinute);
  });

  it("reports pairwise relations whose claims are consistent with the measured metrics", () => {
    expect(result.comparison.relations).toHaveLength(3);
    for (const r of result.comparison.relations) {
      expect(r.materiallyDifferent).toBe(r.assignmentDistance >= 0.1 && r.differsOn.length > 0);
      expect(r.identical).toBe(r.assignmentDistance === 0);
    }
    if (result.comparison.equivalent.length > 0) expect(result.comparison.explanation.join(" ")).toContain("equivalent");
  });

  it("measures every option and an optimistic lower bound without claiming optimality", () => {
    for (const o of result.options) {
      const m = o.metrics;
      expect(m.finishMinute).toBeGreaterThanOrEqual(result.diagnostics.finishLowerBoundMinute);
      expect(m.utilization).toBeGreaterThan(0);
      expect(m.utilization).toBeLessThanOrEqual(1);
      expect(m.busyMinutes).toBe(inventory.matches.reduce((s, x) => s + x.durationMinutes, 0));
    }
    expect(result.diagnostics.finishGapToLowerBound).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toMatch(/optimal(?!ity)/i);
  });

  it("is deterministic for a seed and an iteration budget", () => {
    const again = run(inventory);
    expect(again.options.map((o) => o.schedule)).toEqual(result.options.map((o) => o.schedule));
    expect(again.comparison).toEqual(result.comparison);
  });

  it("can run a subset of strategies", () => {
    const only = run(inventory, [], { strategies: ["player_first"] });
    expect(only.options.map((o) => o.strategy)).toEqual(["player_first"]);
    expectAllValid(inventory, only);
  });
});

describe("optimizer: structured instructions (mandatory)", () => {
  const inventory = build();
  const adv = inventory.matches.filter((m) => m.divisionId === "ADV");
  const intMatches = inventory.matches.filter((m) => m.divisionId === "INT");

  it("Advanced before noon: every Advanced match ends by 12:00", () => {
    const instructions = [mandatory({ id: "adv-am", kind: "time_window", selector: { divisionIds: ["ADV"] }, latestEnd: { minute: 12 * 60 } })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      for (const m of adv) expect(interval(inventory, o.schedule, m.id).end % 1440).toBeLessThanOrEqual(12 * 60);
    }
  });

  it("a division cannot start before 1 PM", () => {
    const instructions = [mandatory({ id: "int-pm", kind: "time_window", selector: { divisionIds: ["INT"] }, earliestStart: { minute: 13 * 60 } })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      for (const m of intMatches) expect(interval(inventory, o.schedule, m.id).start % 1440).toBeGreaterThanOrEqual(13 * 60);
    }
  });

  it("reserves a court for medal matches only", () => {
    const instructions = [mandatory({ id: "c5", kind: "court_reservation", courtIds: ["C5"], selector: { roles: ["medal"] } })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    const medal = new Set(adv.filter((m) => m.label === "F" || m.label === "3P").map((m) => m.id));
    for (const o of result.options) {
      for (const a of o.schedule.assignments) if (a.courtId === "C5") expect(medal.has(a.matchId)).toBe(true);
    }
  });

  it("keeps a division on an allowlist of courts", () => {
    const instructions = [mandatory({ id: "int-courts", kind: "court_allowlist", selector: { divisionIds: ["INT"] }, courtIds: ["C1", "C2"] })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      for (const m of intMatches) expect(["C1", "C2"]).toContain(interval(inventory, o.schedule, m.id).court);
    }
  });

  it("blocks a court during a period", () => {
    const instructions = [
      mandatory({ id: "c3-lunch", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY1, start: 12 * 60, end: 13 * 60 } }),
      mandatory({ id: "c3-lunch2", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY2, start: 12 * 60, end: 13 * 60 } }),
    ];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      for (const a of o.schedule.assignments) {
        if (a.courtId !== "C3") continue;
        const end = a.start + inventory.matchById.get(a.matchId)!.durationMinutes;
        expect(a.start < 13 * 60 && 12 * 60 < end).toBe(false);
      }
    }
  });

  it("applies a minimum rest between a player's matches", () => {
    const instructions = [mandatory({ id: "rest", kind: "min_rest", divisionIds: ["INT", "BEG"], minutes: 60 })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    const teams = inventory.config.divisions.find((d) => d.id === "INT")!.teams;
    for (const o of result.options) {
      for (const team of teams) {
        const own = intMatches
          .filter((m) => m.slots.some((s) => s.type === "team" && s.teamId === team.id))
          .map((m) => interval(inventory, o.schedule, m.id))
          .sort((x, y) => x.start - y.start);
        for (let k = 1; k < own.length; k++) expect(own[k]!.start - own[k - 1]!.end).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it("completes a division before a dated deadline", () => {
    const instructions = [mandatory({ id: "deadline", kind: "time_window", selector: { divisionIds: ["BEG"] }, latestEnd: { day: DAY1, minute: 15 * 60 } })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      for (const m of inventory.matches.filter((x) => x.divisionId === "BEG")) {
        const iv = interval(inventory, o.schedule, m.id);
        expect(iv.end).toBeLessThanOrEqual(15 * 60);
      }
    }
  });

  it("restricts a stage: knockout matches only after 14:00, groups unrestricted", () => {
    const instructions = [mandatory({ id: "ko-pm", kind: "time_window", selector: { divisionIds: ["ADV"], phases: ["knockout"] }, earliestStart: { minute: 14 * 60 } })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      for (const m of adv.filter((x) => x.phase === "knockout")) expect(interval(inventory, o.schedule, m.id).start % 1440).toBeGreaterThanOrEqual(14 * 60);
    }
  });

  it("honours locked placements and plans around them", () => {
    const final = adv.find((m) => m.label === "F")!;
    const instructions = [mandatory({ id: "lock", kind: "locked_placement", matchId: final.id, courtId: "C2", day: DAY2, start: 16 * 60 })];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    for (const o of result.options) {
      expect(o.schedule.assignments.find((a) => a.matchId === final.id)).toEqual({ matchId: final.id, courtId: "C2", day: DAY2, start: 16 * 60 });
    }
  });

  it("combines several instructions at once", () => {
    const instructions = [
      mandatory({ id: "a", kind: "time_window", selector: { divisionIds: ["ADV"] }, latestEnd: { minute: 14 * 60 } }),
      mandatory({ id: "b", kind: "court_reservation", courtIds: ["C5"], selector: { roles: ["medal"] } }),
      mandatory({ id: "c", kind: "court_allowlist", selector: { divisionIds: ["INT"] }, courtIds: ["C1", "C2"] }),
      mandatory({ id: "d", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY1, start: 12 * 60, end: 13 * 60 } }),
      mandatory({ id: "e", kind: "min_rest", divisionIds: ["BEG"], minutes: 40 }),
    ];
    expectAllValid(inventory, run(inventory, instructions), instructions);
  });
});

describe("optimizer: preferences are measured and optimised, never enforced", () => {
  const inventory = build();

  it("an impossible preference still yields valid schedules, with a measured penalty", () => {
    const instructions = [preference({ id: "all-early", kind: "time_window", selector: {}, latestEnd: { minute: 9 * 60 } }, 2)];
    const result = run(inventory, instructions);
    expectAllValid(inventory, result, instructions);
    expect(result.options.every((o) => o.metrics.preferencePenalty > 0)).toBe(true);
  });

  it("the same rule as a mandatory instruction is reported as unschedulable, with reasons", () => {
    const result = run(inventory, [mandatory({ id: "all-early", kind: "time_window", selector: {}, latestEnd: { minute: 9 * 60 } })]);
    expect(result.status).toBe("no_schedule");
    expect(result.options).toEqual([]);
    expect(result.failure!.unplaced.length).toBeGreaterThan(0);
    expect(result.failure!.unplaced[0]!.reason).toMatch(/window|start|court/);
    expect(result.failure!.feasibility).toBeDefined();
  });

  it("a satisfiable preference is satisfied better than by chance", () => {
    const instructions = [preference({ id: "adv-courts", kind: "court_allowlist", selector: { divisionIds: ["ADV"] }, courtIds: ["C1"] }, 5)];
    const without = run(inventory);
    const withPref = run(inventory, instructions);
    const onC1 = (r: OptimizeResult, i: number) =>
      r.options[i]!.schedule.assignments.filter((a) => a.courtId === "C1" && inventory.matchById.get(a.matchId)!.divisionId === "ADV").length;
    const total = inventory.matches.filter((m) => m.divisionId === "ADV").length;
    // Most Advanced matches end up on the preferred court; the unconstrained run does not do that.
    expect(onC1(withPref, 0)).toBeGreaterThan(total / 2);
    expect(onC1(withPref, 0)).toBeGreaterThan(onC1(without, 0));
  });

  it("consecutive blocks reduce overlap between the divisions' time spans", () => {
    const span = (r: OptimizeResult, divisionId: string) => {
      const ids = inventory.matches.filter((m) => m.divisionId === divisionId).map((m) => m.id);
      const ivs = ids.map((id) => interval(inventory, r.options[0]!.schedule, id));
      return { start: Math.min(...ivs.map((i) => i.start)), end: Math.max(...ivs.map((i) => i.end)) };
    };
    const overlap = (r: OptimizeResult) => {
      const a = span(r, "ADV");
      const b = span(r, "INT");
      return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    };
    const free = run(inventory, [], { strategies: ["balanced_operations"] });
    const blocked = run(inventory, [preference({ id: "blocks", kind: "consecutive_blocks", divisionIds: ["ADV", "INT"] }, 10)], { strategies: ["balanced_operations"] });
    expectAllValid(inventory, blocked, [preference({ id: "blocks", kind: "consecutive_blocks", divisionIds: ["ADV", "INT"] }, 10)]);
    expect(overlap(blocked)).toBeLessThanOrEqual(overlap(free));
  });
});

describe("optimizer: failure and degradation", () => {
  it("rejects invalid instructions without scheduling anything", () => {
    const inventory = build();
    const result = run(inventory, [mandatory({ id: "bad", kind: "court_allowlist", selector: {}, courtIds: ["C99"] })]);
    expect(result.status).toBe("invalid_instructions");
    expect(result.options).toEqual([]);
    expect(result.instructionIssues!.map((i) => i.code)).toContain("UNKNOWN_COURT");
  });

  it("reports a proven-infeasible tournament with the feasibility analysis instead of a schedule", () => {
    const tight = buildInventory(
      tournament({ courts: courts(1, [fullDay(DAY1, 8 * 60, 10 * 60)]), divisions: [{ id: "BIG", categoryId: "MD", teamCount: 8, stages: stages.roundRobin() }] }),
    );
    const result = run(tight);
    expect(result.status).toBe("no_schedule");
    expect(result.failure!.feasibility.status).toBe("infeasible");
    expect(result.failure!.unplaced.length).toBeGreaterThan(0);
  });

  it("a hit time budget degrades gracefully: still valid, flagged as budget-limited", () => {
    const inventory = build();
    let now = 0;
    const result = optimizeSchedules(inventory, { seed: 2, budget: { totalMs: 3000 }, clock: () => (now += 400) });
    expectAllValid(inventory, result);
    expect(result.options.some((o) => o.budgetExhausted)).toBe(true);
  });

  it("rejects an invalid granularity", () => {
    expect(() => run(build(), [], { granularityMinutes: 7 })).toThrow(/granularity/);
  });
});

describe("optimizer: duplicate and equivalent options are detected, never fabricated", () => {
  it("a single-match tournament cannot yield different schedules and says so", () => {
    const inventory = buildInventory(tournament({ courts: courts(1, [fullDay()]), divisions: [{ id: "ONE", categoryId: "MD", teamCount: 2, stages: stages.roundRobin() }] }));
    const result = run(inventory);
    expectAllValid(inventory, result);
    expect(result.options).toHaveLength(3);
    expect(result.comparison.relations.every((r) => r.identical && !r.materiallyDifferent)).toBe(true);
    expect(result.comparison.equivalent.length).toBeGreaterThan(0);
    const text = result.comparison.explanation.join(" ");
    expect(text).toContain("materially equivalent");
    expect(text).toContain("does not prove");
    expect(result.recommended!.strategy).toBe("balanced_operations");
  });

  it("when options are reported as different, they differ by the stated measures", () => {
    const result = run(build());
    for (const r of result.comparison.relations.filter((x) => x.materiallyDifferent)) {
      const a = result.options.find((o) => o.strategy === r.a)!.metrics;
      const b = result.options.find((o) => o.strategy === r.b)!.metrics;
      expect(r.differsOn.length).toBeGreaterThan(0);
      if (r.differsOn.includes("finish_time")) expect(Math.abs(a.finishMinute - b.finishMinute)).toBeGreaterThanOrEqual(15);
      if (r.differsOn.includes("back_to_backs")) expect(a.backToBackCount).not.toBe(b.backToBackCount);
    }
  });
});
