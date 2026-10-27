import { describe, expect, it } from "vitest";
import { buildInventory, optimizeSchedules, validateSchedule } from "../../src/index.js";
import { courts, DAY1, DAY2, fullDay, stages, tournament } from "../support/fixtures.js";

/**
 * Validity at scale with a reduced search budget, so CI stays fast. Timing
 * targets (10 s typical, 30 s large) are measured by `npm run bench` on
 * documented hardware, not asserted here: shared CI runners are too noisy.
 */
describe("scale: validity at typical and large sizes", () => {
  const sized = (divisionCount: number, courtCount: number) =>
    buildInventory(
      tournament({
        days: [DAY1, DAY2],
        courts: courts(courtCount, [fullDay(DAY1, 8 * 60, 20 * 60), fullDay(DAY2, 8 * 60, 20 * 60)]),
        divisions: Array.from({ length: divisionCount }, (_, i) => ({
          id: `D${i + 1}`,
          categoryId: ["MD", "WD", "XD"][i % 3]!,
          teamCount: 8,
          seeded: true,
          stages: stages.groupsToKnockout(2, 2, true),
        })),
        rules: { minRestMinutes: 20 },
      }),
    );

  it("a typical event (~210 matches, 8 courts) yields three validated options", () => {
    const inventory = sized(13, 8);
    expect(inventory.matches.length).toBeGreaterThanOrEqual(200);
    const result = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 400 }, diversityAttempts: 1 });
    expect(result.status).toBe("ok");
    expect(result.options).toHaveLength(3);
    for (const o of result.options) expect(validateSchedule(inventory, o.schedule).violations).toEqual([]);
  }, 120_000);

  it("a large event (~500 matches, 20 courts) yields validated options", () => {
    const inventory = sized(31, 20);
    expect(inventory.matches.length).toBeGreaterThanOrEqual(480);
    const result = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 150 }, diversityAttempts: 0 });
    expect(result.status).toBe("ok");
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) expect(validateSchedule(inventory, o.schedule).violations).toEqual([]);
  }, 180_000);
});
