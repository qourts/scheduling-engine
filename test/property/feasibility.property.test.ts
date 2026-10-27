import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { analyzeFeasibility, buildInventory, validateSchedule } from "../../src/index.js";
import { divisionSpec } from "../support/arbitraries.js";
import { courts, DAY1, DAY2, fullDay, tournament } from "../support/fixtures.js";
import { oracleSchedule } from "../support/oracleScheduler.js";
import { serialSchedule } from "../support/serialScheduler.js";

/**
 * Feasibility checks are necessary conditions. If they ever report
 * "infeasible" for a tournament that has a validated schedule, a check is
 * wrong. This property hunts for such false alarms across tight settings.
 */
const setting = fc.record({
  courtCount: fc.integer({ min: 1, max: 4 }),
  twoDays: fc.boolean(),
  endHour: fc.integer({ min: 10, max: 20 }),
  duration: fc.integer({ min: 10, max: 45 }),
  rest: fc.integer({ min: 0, max: 40 }),
  turnover: fc.integer({ min: 0, max: 10 }),
  cap: fc.option(fc.integer({ min: 2, max: 8 }), { nil: undefined }),
});

describe("feasibility soundness (property)", () => {
  it("never reports infeasible when a validated schedule exists", () => {
    let witnessed = 0;
    fc.assert(
      fc.property(divisionSpec("A"), divisionSpec("B", "XD"), setting, (a, b, s) => {
        const days = s.twoDays ? [DAY1, DAY2] : [DAY1];
        const config = tournament({
          days,
          courts: courts(s.courtCount, days.map((d) => fullDay(d, 8 * 60, s.endHour * 60))),
          divisions: [
            { ...a, duration: s.duration },
            { ...b, duration: s.duration },
          ],
          rules: { minRestMinutes: s.rest, courtTurnoverMinutes: s.turnover, ...(s.cap ? { maxMatchesPerPlayerPerDay: s.cap } : {}) },
        });
        config.divisions[1]!.teams[0]!.playerIds[0] = "A-p1a";
        config.players = config.players.filter((p) => p.id !== "B-p1a");
        const inventory = buildInventory(config);
        if (inventory.matches.length > 40) return;
        const schedule = serialSchedule(inventory) ?? oracleSchedule(inventory, 10);
        if (!schedule || !validateSchedule(inventory, schedule).valid) return;
        witnessed++;
        const failed = analyzeFeasibility(inventory).checks.filter((c) => !c.passed);
        expect(failed).toEqual([]);
      }),
      // Fixed seed: the non-vacuity guard below counts sampled cases, so unseeded runs could land on the threshold.
      { numRuns: 60, seed: 20261027 },
    );
    expect(witnessed).toBeGreaterThan(10);
  }, 180_000);
});
