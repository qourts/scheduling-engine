import { describe, expect, it } from "vitest";
import { buildInventory, validateSchedule, type Assignment, type Schedule, type TournamentConfig } from "../../src/index.js";
import { courts, DAY1, fullDay, stages, tournament } from "../support/fixtures.js";
import { serialSchedule } from "../support/serialScheduler.js";

const setup = (mutate?: (c: TournamentConfig) => void) => {
  const config = tournament({
    courts: courts(3, [fullDay(DAY1, 8 * 60, 22 * 60)]),
    divisions: [
      { id: "MD", teamCount: 6, stages: stages.groupsToKnockout(2, 2, true) },
      { id: "XD", categoryId: "XD", teamCount: 4, stages: stages.knockout() },
    ],
  });
  // MD-p1a also plays mixed for XD-t1.
  config.divisions[1]!.teams[0]!.playerIds[0] = "MD-p1a";
  config.players = config.players.filter((p) => p.id !== "XD-p1a");
  mutate?.(config);
  const inventory = buildInventory(config);
  const schedule = serialSchedule(inventory)!;
  return { config, inventory, schedule };
};

const at = (s: Schedule, matchId: string) => s.assignments.find((a) => a.matchId === matchId)!;
const codes = (r: ReturnType<typeof validateSchedule>) => r.violations.map((v) => v.code);
const clone = (s: Schedule): Schedule => ({ ...s, assignments: s.assignments.map((a) => ({ ...a })) });

describe("validateSchedule", () => {
  it("accepts a schedule that satisfies every hard rule", () => {
    const { inventory, schedule } = setup();
    const report = validateSchedule(inventory, schedule);
    expect(report.violations).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("flags missing, unknown and duplicate assignments", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    const removed = s.assignments.pop()!;
    s.assignments.push({ ...s.assignments[0]! });
    s.assignments.push({ matchId: "ghost", courtId: "C1", day: DAY1, start: 600 });
    expect(codes(validateSchedule(inventory, s))).toEqual(expect.arrayContaining(["UNSCHEDULED_MATCH", "DUPLICATE_ASSIGNMENT", "UNKNOWN_MATCH"]));
    expect(validateSchedule(inventory, s).violations.find((v) => v.code === "UNSCHEDULED_MATCH")!.matchIds).toEqual([removed.matchId]);
  });

  it("allowPartial skips completeness only", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    s.assignments = s.assignments.slice(0, 5);
    expect(validateSchedule(inventory, s, { allowPartial: true }).valid).toBe(true);
  });

  it("flags unknown courts, days and invalid starts, and the wrong tournament", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    s.tournamentId = "other";
    s.assignments[0]!.courtId = "C99";
    s.assignments[1]!.day = "2027-01-01";
    s.assignments[2]!.start = 12.5;
    expect(codes(validateSchedule(inventory, s))).toEqual(expect.arrayContaining(["WRONG_TOURNAMENT", "UNKNOWN_COURT", "UNKNOWN_DAY", "INVALID_START"]));
  });

  it("detects court overlap and insufficient turnover", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    const [a, b, c] = s.assignments;
    // Two group matches of different groups and different players.
    b!.courtId = a!.courtId;
    b!.start = a!.start + 10;
    expect(codes(validateSchedule(inventory, s))).toContain("COURT_OVERLAP");
    const t = clone(schedule);
    t.assignments[1]!.courtId = t.assignments[0]!.courtId;
    t.assignments[1]!.start = t.assignments[0]!.start + 30 + 2; // turnover is 5
    expect(codes(validateSchedule(inventory, t))).toContain("COURT_TURNOVER");
    expect(c).toBeDefined();
  });

  it("detects matches outside court availability and division windows, and ineligible courts", () => {
    const { inventory, schedule } = setup((c) => {
      c.divisions[0]!.playWindows = [{ day: DAY1, start: 8 * 60, end: 22 * 60 }];
      c.divisions[1]!.eligibleCourtIds = ["C1", "C2"];
    });
    const s = clone(schedule);
    at(s, "MD:grp:A:R1:M1").start = 21 * 60 + 45; // ends 22:15
    const xd = s.assignments.find((a) => a.matchId.startsWith("XD"))!;
    xd.courtId = "C3";
    expect(codes(validateSchedule(inventory, s))).toEqual(
      expect.arrayContaining(["OUTSIDE_COURT_AVAILABILITY", "OUTSIDE_DIVISION_WINDOW", "COURT_NOT_ELIGIBLE"]),
    );
  });

  it("detects a playoff scheduled before its prerequisites plus rest", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    const sf = at(s, "MD:ko:R1:M1");
    const final = at(s, "MD:ko:R2:M1");
    final.start = sf.start + 30 + 5; // after the semi, but only 5 of the 20 rest minutes
    final.day = sf.day;
    final.courtId = "C3";
    const report = validateSchedule(inventory, s);
    const v = report.violations.find((x) => x.code === "DEPENDENCY_ORDER")!;
    expect(v.matchIds).toContain("MD:ko:R2:M1");
  });

  it("detects a definite player double-booking and insufficient rest in a group", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    const t1 = inventory.matches.filter((m) => m.groupId === "A" && m.slots.some((x) => x.type === "team" && x.teamId === "MD-t1"));
    const a = at(s, t1[0]!.id);
    const b = at(s, t1[1]!.id);
    b.day = a.day;
    b.courtId = a.courtId === "C1" ? "C2" : "C1";
    b.start = a.start + 15;
    let report = validateSchedule(inventory, s);
    let v = report.violations.find((x) => x.code === "PLAYER_OVERLAP")!;
    expect(v.certainty).toBe("definite");
    expect(v.playerIds).toEqual(["MD-p1a", "MD-p1b"]);
    b.start = a.start + 30 + 10;
    report = validateSchedule(inventory, s);
    v = report.violations.find((x) => x.code === "PLAYER_REST")!;
    expect(v.certainty).toBe("definite");
  });

  it("detects a possible cross-division conflict for an unresolved playoff, and clears it once resolved", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    const final = at(s, "MD:ko:R2:M1");
    const xdSemi = at(s, "XD:ko:R1:M1"); // contains XD-t1 with MD-p1a
    xdSemi.day = final.day;
    xdSemi.courtId = final.courtId === "C1" ? "C2" : "C1";
    xdSemi.start = final.start;
    // Keep XD final after its semi.
    const xdFinal = at(s, "XD:ko:R2:M1");
    xdFinal.start = Math.max(xdFinal.start, final.start + 30 + 25);
    const report = validateSchedule(inventory, s, { allowPartial: false });
    const v = report.violations.find((x) => x.code === "PLAYER_OVERLAP")!;
    expect(v.certainty).toBe("possible");
    expect(v.playerIds).toEqual(["MD-p1a"]);
    // Once the MD final participants are known to exclude MD-t1, the conflict disappears.
    const resolved = validateSchedule(inventory, s, { resolution: new Map([["MD:ko:R2:M1", ["MD-t2", "MD-t3"] as const]]) });
    expect(resolved.violations.filter((x) => x.code === "PLAYER_OVERLAP")).toEqual([]);
  });

  it("allows the two semifinals, and the final with the third-place match, at the same time", () => {
    const { inventory, schedule } = setup();
    const s = clone(schedule);
    const sf1 = at(s, "MD:ko:R1:M1");
    const sf2 = at(s, "MD:ko:R1:M2");
    Object.assign(sf2, { day: sf1.day, start: sf1.start, courtId: sf1.courtId === "C1" ? "C2" : "C1" });
    const f = at(s, "MD:ko:R2:M1");
    const p3 = at(s, "MD:ko:3P");
    Object.assign(p3, { day: f.day, start: f.start, courtId: f.courtId === "C1" ? "C2" : "C1" });
    const player = validateSchedule(inventory, s).violations.filter((v) => v.code.startsWith("PLAYER") || v.code === "DEPENDENCY_ORDER");
    expect(player).toEqual([]);
  });

  it("detects unavailable participants, including possible playoff participants", () => {
    const { schedule } = setup();
    const { config } = setup();
    config.restrictions = [{ id: "away", kind: "unavailable", subject: { type: "player", id: "MD-p1a" }, window: { day: DAY1, start: 0, end: 24 * 60 } }];
    const inventory = buildInventory(config);
    const report = validateSchedule(inventory, schedule);
    const v = report.violations.filter((x) => x.code === "PARTICIPANT_UNAVAILABLE");
    expect(v.some((x) => x.certainty === "definite")).toBe(true);
    expect(v.some((x) => x.certainty === "possible" && x.matchIds[0] === "MD:ko:R2:M1")).toBe(true);
  });

  it("enforces a daily match cap over the longest possible path", () => {
    const { inventory, schedule } = setup((c) => (c.rules.maxMatchesPerPlayerPerDay = 4));
    // MD-p1a: 2 group matches + up to 2 MD playoffs + up to 2 XD matches = 6 on one day.
    const report = validateSchedule(inventory, schedule);
    const v = report.violations.filter((x) => x.code === "PLAYER_DAILY_CAP");
    expect(v.map((x) => x.playerIds![0])).toContain("MD-p1a");
    expect(v.find((x) => x.playerIds![0] === "MD-p1a")!.certainty).toBe("possible");
  });

  it("rejects schedules that move a frozen match", () => {
    const { inventory, schedule } = setup();
    const frozen: Assignment[] = [{ ...schedule.assignments[0]! }];
    const s = clone(schedule);
    s.assignments[0]!.start += 5;
    expect(codes(validateSchedule(inventory, s, { frozen, allowPartial: true }))).toContain("FROZEN_MATCH_CHANGED");
    expect(validateSchedule(inventory, schedule, { frozen }).valid).toBe(true);
  });
});
