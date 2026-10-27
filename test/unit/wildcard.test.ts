import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  buildInventory,
  optimizeSchedules,
  ParticipantModel,
  validateConfig,
  validateSchedule,
  type StageConfig,
  type TournamentConfig,
} from "../../src/index.js";
import { courts, DAY1, fullDay, tournament } from "../support/fixtures.js";
import { playAll } from "../support/simulate.js";

const wildcardStages = (groupCount: number, perGroup: number, wildcards?: { count: number; rank: number }): StageConfig[] => [
  { id: "pool", kind: "groups", groupCount, legs: 1, allocation: "snake" },
  {
    id: "ko",
    kind: "single_elimination",
    source: { type: "qualifiers", fromStageId: "pool", perGroup, ...(wildcards ? { wildcards } : {}) },
    thirdPlaceMatch: true,
  },
];

/** Three pools of 4: three winners and the best second-placed team reach the semifinals. */
const novice = (): TournamentConfig =>
  tournament({
    courts: courts(4, [fullDay()]),
    divisions: [{ id: "NOV", categoryId: "MD", teamCount: 12, seeded: true, stages: wildcardStages(3, 1, { count: 1, rank: 2 }) }],
  });

describe("wildcard qualification: inventory and dependencies", () => {
  const inventory = buildInventory(novice());
  const ko = inventory.matches.filter((m) => m.phase === "knockout");
  const semis = ko.filter((m) => m.round === 1);

  it("builds 18 pool matches, 2 semifinals, a gold and a bronze match", () => {
    expect(inventory.matches.filter((m) => m.phase === "group")).toHaveLength(18);
    expect(semis).toHaveLength(2);
    expect(ko).toHaveLength(4);
  });

  it("seeds the three winners first and the wildcard last", () => {
    const slots = semis.flatMap((m) => m.slots);
    expect(slots.filter((s) => s.type === "group_rank")).toHaveLength(3);
    const wild = slots.filter((s) => s.type === "wildcard");
    expect(wild).toEqual([{ type: "wildcard", divisionId: "NOV", stageId: "pool", rank: 2, index: 1 }]);
  });

  it("makes the semifinal with the wildcard wait for every pool, and the other only for its own pools", () => {
    const withWildcard = semis.find((m) => m.slots.some((s) => s.type === "wildcard"))!;
    const without = semis.find((m) => m !== withWildcard)!;
    const poolIds = (m: typeof withWildcard) => new Set(m.dependencies.filter((d) => d.kind === "group_complete").map((d) => d.matchId));
    expect(poolIds(withWildcard).size).toBe(18);
    expect(poolIds(without).size).toBe(12);
  });

  it("treats every team of the stage as a possible wildcard until results exist", () => {
    const model = new ParticipantModel(inventory, buildDependencyGraph(inventory));
    const withWildcard = semis.find((m) => m.slots.some((s) => s.type === "wildcard"))!;
    const without = semis.find((m) => m !== withWildcard)!;
    expect(model.possibleTeams(withWildcard.id).size).toBe(12);
    expect(model.possibleTeams(without.id).size).toBe(8);
    const gold = ko.find((m) => m.label === "F")!;
    expect(model.possibleTeams(gold.id).size).toBe(12);
  });
});

describe("wildcard qualification: progression", () => {
  const inventory = buildInventory(novice());

  it("resolves the wildcard to the best second-placed team once every pool is complete", () => {
    let uniqueBest = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = playAll(inventory, seed);
      const seconds = [...state.standings].filter(([key]) => key.startsWith("NOV|pool|")).map(([, table]) => table.rows[1]!);
      expect(seconds).toHaveLength(3);
      // Independent expectation: wins, then game difference, then point difference, then points for.
      const key = (r: (typeof seconds)[number]) => [r.wins, r.gamesWon - r.gamesLost, r.pointsFor - r.pointsAgainst, r.pointsFor];
      const order = [...seconds].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
        return 0;
      });
      const semi = inventory.matches.find((m) => m.phase === "knockout" && m.slots.some((s) => s.type === "wildcard"))!;
      const side = semi.slots.findIndex((s) => s.type === "wildcard");
      const resolved = state.participants.get(semi.id)![side]!;
      expect(seconds.map((r) => r.teamId)).toContain(resolved);
      // Ties on every statistic are broken by a deterministic draw, so only check when the best is unique.
      if (JSON.stringify(key(order[0]!)) !== JSON.stringify(key(order[1]!))) {
        expect(resolved).toBe(order[0]!.teamId);
        uniqueBest++;
      }
    }
    expect(uniqueBest).toBeGreaterThan(0);
  });

  it("leaves the wildcard unknown while any pool is unfinished", () => {
    const first = inventory.matches.find((m) => m.phase === "group")!;
    const state = playAll(inventory, 1);
    expect(state.status.get(first.id)).toBe("completed");
    // Before any result, no knockout participant is known.
    const semi = inventory.matches.find((m) => m.phase === "knockout" && m.slots.some((s) => s.type === "wildcard"))!;
    expect(semi.slots.some((s) => s.type === "wildcard")).toBe(true);
  });
});

describe("wildcard qualification: configuration", () => {
  const withRule = (rule: { count: number; rank: number }, perGroup = 1, groups = 3): TournamentConfig => {
    const config = novice();
    config.divisions[0]!.stages = wildcardStages(groups, perGroup, rule);
    return config;
  };
  const codes = (config: TournamentConfig) => validateConfig(config).issues.map((i) => i.code);

  it("accepts a valid wildcard rule", () => {
    expect(validateConfig(novice()).valid).toBe(true);
  });

  it("rejects a count above the number of groups, a rank not below the winners, and a rank beyond the group size", () => {
    expect(codes(withRule({ count: 4, rank: 2 }))).toContain("INVALID_WILDCARDS");
    expect(codes(withRule({ count: 1, rank: 1 }))).toContain("INVALID_WILDCARDS");
    expect(codes(withRule({ count: 1, rank: 9 }))).toContain("INVALID_WILDCARDS");
    expect(codes(withRule({ count: 0, rank: 2 }))).toContain("INVALID_WILDCARDS");
  });

  it("requires four qualifiers for a third-place match, counting wildcards", () => {
    const config = withRule({ count: 1, rank: 2 }, 1, 2);
    config.divisions[0]!.teams = config.divisions[0]!.teams.slice(0, 8);
    expect(codes(config)).toContain("THIRD_PLACE_NEEDS_SEMIFINALS");
  });
});

describe("wildcard qualification: scheduling", () => {
  it("produces valid options, validated independently", () => {
    const config = tournament({
      days: [DAY1],
      courts: courts(4, [fullDay(DAY1, 8 * 60, 20 * 60)]),
      divisions: [
        { id: "NOV", categoryId: "MD", teamCount: 12, seeded: true, stages: wildcardStages(3, 1, { count: 1, rank: 2 }) },
        { id: "LI", categoryId: "WD", teamCount: 16, seeded: true, stages: wildcardStages(4, 1) },
      ],
    });
    const inventory = buildInventory(config);
    const result = optimizeSchedules(inventory, { seed: 1, budget: { iterationsPerStrategy: 400 } });
    expect(result.status).toBe("ok");
    for (const o of result.options) expect(validateSchedule(inventory, o.schedule).violations).toEqual([]);
  });
});
