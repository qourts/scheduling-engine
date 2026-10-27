import { beforeAll, describe, expect, it } from "vitest";
import type { Schedule } from "@engine";
import { buildConfig } from "../domain/buildConfig.js";
import { smallClubDay } from "../domain/samples.js";
import type { MatchInfo } from "./core.js";
import { createInlineRunner } from "./inlineRunner.js";

const runner = createInlineRunner();
const config = buildConfig(smallClubDay());
let schedule: Schedule;
let matches: MatchInfo[];

beforeAll(async () => {
  schedule = (await runner.generate(config, [], 1, 3000)).result.options[0]!.schedule;
  matches = await runner.matchInfo(config);
});

describe("match inspector data", () => {
  it("classifies preliminary, knockout and medal matches from the engine's own bracket structure", () => {
    // Two divisions of 8 teams: 2 pools of 4, then 2 semifinals, a final and a bronze match each.
    expect(matches.filter((m) => m.kind === "medal")).toHaveLength(4);
    expect(matches.filter((m) => m.kind === "semi")).toHaveLength(4);
    expect(matches.filter((m) => m.kind === "prelim")).toHaveLength(24);
    expect(matches.filter((m) => m.kind === "medal").every((m) => m.label === "F" || m.label === "3P")).toBe(true);
  });

  it("describes a pool match with real teams, players and consistent recovery", async () => {
    const pool = matches.find((m) => m.kind === "prelim" && m.id.includes("R2"))!;
    const d = (await runner.inspectMatch(config, schedule, pool.id))!;
    expect(d.kindLabel).toBe("Preliminary");
    expect(d.stageLabel).toBe("Pool play");
    expect(d.groupLabel).toMatch(/^[A-Z]$/);
    expect(d.provisional).toBe(false);
    expect(d.slots.every((s) => s.teamId !== null && s.players.length === 2)).toBe(true);
    expect(d.recovery).toHaveLength(2);
    // The schedule is valid, so no measured gap may be below the rule.
    for (const r of d.recovery) for (const n of [r.previous, r.next]) if (n?.gapMinutes != null) expect(n.gapMinutes).toBeGreaterThanOrEqual(r.restRequiredMinutes);
  });

  it("describes a knockout match with qualification placeholders and the matches it waits for", async () => {
    const semi = matches.find((m) => m.kind === "semi")!;
    const d = (await runner.inspectMatch(config, schedule, semi.id))!;
    expect(d.provisional).toBe(true);
    expect(d.slots.every((s) => s.teamId === null && /place|Winner|Wildcard/i.test(s.text))).toBe(true);
    expect(d.before.length).toBeGreaterThan(0);
    expect(d.recovery).toEqual([]);

    const final = matches.find((m) => m.kind === "medal" && m.label === "F" && m.divisionId === semi.divisionId)!;
    const f = (await runner.inspectMatch(config, schedule, final.id))!;
    expect(f.kindLabel).toBe("Gold medal match");
    expect(f.slots[0]?.text).toMatch(/^Winner of /);
    expect(f.before.map((n) => n.name).join(" ")).toMatch(/SF/);
  });

  it("returns nothing for an unknown match and never changes the schedule", async () => {
    const before = JSON.stringify(schedule);
    expect(await runner.inspectMatch(config, schedule, "nope")).toBeNull();
    expect(JSON.stringify(schedule)).toBe(before);
  });
});
