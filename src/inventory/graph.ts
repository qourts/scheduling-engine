import { compareStrings } from "../util/compare.js";
import type { Inventory, MatchId } from "./types.js";

export interface DependencyGraph {
  /** Topological order; ties broken by generation order, so it is deterministic. */
  order: MatchId[];
  /** Direct successors of each match. */
  successors: ReadonlyMap<MatchId, MatchId[]>;
  /** All transitive predecessors of each match. */
  ancestors: ReadonlyMap<MatchId, ReadonlySet<MatchId>>;
  /** Number of matches on the longest dependency chain ending at each match (1 = no dependencies). */
  depth: ReadonlyMap<MatchId, number>;
}

export class DependencyCycleError extends Error {
  constructor(readonly matchIds: MatchId[]) {
    super(`Dependency cycle among matches: ${matchIds.join(", ")}`);
    this.name = "DependencyCycleError";
  }
}

export function buildDependencyGraph(inventory: Inventory): DependencyGraph {
  const position = new Map(inventory.matches.map((m, i) => [m.id, i]));
  const successors = new Map<MatchId, MatchId[]>(inventory.matches.map((m) => [m.id, []]));
  const remaining = new Map<MatchId, number>();
  for (const match of inventory.matches) {
    remaining.set(match.id, match.dependencies.length);
    for (const dep of match.dependencies) {
      const list = successors.get(dep.matchId);
      if (!list) throw new Error(`Match ${match.id} depends on unknown match ${dep.matchId}`);
      list.push(match.id);
    }
  }

  // Kahn's algorithm with a queue ordered by generation position.
  const ready = inventory.matches.filter((m) => m.dependencies.length === 0).map((m) => m.id);
  const order: MatchId[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => position.get(a)! - position.get(b)! || compareStrings(a, b));
    const id = ready.shift()!;
    order.push(id);
    for (const next of successors.get(id)!) {
      const left = remaining.get(next)! - 1;
      remaining.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  if (order.length !== inventory.matches.length) {
    throw new DependencyCycleError(inventory.matches.filter((m) => remaining.get(m.id)! > 0).map((m) => m.id));
  }

  const ancestors = new Map<MatchId, Set<MatchId>>();
  const depth = new Map<MatchId, number>();
  for (const id of order) {
    const match = inventory.matchById.get(id)!;
    const set = new Set<MatchId>();
    let d = 1;
    for (const dep of match.dependencies) {
      set.add(dep.matchId);
      for (const a of ancestors.get(dep.matchId)!) set.add(a);
      d = Math.max(d, depth.get(dep.matchId)! + 1);
    }
    ancestors.set(id, set);
    depth.set(id, d);
  }

  return { order, successors, ancestors, depth };
}

/** True when one match must finish before the other can start (transitively). */
export function areOrdered(graph: DependencyGraph, a: MatchId, b: MatchId): boolean {
  return graph.ancestors.get(a)!.has(b) || graph.ancestors.get(b)!.has(a);
}

/** All matches that (transitively) depend on the given match. */
export function descendantsOf(graph: DependencyGraph, id: MatchId): MatchId[] {
  const out: MatchId[] = [];
  const seen = new Set<MatchId>();
  const stack = [...(graph.successors.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(graph.successors.get(next) ?? []));
  }
  return out;
}
