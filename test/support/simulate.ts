import {
  applyEvent,
  initialState,
  type Inventory,
  type MatchResult,
  type ProgressionState,
} from "../../src/index.js";

/** Small deterministic PRNG (mulberry32) for reproducible simulations. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomResult(random: () => number, bestOf: 1 | 3 | 5): MatchResult {
  const winner = random() < 0.5 ? 0 : 1;
  const needed = Math.ceil(bestOf / 2);
  const loserGames = Math.floor(random() * needed);
  const games: { a: number; b: number }[] = [];
  const order = [...Array(loserGames).fill(1 - winner), ...Array(needed - 1).fill(winner)];
  order.sort(() => random() - 0.5);
  order.push(winner);
  for (const side of order) {
    const lose = Math.floor(random() * 10);
    games.push(side === 0 ? { a: 11, b: lose } : { a: lose, b: 11 });
  }
  return { winner: winner as 0 | 1, outcome: "played", games };
}

/** Plays every match with random results, in an order where each match is ready. */
export function playAll(inventory: Inventory, seed: number): ProgressionState {
  const random = rng(seed);
  let state = initialState(inventory);
  let n = 0;
  for (let guard = 0; guard < inventory.matches.length + 1; guard++) {
    const ready = inventory.matches.filter((m) => state.status.get(m.id) === "ready");
    if (ready.length === 0) break;
    for (const match of ready) {
      const division = inventory.config.divisions.find((d) => d.id === match.divisionId)!;
      const applied = applyEvent(inventory, state, {
        type: "result_recorded",
        eventId: `e${n++}`,
        at: "2026-11-14T10:00:00Z",
        actor: "sim",
        matchId: match.id,
        result: randomResult(random, division.scoring.bestOf),
      });
      if (!applied.ok) throw new Error(applied.error.message);
      state = applied.value.state;
    }
  }
  return state;
}
