import {
  buildDependencyGraph,
  Timeline,
  type Assignment,
  type Inventory,
  type Schedule,
} from "../../src/index.js";

/**
 * TEST-ONLY reference scheduler. It is deliberately naive and shares no logic
 * with the validator: matches are played one at a time across the whole venue,
 * in dependency order, each starting at least max(rest, turnover) after the
 * previous one ends, and never during any declared restriction. Such a schedule
 * satisfies every hard rule by construction whenever it fits, which makes it a
 * trustworthy positive fixture. Returns null if it does not fit.
 */
export function serialSchedule(inventory: Inventory): Schedule | null {
  const { config } = inventory;
  const timeline = new Timeline(config);
  const graph = buildDependencyGraph(inventory);
  const maxRest = Math.max(config.rules.minRestMinutes, ...config.divisions.map((d) => d.minRestMinutes ?? 0));
  const gap = Math.max(maxRest, config.rules.courtTurnoverMinutes);
  const blocked = (config.restrictions ?? []).map((r) => timeline.window(r.window));
  const assignments: Assignment[] = [];
  let cursor = 0;

  for (const id of graph.order) {
    const match = inventory.matchById.get(id)!;
    const division = config.divisions.find((d) => d.id === match.divisionId)!;
    const allowed = division.playWindows?.map((w) => timeline.window(w));
    let best: { start: number; courtId: string; day: string } | null = null;
    for (const court of config.courts) {
      if (division.eligibleCourtIds && !division.eligibleCourtIds.includes(court.id)) continue;
      for (const w of court.availability) {
        const iv = timeline.window(w);
        let start = Math.max(cursor, iv.start);
        // Skip past restrictions and division windows.
        for (let guard = 0; guard < 1000; guard++) {
          const end = start + match.durationMinutes;
          const hit = blocked.find((b) => b.start < end && start < b.end);
          if (hit) {
            start = hit.end;
            continue;
          }
          if (allowed && !allowed.some((a) => start >= a.start && end <= a.end)) {
            const next = allowed.filter((a) => a.start > start).sort((a, b) => a.start - b.start)[0];
            if (!next) {
              start = Number.POSITIVE_INFINITY;
              break;
            }
            start = next.start;
            continue;
          }
          break;
        }
        if (start + match.durationMinutes <= iv.end && (best === null || start < best.start)) {
          best = { start, courtId: court.id, day: w.day };
        }
      }
    }
    if (!best) return null;
    const dayStart = timeline.absolute(best.day, 0);
    assignments.push({ matchId: id, courtId: best.courtId, day: best.day, start: best.start - dayStart });
    cursor = best.start + match.durationMinutes + gap;
  }
  return { tournamentId: config.id, assignments };
}
