import type { Id } from "../config/types.js";
import { areOrdered, type DependencyGraph } from "./graph.js";
import { groupKey, type Inventory, type Match, type MatchId, type Slot } from "./types.js";

/**
 * Known participants per match, typically derived from recorded results.
 * `null` means that side is not decided yet.
 */
export type Resolution = ReadonlyMap<MatchId, readonly [Id | null, Id | null]>;

/**
 * Answers "who could play in this match?" conservatively.
 *
 * Every slot has a set of possible teams: the team itself, every team of a
 * group for a group position, or the union over the feeding match. A schedule
 * must be valid for every possible outcome, so constraints on unresolved
 * fixtures are checked against these sets.
 *
 * Pure possible-team sets would also forbid things that can never happen, such
 * as two semifinals of the same bracket at the same time. Two structural facts
 * rule those out without weakening the guarantee:
 *  1. Within one stage, each entry position (a team, or a group finishing
 *     position) is held by exactly one team. In a group, two matches share a
 *     team only if they share an entry position. In a bracket, a team follows
 *     a single path of winner/loser links, so two knockout matches of the same
 *     stage that neither precede each other (e.g. the final and the
 *     third-place match) can never contain the same team.
 *  2. Matches ordered by dependencies (e.g. a quarterfinal and the semifinal it
 *     feeds) are kept apart by the dependency-plus-rest rule instead.
 */
export class ParticipantModel {
  private readonly tokensCache = new Map<MatchId, ReadonlySet<string>>();
  private readonly teamsCache = new Map<MatchId, ReadonlySet<Id>>();
  private readonly playersCache = new Map<MatchId, ReadonlySet<Id>>();

  constructor(
    readonly inventory: Inventory,
    readonly graph: DependencyGraph,
    readonly resolution: Resolution = new Map(),
  ) {}

  /** Entry positions within the match's stage that could feed this match. */
  entryTokens(matchId: MatchId): ReadonlySet<string> {
    const cached = this.tokensCache.get(matchId);
    if (cached) return cached;
    const match = this.match(matchId);
    const tokens = new Set<string>();
    for (const slot of match.slots) {
      if (slot.type === "team") tokens.add(`team:${slot.teamId}`);
      else if (slot.type === "group_rank") tokens.add(`rank:${slot.groupId}:${slot.rank}`);
      else if (slot.type === "wildcard") tokens.add(`wildcard:${slot.stageId}:${slot.rank}:${slot.index}`);
      else for (const t of this.entryTokens(slot.matchId)) tokens.add(t);
    }
    this.tokensCache.set(matchId, tokens);
    return tokens;
  }

  /** Teams that could occupy the slot, narrowed by the resolution where known. */
  possibleTeamsForSlot(matchId: MatchId, side: 0 | 1): ReadonlySet<Id> {
    const known = this.resolution.get(matchId)?.[side];
    if (known) return new Set([known]);
    return this.slotTeams(this.match(matchId).slots[side]);
  }

  possibleTeams(matchId: MatchId): ReadonlySet<Id> {
    const cached = this.teamsCache.get(matchId);
    if (cached) return cached;
    const teams = new Set<Id>([...this.possibleTeamsForSlot(matchId, 0), ...this.possibleTeamsForSlot(matchId, 1)]);
    this.teamsCache.set(matchId, teams);
    return teams;
  }

  possiblePlayers(matchId: MatchId): ReadonlySet<Id> {
    const cached = this.playersCache.get(matchId);
    if (cached) return cached;
    const players = new Set<Id>();
    for (const teamId of this.possibleTeams(matchId)) {
      for (const p of this.inventory.teamById.get(teamId)!.playerIds) players.add(p);
    }
    this.playersCache.set(matchId, players);
    return players;
  }

  /** Both sides known, from team slots or from the resolution. */
  isResolved(matchId: MatchId): boolean {
    return this.knownTeam(matchId, 0) !== null && this.knownTeam(matchId, 1) !== null;
  }

  knownTeam(matchId: MatchId, side: 0 | 1): Id | null {
    const known = this.resolution.get(matchId)?.[side];
    if (known) return known;
    const slot = this.match(matchId).slots[side];
    return slot.type === "team" ? slot.teamId : null;
  }

  /**
   * Players who might have to play in both matches. Returns an empty list when
   * the matches are dependency-ordered or structurally exclusive.
   */
  sharedPlayers(a: MatchId, b: MatchId): { playerIds: Id[]; certainty: "definite" | "possible" } {
    const none = { playerIds: [], certainty: "possible" as const };
    if (a === b || areOrdered(this.graph, a, b)) return none;
    const ma = this.match(a);
    const mb = this.match(b);
    if (ma.divisionId === mb.divisionId && ma.stageId === mb.stageId) {
      // A team follows one path through a bracket, so two knockout matches that
      // are not dependency-ordered can never both contain it.
      if (ma.phase === "knockout") return none;
      const ta = this.entryTokens(a);
      const tb = this.entryTokens(b);
      let sharesToken = false;
      for (const t of ta) if (tb.has(t)) sharesToken = true;
      if (!sharesToken) return none;
    }
    const pb = this.possiblePlayers(b);
    const shared = [...this.possiblePlayers(a)].filter((p) => pb.has(p)).sort();
    if (shared.length === 0) return none;
    const definite = this.isResolved(a) && this.isResolved(b);
    return { playerIds: shared, certainty: definite ? "definite" : "possible" };
  }

  private slotTeams(slot: Slot): ReadonlySet<Id> {
    if (slot.type === "team") return new Set([slot.teamId]);
    if (slot.type === "group_rank") {
      return new Set(this.inventory.groupByKey.get(groupKey(slot.divisionId, slot.stageId, slot.groupId))!.teamIds);
    }
    if (slot.type === "wildcard") {
      // Any team of any group of the stage could turn out to be the best team of that position.
      const prefix = `${slot.divisionId}|${slot.stageId}|`;
      const teams = new Set<Id>();
      for (const [key, group] of this.inventory.groupByKey) if (key.startsWith(prefix)) group.teamIds.forEach((t) => teams.add(t));
      return teams;
    }
    return this.possibleTeams(slot.matchId);
  }

  private match(id: MatchId): Match {
    const m = this.inventory.matchById.get(id);
    if (!m) throw new Error(`Unknown match ${id}`);
    return m;
  }
}
