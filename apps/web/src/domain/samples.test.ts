import { describe, expect, it } from "vitest";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { buildConfig } from "./buildConfig.js";
import { SAMPLES, clubWeekendOpen, echelonStyleDay, qourtsChampionshipDemo, smallClubDay } from "./samples.js";

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

  it("the guided demo generates with every suggested request applied, within a demo-friendly time", async () => {
    const { parseInstructions } = await import("../nlp/parser.js");
    const { finalizeRule } = await import("../nlp/finalize.js");
    const spec = qourtsChampionshipDemo();
    const config = buildConfig(spec);
    const prep = await runner.prepare(config);
    expect(prep.valid).toBe(true);
    expect(prep.matchCount).toBe(102);
    const out = parseInstructions(spec.demoRequests!.join("\n"), prep.vocabulary!);
    expect(out.unresolved).toEqual([]);
    expect(out.interpretations).toHaveLength(6);
    // Where the wording does not say hard or preferred, the operator chooses; the demo guide tells them to pick mandatory.
    const rules = out.interpretations.map((r, i) => finalizeRule(r.body, `r${i}`, r.strength ?? "mandatory"));
    const started = Date.now();
    const { result } = await runner.generate(config, rules, 1, 8000);
    expect(result.status).toBe("ok");
    expect(result.options.length).toBeGreaterThanOrEqual(2);
    expect(Date.now() - started).toBeLessThan(15000);
    for (const o of result.options) expect((await runner.check(config, o.schedule, rules, [], false)).valid).toBe(true);
  }, 30000);

  it("marks the Echelon-style sample as experimental", () => {
    expect(echelonStyleDay().experimentalNote).toMatch(/experimental/i);
    expect(echelonStyleDay().recoveryMinutes).toBe(5);
  });
});
