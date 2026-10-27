import { describe, expect, it } from "vitest";
import {
  analyzeSchedule,
  applyEvent,
  buildInventory,
  initialState,
  optimizeSchedules,
  validateConfig,
  validateSchedule,
  validateScheduleWithInstructions,
  verifyAllQualifierOutcomes,
  type OptimizeResult,
} from "../../src/index.js";
import { actualConflicts } from "../../bench/echelon.mjs";
import { buildEchelonDayConfig, CATEGORY_WINDOWS, DAY_END, DAY_START, echelonDayPreferences, EVENT_DAY } from "../../bench/echelon-day.mjs";

/**
 * Regression test for the one-day Echelon structure (synthetic participants): one day, 10 courts, four categories with
 * their own three-hour windows, wildcard progression for Novice and High Intermediate. The two-day scenario in
 * echelon.test.ts remains a separate stress test.
 */
const approved = buildEchelonDayConfig(); // recovery assumed at 10 minutes, which the windows cannot accommodate
const feasible = buildEchelonDayConfig({ minRest: 5 }); // the largest recovery for which the approved windows work
const prefs = echelonDayPreferences();
const budget = { iterationsPerStrategy: 1500 };
const run = (config = feasible): { inventory: ReturnType<typeof buildInventory>; result: OptimizeResult } => {
  const inventory = buildInventory(config);
  return { inventory, result: optimizeSchedules(inventory, { seed: 1, instructions: prefs, budget, diversityAttempts: 1 }) };
};

describe("Echelon one-day structure", () => {
  const inventory = buildInventory(approved);

  it("has exactly the requested counts", () => {
    expect(validateConfig(approved).valid).toBe(true);
    const count = (p: (m: (typeof inventory.matches)[number]) => boolean) => inventory.matches.filter(p).length;
    expect(inventory.matches).toHaveLength(288);
    expect(count((m) => m.phase === "group")).toBe(240);
    expect(count((m) => m.phase === "knockout" && m.round === 1)).toBe(24);
    expect(count((m) => Boolean(m.thirdPlace) || (m.phase === "knockout" && m.round === 2))).toBe(24);
    expect(new Set(inventory.matches.filter((m) => m.phase === "group").map((m) => `${m.divisionId}|${m.groupId}`)).size).toBe(40);
    expect(inventory.teamById.size).toBe(160);
    expect(approved.divisions).toHaveLength(12);
    expect(approved.days).toEqual([EVENT_DAY]);
    expect(approved.courts).toHaveLength(10);
  });

  it("gives each division two semifinals, a bronze and a gold match, and wildcards to Novice and High Intermediate only", () => {
    for (const division of approved.divisions) {
      const ko = inventory.matches.filter((m) => m.divisionId === division.id && m.phase === "knockout");
      expect(ko.filter((m) => m.round === 1)).toHaveLength(2);
      expect(ko.filter((m) => m.thirdPlace)).toHaveLength(1);
      expect(ko.filter((m) => !m.thirdPlace && m.round === 2)).toHaveLength(1);
      const wildcards = ko.flatMap((m) => m.slots).filter((s) => s.type === "wildcard");
      expect(wildcards).toHaveLength(division.id.endsWith("-LI") ? 0 : 1);
      expect(ko.flatMap((m) => m.slots).filter((s) => s.type === "group_rank")).toHaveLength(division.id.endsWith("-LI") ? 4 : 3);
    }
  });

  it("allocates 15 minutes of play + 5 of transition as a 20-minute slot, 30 minutes for medals, and no extra turnover", () => {
    expect(approved.rules.courtTurnoverMinutes).toBe(0);
    for (const m of inventory.matches) {
      const medal = Boolean(m.thirdPlace) || (m.phase === "knockout" && m.round === 2);
      expect(m.durationMinutes).toBe(medal ? 30 : 20);
    }
    expect(approved.divisions.every((d) => d.playMinutes === 15 && d.transitionMinutes === 5 && d.matchDurationMinutes === 20)).toBe(true);
  });
});

describe("Echelon one-day: the windows with the assumed 10-minute recovery", () => {
  const { result } = run(approved);

  it("is PROVEN infeasible, with a proof for every category and quantified remedies", () => {
    expect(result.status).toBe("no_schedule");
    expect(result.failure!.kind).toBe("proven_infeasible");
    expect(result.failure!.statement).toContain("proof");
    const failed = result.failure!.feasibility.checks.filter((c) => !c.passed && c.id.startsWith("window_group_tail:"));
    expect(failed).toHaveLength(4);
    for (const check of failed) {
      expect(check.message).toContain("70 more minutes");
      const kinds = check.remedies.map((r) => r.kind);
      expect(kinds).toContain("reduce_rest");
      expect(kinds).toContain("extend_last_day");
      expect(check.remedies.find((r) => r.kind === "reduce_rest")!.value).toBe(5);
      expect(check.remedies.find((r) => r.kind === "extend_last_day")!.value).toBe(10);
    }
  });

  it("does not relax a window, add a day or add hours to find something", () => {
    expect(result.options).toEqual([]);
  });

  it("the plain capacity check passes, which is why it is not sufficient", () => {
    const capacity = result.failure!.feasibility.checks.filter((c) => c.id.startsWith("window_group:"));
    expect(capacity).toHaveLength(4);
    expect(capacity.every((c) => c.passed && c.required === 1500 && c.available === 1800)).toBe(true);
  });
});

describe("Echelon one-day: a feasible configuration (recovery 5 minutes)", () => {
  const { inventory, result } = run();

  it("produces valid options that stay on the event date and inside every category window", () => {
    expect(result.status).toBe("ok");
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) {
      expect(o.schedule.assignments).toHaveLength(288);
      expect(validateSchedule(inventory, o.schedule).violations).toEqual([]);
      const full = validateScheduleWithInstructions(inventory, o.schedule, prefs);
      expect(full.ok && full.value.valid).toBe(true);
      for (const a of o.schedule.assignments) {
        const match = inventory.matchById.get(a.matchId)!;
        const category = feasible.divisions.find((d) => d.id === match.divisionId)!.categoryId;
        const window = CATEGORY_WINDOWS.find((c) => c.id === category)!;
        expect(a.day).toBe(EVENT_DAY);
        expect(a.start).toBeGreaterThanOrEqual(window.start);
        expect(a.start + match.durationMinutes).toBeLessThanOrEqual(window.end);
        expect(a.start).toBeGreaterThanOrEqual(DAY_START);
        expect(a.start + match.durationMinutes).toBeLessThanOrEqual(DAY_END);
      }
    }
  });

  it("keeps every team's preliminary matches on the event day: zero split teams in every returned schedule", () => {
    for (const o of result.options) {
      expect(o.metrics.teamsSplitAcrossDays).toBe(0);
      expect(analyzeSchedule(inventory, o.schedule).recovery.teamsSplitAcrossDays).toBe(0);
    }
  });

  it("is safe for every possible playoff participant: exhaustive enumeration, not sampling", () => {
    for (const o of result.options) {
      const report = verifyAllQualifierOutcomes(inventory, o.schedule);
      expect(report.skipped).toEqual([]);
      expect(report.enumerated).toHaveLength(12);
      expect(report.enumerated.reduce((s, e) => s + e.outcomes, 0)).toBeGreaterThan(20_000);
      expect(report.violations).toEqual([]);
    }
  });

  it("also survives sampled complete tournaments, including the wildcard", () => {
    for (const o of result.options) {
      for (const seed of [1, 2, 3, 4, 5]) expect(actualConflicts({ initialState, applyEvent }, inventory, o.schedule, seed)).toEqual([]);
    }
  });

  it("classifies every playoff match as provisional and reports the medal-overrun risk", () => {
    const report = analyzeSchedule(inventory, result.options[0]!.schedule);
    expect(report.playoffs).toHaveLength(48);
    expect(report.playoffs.every((p) => p.provisional)).toBe(true);
    expect(report.playoffs.some((p) => p.possibleTeams === 16)).toBe(true);
    expect(report.medalSlots).toHaveLength(24);
    expect(report.warnings.some((w) => w.code === "MEDAL_OVERRUN_RISK")).toBe(true);
  });

  it("reports recovery and playoff delays that respect the rest rule", () => {
    const report = analyzeSchedule(inventory, result.options[0]!.schedule);
    expect(report.recovery.minMinutes).toBeGreaterThanOrEqual(5);
    expect(report.divisions.every((d) => d.transitionMinutes === null || d.transitionMinutes >= 5)).toBe(true);
  });

  it("does not claim distinct options when the options are equivalent, and does not let noise override the default", () => {
    for (const r of result.comparison.relations) expect(r.materiallyDifferent).toBe(r.assignmentDistance >= 0.1 && r.differsOn.length > 0);
    if (result.comparison.equivalent.length > 0) {
      expect(result.comparison.explanation.join(" ")).toContain("materially equivalent");
      expect(result.recommended!.strategy).toBe("balanced_operations");
    }
  });

  it("is reproducible and Fastest Finish has the earliest finish", () => {
    const again = run().result;
    expect(again.options.map((o) => o.schedule)).toEqual(result.options.map((o) => o.schedule));
    const fastest = result.options.find((o) => o.strategy === "fastest_finish")!;
    expect(fastest.metrics.finishMinute).toBe(Math.min(...result.options.map((o) => o.metrics.finishMinute)));
  });
});

describe("exhaustive outcome check coverage", () => {
  it("also covers a division whose knockout is seeded straight from teams", () => {
    const config = buildEchelonDayConfig({ minRest: 5 });
    config.divisions[0]!.stages = [{ id: "ko", kind: "single_elimination", source: { type: "teams" }, thirdPlaceMatch: true }];
    const inventory = buildInventory(config);
    const r = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 200 }, diversityAttempts: 0 });
    expect(r.status).toBe("ok");
    const report = verifyAllQualifierOutcomes(inventory, r.options[0]!.schedule);
    expect(report.skipped).toEqual([]);
    // 12 teams in a bracket of 16: ten matches feed another match, so 2^10 result combinations.
    expect(report.enumerated.find((e) => e.divisionId === config.divisions[0]!.id)!.outcomes).toBe(1024);
  });
});

describe("Echelon one-day: honest results around the boundary", () => {
  it("recovery of 6 to 9 minutes is proven infeasible", () => {
    for (const rest of [6, 9]) {
      const r = optimizeSchedules(buildInventory(buildEchelonDayConfig({ minRest: rest })), { seed: 1, budget: { iterationsPerStrategy: 200 }, diversityAttempts: 0 });
      expect(r.failure!.kind).toBe("proven_infeasible");
    }
  });

  it("11 courts at recovery 10 is NOT labelled a proof: the heuristic simply finds nothing", () => {
    const r = optimizeSchedules(buildInventory(buildEchelonDayConfig({ courts: 11 })), { seed: 1, budget: { iterationsPerStrategy: 200 }, diversityAttempts: 0 });
    expect(r.status).toBe("no_schedule");
    expect(r.failure!.kind).toBe("not_found");
    expect(r.failure!.proof).toEqual([]);
    expect(r.failure!.statement).toContain("NOT a proof");
  });

  it("each adjustment that the report suggests really produces a valid schedule", () => {
    for (const options of [{ courts: 12 }, { categoryWindowMinutes: 190 }, { categoryWindowMinutes: 200, medalMinutes: 40 }]) {
      const config = buildEchelonDayConfig(options);
      const inventory = buildInventory(config);
      const r = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 300 }, diversityAttempts: 0 });
      expect(r.status, JSON.stringify(options)).toBe("ok");
      for (const o of r.options) expect(validateSchedule(inventory, o.schedule).violations).toEqual([]);
    }
  });

  it("wildcard progression with players shared across categories stays valid or is reported honestly", () => {
    const config = buildEchelonDayConfig({ minRest: 5, sharedPlayers: true });
    const inventory = buildInventory(config);
    const r = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 300 }, diversityAttempts: 0 });
    if (r.status === "ok") {
      for (const o of r.options) {
        expect(validateSchedule(inventory, o.schedule).violations).toEqual([]);
        expect(verifyAllQualifierOutcomes(inventory, o.schedule).violations).toEqual([]);
      }
    } else {
      expect(["proven_infeasible", "not_found"]).toContain(r.failure!.kind);
    }
  });
});
