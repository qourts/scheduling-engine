import type { Division, Id, Tiebreaker } from "../config/types.js";
import type { GroupStructure, Inventory, Match } from "../inventory/types.js";
import { fnv1a } from "../util/hash.js";
import { compareStrings } from "../util/compare.js";
import type { MatchResult, StandingRow } from "./types.js";

interface PlayedMatch {
  match: Match;
  teams: readonly [Id, Id];
  result: MatchResult;
}

/**
 * Computes and ranks a group table.
 *
 * Tiebreakers are applied in the configured order to the set of tied teams.
 * Whenever a criterion splits a tie into smaller ties, each smaller tie is
 * re-ranked from the first criterion, so head-to-head is always evaluated among
 * exactly the teams still tied (the common "restart" rule). The last criterion
 * is always "draw", so the order is total and reproducible.
 */
export function computeGroupStandings(
  inventory: Inventory,
  division: Division,
  group: GroupStructure,
  results: ReadonlyMap<string, MatchResult>,
): StandingRow[] {
  const rows = new Map<Id, StandingRow>(
    group.teamIds.map((teamId) => [
      teamId,
      { teamId, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, pointsFor: 0, pointsAgainst: 0 },
    ]),
  );
  const played: PlayedMatch[] = [];
  for (const matchId of group.matchIds) {
    const result = results.get(matchId);
    if (!result) continue;
    const match = inventory.matchById.get(matchId)!;
    const [s0, s1] = match.slots;
    if (s0.type !== "team" || s1.type !== "team") throw new Error(`Group match ${matchId} must have fixed teams`);
    const teams = [s0.teamId, s1.teamId] as const;
    played.push({ match, teams, result });
    teams.forEach((teamId, side) => {
      const row = rows.get(teamId)!;
      row.played++;
      if (result.winner === side) row.wins++;
      else row.losses++;
      for (const g of result.games) {
        const mine = side === 0 ? g.a : g.b;
        const theirs = side === 0 ? g.b : g.a;
        row.pointsFor += mine;
        row.pointsAgainst += theirs;
        if (mine > theirs) row.gamesWon++;
        else if (theirs > mine) row.gamesLost++;
      }
    });
  }

  const seedOf = new Map(division.teams.map((t) => [t.id, t.seed ?? Number.POSITIVE_INFINITY]));
  const drawKey = (teamId: Id) => fnv1a(`${inventory.config.id}|${division.id}|${group.groupId}|${teamId}`);
  const criteria = division.standings.tiebreakers;

  const score = (criterion: Tiebreaker, teamId: Id, tied: ReadonlySet<Id>): number => {
    const r = rows.get(teamId)!;
    switch (criterion) {
      case "wins":
        return r.wins;
      case "head_to_head":
        return played.filter((p) => tied.has(p.teams[0]) && tied.has(p.teams[1]) && p.teams[p.result.winner] === teamId).length;
      case "game_difference":
        return r.gamesWon - r.gamesLost;
      case "point_difference":
        return r.pointsFor - r.pointsAgainst;
      case "points_for":
        return r.pointsFor;
      case "seed":
        return -seedOf.get(teamId)!;
      case "draw":
        return -drawKey(teamId);
    }
  };

  const resolve = (teams: Id[], from: number): Id[] => {
    if (teams.length <= 1) return teams;
    const tied = new Set(teams);
    for (let i = from; i < criteria.length; i++) {
      const criterion = criteria[i]!;
      const values = new Map(teams.map((t) => [t, score(criterion, t, tied)]));
      const distinct = [...new Set(values.values())].sort((a, b) => b - a);
      if (distinct.length === 1) continue;
      return distinct.flatMap((v) => {
        const part = teams.filter((t) => values.get(t) === v);
        return part.length > 1 ? resolve(part, 0) : part;
      });
    }
    // Only reachable if two teams share a draw hash; fall back to id order.
    return [...teams].sort(compareStrings);
  };

  return resolve([...group.teamIds], 0).map((id) => rows.get(id)!);
}
