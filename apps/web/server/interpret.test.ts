import { describe, expect, it, vi } from "vitest";
import { mapAiResponse } from "../src/nlp/adapter.js";
import { buildRequest, extractProposals, handleInterpret, handleStatus, TOOL } from "./interpret.js";

const vocab = { tournamentId: "t", days: ["2026-11-14"], courts: [{ id: "C1", name: "Court 1", tags: [] }], categories: [], divisions: [] };
const toolAnswer = (proposals: unknown[], unresolved: unknown[] = []) => ({ content: [{ type: "tool_use", name: TOOL.name, input: { proposals, unresolved } }] });
const okFetch = (answer: unknown) => vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 })) as unknown as typeof fetch;

describe("server-side interpreter", () => {
  it("is unavailable without a key and never calls the network", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(handleStatus({ apiKey: undefined })).toEqual({ available: false });
    const r = await handleInterpret({ text: "x", vocabulary: vocab }, { apiKey: undefined, model: "m", fetchImpl });
    expect(r.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forces the structured tool call and never puts the key in the body", () => {
    const body = buildRequest("Reserve Court 1", vocab, "claude-sonnet-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_rules" });
    expect(JSON.stringify(body)).not.toMatch(/sk-ant|api[-_]?key/i);
  });

  it("sends the key only as a header and returns normalised proposals", async () => {
    const fetchImpl = okFetch(toolAnswer([{ sourceText: "Reserve Court 1 for medals", strength: "unclear", body: { id: "", kind: "court_reservation", courtIds: ["C1"], selector: { roles: ["medal"] } } }]));
    const r = await handleInterpret({ text: "Reserve Court 1 for medals", vocabulary: vocab }, { apiKey: "sk-test-key-123456", model: "m", fetchImpl });
    expect(r.status).toBe(200);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-test-key-123456");
    expect(String(init.body)).not.toContain("sk-test-key-123456");
    expect((r.json as { proposals: { strength: unknown }[] }).proposals[0]?.strength).toBeNull();
  });

  it("rejects oversized or malformed requests before calling the model", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const deps = { apiKey: "sk-test-key-123456", model: "m", fetchImpl };
    expect((await handleInterpret({ text: "", vocabulary: vocab }, deps)).status).toBe(400);
    expect((await handleInterpret({ text: "x".repeat(5000), vocabulary: vocab }, deps)).status).toBe(400);
    expect((await handleInterpret({ text: "ok", vocabulary: null }, deps)).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports upstream failures without leaking details", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret upstream detail", { status: 500 })) as unknown as typeof fetch;
    const r = await handleInterpret({ text: "ok", vocabulary: vocab }, { apiKey: "sk-test-key-123456", model: "m", fetchImpl });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.json)).not.toContain("secret upstream detail");
  });

  it("extractProposals ignores answers that are not the forced tool call", () => {
    expect(extractProposals({ content: [{ type: "text", text: "hello" }] })).toBeNull();
  });
});

describe("client mapping of an AI answer", () => {
  it("never trusts the model to decide strength beyond the two exact words, and drops unsupported kinds", () => {
    const out = mapAiResponse({
      proposals: [
        { sourceText: "a", strength: "mandatory", body: { kind: "court_blackout", id: "" } },
        { sourceText: "b", strength: "MUST!!!", body: { kind: "min_rest", id: "" } },
        { sourceText: "c", strength: "mandatory", body: { kind: "weather_delay" } },
        { sourceText: "d", strength: "mandatory", body: { kind: "same_day_preliminaries", id: "" } },
      ],
      unresolved: [{ text: "x", reason: "no" }],
    });
    expect(out.interpretations.map((i) => i.strength)).toEqual(["mandatory", null, "preference"]);
    expect(out.interpretations[2]?.preferenceOnly).toBe(true);
    expect(out.unresolved.map((u) => u.text)).toEqual(["c", "x"]);
  });
});
