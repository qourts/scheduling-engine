import { describe, expect, it } from "vitest";
import { buildInventory, InvalidConfigError, validateConfig, type TournamentConfig } from "../../src/index.js";
import { courts, fullDay, stages, tournament } from "../support/fixtures.js";

const base = () => tournament({ courts: courts(4, [fullDay()]), divisions: [{ id: "MD35", teamCount: 8, stages: stages.groupsToKnockout(2, 2) }] });
const codes = (config: TournamentConfig) => validateConfig(config).issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("validateConfig", () => {
  it("accepts a well-formed configuration without modifying it", () => {
    const config = base();
    const snapshot = JSON.stringify(config);
    const result = validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it.each<[string, (c: TournamentConfig) => void, string]>([
    ["invalid id", (c) => (c.id = "bad id"), "INVALID_ID"],
    ["no days", (c) => (c.days = []), "NO_DAYS"],
    ["invalid date", (c) => (c.days = ["2026-02-30"]), "INVALID_DATE"],
    ["days out of order", (c) => (c.days = ["2026-11-15", "2026-11-14"]), "DAYS_NOT_ASCENDING"],
    ["duplicate court", (c) => (c.courts[1]!.id = "C1"), "DUPLICATE_ID"],
    ["window outside day", (c) => (c.courts[0]!.availability[0]!.end = 1500), "INVALID_WINDOW"],
    ["empty window", (c) => (c.courts[0]!.availability[0]!.end = c.courts[0]!.availability[0]!.start), "INVALID_WINDOW"],
    ["window on unknown day", (c) => (c.courts[0]!.availability[0]!.day = "2026-12-01"), "UNKNOWN_DAY"],
    ["overlapping court windows", (c) => c.courts[0]!.availability.push({ day: c.days[0]!, start: 600, end: 700 }), "OVERLAPPING_WINDOWS"],
    ["negative rest", (c) => (c.rules.minRestMinutes = -5), "INVALID_REST"],
    ["fractional turnover", (c) => (c.rules.courtTurnoverMinutes = 2.5), "INVALID_TURNOVER"],
    ["unknown category", (c) => (c.divisions[0]!.categoryId = "ZZ"), "UNKNOWN_CATEGORY"],
    ["zero duration", (c) => (c.divisions[0]!.matchDurationMinutes = 0), "INVALID_DURATION"],
    ["wrong team size", (c) => c.divisions[0]!.teams[0]!.playerIds.pop(), "WRONG_TEAM_SIZE"],
    ["unknown player", (c) => (c.divisions[0]!.teams[0]!.playerIds[0] = "ghost"), "UNKNOWN_PLAYER"],
    ["player twice in division", (c) => (c.divisions[0]!.teams[1]!.playerIds[0] = c.divisions[0]!.teams[0]!.playerIds[0]!), "PLAYER_IN_TWO_TEAMS"],
    ["duplicate team id", (c) => (c.divisions[0]!.teams[1]!.id = c.divisions[0]!.teams[0]!.id), "DUPLICATE_ID"],
    ["duplicate seed", (c) => { c.divisions[0]!.teams[0]!.seed = 1; c.divisions[0]!.teams[1]!.seed = 1; }, "DUPLICATE_SEED"],
    ["too few teams", (c) => (c.divisions[0]!.teams = c.divisions[0]!.teams.slice(0, 1)), "TOO_FEW_TEAMS"],
    ["groups too small", (c) => ((c.divisions[0]!.stages[0] as { groupCount: number }).groupCount = 5), "GROUPS_TOO_SMALL"],
    ["too many qualifiers", (c) => ((c.divisions[0]!.stages[1] as { source: { perGroup: number } }).source.perGroup = 5), "TOO_MANY_QUALIFIERS"],
    ["qualifier source mismatch", (c) => ((c.divisions[0]!.stages[1] as { source: { fromStageId: string } }).source.fromStageId = "x"), "INVALID_QUALIFICATION_SOURCE"],
    ["three stages", (c) => c.divisions[0]!.stages.push({ id: "x", kind: "round_robin", legs: 1 }), "INVALID_STAGE_COUNT"],
    ["knockout first then groups", (c) => (c.divisions[0]!.stages = [c.divisions[0]!.stages[1]!, c.divisions[0]!.stages[0]!]), "INVALID_STAGE_ORDER"],
    ["tiebreakers not total", (c) => (c.divisions[0]!.standings.tiebreakers = ["wins", "head_to_head"]), "TIEBREAKERS_NOT_TOTAL"],
    ["unknown tiebreaker", (c) => (c.divisions[0]!.standings.tiebreakers = ["luck" as never, "draw"]), "UNKNOWN_TIEBREAKER"],
    ["bad bestOf", (c) => (c.divisions[0]!.scoring.bestOf = 2 as never), "INVALID_SCORING"],
    ["unknown eligible court", (c) => (c.divisions[0]!.eligibleCourtIds = ["C9"]), "UNKNOWN_COURT"],
    ["empty eligible courts", (c) => (c.divisions[0]!.eligibleCourtIds = []), "NO_ELIGIBLE_COURTS"],
    ["empty play windows", (c) => (c.divisions[0]!.playWindows = []), "EMPTY_PLAY_WINDOWS"],
    ["restriction unknown team", (c) => (c.restrictions = [{ id: "r1", kind: "unavailable", subject: { type: "team", id: "nope" }, window: fullDay() }]), "UNKNOWN_TEAM"],
    ["third place without semis", (c) => { c.divisions[0]!.teams = c.divisions[0]!.teams.slice(0, 3); c.divisions[0]!.stages = stages.knockout(true); }, "THIRD_PLACE_NEEDS_SEMIFINALS"],
  ])("rejects %s", (_name, mutate, code) => {
    const config = base();
    mutate(config);
    expect(codes(config)).toContain(code);
  });

  it("reports every issue with a path, not just the first", () => {
    const config = base();
    config.rules.minRestMinutes = -1;
    config.divisions[0]!.matchDurationMinutes = -3;
    const issues = validateConfig(config).issues.filter((i) => i.severity === "error");
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(["rules.minRestMinutes", "divisions[0].matchDurationMinutes"]));
  });

  it("warns about groups of two and courts without availability", () => {
    const config = tournament({ courts: courts(2, [fullDay()]), divisions: [{ id: "D", teamCount: 4, stages: stages.groupsToKnockout(2, 1) }] });
    config.courts[1]!.availability = [];
    const warnings = validateConfig(config).issues.filter((i) => i.severity === "warning").map((i) => i.code);
    expect(warnings).toEqual(expect.arrayContaining(["SMALL_GROUPS", "COURT_NEVER_AVAILABLE"]));
  });

  it("allows a player in several divisions (multi-category entry)", () => {
    const config = tournament({
      courts: courts(2, [fullDay()]),
      divisions: [
        { id: "MD", teamCount: 4, stages: stages.roundRobin() },
        { id: "XD", categoryId: "XD", teamCount: 4, stages: stages.roundRobin() },
      ],
    });
    config.divisions[1]!.teams[0]!.playerIds[0] = config.divisions[0]!.teams[0]!.playerIds[0]!;
    expect(validateConfig(config).valid).toBe(true);
  });

  it("buildInventory refuses invalid configurations", () => {
    const config = base();
    config.divisions[0]!.matchDurationMinutes = 0;
    expect(() => buildInventory(config)).toThrow(InvalidConfigError);
  });
});
