import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  buildInventory,
  descendantsOf,
  ParticipantModel,
  type KnockoutStageStructure,
  type Slot,
} from "../../src/index.js";
import { courts, fullDay, stages, tournament } from "../support/fixtures.js";

const groupsConfig = () =>
  tournament({ courts: courts(4, [fullDay()]), divisions: [{ id: "MD", teamCount: 8, seeded: true, stages: stages.groupsToKnockout(2, 2, true) }] });

describe("buildInventory", () => {
  it("generates groups of 4 plus semis, final and third place", () => {
    const inv = buildInventory(groupsConfig());
    const group = inv.matches.filter((m) => m.phase === "group");
    const ko = inv.matches.filter((m) => m.phase === "knockout");
    expect(group).toHaveLength(12); // 2 x C(4,2)
    expect(ko.map((m) => m.label)).toEqual(["SF1", "SF2", "F", "3P"]);
    const structure = inv.divisions[0]!.stages[0]!;
    expect(structure.kind).toBe("groups");
    // Snake allocation of seeds 1..8 into 2 groups.
    expect(structure.kind === "groups" && structure.groups.map((g) => g.teamIds)).toEqual([
      ["MD-t1", "MD-t4", "MD-t5", "MD-t8"],
      ["MD-t2", "MD-t3", "MD-t6", "MD-t7"],
    ]);
  });

  it("crosses group qualifiers: A1 v B2 and B1 v A2", () => {
    const inv = buildInventory(groupsConfig());
    const [sf1, sf2] = inv.matches.filter((m) => m.label.startsWith("SF"));
    const describe = (s: Slot) => (s.type === "group_rank" ? `${s.groupId}${s.rank}` : s.type);
    expect(sf1!.slots.map(describe)).toEqual(["A1", "B2"]);
    expect(sf2!.slots.map(describe)).toEqual(["B1", "A2"]);
  });

  it("is deterministic: same config, same ids and order", () => {
    const a = buildInventory(groupsConfig()).matches.map((m) => m.id);
    const b = buildInventory(groupsConfig()).matches.map((m) => m.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toContain("MD:grp:A:R1:M1");
    expect(a).toContain("MD:ko:3P");
  });

  it("knockout from qualifiers depends on completion of the feeding groups", () => {
    const inv = buildInventory(groupsConfig());
    const sf1 = inv.matches.find((m) => m.label === "SF1")!;
    expect(sf1.dependencies.every((d) => d.kind === "group_complete")).toBe(true);
    expect(sf1.dependencies).toHaveLength(12); // A1 and B2 need both groups finished
    const final = inv.matches.find((m) => m.label === "F")!;
    expect(final.dependencies.map((d) => d.kind)).toEqual(["winner", "winner"]);
    const third = inv.matches.find((m) => m.label === "3P")!;
    expect(third.dependencies.map((d) => d.kind)).toEqual(["loser", "loser"]);
  });

  it("models byes: 6-team knockout gives seeds 1 and 2 a bye into the semifinals", () => {
    const inv = buildInventory(
      tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "K", teamCount: 6, seeded: true, stages: stages.knockout() }] }),
    );
    expect(inv.matches).toHaveLength(5);
    const ko = inv.divisions[0]!.stages[0] as KnockoutStageStructure;
    expect(ko.size).toBe(8);
    expect(ko.rounds.map((r) => r.length)).toEqual([2, 2, 1]);
    const sf = ko.rounds[1]!.map((id) => inv.matchById.get(id)!);
    expect(sf[0]!.slots[0]).toEqual({ type: "team", teamId: "K-t1" });
    expect(sf[1]!.slots[0]).toEqual({ type: "team", teamId: "K-t2" });
  });

  it("round-robin stage is a single group", () => {
    const inv = buildInventory(tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "R", teamCount: 5, stages: stages.roundRobin(2) }] }));
    expect(inv.matches).toHaveLength(20);
    expect(inv.matches.every((m) => m.groupId === "RR")).toBe(true);
  });
});

describe("dependency graph", () => {
  it("orders prerequisites first and computes chain depth", () => {
    const inv = buildInventory(groupsConfig());
    const graph = buildDependencyGraph(inv);
    const pos = new Map(graph.order.map((id, i) => [id, i]));
    for (const m of inv.matches) for (const d of m.dependencies) expect(pos.get(d.matchId)!).toBeLessThan(pos.get(m.id)!);
    expect(graph.depth.get("MD:ko:R2:M1")).toBe(3); // group -> SF -> F
    const firstGroupMatch = inv.matches[0]!.id;
    expect(descendantsOf(graph, firstGroupMatch).sort()).toEqual(["MD:ko:3P", "MD:ko:R1:M1", "MD:ko:R1:M2", "MD:ko:R2:M1"].sort());
  });
});

describe("participant model (conservative unresolved participants)", () => {
  const setup = () => {
    const config = tournament({
      courts: courts(4, [fullDay()]),
      divisions: [
        { id: "MD", teamCount: 8, stages: stages.groupsToKnockout(2, 2, true) },
        { id: "XD", categoryId: "XD", teamCount: 4, stages: stages.knockout() },
      ],
    });
    // Player MD-p1a also plays mixed doubles with team XD-t1.
    config.divisions[1]!.teams[0]!.playerIds[0] = "MD-p1a";
    config.players = config.players.filter((p) => p.id !== "XD-p1a");
    const inv = buildInventory(config);
    return { inv, model: new ParticipantModel(inv, buildDependencyGraph(inv)) };
  };

  it("possible teams of a semifinal are all teams of the feeding groups", () => {
    const { inv, model } = setup();
    expect(model.possibleTeams("MD:ko:R1:M1").size).toBe(8);
    expect(inv.matches.find((m) => m.id === "MD:ko:R1:M1")).toBeDefined();
  });

  it("semifinals of the same bracket can never share a team", () => {
    const { model } = setup();
    expect(model.sharedPlayers("MD:ko:R1:M1", "MD:ko:R1:M2").playerIds).toEqual([]);
  });

  it("final and third-place match can never share a team", () => {
    const { model } = setup();
    expect(model.sharedPlayers("MD:ko:R2:M1", "MD:ko:3P").playerIds).toEqual([]);
  });

  it("two matches of one group that share a team conflict definitely", () => {
    const { inv, model } = setup();
    const t1 = inv.matches.filter((m) => m.phase === "group" && m.slots.some((s) => s.type === "team" && s.teamId === "MD-t1"));
    const shared = model.sharedPlayers(t1[0]!.id, t1[1]!.id);
    expect(shared.certainty).toBe("definite");
    expect(shared.playerIds).toEqual(["MD-p1a", "MD-p1b"]);
  });

  it("a multi-division player possibly conflicts with an unresolved playoff", () => {
    const { model } = setup();
    const shared = model.sharedPlayers("MD:ko:R2:M1", "XD:ko:R1:M1");
    expect(shared).toEqual({ playerIds: ["MD-p1a"], certainty: "possible" });
  });

  it("dependency-ordered matches are left to the dependency rule", () => {
    const { model } = setup();
    expect(model.sharedPlayers("MD:ko:R1:M1", "MD:ko:R2:M1").playerIds).toEqual([]);
  });

  it("resolution narrows possible participants", () => {
    const { inv } = setup();
    const graph = buildDependencyGraph(inv);
    const model = new ParticipantModel(inv, graph, new Map([["MD:ko:R2:M1", ["MD-t2", "MD-t3"] as const]]));
    expect([...model.possibleTeams("MD:ko:R2:M1")].sort()).toEqual(["MD-t2", "MD-t3"]);
    expect(model.sharedPlayers("MD:ko:R2:M1", "XD:ko:R1:M1").playerIds).toEqual([]);
  });
});
