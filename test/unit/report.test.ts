import { describe, expect, it } from "vitest";
import { analyzeFeasibility, analyzeSchedule, buildInventory, optimizeSchedules, validateConfig, type Inventory, type Schedule } from "../../src/index.js";
import { courts, DAY1, DAY2, fullDay, stages, tournament } from "../support/fixtures.js";

const build = () =>
  buildInventory(
    tournament({
      days: [DAY1, DAY2],
      courts: courts(4, [fullDay(DAY1), fullDay(DAY2)]),
      divisions: [
        { id: "A", categoryId: "MD", teamCount: 8, stages: stages.groupsToKnockout(2, 2, true), extra: { medalMatchDurationMinutes: 40 } },
        { id: "B", categoryId: "WD", teamCount: 4, stages: stages.roundRobin() },
      ],
      rules: { courtTurnoverMinutes: 5, minRestMinutes: 15 },
    }),
  );

const absolute = (inventory: Inventory, a: Schedule["assignments"][number]) => inventory.config.days.indexOf(a.day) * 1440 + a.start;

/** Independent brute-force recovery gaps, written separately from analyzeSchedule. */
function bruteGaps(inventory: Inventory, schedule: Schedule): number[] {
  const rows = schedule.assignments.map((a) => ({ a, m: inventory.matchById.get(a.matchId)!, start: absolute(inventory, a) }));
  const end = new Map(rows.map((r) => [r.m.id, r.start + r.m.durationMinutes]));
  const gaps: number[] = [];
  const teams = new Set(rows.flatMap((r) => r.m.slots.flatMap((s) => (s.type === "team" ? [s.teamId] : []))));
  for (const team of teams) {
    const own = rows.filter((r) => r.m.slots.some((s) => s.type === "team" && s.teamId === team)).sort((x, y) => x.start - y.start);
    for (let k = 1; k < own.length; k++) gaps.push(own[k]!.start - (own[k - 1]!.start + own[k - 1]!.m.durationMinutes));
  }
  for (const r of rows) for (const s of r.m.slots) if (s.type === "winner" || s.type === "loser") gaps.push(r.start - end.get(s.matchId)!);
  return gaps;
}

describe("analyzeSchedule", () => {
  const inventory = build();
  const result = optimizeSchedules(inventory, { seed: 3, budget: { iterationsPerStrategy: 600 } });

  it("matches an independent brute-force recomputation of recovery for every option", () => {
    expect(result.status).toBe("ok");
    for (const option of result.options) {
      const report = analyzeSchedule(inventory, option.schedule);
      const gaps = bruteGaps(inventory, option.schedule);
      expect(report.recovery.gapCount).toBe(gaps.length);
      expect(report.recovery.minMinutes).toBe(Math.min(...gaps));
      expect(report.recovery.maxMinutes).toBe(Math.max(...gaps));
      expect(report.recovery.meanMinutes).toBeCloseTo(gaps.reduce((a, b) => a + b, 0) / gaps.length, 9);
      const threshold = report.assumptions.backToBackThresholdMinutes;
      expect(report.recovery.backToBackOccurrences).toBe(gaps.filter((g) => g < threshold).length);
      expect(report.recovery.shortest[0]!.gapMinutes).toBe(Math.min(...gaps));
    }
  });

  it("measures recovery from the end of allocated court time and ignores court turnover", () => {
    const option = result.options[0]!;
    const report = analyzeSchedule(inventory, option.schedule);
    expect(report.assumptions).toMatchObject({ recoveryMeasuredFrom: "end_of_allocated_court_time", courtTurnoverIncludedInRecovery: false });
    // The hard rule uses the same basis: no gap is shorter than the minimum rest, whatever the turnover.
    expect(report.recovery.minMinutes!).toBeGreaterThanOrEqual(inventory.config.rules.minRestMinutes);
    const turnoverFree = analyzeSchedule(buildInventory({ ...inventory.config, rules: { ...inventory.config.rules, courtTurnoverMinutes: 0 } }), option.schedule);
    expect(turnoverFree.recovery.minMinutes).toBe(report.recovery.minMinutes);
    expect(turnoverFree.recovery.meanMinutes).toBe(report.recovery.meanMinutes);
  });

  it("reports court usage that adds up", () => {
    for (const option of result.options) {
      const report = analyzeSchedule(inventory, option.schedule);
      expect(report.courts.reduce((s, c) => s + c.matches, 0)).toBe(inventory.matches.length);
      expect(report.courts.reduce((s, c) => s + c.busyMinutes, 0)).toBe(inventory.matches.reduce((s, m) => s + m.durationMinutes, 0));
      for (const c of report.courts) {
        expect(c.utilization).toBeGreaterThanOrEqual(0);
        expect(c.utilization).toBeLessThanOrEqual(1);
      }
      expect(report.start!.absolute).toBeLessThanOrEqual(report.finish!.absolute);
      expect(report.spanMinutes).toBe(report.finish!.absolute - report.start!.absolute);
      expect(report.playingDayMinutes).toBeLessThanOrEqual(report.spanMinutes);
    }
  });

  it("measures each division's playoff transition against the pools its semifinals depend on, never below the rest rule", () => {
    for (const option of result.options) {
      const report = analyzeSchedule(inventory, option.schedule);
      for (const d of report.divisions) {
        if (d.transitionMinutes !== null) expect(d.transitionMinutes).toBeGreaterThanOrEqual(inventory.config.rules.minRestMinutes);
      }
    }
  });

  it("describes a partial schedule honestly", () => {
    const partial: Schedule = { ...result.options[0]!.schedule, assignments: result.options[0]!.schedule.assignments.slice(0, 5) };
    const report = analyzeSchedule(inventory, partial);
    expect(report.scheduledMatches).toBe(5);
    expect(report.warnings.some((w) => w.code === "UNSCHEDULED_MATCHES")).toBe(true);
    expect(analyzeSchedule(inventory, { tournamentId: inventory.config.id, assignments: [] }).start).toBeNull();
  });

  it("flags a back-to-back and a minimum-slack gap in a hand-made schedule", () => {
    const small = buildInventory(tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "S", categoryId: "MD", teamCount: 3, stages: stages.roundRobin() }] }));
    // Three matches, each team plays two of them. Place them 30 minutes long, 15 minutes apart (the minimum rest).
    const [m1, m2, m3] = small.matches;
    const schedule: Schedule = {
      tournamentId: small.config.id,
      assignments: [
        { matchId: m1!.id, courtId: "C1", day: DAY1, start: 480 },
        { matchId: m2!.id, courtId: "C1", day: DAY1, start: 480 + 30 + 5 + 15 },
        { matchId: m3!.id, courtId: "C2", day: DAY1, start: 480 + 2 * 50 },
      ],
    };
    const report = analyzeSchedule(small, schedule);
    expect(report.recovery.gapCount).toBe(bruteGaps(small, schedule).length);
    expect(report.recovery.minMinutes).toBe(Math.min(...bruteGaps(small, schedule)));
    expect(report.warnings.some((w) => w.code === "NO_SLACK")).toBe(report.recovery.minMinutes! <= small.config.rules.minRestMinutes + 5);
  });
});

describe("medalMatchDurationMinutes", () => {
  const inventory = build();

  it("applies to the final and the third-place match only", () => {
    const a = inventory.matches.filter((m) => m.divisionId === "A");
    const medal = a.filter((m) => m.thirdPlace || m.label === "F");
    expect(medal).toHaveLength(2);
    expect(medal.every((m) => m.durationMinutes === 40)).toBe(true);
    expect(a.filter((m) => !medal.includes(m)).every((m) => m.durationMinutes === 30)).toBe(true);
    expect(inventory.matches.filter((m) => m.divisionId === "B").every((m) => m.durationMinutes === 30)).toBe(true);
  });

  it("defaults to the division duration and is validated", () => {
    expect(
      buildInventory(tournament({ courts: courts(1, [fullDay()]), divisions: [{ id: "A", categoryId: "MD", teamCount: 4, stages: stages.knockout(true) }] })).matches.every((m) => m.durationMinutes === 30),
    ).toBe(true);
    const bad = { ...inventory.config, divisions: inventory.config.divisions.map((d) => (d.id === "A" ? { ...d, medalMatchDurationMinutes: 0 } : d)) };
    expect(validateConfig(bad).issues.some((i) => i.code === "INVALID_DURATION")).toBe(true);
  });

  it("keeps feasibility proofs sound when medal matches are shorter or longer than the others", () => {
    const shorter = buildInventory({ ...inventory.config, divisions: inventory.config.divisions.map((d) => (d.id === "A" ? { ...d, medalMatchDurationMinutes: 10 } : d)) });
    expect(analyzeFeasibility(shorter).status).toBe("no_blocking_issue_found");
    // Capacity demand uses the real per-match durations.
    expect(analyzeFeasibility(inventory).totals.matchMinutes).toBe(inventory.matches.reduce((s, m) => s + m.durationMinutes, 0));
  });

  it("the optimizer schedules the longer medal slots", () => {
    const result = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 300 } });
    expect(result.status).toBe("ok");
    for (const o of result.options) expect(o.schedule.assignments.find((a) => a.matchId === "A:ko:R2:M1")).toBeDefined();
    expect(inventory.matchById.get("A:ko:R2:M1")!.durationMinutes).toBe(40);
  });
});
