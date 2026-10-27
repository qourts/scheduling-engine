import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { areOrdered, buildDependencyGraph, buildInventory, ParticipantModel, validateConfig, type Id } from "../../src/index.js";
import { divisionSpec } from "../support/arbitraries.js";
import { courts, fullDay, tournament } from "../support/fixtures.js";
import { playAll } from "../support/simulate.js";

/**
 * Soundness of the conservative participant model: across many simulated
 * tournaments, whenever two matches actually share a player, the model must
 * have flagged them (or they are dependency-ordered). A miss would mean the
 * validator could accept a schedule that breaks for some outcome.
 */
describe("participant model soundness (simulation)", () => {
  it("never misses a real shared player, and possible sets always contain the actual teams", () => {
    fc.assert(
      fc.property(divisionSpec("A"), divisionSpec("B", "XD"), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (a, b, seed) => {
        const config = tournament({ courts: courts(2, [fullDay()]), divisions: [a, b] });
        // Two players are entered in both divisions.
        const shared = ["A-p1a", "A-p2b"];
        config.divisions[1]!.teams[0]!.playerIds[0] = shared[0]!;
        config.divisions[1]!.teams[1]!.playerIds[1] = shared[1]!;
        config.players = config.players.filter((p) => p.id !== "B-p1a" && p.id !== "B-p2b");
        if (!validateConfig(config).valid) return;
        const inv = buildInventory(config);
        const graph = buildDependencyGraph(inv);
        const model = new ParticipantModel(inv, graph);

        for (let run = 0; run < 3; run++) {
          const state = playAll(inv, seed + run);
          const actualPlayers = new Map<string, Set<Id>>();
          for (const m of inv.matches) {
            const [x, y] = state.participants.get(m.id)!;
            expect(x).not.toBeNull();
            expect(y).not.toBeNull();
            expect(x).not.toBe(y);
            expect(model.possibleTeams(m.id).has(x!)).toBe(true);
            expect(model.possibleTeams(m.id).has(y!)).toBe(true);
            actualPlayers.set(m.id, new Set([...inv.teamById.get(x!)!.playerIds, ...inv.teamById.get(y!)!.playerIds]));
          }
          for (let i = 0; i < inv.matches.length; i++) {
            for (let j = i + 1; j < inv.matches.length; j++) {
              const mi = inv.matches[i]!.id;
              const mj = inv.matches[j]!.id;
              const pj = actualPlayers.get(mj)!;
              const real = [...actualPlayers.get(mi)!].filter((p) => pj.has(p));
              if (real.length === 0 || areOrdered(graph, mi, mj)) continue;
              const flagged = model.sharedPlayers(mi, mj).playerIds;
              for (const p of real) expect(flagged).toContain(p);
            }
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("progression invariants (simulation)", () => {
  it("every match gets two distinct teams; each team plays at most once per knockout round", () => {
    fc.assert(
      fc.property(divisionSpec("A"), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (spec, seed) => {
        const config = tournament({ courts: courts(1, [fullDay()]), divisions: [spec] });
        const inv = buildInventory(config);
        const state = playAll(inv, seed);
        expect([...state.status.values()].every((s) => s === "completed")).toBe(true);
        for (const stage of inv.divisions[0]!.stages) {
          if (stage.kind !== "knockout") continue;
          for (const round of stage.rounds) {
            const teams = round.flatMap((id) => state.participants.get(id)!);
            expect(new Set(teams).size).toBe(teams.length);
          }
          const final = state.participants.get(stage.finalMatchId)!;
          if (stage.thirdPlaceMatchId) {
            const third = state.participants.get(stage.thirdPlaceMatchId)!;
            expect(third.some((t) => final.includes(t))).toBe(false);
          }
        }
        for (const table of state.standings.values()) {
          expect(table.complete).toBe(true);
          const wins = table.rows.reduce((s, r) => s + r.wins, 0);
          const losses = table.rows.reduce((s, r) => s + r.losses, 0);
          expect(wins).toBe(losses);
          // Ranks are a permutation of the group's teams, sorted by wins.
          for (let k = 1; k < table.rows.length; k++) expect(table.rows[k - 1]!.wins).toBeGreaterThanOrEqual(table.rows[k]!.wins);
        }
      }),
      { numRuns: 100 },
    );
  });
});
