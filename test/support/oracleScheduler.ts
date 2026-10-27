import { buildDependencyGraph, validateSchedule, type Assignment, type Inventory, type Schedule } from "../../src/index.js";

/**
 * TEST-ONLY dense scheduler: places matches in dependency order at the earliest
 * slot (on a coarse grid) that the validator accepts for the partial schedule.
 * It produces tightly packed, parallel schedules whose validity rests entirely
 * on the validator, which is what the end-to-end soundness test then attacks
 * with simulated outcomes.
 */
export function oracleSchedule(inventory: Inventory, step = 15): Schedule | null {
  const { config } = inventory;
  const graph = buildDependencyGraph(inventory);
  const schedule: Schedule = { tournamentId: config.id, assignments: [] };
  for (const id of graph.order) {
    let placed: Assignment | null = null;
    search: for (const day of config.days) {
      for (let start = 0; start < 1440; start += step) {
        for (const court of config.courts) {
          const candidate = { matchId: id, courtId: court.id, day, start };
          schedule.assignments.push(candidate);
          if (validateSchedule(inventory, schedule, { allowPartial: true }).valid) {
            placed = candidate;
            break search;
          }
          schedule.assignments.pop();
        }
      }
    }
    if (!placed) return null;
  }
  return schedule;
}
