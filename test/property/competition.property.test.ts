import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  crossoverSeeds,
  earliestMeetingRound,
  nextPowerOfTwo,
  planKnockout,
  roundRobinMatchCount,
  roundRobinPairings,
  roundRobinRoundCount,
  seedLineOrder,
  type Feed,
} from "../../src/index.js";

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

describe("round robin (property)", () => {
  it("every pair meets exactly once per leg, at most one match per entrant per round", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 32 }), fc.constantFrom<1 | 2>(1, 2), (n, legs) => {
        const entrants = Array.from({ length: n }, (_, i) => i);
        const pairings = roundRobinPairings(entrants, legs);
        expect(pairings).toHaveLength(roundRobinMatchCount(n, legs));
        expect(new Set(pairings.map((p) => p.round)).size).toBe(roundRobinRoundCount(n, legs));

        const counts = new Map<string, number>();
        for (const p of pairings) {
          expect(p.a).not.toBe(p.b);
          counts.set(pairKey(p.a, p.b), (counts.get(pairKey(p.a, p.b)) ?? 0) + 1);
        }
        expect(counts.size).toBe((n * (n - 1)) / 2);
        for (const c of counts.values()) expect(c).toBe(legs);

        const byRound = new Map<number, number[]>();
        for (const p of pairings) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p.a, p.b]);
        for (const players of byRound.values()) {
          expect(new Set(players).size).toBe(players.length);
          // Odd n: exactly one entrant sits out each round.
          expect(players.length).toBe(n % 2 === 0 ? n : n - 1);
        }
      }),
    );
  });

  it("second leg reverses slot order of the first", () => {
    const pairings = roundRobinPairings([1, 2, 3, 4, 5], 2);
    const half = pairings.length / 2;
    for (let i = 0; i < half; i++) {
      expect(pairings[i + half]!.a).toBe(pairings[i]!.b);
      expect(pairings[i + half]!.b).toBe(pairings[i]!.a);
      expect(pairings[i + half]!.leg).toBe(2);
    }
  });

  it("first-slot assignments are balanced within one per entrant", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 24 }), (n) => {
        const pairings = roundRobinPairings(Array.from({ length: n }, (_, i) => i), 1);
        const first = new Map<number, number>();
        for (const p of pairings) first.set(p.a, (first.get(p.a) ?? 0) + 1);
        const total = n - 1;
        for (let i = 0; i < n; i++) {
          const f = first.get(i) ?? 0;
          expect(Math.abs(f - (total - f))).toBeLessThanOrEqual(n % 2 === 0 ? 2 : 2);
        }
      }),
    );
  });
});

/** Follows feeds back to the entrants a match can contain. */
function entrantsOf<T>(plan: ReturnType<typeof planKnockout<T>>, feed: Feed<T>): number[] {
  if (feed.type === "entrant") return [feed.seed];
  const m = plan.rounds[feed.round - 1]![feed.index]!;
  return [...entrantsOf(plan, m.a), ...entrantsOf(plan, m.b)];
}

describe("single elimination (property)", () => {
  it("n-1 matches (+1 third place), each entrant enters exactly once, every winner feeds once", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 128 }), fc.boolean(), (n, third) => {
        const thirdPlace = third && n >= 4;
        const plan = planKnockout(Array.from({ length: n }, (_, i) => `e${i + 1}`), thirdPlace);
        const all = plan.rounds.flat();
        expect(all).toHaveLength(n - 1);
        expect(plan.rounds[plan.roundCount - 1]).toHaveLength(1);
        expect(plan.thirdPlace !== undefined).toBe(thirdPlace);

        const entries = all.flatMap((m) => [m.a, m.b]).filter((f) => f.type === "entrant");
        expect(entries.map((f) => (f as { seed: number }).seed).sort((a, b) => a - b)).toEqual(
          Array.from({ length: n }, (_, i) => i + 1),
        );

        const fed = new Map<string, number>();
        for (const m of all) {
          for (const f of [m.a, m.b]) if (f.type === "winner") fed.set(`${f.round}:${f.index}`, (fed.get(`${f.round}:${f.index}`) ?? 0) + 1);
          // A match never takes inputs from its own or a later round.
          for (const f of [m.a, m.b]) if (f.type !== "entrant") expect(f.round).toBeLessThan(m.round);
        }
        for (const m of all) {
          const key = `${m.round}:${m.index}`;
          expect(fed.get(key) ?? 0).toBe(m.round === plan.roundCount ? 0 : 1);
        }
        // Final contains every entrant on exactly one side.
        const final = plan.rounds[plan.roundCount - 1]![0]!;
        const sideA = entrantsOf(plan, final.a);
        const sideB = entrantsOf(plan, final.b);
        expect([...sideA, ...sideB].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        // Seeds 1 and 2 are on opposite sides.
        expect(sideA.includes(1) !== sideB.includes(1)).toBe(true);
        expect(sideA.includes(1) === sideB.includes(2)).toBe(true);
      }),
    );
  });

  it("byes go to the top seeds only", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 128 }), (n) => {
        const plan = planKnockout(Array.from({ length: n }, (_, i) => i), false);
        const firstRoundSeeds = plan.rounds[0]!.flatMap((m) => [m.a, m.b]).map((f) => (f as { seed: number }).seed);
        const byes = plan.size - n;
        // Seeds 1..byes skip round 1; everyone else plays it.
        expect(firstRoundSeeds.sort((a, b) => a - b)).toEqual(Array.from({ length: n - byes }, (_, i) => byes + i + 1));
      }),
    );
  });

  it("top 2^k seeds land in different 1/2^k sections", () => {
    for (const size of [4, 8, 16, 32, 64]) {
      const line = seedLineOrder(size);
      const pos = (seed: number) => line.indexOf(seed);
      for (let k = 1; 2 ** k <= size; k++) {
        const sections = new Set(Array.from({ length: 2 ** k }, (_, s) => Math.floor(pos(s + 1) / (size / 2 ** k))));
        expect(sections.size).toBe(2 ** k);
      }
    }
  });
});

describe("group crossover (property)", () => {
  it("is never worse than the best tier arrangement found by exhaustive search", () => {
    for (let groups = 2; groups <= 5; groups++) {
      for (let perGroup = 1; perGroup <= 4; perGroup++) {
        const orders = permutations(Array.from({ length: groups }, (_, g) => g));
        if (orders.length ** (perGroup - 1) > 20000) continue;
        let optimal = Number.POSITIVE_INFINITY;
        const search = (tiers: number[][]) => {
          if (tiers.length === perGroup) {
            optimal = Math.min(optimal, firstMatchMeetings(tiers, groups * perGroup));
            return;
          }
          for (const order of orders) search([...tiers, order]);
        };
        search([orders[0]!]);
        const result = crossoverSeeds(groups, perGroup);
        result.seeds.forEach((s, i) => expect(s.rank).toBe(Math.floor(i / groups) + 1));
        expect(result.sameGroupFirstRoundMeetings).toBe(optimal);
      }
    }
  });

  it("avoids every same-group first match for common formats", () => {
    for (const [groups, perGroup] of [[2, 2], [3, 2], [4, 2], [4, 1], [8, 2], [6, 2], [4, 4], [3, 3]] as const) {
      expect(crossoverSeeds(groups, perGroup).sameGroupFirstRoundMeetings).toBe(0);
    }
    // 2 groups x top 3: a group winner with a bye must meet a rank-2/rank-3 pair
    // that always contains a team from its own group; reported, not hidden.
    expect(crossoverSeeds(2, 3).sameGroupFirstRoundMeetings).toBe(2);
  });

  it("winner and runner-up of a group are in opposite halves for 4 groups x 2", () => {
    const { seeds } = crossoverSeeds(4, 2);
    const line = seedLineOrder(8);
    for (let g = 0; g < 4; g++) {
      const winner = seeds.findIndex((s) => s.groupIndex === g && s.rank === 1) + 1;
      const runner = seeds.findIndex((s) => s.groupIndex === g && s.rank === 2) + 1;
      expect(earliestMeetingRound(line.indexOf(winner), line.indexOf(runner))).toBe(3);
    }
  });
});

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

/** Independent count of same-group pairs meeting in their first match, bye-aware. */
function firstMatchMeetings(tiers: number[][], total: number): number {
  const size = nextPowerOfTwo(total);
  const line = seedLineOrder(size);
  const lineOf: number[] = [];
  line.forEach((seed, position) => (lineOf[seed] = position));
  const firstRound = (position: number) => (line[position ^ 1]! > total ? 2 : 1);
  const groupOfSeed = tiers.flat();
  let count = 0;
  for (let i = 0; i < groupOfSeed.length; i++) {
    for (let j = i + 1; j < groupOfSeed.length; j++) {
      if (groupOfSeed[i] !== groupOfSeed[j]) continue;
      const a = lineOf[i + 1]!;
      const b = lineOf[j + 1]!;
      if (earliestMeetingRound(a, b) === Math.max(firstRound(a), firstRound(b))) count++;
    }
  }
  return count;
}
