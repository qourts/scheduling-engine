import { describe, expect, it } from "vitest";
import {
  analyzeSchedule,
  buildInventory,
  measurePreferences,
  optimizeSchedules,
  validateInstructions,
  validateScheduleWithInstructions,
  type SchedulingInstruction,
} from "../../src/index.js";
import { buildEchelonConfig, categoryWindows } from "../../bench/echelon.mjs";
import { buildEchelonDayConfig } from "../../bench/echelon-day.mjs";

const sameDay = (weight: number): SchedulingInstruction => ({ id: "same-day", kind: "same_day_preliminaries", strength: "preference", weight });

describe("same-day preliminaries preference (multi-day events)", () => {
  const inventory = buildInventory(buildEchelonConfig());
  const base = categoryWindows();
  const budget = { iterationsPerStrategy: 3000 };
  const baseline = optimizeSchedules(inventory, { seed: 1, instructions: base, budget, diversityAttempts: 0 });
  const preferred = optimizeSchedules(inventory, { seed: 1, instructions: [...base, sameDay(5)], budget, diversityAttempts: 0 });

  it("reports how many teams have preliminary matches on more than one day, consistently in metrics and report", () => {
    expect(baseline.status).toBe("ok");
    for (const o of baseline.options) {
      expect(o.metrics.teamsSplitAcrossDays).toBe(analyzeSchedule(inventory, o.schedule).recovery.teamsSplitAcrossDays);
    }
  });

  it("reduces the number of split teams for every strategy without relaxing any hard rule", () => {
    expect(preferred.status).toBe("ok");
    for (const o of preferred.options) {
      const before = baseline.options.find((b) => b.strategy === o.strategy)!;
      expect(o.metrics.teamsSplitAcrossDays).toBeLessThanOrEqual(before.metrics.teamsSplitAcrossDays);
      const full = validateScheduleWithInstructions(inventory, o.schedule, [...base, sameDay(5)]);
      expect(full.ok && full.value.valid).toBe(true);
    }
    const totalBefore = baseline.options.reduce((s, o) => s + o.metrics.teamsSplitAcrossDays, 0);
    const totalAfter = preferred.options.reduce((s, o) => s + o.metrics.teamsSplitAcrossDays, 0);
    expect(totalAfter).toBeLessThan(totalBefore);
  });

  it("measures the preference independently of the optimizer", () => {
    for (const o of preferred.options) {
      const [measure] = measurePreferences(inventory, o.schedule, [sameDay(5)]);
      expect(measure).toMatchObject({ instructionId: "same-day", kind: "same_day_preliminaries", unit: "teams" });
      expect(measure!.violated).toBe(o.metrics.teamsSplitAcrossDays);
    }
  });

  it("is a preference only: a mandatory version is rejected with an explanation", () => {
    const mandatory = { id: "m", kind: "same_day_preliminaries", strength: "mandatory" } as unknown as SchedulingInstruction;
    const result = validateInstructions(inventory, [mandatory]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.message).toContain("single tournament day");
  });
});

describe("a one-day event never uses another day", () => {
  it("has exactly one calendar day, so no team can be split and no match can be placed elsewhere", () => {
    const config = buildEchelonDayConfig({ minRest: 5 });
    expect(config.days).toEqual(["2026-11-21"]);
    const inventory = buildInventory(config);
    const result = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 300 }, diversityAttempts: 0 });
    expect(result.status).toBe("ok");
    for (const o of result.options) {
      expect(o.schedule.assignments.every((a) => a.day === "2026-11-21")).toBe(true);
      expect(o.metrics.teamsSplitAcrossDays).toBe(0);
    }
  });
});
