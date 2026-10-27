import { assertValidConfig } from "../config/validate.js";
import type { Division, Id, KnockoutStageConfig, Team, TournamentConfig } from "../config/types.js";
import { crossoverSeeds } from "../competition/crossover.js";
import { allocateGroups, groupLabel, orderBySeed } from "../competition/groups.js";
import { knockoutRoundCode, knockoutRoundLabel, planKnockout, type Feed } from "../competition/knockout.js";
import { roundRobinPairings } from "../competition/roundRobin.js";
import {
  groupKey,
  type Dependency,
  type DivisionStructure,
  type GroupStageStructure,
  type GroupStructure,
  type Inventory,
  type KnockoutStageStructure,
  type Match,
  type MatchId,
  type Slot,
} from "./types.js";

/**
 * Generates the complete match inventory for a tournament.
 *
 * Deterministic: the same configuration always yields the same matches, in the
 * same order, with the same IDs. Throws InvalidConfigError for invalid input.
 */
export function buildInventory(config: TournamentConfig): Inventory {
  assertValidConfig(config);

  const matches: Match[] = [];
  const divisions: DivisionStructure[] = [];
  const teamById = new Map<Id, Team>();
  const divisionOfTeam = new Map<Id, Id>();
  const groupByKey = new Map<string, GroupStructure>();

  for (const division of config.divisions) {
    for (const team of division.teams) {
      teamById.set(team.id, team);
      divisionOfTeam.set(team.id, division.id);
    }
    const structure: DivisionStructure = { divisionId: division.id, stages: [] };
    let previousGroups: GroupStageStructure | undefined;

    for (const stage of division.stages) {
      if (stage.kind === "round_robin" || stage.kind === "groups") {
        const teamGroups =
          stage.kind === "round_robin" ? [orderBySeed(division.teams)] : allocateGroups(division.teams, stage.groupCount, stage.allocation);
        const groups = teamGroups.map((teams, g) => {
          const groupId = stage.kind === "round_robin" ? "RR" : groupLabel(g);
          const group = buildGroup(config, division, stage.id, groupId, teams, stage.legs, matches);
          groupByKey.set(groupKey(division.id, stage.id, groupId), group);
          return group;
        });
        previousGroups = { stageId: stage.id, kind: "groups", groups };
        structure.stages.push(previousGroups);
      } else {
        structure.stages.push(buildKnockout(config, division, stage, previousGroups, groupByKey, matches));
      }
    }
    divisions.push(structure);
  }

  return {
    config,
    matches,
    matchById: new Map(matches.map((m) => [m.id, m])),
    divisions,
    teamById,
    divisionOfTeam,
    groupByKey,
  };
}

function buildGroup(
  config: TournamentConfig,
  division: Division,
  stageId: Id,
  groupId: Id,
  teams: Team[],
  legs: 1 | 2,
  out: Match[],
): GroupStructure {
  const pairings = roundRobinPairings(
    teams.map((t) => t.id),
    legs,
  );
  const matchIds: MatchId[] = [];
  const perRound = new Map<number, number>();
  for (const p of pairings) {
    const k = (perRound.get(p.round) ?? 0) + 1;
    perRound.set(p.round, k);
    const id = `${division.id}:${stageId}:${groupId}:R${p.round}:M${k}`;
    matchIds.push(id);
    out.push({
      id,
      tournamentId: config.id,
      divisionId: division.id,
      stageId,
      phase: "group",
      groupId,
      round: p.round,
      roundLabel: groupId === "RR" ? `Round ${p.round}` : `Group ${groupId} round ${p.round}`,
      label: `${groupId}-R${p.round}-${k}`,
      slots: [
        { type: "team", teamId: p.a },
        { type: "team", teamId: p.b },
      ],
      durationMinutes: division.matchDurationMinutes,
      dependencies: [],
    });
  }
  return { groupId, teamIds: teams.map((t) => t.id), matchIds, legs };
}

function buildKnockout(
  config: TournamentConfig,
  division: Division,
  stage: KnockoutStageConfig,
  previous: GroupStageStructure | undefined,
  groupByKey: ReadonlyMap<string, GroupStructure>,
  out: Match[],
): KnockoutStageStructure {
  let entrants: Slot[];
  let sameGroupFirstMatchMeetings = 0;

  if (stage.source.type === "teams") {
    entrants = orderBySeed(division.teams).map((t) => ({ type: "team", teamId: t.id }));
  } else {
    if (!previous) throw new Error(`Knockout stage ${stage.id} has no preceding group stage`);
    const crossover = crossoverSeeds(previous.groups.length, stage.source.perGroup);
    sameGroupFirstMatchMeetings = crossover.sameGroupFirstRoundMeetings;
    entrants = crossover.seeds.map((token) => ({
      type: "group_rank",
      divisionId: division.id,
      stageId: previous.stageId,
      groupId: previous.groups[token.groupIndex]!.groupId,
      rank: token.rank,
    }));
  }

  const plan = planKnockout(entrants, stage.thirdPlaceMatch);
  const idOf = (round: number, index: number) => `${division.id}:${stage.id}:R${round}:M${index + 1}`;
  const toSlot = (feed: Feed<Slot>): Slot =>
    feed.type === "entrant"
      ? feed.entrant
      : { type: feed.type, matchId: idOf(feed.round, feed.index) };

  const makeMatch = (round: number, index: number, a: Feed<Slot>, b: Feed<Slot>, thirdPlace: boolean): Match => {
    const slots = [toSlot(a), toSlot(b)] as const;
    const code = knockoutRoundCode(round, plan.roundCount);
    const roundSize = plan.rounds[round - 1]!.length;
    const match: Match = {
      id: thirdPlace ? `${division.id}:${stage.id}:3P` : idOf(round, index),
      tournamentId: config.id,
      divisionId: division.id,
      stageId: stage.id,
      phase: "knockout",
      round,
      roundLabel: thirdPlace ? "Third-place match" : knockoutRoundLabel(round, plan.roundCount),
      label: thirdPlace ? "3P" : roundSize === 1 ? code : code.startsWith("R") ? `${code}-${index + 1}` : `${code}${index + 1}`,
      slots,
      durationMinutes: division.matchDurationMinutes,
      dependencies: dependenciesOf(slots, groupByKey),
    };
    if (thirdPlace) match.thirdPlace = true;
    return match;
  };

  const rounds: MatchId[][] = [];
  for (const roundMatches of plan.rounds) {
    const ids: MatchId[] = [];
    for (const pm of roundMatches) {
      const match = makeMatch(pm.round, pm.index, pm.a, pm.b, false);
      out.push(match);
      ids.push(match.id);
    }
    rounds.push(ids);
  }
  let thirdPlaceMatchId: MatchId | undefined;
  if (plan.thirdPlace) {
    const match = makeMatch(plan.thirdPlace.round, plan.thirdPlace.index, plan.thirdPlace.a, plan.thirdPlace.b, true);
    out.push(match);
    thirdPlaceMatchId = match.id;
  }

  const structure: KnockoutStageStructure = {
    stageId: stage.id,
    kind: "knockout",
    size: plan.size,
    roundCount: plan.roundCount,
    entrants,
    rounds,
    finalMatchId: rounds[rounds.length - 1]![0]!,
    sameGroupFirstMatchMeetings,
  };
  if (thirdPlaceMatchId) structure.thirdPlaceMatchId = thirdPlaceMatchId;
  return structure;
}

function dependenciesOf(slots: readonly Slot[], groupByKey: ReadonlyMap<string, GroupStructure>): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();
  const add = (matchId: MatchId, kind: Dependency["kind"]) => {
    if (seen.has(matchId)) return;
    seen.add(matchId);
    deps.push({ matchId, kind });
  };
  for (const slot of slots) {
    if (slot.type === "winner" || slot.type === "loser") add(slot.matchId, slot.type);
    if (slot.type === "group_rank") {
      const group = groupByKey.get(groupKey(slot.divisionId, slot.stageId, slot.groupId));
      if (!group) throw new Error(`Unknown group ${slot.groupId}`);
      group.matchIds.forEach((id) => add(id, "group_complete"));
    }
  }
  return deps;
}
