import { describe, expect, it } from "vitest";
import { analyzeFeasibility, buildInventory, earliestFit, slotCapacity, type TournamentConfig } from "../../src/index.js";
import { courts, DAY1, fullDay, stages, tournament } from "../support/fixtures.js";

const check = (config: TournamentConfig, id: string) => analyzeFeasibility(buildInventory(config)).checks.find((c) => c.id === id)!;

describe("feasibility primitives", () => {
  it("slot capacity counts whole matches per window with turnover", () => {
    // 600 minutes, 30-minute matches, 5-minute turnover: floor(605 / 35) = 17.
    expect(slotCapacity([[{ start: 0, end: 600 }]], 30, 5)).toBe(17);
    expect(slotCapacity([[{ start: 0, end: 50 }, { start: 60, end: 110 }]], 30, 0)).toBe(2);
  });

  it("earliestFit finds the first window that can hold the match", () => {
    const windows = [{ start: 0, end: 40 }, { start: 100, end: 200 }];
    expect(earliestFit(windows, 20, 30)).toBe(100);
    expect(earliestFit(windows, 0, 30)).toBe(0);
    expect(earliestFit(windows, 180, 30)).toBeNull();
  });
});

describe("analyzeFeasibility", () => {
  it("passes a comfortable event and estimates the earliest finish from the dependency chain", () => {
    const report = analyzeFeasibility(
      buildInventory(tournament({ courts: courts(4, [fullDay()]), divisions: [{ id: "MD", teamCount: 8, stages: stages.groupsToKnockout(2, 2) }] })),
    );
    expect(report.status).toBe("no_blocking_issue_found");
    // Group of 4: 3 matches per team, 30 min + 20 min rest -> 08:00 + 130 = 10:10.
    // Semis 10:30-11:00, final 11:20-11:50.
    expect(report.divisions[0]!.earliestFinish).toEqual({ day: DAY1, minute: 11 * 60 + 50 });
  });

  it("proves court capacity shortfall and quantifies remedies that each fix it", () => {
    const config = tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "RR", teamCount: 12, stages: stages.roundRobin() }] });
    const c = check(config, "division_capacity:RR");
    expect(c.passed).toBe(false);
    expect(c.required).toBe(66);
    expect(c.available).toBe(34);
    const byKind = new Map(c.remedies.map((r) => [r.kind, r.value]));
    // Neither zero turnover nor a longer last day can create 66 slots, so those are not offered.
    expect([...byKind.keys()].sort()).toEqual(["add_courts", "shorten_match_duration"]);

    const moreCourts = tournament({ courts: courts(2 + byKind.get("add_courts")!, [fullDay()]), divisions: [{ id: "RR", teamCount: 12, stages: stages.roundRobin() }] });
    expect(check(moreCourts, "division_capacity:RR").passed).toBe(true);
    const fewerCourts = tournament({ courts: courts(1 + byKind.get("add_courts")!, [fullDay()]), divisions: [{ id: "RR", teamCount: 12, stages: stages.roundRobin() }] });
    expect(check(fewerCourts, "division_capacity:RR").passed).toBe(false);

    const shorter = tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "RR", teamCount: 12, stages: stages.roundRobin(), duration: byKind.get("shorten_match_duration")! }] });
    expect(check(shorter, "division_capacity:RR").passed).toBe(true);
    const notShortEnough = tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "RR", teamCount: 12, stages: stages.roundRobin(), duration: byKind.get("shorten_match_duration")! + 1 }] });
    expect(check(notShortEnough, "division_capacity:RR").passed).toBe(false);
  });

  it("proves a dependency chain that cannot fit and says more courts will not help", () => {
    // 32-team knockout, 60 min matches, 60 min rest, 4-hour window on 16 courts.
    const config = tournament({
      courts: courts(16, [fullDay(DAY1, 8 * 60, 12 * 60)]),
      divisions: [{ id: "KO", teamCount: 32, stages: stages.knockout(), duration: 60 }],
      rules: { minRestMinutes: 60 },
    });
    const report = analyzeFeasibility(buildInventory(config));
    expect(report.status).toBe("infeasible");
    expect(check(config, "division_capacity:KO").passed).toBe(true);
    const chain = check(config, "dependency_chain:KO");
    expect(chain.passed).toBe(false);
    expect(chain.message).toMatch(/adding courts does not help/);
    expect(chain.remedies.map((r) => r.kind)).not.toContain("add_courts");
    // Five rounds need 5 x 60 + 4 x 60 = 540 min; no shorter match or rest fits 240 min.
    expect(chain.required).toBeNull();
    expect(chain.remedies).toEqual([expect.objectContaining({ kind: "extend_last_day", value: 300 })]);
    const longer = tournament({
      courts: courts(16, [fullDay(DAY1, 8 * 60, 17 * 60)]),
      divisions: [{ id: "KO", teamCount: 32, stages: stages.knockout(), duration: 60 }],
      rules: { minRestMinutes: 60 },
    });
    expect(check(longer, "dependency_chain:KO").passed).toBe(true);
    // Single-entry players are not repeated as separate player-load failures.
    expect(report.checks.filter((c) => c.kind === "player_load")).toEqual([]);
  });

  it("offers a shorter-rest remedy when that alone fixes the chain", () => {
    const config = tournament({
      courts: courts(16, [fullDay(DAY1, 8 * 60, 12 * 60)]),
      divisions: [{ id: "KO", teamCount: 16, stages: stages.knockout(), duration: 45 }],
      rules: { minRestMinutes: 30 },
    });
    // 4 x 45 + 3 x 30 = 270 > 240; rest 20 gives 240.
    const chain = check(config, "dependency_chain:KO");
    expect(chain.passed).toBe(false);
    expect(chain.remedies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "reduce_rest", value: 20 })]));
    config.rules.minRestMinutes = 20;
    expect(check(config, "dependency_chain:KO").passed).toBe(true);
  });

  it("detects a match duration longer than every usable window", () => {
    const config = tournament({
      courts: courts(4, [fullDay()]),
      divisions: [{ id: "MD", teamCount: 4, stages: stages.roundRobin(), duration: 45, extra: { playWindows: [{ day: DAY1, start: 600, end: 630 }] } }],
    });
    const c = check(config, "window_fit:MD");
    expect(c.passed).toBe(false);
    expect(c.remedies[0]).toMatchObject({ kind: "shorten_match_duration", value: 30 });
  });

  it("detects a multi-division player who cannot play every possible match", () => {
    const config = tournament({
      courts: courts(8, [fullDay(DAY1, 8 * 60, 12 * 60)]),
      divisions: [
        { id: "MD", teamCount: 5, stages: stages.roundRobin() },
        { id: "XD", categoryId: "XD", teamCount: 5, stages: stages.roundRobin() },
      ],
      rules: { minRestMinutes: 30 },
    });
    config.divisions[1]!.teams[0]!.playerIds[0] = "MD-p1a";
    config.players = config.players.filter((p) => p.id !== "XD-p1a");
    // 4 + 4 = 8 matches of 30 min with 30 min rest in 240 min: floor(270 / 60) = 4.
    const c = check(config, "player_load:MD-p1a");
    expect(c.passed).toBe(false);
    expect(c.required).toBe(8);
    expect(c.available).toBe(4);
  });

  it("detects divisions that together overload a shared court set", () => {
    const config = tournament({
      courts: courts(6, [fullDay()]),
      divisions: [
        { id: "A", teamCount: 8, stages: stages.roundRobin(), extra: { eligibleCourtIds: ["C1", "C2"] } },
        { id: "B", teamCount: 8, stages: stages.roundRobin(), extra: { eligibleCourtIds: ["C1", "C2"] } },
      ],
    });
    const report = analyzeFeasibility(buildInventory(config));
    expect(check(config, "division_capacity:A").passed).toBe(true);
    expect(check(config, "division_capacity:B").passed).toBe(true);
    const shared = report.checks.find((c) => c.id === "shared_capacity:C1,C2")!;
    // 56 matches x 35 = 1960 > 2 x 605 = 1210.
    expect(shared.passed).toBe(false);
    expect(report.status).toBe("infeasible");
  });

  it("never changes the configuration it analyses", () => {
    const config = tournament({ courts: courts(1, [fullDay()]), divisions: [{ id: "RR", teamCount: 12, stages: stages.roundRobin() }] });
    const snapshot = JSON.stringify(config);
    analyzeFeasibility(buildInventory(config));
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});
