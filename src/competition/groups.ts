import type { Team } from "../config/types.js";

/** Group identifiers: A..Z, then G27, G28, ... */
export function groupLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `G${index + 1}`;
}

/** Seeded teams first (ascending seed), then unseeded teams in listed order. */
export function orderBySeed(teams: readonly Team[]): Team[] {
  const seeded = teams.filter((t) => t.seed !== undefined).sort((a, b) => a.seed! - b.seed!);
  const unseeded = teams.filter((t) => t.seed === undefined);
  return [...seeded, ...unseeded];
}

/**
 * Splits teams into groups whose sizes differ by at most one.
 * "snake" deals seeds A,B,C,C,B,A,A,B,... so group strength is balanced.
 * "sequential" fills group A first, then B, keeping the listed order.
 */
export function allocateGroups(teams: readonly Team[], groupCount: number, allocation: "snake" | "sequential"): Team[][] {
  const ordered = orderBySeed(teams);
  const groups: Team[][] = Array.from({ length: groupCount }, () => []);
  if (allocation === "snake") {
    ordered.forEach((team, i) => {
      const row = Math.floor(i / groupCount);
      const col = i % groupCount;
      groups[row % 2 === 0 ? col : groupCount - 1 - col]!.push(team);
    });
  } else {
    const base = Math.floor(ordered.length / groupCount);
    const extra = ordered.length % groupCount;
    let cursor = 0;
    for (let g = 0; g < groupCount; g++) {
      const size = base + (g < extra ? 1 : 0);
      groups[g] = ordered.slice(cursor, cursor + size);
      cursor += size;
    }
  }
  return groups;
}
