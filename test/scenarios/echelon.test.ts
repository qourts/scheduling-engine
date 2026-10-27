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
  type OptimizeResult,
} from "../../src/index.js";
import { actualConflicts, buildEchelonConfig, categoryWindows, instructionCases, problemCases, verifyEnforcement } from "../../bench/echelon.mjs";

/**
 * Operational acceptance on a synthetic 288-match tournament (10 courts, 4 categories x 3 skill
 * divisions, 40 pools of 4 teams). Budgets are reduced so the suite stays fast; the full-budget run is
 * `npm run acceptance`.
 */
const config = buildEchelonConfig();
const inventory = buildInventory(config);
const base = categoryWindows();
const budget = { iterationsPerStrategy: 1500 };
const run = (instructions = base, extra = {}): OptimizeResult => optimizeSchedules(inventory, { seed: 1, instructions, budget, diversityAttempts: 1, ...extra });

describe("acceptance: the 288-match scenario", () => {
  it("has exactly the requested structure", () => {
    expect(validateConfig(config).valid).toBe(true);
    const count = (p: (m: (typeof inventory.matches)[number]) => boolean) => inventory.matches.filter(p).length;
    expect(inventory.matches).toHaveLength(288);
    expect(count((m) => m.phase === "group")).toBe(240);
    expect(count((m) => m.phase === "knockout" && m.round === 1)).toBe(24);
    expect(count((m) => Boolean(m.thirdPlace) || (m.phase === "knockout" && m.round === 2))).toBe(24);
    expect(new Set(inventory.matches.filter((m) => m.phase === "group").map((m) => `${m.divisionId}|${m.groupId}`)).size).toBe(40);
    expect(config.courts).toHaveLength(10);
    expect(config.categories).toHaveLength(4);
    expect(config.divisions).toHaveLength(12);
    expect(inventory.teamById.size).toBe(160);
  });

  it("uses 20-minute preliminary and semifinal slots and a separate medal duration", () => {
    for (const m of inventory.matches) {
      const medal = Boolean(m.thirdPlace) || (m.phase === "knockout" && m.round === 2);
      expect(m.durationMinutes).toBe(medal ? 30 : 20);
    }
    const longer = buildInventory(buildEchelonConfig({ medalMinutes: 45 }));
    expect(longer.matches.filter((m) => m.durationMinutes === 45)).toHaveLength(24);
  });

  const result = run();

  it("schedules every match in up to three distinct options, each independently valid", () => {
    expect(result.status).toBe("ok");
    expect(result.options).toHaveLength(3);
    for (const option of result.options) {
      expect(option.schedule.assignments).toHaveLength(288);
      expect(validateSchedule(inventory, option.schedule).violations).toEqual([]);
      const full = validateScheduleWithInstructions(inventory, option.schedule, base);
      expect(full.ok && full.value.valid).toBe(true);
    }
  });

  it("never has an actual player collision or rest breach once real participants are known", () => {
    for (const option of result.options) {
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(actualConflicts({ initialState, applyEvent }, inventory, option.schedule, seed)).toEqual([]);
      }
    }
  });

  it("Fastest Finish has the earliest finish among the returned options", () => {
    const finishes = result.options.map((o) => o.metrics.finishMinute);
    const fastest = result.options.find((o) => o.strategy === "fastest_finish")!;
    expect(fastest.metrics.finishMinute).toBe(Math.min(...finishes));
  });

  it("options differ in measured operational outcomes, and the comparison text matches the numbers", () => {
    const [a, b, c] = result.options.map((o) => analyzeSchedule(inventory, o.schedule));
    expect(c!.recovery.backToBackOccurrences).toBeLessThanOrEqual(a!.recovery.backToBackOccurrences);
    expect(b!.recovery.backToBackOccurrences).toBeLessThanOrEqual(a!.recovery.backToBackOccurrences);
    for (const r of result.comparison.relations) {
      const x = result.options.find((o) => o.strategy === r.a)!.metrics;
      const y = result.options.find((o) => o.strategy === r.b)!.metrics;
      expect(r.materiallyDifferent).toBe(r.assignmentDistance >= 0.1 && r.differsOn.length > 0);
      if (r.differsOn.includes("finish_time")) expect(Math.abs(x.finishMinute - y.finishMinute)).toBeGreaterThanOrEqual(15);
      if (r.differsOn.includes("back_to_backs")) expect(x.backToBackCount).not.toBe(y.backToBackCount);
    }
    expect(result.comparison.equivalent).toEqual([]);
  });

  it("the report and the optimizer agree on finish and idle time", () => {
    for (const o of result.options) {
      const report = analyzeSchedule(inventory, o.schedule);
      expect(report.finish!.absolute).toBe(o.metrics.finishMinute);
      expect(report.idleCourtMinutes).toBe(o.metrics.idleMinutes);
      expect(report.scheduledMatches).toBe(288);
    }
  });

  it("is reproducible: the same seed and iteration budget give identical schedules", () => {
    const again = run();
    expect(again.options.map((o) => o.schedule)).toEqual(result.options.map((o) => o.schedule));
  });

  it("reports construction and search time separately", () => {
    const t = result.diagnostics.timing;
    expect(t.constructionMs).toBeGreaterThan(0);
    expect(t.searchMs).toBeGreaterThan(0);
    expect(t.totalMs).toBeGreaterThanOrEqual(t.constructionMs + t.searchMs);
    expect(Object.keys(result.diagnostics.construction).length).toBe(3);
  });
});

describe("acceptance: structured special instructions", () => {
  const baseline = run();
  for (const c of instructionCases()) {
    it(`enforces: ${c.request}`, () => {
      const r = run([...base, ...c.instructions]);
      expect(r.status).toBe("ok");
      for (const option of r.options) {
        const check = verifyEnforcement(c.id, inventory, option.schedule, baseline.options.find((o) => o.strategy === option.strategy)?.schedule);
        expect(check, `${option.label}: ${check.detail}`).toMatchObject({ ok: true });
        const full = validateScheduleWithInstructions(inventory, option.schedule, [...base, ...c.instructions]);
        expect(full.ok && full.value.valid).toBe(true);
      }
    });
  }

  it("applies all the mandatory requests together", () => {
    const all = instructionCases().filter((c) => c.id !== "preference-consecutive-blocks").flatMap((c) => c.instructions);
    const r = run([...base, ...all]);
    expect(r.status).toBe("ok");
    for (const option of r.options) {
      const full = validateScheduleWithInstructions(inventory, option.schedule, [...base, ...all]);
      expect(full.ok && full.value.valid).toBe(true);
    }
  });

  for (const c of problemCases()) {
    it(`classifies honestly: ${c.request}`, () => {
      const r = optimizeSchedules(inventory, { seed: 1, instructions: [...base, ...c.instructions], budget: { iterationsPerStrategy: 600 }, diversityAttempts: 0 });
      const kind = r.status === "no_schedule" ? r.failure!.kind : r.status;
      expect(kind).toBe(c.expect);
      if (r.status === "invalid_instructions") {
        expect(r.instructionIssues!.filter((i) => i.severity === "error").every((i) => i.message.length > 20)).toBe(true);
      }
      if (r.status === "no_schedule" && r.failure!.kind === "not_found") {
        expect(r.failure!.statement).toContain("NOT a proof");
        expect(r.failure!.proof).toEqual([]);
      }
      if (r.status === "no_schedule" && r.failure!.kind === "proven_infeasible") expect(r.failure!.proof.length).toBeGreaterThan(0);
    });
  }
});

describe("acceptance: failure classification and tight configurations", () => {
  it("a capacity shortage is proven, with quantified remedies", () => {
    const short = buildInventory(buildEchelonConfig({ courts: 4 }));
    const r = optimizeSchedules(short, { seed: 1, budget: { iterationsPerStrategy: 300 }, diversityAttempts: 0 });
    expect(r.status).toBe("no_schedule");
    expect(r.failure!.kind).toBe("proven_infeasible");
    expect(r.failure!.proof.join(" ")).toMatch(/court-minutes/);
    expect(r.failure!.feasibility.checks.some((c) => c.remedies.length > 0)).toBe(true);
  });

  it("a tight but feasible day length is scheduled through the fallback constructions", () => {
    const tight = buildInventory(buildEchelonConfig({ dayEnd: 14 * 60 + 40 }));
    const r = optimizeSchedules(tight, { seed: 1, budget: { iterationsPerStrategy: 300 }, diversityAttempts: 0 });
    expect(r.status).toBe("ok");
    for (const o of r.options) expect(validateSchedule(tight, o.schedule).violations).toEqual([]);
    expect(Object.values(r.diagnostics.construction)).toContain("fastest_finish_weights");
  });
});
