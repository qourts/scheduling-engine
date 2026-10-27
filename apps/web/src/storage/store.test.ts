import { beforeEach, describe, expect, it } from "vitest";
import { newProject } from "../domain/project.js";
import { smallClubDay } from "../domain/samples.js";
import { buildConfig } from "../domain/buildConfig.js";
import { createInlineRunner } from "../engine/inlineRunner.js";
import { exportProjectJson, importProjectJson, matrixToCsv, scheduleToCsv } from "./exchange.js";
import { createIndexedDbStore, createMemoryStore, openStore } from "./store.js";

describe("IndexedDB project store", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("qourts-smart-scheduler");
  });

  it("saves, lists, loads and removes a project", async () => {
    const store = await createIndexedDbStore();
    const p = newProject(smallClubDay());
    await store.put(p);
    expect((await store.list()).map((s) => s.id)).toContain(p.id);
    expect((await store.get(p.id))?.spec.name).toBe(p.spec.name);
    await store.remove(p.id);
    expect(await store.get(p.id)).toBeNull();
  });

  it("falls back to memory with an honest warning when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulating a browser with storage blocked
    globalThis.indexedDB = undefined;
    try {
      const { store, warning } = await openStore();
      expect(store.kind).toBe("memory");
      expect(warning).toMatch(/lost on reload/i);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("the memory store isolates stored copies", async () => {
    const store = createMemoryStore();
    const p = newProject(smallClubDay());
    await store.put(p);
    p.spec.name = "changed after save";
    expect((await store.get(p.id))?.spec.name).not.toBe("changed after save");
  });
});

describe("export and import", () => {
  it("round-trips a project through versioned JSON", () => {
    const p = newProject(smallClubDay());
    const back = importProjectJson(exportProjectJson(p));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.project).toEqual(p);
  });

  it.each([
    ["not json", "{"],
    ["wrong format", JSON.stringify({ format: "other", version: 1, project: {} })],
    ["newer version", JSON.stringify({ format: "qourts-smart-scheduler-project", version: 99, project: {} })],
    ["damaged project", JSON.stringify({ format: "qourts-smart-scheduler-project", version: 1, project: { id: "x" } })],
  ])("rejects %s with a readable reason", (_n, text) => {
    const r = importProjectJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
  });

  it("writes one CSV line per match and neutralises spreadsheet formulas", async () => {
    const spec = smallClubDay();
    spec.divisions[0]!.name = "=HYPERLINK(1)";
    const config = buildConfig(spec);
    const runner = createInlineRunner();
    const { result } = await runner.generate(config, [], 1, 3000);
    const schedule = result.options[0]!.schedule;
    const matches = await runner.matchInfo(config);
    const csv = scheduleToCsv(config, matches, schedule, [schedule.assignments[0]!.matchId]);
    expect(csv.trim().split("\r\n")).toHaveLength(schedule.assignments.length + 1);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain("yes");
    expect(matrixToCsv(config, matches, schedule)).toContain("Court 1");
  });
});
