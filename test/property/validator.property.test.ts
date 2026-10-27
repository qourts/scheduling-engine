import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildInventory, Timeline, validateSchedule, type Inventory, type ProgressionState, type Schedule } from "../../src/index.js";
import { divisionSpec } from "../support/arbitraries.js";
import { courts, DAY1, DAY2, fullDay, tournament } from "../support/fixtures.js";
import { oracleSchedule } from "../support/oracleScheduler.js";
import { serialSchedule } from "../support/serialScheduler.js";
import { playAll } from "../support/simulate.js";

const config2 = (a: Parameters<typeof tournament>[0]["divisions"][number], b: Parameters<typeof tournament>[0]["divisions"][number], courtCount: number) => {
  const config = tournament({
    days: [DAY1, DAY2],
    courts: courts(courtCount, [fullDay(DAY1, 8 * 60, 20 * 60), fullDay(DAY2, 8 * 60, 20 * 60)]),
    divisions: [a, b],
  });
  config.divisions[1]!.teams[0]!.playerIds[0] = "A-p1a";
  config.divisions[1]!.teams[1]!.playerIds[0] = "A-p2a";
  config.players = config.players.filter((p) => p.id !== "B-p1a" && p.id !== "B-p2a");
  return config;
};

/** Independent check of what actually happened: real participants, real gaps. */
function actualPlayerViolations(inventory: Inventory, schedule: Schedule, state: ProgressionState): string[] {
  const timeline = new Timeline(inventory.config);
  const items = schedule.assignments.map((a) => {
    const m = inventory.matchById.get(a.matchId)!;
    const div = inventory.config.divisions.find((d) => d.id === m.divisionId)!;
    const start = timeline.absolute(a.day, a.start);
    const players = state.participants.get(m.id)!.flatMap((t) => inventory.teamById.get(t!)!.playerIds);
    return { id: m.id, start, end: start + m.durationMinutes, players, rest: div.minRestMinutes ?? inventory.config.rules.minRestMinutes };
  });
  const problems: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      const a = items[i]!;
      const b = items[j]!;
      if (i === j || a.start > b.start || (a.start === b.start && i > j)) continue;
      if (!a.players.some((p) => b.players.includes(p))) continue;
      if (b.start < a.end + Math.max(a.rest, b.rest)) problems.push(`${a.id} -> ${b.id}`);
    }
  }
  return problems;
}

describe("validator (property)", () => {
  it("accepts the serial reference schedule for any valid tournament", () => {
    fc.assert(
      fc.property(divisionSpec("A"), divisionSpec("B", "XD"), (a, b) => {
        const config = config2(a, b, 2);
        const inventory = buildInventory(config);
        const schedule = serialSchedule(inventory);
        if (!schedule) return;
        expect(validateSchedule(inventory, schedule).violations).toEqual([]);
      }),
      { numRuns: 80 },
    );
  });

  it("detects any match moved onto an occupied court slot", () => {
    fc.assert(
      fc.property(divisionSpec("A"), divisionSpec("B", "XD"), fc.nat(), fc.nat(), (a, b, i, j) => {
        const inventory = buildInventory(config2(a, b, 2));
        const schedule = serialSchedule(inventory);
        if (!schedule || schedule.assignments.length < 2) return;
        const x = i % schedule.assignments.length;
        let y = j % schedule.assignments.length;
        if (x === y) y = (y + 1) % schedule.assignments.length;
        const moved = { ...schedule, assignments: schedule.assignments.map((s) => ({ ...s })) };
        Object.assign(moved.assignments[y]!, { courtId: moved.assignments[x]!.courtId, day: moved.assignments[x]!.day, start: moved.assignments[x]!.start });
        expect(validateSchedule(inventory, moved).violations.map((v) => v.code)).toContain("COURT_OVERLAP");
      }),
      { numRuns: 80 },
    );
  });

  it("end-to-end soundness: a validated dense schedule never breaks rest or overlap for any simulated outcome", () => {
    fc.assert(
      fc.property(divisionSpec("A"), divisionSpec("B", "XD"), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (a, b, seed) => {
        const inventory = buildInventory(config2(a, b, 3));
        if (inventory.matches.length > 45) return;
        const schedule = oracleSchedule(inventory);
        if (!schedule) return;
        expect(validateSchedule(inventory, schedule).valid).toBe(true);
        for (let run = 0; run < 4; run++) {
          expect(actualPlayerViolations(inventory, schedule, playAll(inventory, seed + run))).toEqual([]);
        }
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});
