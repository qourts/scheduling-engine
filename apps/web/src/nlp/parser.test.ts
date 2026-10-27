import { beforeAll, describe, expect, it } from "vitest";
import type { InstructionVocabulary } from "@engine";
import { buildConfig } from "../domain/buildConfig.js";
import { clubWeekendOpen } from "../domain/samples.js";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { finalizeRule } from "./finalize.js";
import { parseInstructions, parseTime } from "./parser.js";

const runner = createInlineRunner();
const config = buildConfig(clubWeekendOpen());
let vocab: InstructionVocabulary;

beforeAll(async () => {
  vocab = (await runner.prepare(config)).vocabulary!;
});

const one = (text: string) => {
  const out = parseInstructions(text, vocab);
  expect(out.unresolved, text).toEqual([]);
  expect(out.interpretations).toHaveLength(1);
  return out.interpretations[0]!;
};

describe("parseTime", () => {
  it.each([
    ["1 PM", 13 * 60],
    ["13:00", 13 * 60],
    ["1:30pm", 13 * 60 + 30],
    ["noon", 720],
    ["12 am", 0],
    ["9", 540],
  ])("%s", (text, minutes) => {
    expect(parseTime(text)).toBe(minutes);
  });
});

describe("deterministic instruction parser", () => {
  it("reads a morning window and states what morning was taken to mean", () => {
    const r = one("Advanced Men's Doubles must play in the morning.");
    expect(r.strength).toBe("mandatory");
    expect(r.body).toMatchObject({ kind: "time_window", selector: { divisionIds: ["MD-ADV"] }, latestEnd: { minute: 720 } });
    expect(r.notes.join(" ")).toMatch(/12:00/);
  });

  it("does not confuse Women's with Men's", () => {
    const r = one("Women's Doubles cannot start before 1 PM on day 1.");
    expect(r.body).toMatchObject({ kind: "time_window", earliestStart: { day: "2026-11-14", minute: 780 } });
    expect((r.body as { selector: { divisionIds: string[] } }).selector.divisionIds.every((id) => id.startsWith("WD-"))).toBe(true);
  });

  it("separates High Intermediate from Intermediate", () => {
    const r = one("High Intermediate only on courts 1-4.");
    const ids = (r.body as { selector: { divisionIds: string[] } }).selector.divisionIds;
    expect(ids.length).toBe(4);
    expect(ids.every((id) => id.endsWith("-HI"))).toBe(true);
    expect((r.body as { courtIds: string[] }).courtIds).toEqual(["C1", "C2", "C3", "C4"]);
  });

  it("reads a placement sentence with a messy court list as a court restriction", () => {
    const r = one("put high intermediate men's in courts 1,2,3,and 4");
    expect(r.body).toMatchObject({ kind: "court_allowlist", courtIds: ["C1", "C2", "C3", "C4"] });
    expect(r.strength).toBeNull();
    expect(one("Place High Intermediate on courts 1, 2 & 3.").body).toMatchObject({ courtIds: ["C1", "C2", "C3"] });
  });

  it("leaves strength undecided when the wording does not say, never defaulting to mandatory", () => {
    for (const text of ["Reserve Court 10 for medal matches.", "High Intermediate only on courts 1-4.", "At least 20 minutes between matches for High Intermediate."]) {
      expect(one(text).strength, text).toBeNull();
    }
  });

  it("reads explicit wording as the operator intended", () => {
    expect(one("Court 3 is unavailable 12:00-13:30 on day 1.").strength).toBe("mandatory");
    expect(one("Ideally Advanced Men's Doubles finish by 12:00.").strength).toBe("preference");
  });

  it("treats consecutive blocks and same-day pools as preference-only", () => {
    const a = one("Try to play Advanced Men's Doubles and Advanced Women's Doubles in consecutive blocks.");
    expect(a).toMatchObject({ strength: "preference", preferenceOnly: true });
    expect(one("Prefer to keep pool play on one day.")).toMatchObject({ preferenceOnly: true, body: { kind: "same_day_preliminaries" } });
  });

  it("reports unsupported and unclear requests instead of guessing", () => {
    const out = parseInstructions("Delay everything by 30 minutes if it rains. Nobody likes Court 4.", vocab);
    expect(out.interpretations).toEqual([]);
    expect(out.unresolved).toHaveLength(2);
  });

  it("rejects a day the event does not have", () => {
    const out = parseInstructions("Court 3 is unavailable 12:00-13:30 on day 5.", vocab);
    expect(out.unresolved[0]?.reason).toMatch(/no day 5/i);
  });

  it("every understood sentence becomes an engine-valid rule once the operator chooses a strength", async () => {
    const text =
      "Advanced Men's Doubles must play in the morning. Reserve Court 10 for medal matches. High Intermediate only on courts 1-4. Court 3 is unavailable 12:00-13:30 on day 1. At least 20 minutes between matches for High Intermediate. Prefer to keep pool play on one day.";
    const out = parseInstructions(text, vocab);
    expect(out.unresolved).toEqual([]);
    const instructions = out.interpretations.map((r, i) => finalizeRule(r.body, `r${i}`, r.strength ?? "preference"));
    const checked = await runner.checkInstructionProposal(config, { instructions, unresolved: [] });
    expect(checked.issues).toEqual([]);
    expect(checked.ok).toBe(true);
    expect(checked.descriptions).toHaveLength(6);
  });
});
