import { describe, expect, it } from "vitest";
import {
  acceptProposal,
  buildInventory,
  buildVocabulary,
  checkInstructions,
  compileInstructions,
  describeInstruction,
  matchRoles,
  optimizeSchedules,
  SelectorIndex,
  validateInstructions,
  validateScheduleWithInstructions,
  type Schedule,
  type SchedulingInstruction,
} from "../../src/index.js";
import { courts, DAY1, DAY2, fullDay, stages, tournament } from "../support/fixtures.js";

const config = () =>
  tournament({
    days: [DAY1, DAY2],
    courts: courts(4, [fullDay(DAY1), fullDay(DAY2)]),
    divisions: [
      { id: "ADV", categoryId: "MD", teamCount: 6, stages: stages.groupsToKnockout(2, 2, true) },
      { id: "INT", categoryId: "WD", teamCount: 4, stages: stages.roundRobin() },
    ],
  });
const inventory = () => buildInventory(config());
const mandatory = <T extends object>(i: T) => ({ ...i, strength: "mandatory" as const }) as unknown as SchedulingInstruction;
const preference = <T extends object>(i: T, weight = 1) => ({ ...i, strength: "preference" as const, weight }) as unknown as SchedulingInstruction;

describe("selectors", () => {
  const inv = inventory();
  const index = new SelectorIndex(inv);

  it("finds medal, semifinal and role matches from the bracket structure", () => {
    const medal = index.select({ divisionIds: ["ADV"], roles: ["medal"] }).map((m) => m.label);
    expect(medal.sort()).toEqual(["3P", "F"]);
    expect(index.select({ divisionIds: ["ADV"], roles: ["semifinal"] })).toHaveLength(2);
    expect(index.select({ divisionIds: ["INT"], roles: ["final"] })).toHaveLength(0);
    expect(matchRoles(inv).size).toBeGreaterThan(0);
  });

  it("combines fields with AND and treats the empty selector as everything", () => {
    expect(index.select({})).toHaveLength(inv.matches.length);
    expect(index.select({ divisionIds: ["ADV"], phases: ["group"] }).every((m) => m.phase === "group")).toBe(true);
    expect(index.select({ categoryIds: ["WD"] }).every((m) => m.divisionId === "INT")).toBe(true);
  });
});

describe("validateInstructions", () => {
  const inv = inventory();
  const codes = (list: SchedulingInstruction[]) => validateInstructions(inv, list).issues.map((i) => i.code);

  it("accepts a well-formed set and never throws on bad input", () => {
    const ok = validateInstructions(inv, [
      mandatory({ id: "a", kind: "time_window", selector: { divisionIds: ["ADV"] }, latestEnd: { minute: 12 * 60 } }),
      preference({ id: "b", kind: "court_allowlist", selector: { divisionIds: ["INT"] }, courtIds: ["C1", "C2"] }, 3),
    ]);
    expect(ok.ok).toBe(true);
    expect(() => validateInstructions(inv, [{ id: "x", kind: "nonsense" } as unknown as SchedulingInstruction])).not.toThrow();
  });

  it("reports unknown references, bad times and bad weights as structured errors", () => {
    expect(codes([mandatory({ id: "a", kind: "court_allowlist", selector: {}, courtIds: ["C9"] })])).toContain("UNKNOWN_COURT");
    expect(codes([mandatory({ id: "a", kind: "min_rest", divisionIds: ["NOPE"], minutes: 10 })])).toContain("UNKNOWN_DIVISION");
    expect(codes([mandatory({ id: "a", kind: "time_window", selector: { categoryIds: ["ZZ"] }, latestEnd: { minute: 700 } })])).toContain("UNKNOWN_CATEGORY");
    expect(codes([mandatory({ id: "a", kind: "time_window", selector: { stageIds: ["nope"] }, latestEnd: { minute: 700 } })])).toContain("UNKNOWN_STAGE");
    expect(codes([mandatory({ id: "a", kind: "locked_placement", matchId: "nope", courtId: "C1", day: DAY1, start: 600 })])).toContain("UNKNOWN_MATCH");
    expect(codes([mandatory({ id: "a", kind: "time_window", selector: {}, latestEnd: { day: "2030-01-01", minute: 700 } })])).toContain("UNKNOWN_DAY");
    expect(codes([mandatory({ id: "a", kind: "time_window", selector: {}, latestEnd: { minute: 2000 } })])).toContain("INVALID_TIME");
    expect(codes([preference({ id: "a", kind: "court_allowlist", selector: {}, courtIds: ["C1"] }, 0)])).toContain("INVALID_WEIGHT");
    expect(codes([preference({ id: "a", kind: "court_allowlist", selector: {}, courtIds: ["C1"] }, Number.NaN)])).toContain("INVALID_WEIGHT");
  });

  it("rejects duplicates, empty lists, contradictory bounds and unsupported mandatory kinds", () => {
    const dup = mandatory({ id: "a", kind: "court_blackout", courtIds: ["C1"], window: { day: DAY1, start: 600, end: 660 } });
    expect(codes([dup, dup])).toContain("DUPLICATE_ID");
    expect(codes([mandatory({ id: "a", kind: "court_allowlist", selector: {}, courtIds: [] })])).toContain("EMPTY_LIST");
    expect(codes([mandatory({ id: "a", kind: "time_window", selector: {} })])).toContain("EMPTY_LIST");
    expect(
      codes([mandatory({ id: "a", kind: "time_window", selector: {}, earliestStart: { minute: 800 }, latestEnd: { minute: 700 } })]),
    ).toContain("CONTRADICTORY_BOUNDS");
    expect(codes([mandatory({ id: "a", kind: "consecutive_blocks", divisionIds: ["ADV", "INT"] })])).toContain("UNSUPPORTED_MANDATORY");
    expect(codes([preference({ id: "a", kind: "locked_placement", matchId: inv.matches[0]!.id, courtId: "C1", day: DAY1, start: 600 })])).toContain("UNSUPPORTED_MANDATORY");
    const lock = (id: string) => mandatory({ id, kind: "locked_placement", matchId: inv.matches[0]!.id, courtId: "C1", day: DAY1, start: 600 });
    expect(codes([lock("l1"), lock("l2")])).toContain("CONFLICTING_LOCKS");
    expect(codes([mandatory({ id: "a", kind: "court_blackout", courtIds: ["C1"], window: { day: DAY1, start: 700, end: 600 } })])).toContain("INVALID_TIME");
  });

  it("warns, without failing, about empty selections and lowered minimum rest", () => {
    const result = validateInstructions(inv, [
      mandatory({ id: "a", kind: "min_rest", divisionIds: ["ADV"], minutes: 5 }),
      mandatory({ id: "b", kind: "time_window", selector: { divisionIds: ["ADV"], roles: ["quarterfinal"] }, latestEnd: { minute: 700 } }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code).sort()).toEqual(["EMPTY_SELECTION", "MIN_REST_LOWERED"]);
    expect(result.issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("validateInstructions hardening", () => {
  const inv = inventory();
  const issues = (list: unknown[]) => validateInstructions(inv, list as SchedulingInstruction[]);

  it("never throws on structurally malformed instructions and reports them", () => {
    const malformed = [
      null,
      "text",
      { id: "a", kind: "time_window", strength: "mandatory" },
      { id: "b", kind: "court_blackout", strength: "mandatory", courtIds: ["C1"] },
      { id: "c", kind: "court_allowlist", strength: "mandatory", selector: {} },
    ];
    expect(() => issues(malformed)).not.toThrow();
    const result = issues(malformed);
    expect(result.ok).toBe(false);
    expect(result.issues.filter((i) => i.severity === "error").length).toBeGreaterThanOrEqual(malformed.length);
  });

  it("rejects unknown selector phases instead of silently selecting nothing", () => {
    const result = issues([{ id: "p", kind: "time_window", strength: "mandatory", selector: { phases: ["groups"] }, latestStart: { minute: 600 } }]);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("INVALID_VALUE");
  });

  it("caps preference weights so the objective cannot overflow", () => {
    const base = { id: "w", kind: "court_allowlist", selector: {}, courtIds: ["C1"], strength: "preference" };
    expect(issues([{ ...base, weight: 1e308 }]).issues.map((i) => i.code)).toContain("INVALID_WEIGHT");
    expect(issues([{ ...base, weight: 1_000_000 }]).ok).toBe(true);
  });

  it("acceptProposal returns issues for a malformed proposal instead of throwing", () => {
    const result = acceptProposal(inv, { instructions: [{ id: "x", kind: "time_window", strength: "mandatory" } as unknown as SchedulingInstruction], unresolved: [] });
    expect(result.ok).toBe(false);
  });
});

describe("compileInstructions", () => {
  it("applies blackouts and minimum rest to an effective copy and leaves the original untouched", () => {
    const inv = inventory();
    const before = JSON.stringify(inv.config);
    const compiled = compileInstructions(inv, [
      mandatory({ id: "bo", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY1, start: 12 * 60, end: 13 * 60 } }),
      mandatory({ id: "mr", kind: "min_rest", divisionIds: ["INT"], minutes: 45 }),
    ]);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const effective = compiled.value.inventory.config;
    const c3 = effective.courts.find((c) => c.id === "C3")!;
    expect(c3.availability.filter((w) => w.day === DAY1)).toEqual([
      { day: DAY1, start: 8 * 60, end: 12 * 60 },
      { day: DAY1, start: 13 * 60, end: 18 * 60 },
    ]);
    expect(effective.divisions.find((d) => d.id === "INT")!.minRestMinutes).toBe(45);
    expect(effective.divisions.find((d) => d.id === "ADV")!.minRestMinutes).toBeUndefined();
    expect(JSON.stringify(inv.config)).toBe(before);
  });

  it("computes per-match court and start limits, honouring stage-specific selectors", () => {
    const inv = inventory();
    const compiled = compileInstructions(inv, [
      mandatory({ id: "res", kind: "court_reservation", courtIds: ["C4"], selector: { divisionIds: ["ADV"], roles: ["medal"] } }),
      mandatory({ id: "allow", kind: "court_allowlist", selector: { divisionIds: ["INT"] }, courtIds: ["C1", "C2"] }),
      mandatory({ id: "win", kind: "time_window", selector: { divisionIds: ["ADV"], phases: ["group"] }, latestEnd: { minute: 12 * 60 } }),
    ]);
    if (!compiled.ok) throw new Error("expected ok");
    const limits = compiled.value.limits;
    const final = inv.matches.find((m) => m.divisionId === "ADV" && m.label === "F")!;
    const group = inv.matches.find((m) => m.divisionId === "ADV" && m.phase === "group")!;
    const intMatch = inv.matches.find((m) => m.divisionId === "INT")!;
    expect(limits.get(final.id)!.allowedCourts).toBeNull();
    expect([...limits.get(group.id)!.allowedCourts!].sort()).toEqual(["C1", "C2", "C3"]);
    expect([...limits.get(intMatch.id)!.allowedCourts!].sort()).toEqual(["C1", "C2"]);
    // Group matches must end by 12:00 on each day: latest start = 12:00 - duration.
    const ranges = limits.get(group.id)!.startRanges!;
    expect(ranges[0]).toEqual({ start: 0, end: 12 * 60 - group.durationMinutes + 1 });
    expect(limits.get(final.id)!.startRanges).toBeNull();
  });

  it("collects locked placements and splits preferences into local and global", () => {
    const inv = inventory();
    const first = inv.matches[0]!;
    const compiled = compileInstructions(inv, [
      mandatory({ id: "lock", kind: "locked_placement", matchId: first.id, courtId: "C2", day: DAY1, start: 9 * 60 }),
      preference({ id: "p1", kind: "court_allowlist", selector: { divisionIds: ["INT"] }, courtIds: ["C1"] }),
      preference({ id: "p2", kind: "consecutive_blocks", divisionIds: ["ADV", "INT"] }),
    ]);
    if (!compiled.ok) throw new Error("expected ok");
    expect(compiled.value.locked).toEqual([{ matchId: first.id, courtId: "C2", day: DAY1, start: 540 }]);
    expect(compiled.value.globalPreferences.map((p) => p.id)).toEqual(["p2"]);
    const intMatch = inv.matches.find((m) => m.divisionId === "INT")!;
    expect(compiled.value.localPreferences.get(intMatch.id)).toHaveLength(1);
  });

  it("fails with every issue when any instruction is invalid", () => {
    const compiled = compileInstructions(inventory(), [
      mandatory({ id: "a", kind: "court_allowlist", selector: {}, courtIds: ["C9"] }),
      mandatory({ id: "b", kind: "min_rest", divisionIds: ["NOPE"], minutes: 10 }),
    ]);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.error.map((i) => i.code).sort()).toEqual(["UNKNOWN_COURT", "UNKNOWN_DIVISION"]);
  });
});

describe("checkInstructions (independent mandatory check)", () => {
  const inv = inventory();
  const base = optimizeSchedules(inv, { budget: { iterationsPerStrategy: 200 } }).options[0]!.schedule;
  const moved = (matchId: string, patch: Partial<Schedule["assignments"][number]>): Schedule => ({
    ...base,
    assignments: base.assignments.map((a) => (a.matchId === matchId ? { ...a, ...patch } : a)),
  });
  const final = inv.matches.find((m) => m.divisionId === "ADV" && m.label === "F")!;

  it("flags each kind of mandatory violation with the instruction id", () => {
    const window = mandatory({ id: "w", kind: "time_window", selector: { matchIds: [final.id] }, latestEnd: { minute: 9 * 60 } });
    expect(checkInstructions(inv, moved(final.id, { start: 15 * 60 }), [window]).map((v) => v.code)).toEqual(["INSTRUCTION_TIME_WINDOW"]);
    expect(checkInstructions(inv, moved(final.id, { start: 8 * 60 }), [mandatory({ id: "e", kind: "time_window", selector: { matchIds: [final.id] }, earliestStart: { minute: 13 * 60 } })])).toHaveLength(1);
    expect(checkInstructions(inv, moved(final.id, { start: 17 * 60 }), [mandatory({ id: "s", kind: "time_window", selector: { matchIds: [final.id] }, latestStart: { minute: 16 * 60 } })])).toHaveLength(1);

    const allow = mandatory({ id: "al", kind: "court_allowlist", selector: { matchIds: [final.id] }, courtIds: ["C1"] });
    expect(checkInstructions(inv, moved(final.id, { courtId: "C2" }), [allow]).map((v) => v.code)).toEqual(["INSTRUCTION_COURT_NOT_ALLOWED"]);
    expect(checkInstructions(inv, moved(final.id, { courtId: "C1" }), [allow])).toEqual([]);

    const reserve = mandatory({ id: "rs", kind: "court_reservation", courtIds: ["C4"], selector: { matchIds: [final.id] } });
    const other = inv.matches.find((m) => m.id !== final.id && !base.assignments.some((a) => a.matchId === m.id && a.courtId === "C4"))!;
    const outsiders = checkInstructions(inv, base, [reserve]);
    const violating = checkInstructions(inv, moved(other.id, { courtId: "C4" }), [reserve]);
    expect(violating.every((v) => v.code === "INSTRUCTION_COURT_RESERVED" && !v.matchIds.includes(final.id))).toBe(true);
    expect(violating).toHaveLength(outsiders.length + 1);
    // The reserved match itself may use the reserved court.
    expect(checkInstructions(inv, moved(final.id, { courtId: "C4" }), [reserve]).some((v) => v.matchIds.includes(final.id))).toBe(false);

    const blackout = mandatory({ id: "bo", kind: "court_blackout", courtIds: ["C1"], window: { day: DAY1, start: 0, end: 1440 } });
    const onC1 = base.assignments.find((a) => a.courtId === "C1" && a.day === DAY1);
    if (onC1) expect(checkInstructions(inv, base, [blackout]).map((v) => v.code)).toContain("INSTRUCTION_COURT_BLACKOUT");

    const lock = mandatory({ id: "lk", kind: "locked_placement", matchId: final.id, courtId: "C1", day: DAY1, start: 9 * 60 });
    expect(checkInstructions(inv, moved(final.id, { courtId: "C1", day: DAY1, start: 9 * 60 }), [lock])).toEqual([]);
    expect(checkInstructions(inv, moved(final.id, { start: 10 * 60 }), [lock]).map((v) => v.code)).toEqual(["INSTRUCTION_LOCK_MOVED"]);
  });

  it("ignores preferences", () => {
    const pref = preference({ id: "p", kind: "court_allowlist", selector: {}, courtIds: ["C1"] });
    expect(checkInstructions(inv, base, [pref])).toEqual([]);
  });
});

describe("adapter boundary", () => {
  const inv = inventory();

  it("exposes only IDs and display names as vocabulary", () => {
    const vocabulary = buildVocabulary(inv.config);
    expect(vocabulary.courts.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4"]);
    expect(vocabulary.divisions.find((d) => d.id === "ADV")!.stageIds).toEqual(["grp", "ko"]);
    expect(JSON.stringify(vocabulary)).not.toContain("playerIds");
  });

  it("accepts a valid proposal with plain-language descriptions and rejects an invalid one", () => {
    const good = acceptProposal(inv, {
      instructions: [
        mandatory({ id: "i1", kind: "time_window", selector: { divisionIds: ["ADV"] }, latestStart: { minute: 12 * 60 } }),
        mandatory({ id: "i2", kind: "court_reservation", courtIds: ["C4"], selector: { roles: ["medal"] } }),
        mandatory({ id: "i3", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY1, start: 12 * 60, end: 13 * 60 } }),
        mandatory({ id: "i4", kind: "min_rest", divisionIds: ["INT"], minutes: 20 }),
      ],
      unresolved: [{ text: "make it nice", reason: "not a scheduling rule" }],
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.value.descriptions.map((d) => d.text)).toEqual([
      "Must: matches of ADV start no later than 12:00 each day.",
      "Must: Court 4 be kept free for medal matches.",
      "Must: Court 3 host no matches on 2026-11-14 from 12:00 to 13:00.",
      "Must: players in INT get at least 20 minutes of rest between matches.",
    ]);
    expect(good.value.unresolved).toHaveLength(1);

    const bad = acceptProposal(inv, { instructions: [mandatory({ id: "x", kind: "court_allowlist", selector: {}, courtIds: ["Z"] })], unresolved: [] });
    expect(bad.ok).toBe(false);
  });

  it("describes preferences with their weight", () => {
    const text = describeInstruction(preference({ id: "p", kind: "consecutive_blocks", divisionIds: ["ADV", "INT"] }, 4), inv.config);
    expect(text).toContain("weight 4");
  });
});

describe("validateScheduleWithInstructions", () => {
  const inv = inventory();

  it("is valid only when the tournament rules and every mandatory instruction hold", () => {
    const instructions = [mandatory({ id: "rs", kind: "court_reservation", courtIds: ["C4"], selector: { divisionIds: ["ADV"], roles: ["medal"] } })];
    const result = optimizeSchedules(inv, { instructions, budget: { iterationsPerStrategy: 300 } });
    expect(result.status).toBe("ok");
    const good = validateScheduleWithInstructions(inv, result.options[0]!.schedule, instructions);
    expect(good.ok && good.value.valid).toBe(true);

    // The same schedule moved onto the reserved court breaks the instruction.
    const other = inv.matches.find((m) => m.divisionId === "INT")!;
    const tampered: Schedule = {
      ...result.options[0]!.schedule,
      assignments: result.options[0]!.schedule.assignments.map((a) => (a.matchId === other.id ? { ...a, courtId: "C4" } : a)),
    };
    const bad = validateScheduleWithInstructions(inv, tampered, instructions);
    expect(bad.ok && bad.value.instructionViolations.map((v) => v.code)).toContain("INSTRUCTION_COURT_RESERVED");
    expect(bad.ok && bad.value.valid).toBe(false);
  });

  it("returns the issues when the instructions themselves are invalid", () => {
    const result = validateScheduleWithInstructions(inv, { tournamentId: inv.config.id, assignments: [] }, [mandatory({ id: "a", kind: "min_rest", divisionIds: ["NOPE"], minutes: 1 })]);
    expect(result.ok).toBe(false);
  });
});
