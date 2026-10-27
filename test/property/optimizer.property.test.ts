import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildInventory,
  optimizeSchedules,
  validateSchedule,
  validateScheduleWithInstructions,
  type SchedulingInstruction,
} from "../../src/index.js";
import { divisionSpec } from "../support/arbitraries.js";
import { courts, DAY1, DAY2, fullDay, tournament } from "../support/fixtures.js";

/**
 * Soundness: whatever the tournament and instructions, the optimizer either
 * reports it could not schedule, or every option it returns passes the
 * independent validator and the independent instruction checker.
 */
describe("optimizer soundness (property)", () => {
  const instructionsFor = (courtCount: number): fc.Arbitrary<SchedulingInstruction[]> => {
    const court = fc.integer({ min: 1, max: courtCount }).map((n) => `C${n}`);
    const one: fc.Arbitrary<SchedulingInstruction> = fc.oneof(
      fc
        .record({ c: court, day: fc.constantFrom(DAY1, DAY2), start: fc.integer({ min: 8, max: 17 }) })
        .map(({ c, day, start }): SchedulingInstruction => ({ id: "", kind: "court_blackout", courtIds: [c], window: { day, start: start * 60, end: (start + 1) * 60 }, strength: "mandatory" })),
      fc
        .record({ div: fc.constantFrom("D1", "D2"), hour: fc.integer({ min: 9, max: 16 }) })
        .map(({ div, hour }): SchedulingInstruction => ({ id: "", kind: "time_window", selector: { divisionIds: [div] }, earliestStart: { minute: hour * 60 }, strength: "mandatory" })),
      fc
        .record({ div: fc.constantFrom("D1", "D2"), c: court })
        .map(({ div, c }): SchedulingInstruction => ({ id: "", kind: "court_reservation", courtIds: [c], selector: { divisionIds: [div] }, strength: "mandatory" })),
      fc
        .record({ div: fc.constantFrom("D1", "D2"), w: fc.integer({ min: 1, max: 9 }) })
        .map(({ div, w }): SchedulingInstruction => ({ id: "", kind: "court_allowlist", selector: { divisionIds: [div] }, courtIds: ["C1", "C2"], strength: "preference", weight: w })),
      fc
        .record({ div: fc.constantFrom("D1", "D2"), m: fc.integer({ min: 0, max: 60 }) })
        .map(({ div, m }): SchedulingInstruction => ({ id: "", kind: "min_rest", divisionIds: [div], minutes: m, strength: "mandatory" })),
    );
    return fc.array(one, { maxLength: 3 }).map((list) => list.map((i, k) => ({ ...i, id: `i${k}` }) as SchedulingInstruction));
  };

  it("every returned option is independently valid, for random tournaments and instructions", () => {
    let scheduled = 0;
    let total = 0;
    fc.assert(
      fc.property(
        divisionSpec("D1", "MD"),
        divisionSpec("D2", "WD"),
        fc.integer({ min: 2, max: 5 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 1000 }),
        fc.constantFrom(undefined, 4, 7),
        fc.boolean(),
        (d1, d2, courtCount, twoDays, seed, dailyCap, withInstructions) => {
          const days = twoDays ? [DAY1, DAY2] : [DAY1];
          const base = tournament({
            days,
            courts: courts(courtCount, days.map((d) => fullDay(d, 8 * 60, 20 * 60))),
            divisions: [d1, d2],
            ...(dailyCap === undefined ? {} : { rules: { maxMatchesPerPlayerPerDay: dailyCap } }),
          });
          const inventory = buildInventory(base);
          const instructions = withInstructions ? fc.sample(instructionsFor(courtCount), { numRuns: 1, seed })[0]! : [];
          const result = optimizeSchedules(inventory, { seed, instructions, budget: { iterationsPerStrategy: 120 }, diversityAttempts: 1 });
          total++;
          if (result.status === "ok") scheduled++;
          if (result.status !== "ok") {
            expect(["no_schedule", "invalid_instructions"]).toContain(result.status);
            expect(result.options).toEqual([]);
            return;
          }
          for (const option of result.options) {
            expect(option.schedule.assignments).toHaveLength(inventory.matches.length);
            const full = validateScheduleWithInstructions(inventory, option.schedule, instructions);
            expect(full.ok).toBe(true);
            if (full.ok) {
              expect(full.value.violations.slice(0, 3)).toEqual([]);
              expect(full.value.instructionViolations).toEqual([]);
            }
          }
          // Without instructions the plain validator on the original inventory must also pass.
          if (instructions.length === 0) for (const o of result.options) expect(validateSchedule(inventory, o.schedule).valid).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
    // The property must not be vacuous: most random cases should actually be scheduled.
    expect(scheduled).toBeGreaterThan(total / 2);
  }, 120_000);

  it("is a pure function of its inputs: the input inventory is never mutated", () => {
    fc.assert(
      fc.property(divisionSpec("D1", "MD"), fc.integer({ min: 1, max: 99 }), (spec, seed) => {
        const inventory = buildInventory(tournament({ days: [DAY1, DAY2], courts: courts(3, [fullDay(DAY1), fullDay(DAY2)]), divisions: [spec] }));
        const before = JSON.stringify(inventory.config);
        optimizeSchedules(inventory, { seed, budget: { iterationsPerStrategy: 60 } });
        expect(JSON.stringify(inventory.config)).toBe(before);
      }),
      { numRuns: 15 },
    );
  }, 60_000);
});
