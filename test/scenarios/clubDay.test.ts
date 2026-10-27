import { describe, expect, it } from "vitest";
import {
  analyzeFeasibility,
  buildDependencyGraph,
  buildInventory,
  ParticipantModel,
  validateConfig,
  validateSchedule,
  type KnockoutStageStructure,
} from "../../src/index.js";
import { oracleSchedule } from "../support/oracleScheduler.js";
import { playAll } from "../support/simulate.js";
import { clubDay } from "./clubDay.js";

describe("scenario: one-day club event", () => {
  const config = clubDay();
  const inventory = buildInventory(config);

  it("is a valid configuration", () => {
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("generates the expected match inventory", () => {
    const count = (id: string) => inventory.matches.filter((m) => m.divisionId === id).length;
    expect(count("MD35")).toBe(18 + 5); // 3 x 6 group matches; 6-team knockout
    expect(count("WD35")).toBe(12 + 4); // semis, final, third place
    expect(count("XD40")).toBe(24 + 7); // quarterfinals onward
    expect(count("OPEN")).toBe(8);
    expect(inventory.matches).toHaveLength(78);
    const md = inventory.divisions.find((d) => d.divisionId === "MD35")!.stages[1] as KnockoutStageStructure;
    expect(md.size).toBe(8);
    expect(md.sameGroupFirstMatchMeetings).toBe(0);
    expect(md.rounds.map((r) => r.length)).toEqual([2, 2, 1]);
  });

  it("knows which players are exposed to cross-division conflicts", () => {
    const model = new ParticipantModel(inventory, buildDependencyGraph(inventory));
    const mdFinal = inventory.matches.find((m) => m.divisionId === "MD35" && m.label === "F")!;
    const xdFinal = inventory.matches.find((m) => m.divisionId === "XD40" && m.label === "F")!;
    const shared = model.sharedPlayers(mdFinal.id, xdFinal.id);
    expect(shared.certainty).toBe("possible");
    expect(shared.playerIds).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
    // Open players are independent of everyone else.
    const openFinal = inventory.matches.find((m) => m.divisionId === "OPEN" && m.label === "F")!;
    expect(model.sharedPlayers(openFinal.id, xdFinal.id).playerIds).toEqual([]);
  });

  it("finds no blocking feasibility issue and estimates finish times", () => {
    const report = analyzeFeasibility(inventory);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.status).toBe("no_blocking_issue_found");
    const finish = Object.fromEntries(report.divisions.map((d) => [d.divisionId, d.earliestFinish?.minute]));
    // Groups of 4: 3 x 25 + 2 x 15 = 105 -> 09:45; knockout rounds each +15 rest +25.
    expect(finish.MD35).toBe(9 * 60 + 45 + 3 * 40); // 3 knockout rounds -> 11:45
    expect(finish.WD35).toBe(9 * 60 + 45 + 2 * 40); // 11:05
    expect(finish.OPEN).toBe(8 * 60 + 30 + 2 * 45); // 10:00
    expect(report.checks.filter((c) => c.kind === "player_load").map((c) => c.playerId)).toHaveLength(16);
  });

  it("admits an independently validated schedule (test-only greedy) on 8 courts", () => {
    const schedule = oracleSchedule(inventory, 10)!;
    expect(schedule).not.toBeNull();
    const report = validateSchedule(inventory, schedule);
    expect(report.violations).toEqual([]);
    const lastEnd = Math.max(...schedule.assignments.map((a) => a.start + inventory.matchById.get(a.matchId)!.durationMinutes));
    expect(lastEnd).toBeLessThanOrEqual(18 * 60);
  }, 60_000);

  it("progresses to champions in every division", () => {
    for (const seed of [1, 2, 3]) {
      const state = playAll(inventory, seed);
      for (const d of inventory.divisions) {
        const ko = d.stages[d.stages.length - 1] as KnockoutStageStructure;
        const [a, b] = state.participants.get(ko.finalMatchId)!;
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(state.status.get(ko.finalMatchId)).toBe("completed");
      }
    }
  });
});

describe("scenario variants: over-subscribed club day", () => {
  it("4 courts until 14:00 is proven infeasible with quantified remedies", () => {
    const report = analyzeFeasibility(buildInventory(clubDay({ courtCount: 4, endMinute: 14 * 60 })));
    expect(report.status).toBe("infeasible");
    const shared = report.checks.find((c) => c.kind === "shared_capacity")!;
    expect(shared.passed).toBe(false);
    // 78 matches: 70 x (25+5) + 8 x (30+5) = 2380 court-minutes vs 4 x (360+5) = 1460.
    expect(shared.required).toBe(2380);
    expect(shared.available).toBe(1460);
    expect(shared.remedies[0]!.kind).toBe("add_courts");
    expect(shared.remedies[0]!.value).toBe(3);
  });

  it("a mixed player arriving at 12:00 cannot play every possible match", () => {
    const config = clubDay();
    config.restrictions = [{ id: "m1-late", kind: "unavailable", subject: { type: "player", id: "m1" }, window: { day: config.days[0]!, start: 8 * 60, end: 12 * 60 } }];
    const inventory = buildInventory(config);
    const report = analyzeFeasibility(inventory);
    const load = report.checks.find((c) => c.id === "player_load:m1")!;
    // m1 could play 3 + 3 (MD) and 3 + 3 (XD) = 12 matches; 360 min at 25 + 15 fits floor(375 / 40) = 9.
    expect(load.required).toBe(12);
    expect(load.available).toBe(9);
    expect(load.passed).toBe(false);
  });
});
