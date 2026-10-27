import { earliestMeetingRound, nextPowerOfTwo, seedLineOrder } from "./knockout.js";

export interface QualifierToken {
  groupIndex: number;
  /** 1-based finishing position in the group. */
  rank: number;
}

export interface CrossoverResult {
  /** Qualifiers in knockout seed order (index 0 = seed 1). */
  seeds: QualifierToken[];
  /** Pairs of same-group qualifiers that could meet in the first round they can meet at all. */
  sameGroupFirstRoundMeetings: number;
}

const EXHAUSTIVE_LIMIT = 50_000;

/**
 * Orders group qualifiers into knockout seeds so that teams from the same group
 * meet as late as possible.
 *
 * Group winners take seeds 1..G in group order, runners-up the next G seeds, and
 * so on. Within each finishing tier the group order is chosen to minimise, in
 * lexicographic order, the number of same-group pairs that could meet in their
 * first match, then in their second match, and so on (byes are taken into
 * account). Small instances are searched exhaustively, so the result is optimal
 * for this tier structure; larger ones use a deterministic swap search. Any
 * unavoidable first-match meeting is reported, never hidden.
 */
export function crossoverSeeds(groupCount: number, perGroup: number): CrossoverResult {
  const entrants = groupCount * perGroup;
  const size = nextPowerOfTwo(entrants);
  const roundCount = Math.log2(size);
  const line = seedLineOrder(size);
  const lineOfSeed: number[] = [];
  line.forEach((seed, position) => (lineOfSeed[seed] = position));
  const firstRound = (position: number) => (line[position ^ 1]! > entrants ? 2 : 1);

  const identity = Array.from({ length: groupCount }, (_, g) => g);
  const seedsOf = (tiers: number[][]): QualifierToken[] =>
    tiers.flatMap((tier, t) => tier.map((groupIndex) => ({ groupIndex, rank: t + 1 })));

  /** meetings[r] = same-group pairs whose earliest meeting is their (r+1)-th match. */
  const cost = (tiers: number[][]): number[] => {
    const seeds = seedsOf(tiers);
    const meetings = new Array<number>(roundCount).fill(0);
    for (let i = 0; i < seeds.length; i++) {
      for (let j = i + 1; j < seeds.length; j++) {
        if (seeds[i]!.groupIndex !== seeds[j]!.groupIndex) continue;
        const a = lineOfSeed[i + 1]!;
        const b = lineOfSeed[j + 1]!;
        meetings[earliestMeetingRound(a, b) - Math.max(firstRound(a), firstRound(b))]!++;
      }
    }
    return meetings;
  };

  let best: number[][];
  const orders = permutationCount(groupCount) ** (perGroup - 1) <= EXHAUSTIVE_LIMIT ? permutations(identity) : null;
  if (orders) {
    best = [identity];
    let bestCost: number[] | null = null;
    const search = (tiers: number[][]) => {
      if (tiers.length === perGroup) {
        const c = cost(tiers);
        if (bestCost === null || lexLess(c, bestCost)) {
          bestCost = c;
          best = tiers;
        }
        return;
      }
      for (const order of orders) search([...tiers, order]);
    };
    search([identity]);
  } else {
    // Rotated start, then pairwise swaps within tiers while the cost improves.
    best = Array.from({ length: perGroup }, (_, t) => [...identity.slice(t % groupCount), ...identity.slice(0, t % groupCount)]);
    let bestCost = cost(best);
    for (let pass = 0, improved = true; improved && pass < 100; pass++) {
      improved = false;
      for (let t = 1; t < perGroup; t++) {
        for (let i = 0; i < groupCount; i++) {
          for (let j = i + 1; j < groupCount; j++) {
            const tier = best[t]!;
            [tier[i], tier[j]] = [tier[j]!, tier[i]!];
            const c = cost(best);
            if (lexLess(c, bestCost)) {
              bestCost = c;
              improved = true;
            } else {
              [tier[i], tier[j]] = [tier[j]!, tier[i]!];
            }
          }
        }
      }
    }
  }

  return { seeds: seedsOf(best), sameGroupFirstRoundMeetings: cost(best)[0]! };
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

function permutationCount(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** Permutations in lexicographic order, so the search is deterministic. */
function permutations(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}
