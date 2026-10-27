import { STANDARD_TIEBREAKERS, type Division, type Player, type Team, type TournamentConfig } from "../../src/index.js";
import { CATEGORIES } from "../support/fixtures.js";

/**
 * Realistic one-day club event:
 *  - 8 courts, 08:00-18:00, court 1 is the feature court
 *  - Men's Doubles 3.5: 12 teams, 3 groups of 4, top 2 -> 6-team knockout (2 byes)
 *  - Women's Doubles 3.5: 8 teams, 2 groups of 4, top 2 -> semis, final, 3rd place
 *  - Mixed Doubles 4.0: 16 teams, 4 groups of 4, top 2 -> quarterfinals
 *    (8 mixed teams are made of players also entered in MD and WD)
 *  - Open Men's Doubles: 8 seeded teams, single elimination with 3rd place,
 *    finals restricted to the feature court window from 15:00
 *  - 25 minutes per match (1 game to 11 plus warm-up), 15 min rest, 5 min turnover
 */
export function clubDay(overrides: { courtCount?: number; endMinute?: number } = {}): TournamentConfig {
  const day = "2026-11-14";
  const players: Player[] = [];
  const person = (id: string) => {
    if (!players.some((p) => p.id === id)) players.push({ id, name: id });
    return id;
  };
  const teams = (prefix: string, count: number, make: (k: number) => string[], seeded = false): Team[] =>
    Array.from({ length: count }, (_, i) => {
      const team: Team = { id: `${prefix}-t${i + 1}`, name: `${prefix} ${i + 1}`, playerIds: make(i + 1) };
      if (seeded) team.seed = i + 1;
      return team;
    });

  const common = {
    matchDurationMinutes: 25,
    scoring: { bestOf: 1 as const },
    standings: { tiebreakers: [...STANDARD_TIEBREAKERS] },
  };
  const groupsThenKo = (groupCount: number, perGroup: number, thirdPlaceMatch: boolean): Division["stages"] => [
    { id: "groups", kind: "groups", groupCount, legs: 1, allocation: "snake" },
    { id: "playoffs", kind: "single_elimination", source: { type: "qualifiers", fromStageId: "groups", perGroup }, thirdPlaceMatch },
  ];

  const divisions: Division[] = [
    {
      id: "MD35",
      name: "Men's Doubles 3.5",
      categoryId: "MD",
      skillLevel: "3.5",
      teams: teams("MD35", 12, (k) => [person(`m${k}`), person(`m${k + 100}`)], true),
      stages: groupsThenKo(3, 2, false),
      ...common,
    },
    {
      id: "WD35",
      name: "Women's Doubles 3.5",
      categoryId: "WD",
      skillLevel: "3.5",
      teams: teams("WD35", 8, (k) => [person(`w${k}`), person(`w${k + 100}`)], true),
      stages: groupsThenKo(2, 2, true),
      ...common,
    },
    {
      id: "XD40",
      name: "Mixed Doubles 4.0",
      categoryId: "XD",
      skillLevel: "4.0",
      // Teams 1-8 reuse MD and WD players: cross-division conflicts are real.
      teams: teams("XD40", 16, (k) => (k <= 8 ? [person(`m${k}`), person(`w${k}`)] : [person(`xm${k}`), person(`xw${k}`)]), true),
      stages: groupsThenKo(4, 2, false),
      ...common,
    },
    {
      id: "OPEN",
      name: "Open Men's Doubles",
      categoryId: "MD",
      teams: teams("OPEN", 8, (k) => [person(`o${k}`), person(`o${k + 100}`)], true),
      stages: [{ id: "bracket", kind: "single_elimination", source: { type: "teams" }, thirdPlaceMatch: true }],
      ...common,
      matchDurationMinutes: 30,
    },
  ];

  const courtCount = overrides.courtCount ?? 8;
  const end = overrides.endMinute ?? 18 * 60;
  return {
    id: "club-day-2026",
    name: "Qourts Club Day",
    days: [day],
    courts: Array.from({ length: courtCount }, (_, i) => ({
      id: `C${i + 1}`,
      name: i === 0 ? "Feature Court" : `Court ${i + 1}`,
      tags: i === 0 ? ["feature"] : [],
      availability: [{ day, start: 8 * 60, end }],
    })),
    players,
    categories: CATEGORIES,
    divisions,
    rules: { courtTurnoverMinutes: 5, minRestMinutes: 15 },
  };
}
