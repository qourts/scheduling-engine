/**
 * Single-elimination bracket planning, independent of IDs and scheduling.
 *
 * Entrants are given in seed order (index 0 = seed 1). The bracket size is the
 * next power of two; missing entrants are byes, which by construction are always
 * paired with the top seeds, so a bye never meets a bye. Seeds 1 and 2 are in
 * opposite halves and can only meet in the final; seeds 1-4 in different quarters.
 */

export type Feed<T> =
  | { type: "entrant"; entrant: T; seed: number }
  | { type: "winner"; round: number; index: number }
  | { type: "loser"; round: number; index: number };

export interface PlannedMatch<T> {
  /** 1-based round. */
  round: number;
  /** 0-based index among the real matches of the round. */
  index: number;
  a: Feed<T>;
  b: Feed<T>;
}

export interface KnockoutPlan<T> {
  size: number;
  roundCount: number;
  rounds: PlannedMatch<T>[][];
  thirdPlace?: PlannedMatch<T>;
}

/** Bracket line order of seeds for a power-of-two size, e.g. 8 -> [1,8,4,5,2,7,3,6]. */
export function seedLineOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) throw new Error(`Bracket size must be a power of two (got ${size})`);
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((s) => [s, next - s]);
  }
  return order;
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** The round (1-based) in which two bracket line positions (0-based) could first meet. */
export function earliestMeetingRound(lineA: number, lineB: number): number {
  if (lineA === lineB) throw new Error("Same line position");
  return Math.floor(Math.log2(lineA ^ lineB)) + 1;
}

export function planKnockout<T>(entrants: readonly T[], thirdPlaceMatch: boolean): KnockoutPlan<T> {
  const n = entrants.length;
  if (n < 2) throw new Error("A knockout needs at least 2 entrants");
  if (thirdPlaceMatch && n < 4) throw new Error("A third-place match needs at least 4 entrants");
  const size = nextPowerOfTwo(n);
  const roundCount = Math.log2(size);
  const line = seedLineOrder(size);

  // Outcome of each line pair: who comes out of it into the next round.
  let outcomes: (Feed<T> | null)[] = line.map((seed) =>
    seed <= n ? { type: "entrant", entrant: entrants[seed - 1]!, seed } : null,
  );
  const rounds: PlannedMatch<T>[][] = [];

  for (let round = 1; round <= roundCount; round++) {
    const matches: PlannedMatch<T>[] = [];
    const next: (Feed<T> | null)[] = [];
    for (let i = 0; i < outcomes.length; i += 2) {
      const a = outcomes[i] ?? null;
      const b = outcomes[i + 1] ?? null;
      if (a && b) {
        const index = matches.length;
        matches.push({ round, index, a, b });
        next.push({ type: "winner", round, index });
      } else {
        // A bye: the present entrant advances without playing.
        next.push(a ?? b);
      }
    }
    rounds.push(matches);
    outcomes = next;
  }

  const plan: KnockoutPlan<T> = { size, roundCount, rounds };
  if (thirdPlaceMatch) {
    const semis = rounds[roundCount - 2]!;
    if (semis.length !== 2) throw new Error("Third-place match requires two semifinals");
    plan.thirdPlace = {
      round: roundCount,
      index: 1,
      a: { type: "loser", round: roundCount - 1, index: 0 },
      b: { type: "loser", round: roundCount - 1, index: 1 },
    };
  }
  return plan;
}

/** Human label for a knockout round given how many rounds remain. */
export function knockoutRoundLabel(round: number, roundCount: number): string {
  const remaining = roundCount - round;
  if (remaining === 0) return "Final";
  if (remaining === 1) return "Semifinal";
  if (remaining === 2) return "Quarterfinal";
  return `Round of ${2 ** (remaining + 1)}`;
}

export function knockoutRoundCode(round: number, roundCount: number): string {
  const remaining = roundCount - round;
  if (remaining === 0) return "F";
  if (remaining === 1) return "SF";
  if (remaining === 2) return "QF";
  return `R${2 ** (remaining + 1)}`;
}
