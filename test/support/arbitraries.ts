import fc from "fast-check";
import type { StageConfig } from "../../src/index.js";
import type { DivisionSpec } from "./fixtures.js";

/** Random but always-valid division formats. */
export const divisionSpec = (id: string, categoryId = "MD"): fc.Arbitrary<DivisionSpec> =>
  fc.oneof(
    fc.record({ n: fc.integer({ min: 2, max: 9 }), legs: fc.constantFrom<1 | 2>(1, 2) }).map(
      ({ n, legs }): DivisionSpec => ({ id, categoryId, teamCount: n, stages: [{ id: "rr", kind: "round_robin", legs }] }),
    ),
    fc.record({ n: fc.integer({ min: 2, max: 20 }), third: fc.boolean(), seeded: fc.boolean() }).map(
      ({ n, third, seeded }): DivisionSpec => ({
        id,
        categoryId,
        teamCount: n,
        seeded,
        stages: [{ id: "ko", kind: "single_elimination", source: { type: "teams" }, thirdPlaceMatch: third && n >= 4 }],
      }),
    ),
    fc
      .record({ groups: fc.integer({ min: 1, max: 4 }), size: fc.integer({ min: 2, max: 5 }), extra: fc.integer({ min: 0, max: 3 }), third: fc.boolean() })
      .chain(({ groups, size, extra, third }) => {
        const n = groups * size + Math.min(extra, groups - 1);
        return fc.integer({ min: 1, max: size }).map((perGroup): DivisionSpec => {
          const qualifiers = perGroup * groups;
          const stages: StageConfig[] = [
            { id: "grp", kind: "groups", groupCount: groups, legs: 1, allocation: "snake" },
            {
              id: "ko",
              kind: "single_elimination",
              source: { type: "qualifiers", fromStageId: "grp", perGroup: qualifiers >= 2 ? perGroup : Math.min(size, 2) },
              thirdPlaceMatch: third && qualifiers >= 4,
            },
          ];
          return { id, categoryId, teamCount: n, seeded: true, stages };
        });
      }),
  );
