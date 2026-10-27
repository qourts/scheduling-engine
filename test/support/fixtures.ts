import {
  STANDARD_TIEBREAKERS,
  type Category,
  type Court,
  type Division,
  type GlobalRules,
  type Player,
  type StageConfig,
  type Team,
  type TimeWindow,
  type TournamentConfig,
} from "../../src/index.js";

export const DAY1 = "2026-11-14";
export const DAY2 = "2026-11-15";

export const CATEGORIES: Category[] = [
  { id: "MD", name: "Men's Doubles", discipline: "doubles", gender: "men" },
  { id: "WD", name: "Women's Doubles", discipline: "doubles", gender: "women" },
  { id: "XD", name: "Mixed Doubles", discipline: "doubles", gender: "mixed" },
  { id: "MS", name: "Men's Singles", discipline: "singles", gender: "men" },
];

export function courts(count: number, windows: Omit<TimeWindow, never>[], tags: string[] = []): Court[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `C${i + 1}`,
    name: `Court ${i + 1}`,
    tags,
    availability: windows.map((w) => ({ ...w })),
  }));
}

export interface DivisionSpec {
  id: string;
  categoryId?: string;
  teamCount: number;
  stages: StageConfig[];
  duration?: number;
  seeded?: boolean;
  extra?: Partial<Division>;
}

/** Builds teams with fresh players for a division. Returns the division and its players. */
export function division(spec: DivisionSpec): { division: Division; players: Player[] } {
  const categoryId = spec.categoryId ?? "MD";
  const size = CATEGORIES.find((c) => c.id === categoryId)!.discipline === "singles" ? 1 : 2;
  const players: Player[] = [];
  const teams: Team[] = Array.from({ length: spec.teamCount }, (_, t) => {
    const playerIds = Array.from({ length: size }, (_, k) => {
      const id = `${spec.id}-p${t + 1}${String.fromCharCode(97 + k)}`;
      players.push({ id, name: id });
      return id;
    });
    const team: Team = { id: `${spec.id}-t${t + 1}`, name: `${spec.id} Team ${t + 1}`, playerIds };
    if (spec.seeded) team.seed = t + 1;
    return team;
  });
  return {
    division: {
      id: spec.id,
      name: spec.id,
      categoryId,
      teams,
      stages: spec.stages,
      matchDurationMinutes: spec.duration ?? 30,
      scoring: { bestOf: 1 },
      standings: { tiebreakers: [...STANDARD_TIEBREAKERS] },
      ...spec.extra,
    },
    players,
  };
}

export interface TournamentSpec {
  id?: string;
  days?: string[];
  courts: Court[];
  divisions: DivisionSpec[];
  rules?: Partial<GlobalRules>;
}

export function tournament(spec: TournamentSpec): TournamentConfig {
  const built = spec.divisions.map(division);
  return {
    id: spec.id ?? "T1",
    name: "Test Open",
    days: spec.days ?? [DAY1],
    courts: spec.courts,
    players: built.flatMap((b) => b.players),
    categories: CATEGORIES,
    divisions: built.map((b) => b.division),
    rules: { courtTurnoverMinutes: 5, minRestMinutes: 20, ...spec.rules },
  };
}

export const stages = {
  roundRobin: (legs: 1 | 2 = 1): StageConfig[] => [{ id: "rr", kind: "round_robin", legs }],
  knockout: (thirdPlaceMatch = false): StageConfig[] => [
    { id: "ko", kind: "single_elimination", source: { type: "teams" }, thirdPlaceMatch },
  ],
  groupsToKnockout: (groupCount: number, perGroup: number, thirdPlaceMatch = false): StageConfig[] => [
    { id: "grp", kind: "groups", groupCount, legs: 1, allocation: "snake" },
    { id: "ko", kind: "single_elimination", source: { type: "qualifiers", fromStageId: "grp", perGroup }, thirdPlaceMatch },
  ],
};

export const fullDay = (day = DAY1, start = 8 * 60, end = 18 * 60): TimeWindow => ({ day, start, end });
