import { describe, expect, it } from "vitest";
import {
  analyzeFeasibility,
  analyzeSchedule,
  buildInventory,
  describeTimeAllocation,
  optimizeSchedules,
  validateConfig,
  validateSchedule,
  type Schedule,
} from "../../src/index.js";
import { buildEchelonDayConfig } from "../../bench/echelon-day.mjs";
import { courts, DAY1, fullDay, stages, tournament } from "../support/fixtures.js";

/**
 * The time-allocation model keeps five quantities apart: active play, the transition allowance that is already inside the
 * scheduled slot, the slot itself, an additional turnover buffer that exists only when configured, and participant recovery.
 * These tests make sure the transition is never counted a second time.
 */

const slot = 20;
/** The two matches of the team that plays in the first match of a 3-team round robin. */
const matchesOfFirstTeam = (inventory: ReturnType<typeof buildInventory>) => {
  const team = (inventory.matches[0]!.slots[0] as { teamId: string }).teamId;
  return inventory.matches.filter((m) => m.slots.some((s) => s.type === "team" && s.teamId === team));
};
const small = (turnover: number, windowMinutes: number, rest = 0) =>
  buildInventory(
    tournament({
      courts: courts(1, [fullDay(DAY1, 9 * 60, 9 * 60 + windowMinutes)]),
      divisions: [{ id: "S", categoryId: "MD", teamCount: 3, stages: stages.roundRobin(), duration: slot }],
      rules: { courtTurnoverMinutes: turnover, minRestMinutes: rest },
    }),
  );

describe("time allocation: configuration", () => {
  it("rejects a slot that is not play + transition, naming the double count", () => {
    const config = buildEchelonDayConfig();
    config.divisions[0]!.matchDurationMinutes = 25; // 15 + 5 was meant, 5 was added again
    const issue = validateConfig(config).issues.find((i) => i.code === "TIME_ALLOCATION_MISMATCH")!;
    expect(issue.message).toContain("already inside the scheduled slot");
    expect(issue.message).toContain("25");
  });

  it("rejects a play or transition value larger than the slot, even when only one is given", () => {
    for (const patch of [{ transitionMinutes: 50 }, { playMinutes: 50 }]) {
      const config = buildEchelonDayConfig();
      const { playMinutes: _p, transitionMinutes: _t, ...rest } = config.divisions[0]!;
      config.divisions[0] = { ...rest, ...patch };
      expect(validateConfig(config).issues.map((i) => i.code)).toContain("TIME_ALLOCATION_MISMATCH");
    }
  });

  it("accepts 15 minutes of play + 5 of transition as a 20-minute slot with no extra turnover", () => {
    const config = buildEchelonDayConfig();
    expect(validateConfig(config).valid).toBe(true);
    const row = describeTimeAllocation(config)[0]!;
    expect(row).toMatchObject({
      activePlayMinutes: 15,
      transitionAllowanceMinutes: 5,
      scheduledSlotMinutes: 20,
      additionalTurnoverMinutes: 0,
      medalPlanningEstimateMinutes: 30,
      courtCycleMinutes: 20,
    });
    expect(row.participantCycleMinutes).toBe(20 + row.minimumRecoveryMinutes);
  });

  it("keeps additional turnover separate and explicit", () => {
    const config = buildEchelonDayConfig({ turnover: 5 });
    const row = describeTimeAllocation(config)[0]!;
    expect(row.scheduledSlotMinutes).toBe(20);
    expect(row.additionalTurnoverMinutes).toBe(5);
    expect(row.courtCycleMinutes).toBe(25);
  });
});

describe("time allocation: court occupancy", () => {
  const pair = (inventory: ReturnType<typeof small>) => {
    const [a, b] = inventory.matches;
    const c = inventory.matches[2]!;
    return { a: a!, b: b!, c };
  };
  const schedule = (inventory: ReturnType<typeof small>, gap: number): Schedule => {
    const { a, b, c } = pair(inventory);
    return {
      tournamentId: inventory.config.id,
      assignments: [
        { matchId: a.id, courtId: "C1", day: DAY1, start: 9 * 60 },
        { matchId: b.id, courtId: "C1", day: DAY1, start: 9 * 60 + slot + gap },
        { matchId: c.id, courtId: "C1", day: DAY1, start: 9 * 60 + 2 * (slot + gap) },
      ],
    };
  };

  it("allows the next match to start exactly when the 20-minute slot ends when no turnover is configured", () => {
    const inventory = small(0, 60);
    expect(validateSchedule(inventory, schedule(inventory, 0)).violations).toEqual([]);
  });

  it("requires the configured turnover, and only that, when one is configured", () => {
    const inventory = small(5, 70);
    const codes = (gap: number) => validateSchedule(inventory, schedule(inventory, gap)).violations.map((v) => v.code);
    expect(codes(0)).toContain("COURT_TURNOVER");
    expect(codes(4)).toContain("COURT_TURNOVER");
    expect(codes(5)).not.toContain("COURT_TURNOVER");
  });

  it("fits exactly three slots in a 60-minute window without turnover, and proves four-slot demand does not fit with turnover", () => {
    const noTurnover = optimizeSchedules(small(0, 60), { seed: 1, budget: { iterationsPerStrategy: 200 } });
    expect(noTurnover.status).toBe("ok");
    expect(noTurnover.options[0]!.metrics.finishMinute).toBe(9 * 60 + 60);
    expect(noTurnover.options[0]!.metrics.idleMinutes).toBe(0);

    const withTurnover = optimizeSchedules(small(5, 60), { seed: 1, budget: { iterationsPerStrategy: 200 } });
    expect(withTurnover.status).toBe("no_schedule");
    expect(withTurnover.failure!.kind).toBe("proven_infeasible");
  });

  it("counts match minutes in capacity checks without adding a hidden turnover", () => {
    const inventory = buildInventory(buildEchelonDayConfig());
    const group = analyzeFeasibility(inventory).checks.find((c) => c.id.startsWith("window_group:GD-"))!;
    // 60 preliminary + 6 semifinal matches at 20 minutes, 6 medal matches at 30: 1500, not 1500 + 72 x 5.
    expect(group.required).toBe(60 * 20 + 6 * 20 + 6 * 30);
    expect(group.available).toBe(10 * 180);
  });
});

describe("time allocation: participant recovery", () => {
  it("measures recovery from the end of the occupied slot, adding neither transition nor turnover", () => {
    const inventory = small(5, 200, 10);
    const own = matchesOfFirstTeam(inventory);
    const [first, second] = own;
    const schedule: Schedule = {
      tournamentId: inventory.config.id,
      assignments: [
        { matchId: first!.id, courtId: "C1", day: DAY1, start: 9 * 60 },
        { matchId: second!.id, courtId: "C1", day: DAY1, start: 9 * 60 + slot + 10 },
      ],
    };
    const report = analyzeSchedule(inventory, schedule);
    // Start 30 minutes after the first start = 20-minute slot + 10 minutes of recovery. Turnover (5) is not part of it.
    expect(report.recovery.minMinutes).toBe(10);
    expect(report.assumptions.courtTurnoverIncludedInRecovery).toBe(false);
  });

  it("does not let the validator count the transition as recovery: a gap below the minimum recovery is still a violation", () => {
    const inventory = small(0, 200, 10);
    const own = matchesOfFirstTeam(inventory);
    const [first, second] = own;
    const bad: Schedule = {
      tournamentId: inventory.config.id,
      assignments: [
        { matchId: first!.id, courtId: "C1", day: DAY1, start: 9 * 60 },
        { matchId: second!.id, courtId: "C1", day: DAY1, start: 9 * 60 + slot + 5 },
        ...inventory.matches
          .filter((m) => m !== first && m !== second)
          .map((m) => ({ matchId: m.id, courtId: "C1", day: DAY1, start: 9 * 60 + 100 })),
      ],
    };
    expect(validateSchedule(inventory, bad).violations.map((v) => v.code)).toContain("PLAYER_REST");
  });
});
