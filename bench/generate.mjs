// Synthetic tournament generator for benchmarks. Deterministic for a given seed.
// Plain JavaScript on purpose: benchmarks run against the built package (dist/).

const CATEGORIES = [
  { id: "MD", name: "Men's Doubles", discipline: "doubles", gender: "men" },
  { id: "WD", name: "Women's Doubles", discipline: "doubles", gender: "women" },
  { id: "XD", name: "Mixed Doubles", discipline: "doubles", gender: "mixed" },
];

const TIEBREAKERS = ["wins", "head_to_head", "game_difference", "point_difference", "points_for", "draw"];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{ courts: number, targetMatches: number, days?: number, sharedPlayerRate?: number, seed?: number }} spec
 */
export function generateTournament(spec) {
  const rand = prng(spec.seed ?? 1);
  const dayCount = spec.days ?? 1;
  const days = Array.from({ length: dayCount }, (_, i) => `2026-11-${String(14 + i).padStart(2, "0")}`);
  const shared = spec.sharedPlayerRate ?? 0.08;

  const players = [];
  const known = [];
  const memberships = new Map();
  const person = (id) => {
    players.push({ id, name: id });
    known.push(id);
    memberships.set(id, 1);
    return id;
  };

  const divisions = [];
  let matches = 0;
  let d = 0;
  while (matches < spec.targetMatches) {
    d++;
    const kind = d % 3;
    // [teams, groups, perGroup, thirdPlace, matches]
    const shape = kind === 0 ? [16, 4, 2, false, 31] : kind === 1 ? [12, 3, 2, false, 23] : [8, 2, 2, true, 16];
    const [teamCount, groupCount, perGroup, third, count] = shape;
    const categoryId = CATEGORIES[d % CATEGORIES.length].id;
    const used = new Set();
    const pick = (fresh) => {
      // Some players also play in earlier divisions (cross-division conflicts); never twice in one division.
      if (known.length > 20 && rand() < shared) {
        const candidate = known[Math.floor(rand() * known.length)];
        // At most two divisions per player, as in a typical singles/doubles/mixed entry.
        if (!used.has(candidate) && memberships.get(candidate) < 2) {
          used.add(candidate);
          memberships.set(candidate, memberships.get(candidate) + 1);
          return candidate;
        }
      }
      const id = person(fresh);
      used.add(id);
      return id;
    };
    const teams = Array.from({ length: teamCount }, (_, t) => ({
      id: `D${d}-t${t + 1}`,
      name: `D${d} Team ${t + 1}`,
      playerIds: [pick(`D${d}-t${t + 1}-p1`), pick(`D${d}-t${t + 1}-p2`)],
      seed: t + 1,
    }));
    divisions.push({
      id: `D${d}`,
      name: `Division ${d}`,
      categoryId,
      teams,
      stages: [
        { id: "grp", kind: "groups", groupCount, legs: 1, allocation: "snake" },
        { id: "ko", kind: "single_elimination", source: { type: "qualifiers", fromStageId: "grp", perGroup }, thirdPlaceMatch: third },
      ],
      matchDurationMinutes: 30,
      scoring: { bestOf: 1 },
      standings: { tiebreakers: TIEBREAKERS },
    });
    matches += count;
  }

  const windows = days.map((day) => ({ day, start: 8 * 60, end: 20 * 60 }));
  return {
    id: `bench-${spec.courts}c-${spec.targetMatches}m`,
    name: "Benchmark Open",
    days,
    courts: Array.from({ length: spec.courts }, (_, i) => ({ id: `C${i + 1}`, name: `Court ${i + 1}`, availability: windows.map((w) => ({ ...w })) })),
    players,
    categories: CATEGORIES,
    divisions,
    rules: { courtTurnoverMinutes: 5, minRestMinutes: 20 },
  };
}
