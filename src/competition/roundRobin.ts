/**
 * Round-robin pairing by the circle (polygon) method.
 *
 * For n entrants (a dummy "bye" is added when n is odd) this yields n-1 rounds
 * (n even) or n rounds (n odd). Every pair meets exactly once per leg and every
 * entrant plays at most once per round; with odd n each entrant sits out exactly
 * one round per leg.
 */

export interface Pairing<T> {
  /** 1-based round number across all legs. */
  round: number;
  /** 1-based leg number. */
  leg: number;
  a: T;
  b: T;
}

export function roundRobinPairings<T>(entrants: readonly T[], legs: 1 | 2): Pairing<T>[] {
  if (entrants.length < 2) return [];
  const ring: (T | null)[] = [...entrants];
  if (ring.length % 2 === 1) ring.push(null);
  const n = ring.length;
  const roundsPerLeg = n - 1;
  const firstLeg: Pairing<T>[] = [];

  for (let r = 0; r < roundsPerLeg; r++) {
    for (let i = 0; i < n / 2; i++) {
      let a = ring[i]!;
      let b = ring[n - 1 - i]!;
      if (a === null || b === null) continue;
      // Alternate the fixed entrant's slot so slot order stays balanced.
      if (i === 0 && r % 2 === 1) [a, b] = [b, a];
      firstLeg.push({ round: r + 1, leg: 1, a, b });
    }
    // Rotate every position except the first.
    const last = ring.pop()!;
    ring.splice(1, 0, last);
  }

  if (legs === 1) return firstLeg;
  const secondLeg = firstLeg.map((p) => ({ round: p.round + roundsPerLeg, leg: 2, a: p.b, b: p.a }));
  return [...firstLeg, ...secondLeg];
}

/** Number of matches in a round robin of n entrants. */
export function roundRobinMatchCount(n: number, legs: 1 | 2): number {
  return (legs * n * (n - 1)) / 2;
}

/** Number of rounds in a round robin of n entrants. */
export function roundRobinRoundCount(n: number, legs: 1 | 2): number {
  if (n < 2) return 0;
  return legs * (n % 2 === 0 ? n - 1 : n);
}
