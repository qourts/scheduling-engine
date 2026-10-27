import { describe, expect, it } from "vitest";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { buildConfig } from "./buildConfig.js";
import { SAMPLES, clubWeekendOpen, echelonStyleDay, smallClubDay } from "./samples.js";

const runner = createInlineRunner();

describe("sample events", () => {
  it.each(SAMPLES.map((s) => [s.id, s.build] as const))("%s expands to a valid engine configuration", async (_id, build) => {
    const prep = await runner.prepare(buildConfig(build()));
    expect(prep.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(prep.valid).toBe(true);
  });

  it("matches the documented sizes", async () => {
    expect((await runner.prepare(buildConfig(clubWeekendOpen()))).matchCount).toBe(192);
    expect((await runner.prepare(buildConfig(echelonStyleDay()))).matchCount).toBe(288);
  });

  it("generates schedules for the small sample, each independently valid", async () => {
    const config = buildConfig(smallClubDay());
    const { result, reports } = await runner.generate(config, [], 1, 3000);
    expect(result.status).toBe("ok");
    expect(result.options.length).toBeGreaterThan(0);
    for (const o of result.options) {
      const c = await runner.check(config, o.schedule, [], [], false);
      expect(c.valid).toBe(true);
      expect(reports[o.strategy]?.scheduledMatches).toBe(o.schedule.assignments.length);
    }
  });

  it("marks the Echelon-style sample as experimental", () => {
    expect(echelonStyleDay().experimentalNote).toMatch(/experimental/i);
    expect(echelonStyleDay().recoveryMinutes).toBe(5);
  });
});
