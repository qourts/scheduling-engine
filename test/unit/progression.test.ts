import { describe, expect, it } from "vitest";
import {
  applyEvent,
  auditTrail,
  buildInventory,
  checkScore,
  initialState,
  replay,
  type Inventory,
  type MatchResult,
  type ProgressionEvent,
  type ProgressionState,
} from "../../src/index.js";
import { courts, fullDay, stages, tournament } from "../support/fixtures.js";

const win = (winner: 0 | 1, loserPoints = 5): MatchResult => ({
  winner,
  outcome: "played",
  games: [winner === 0 ? { a: 11, b: loserPoints } : { a: loserPoints, b: 11 }],
});

let counter = 0;
function record(inv: Inventory, state: ProgressionState, matchId: string, result: MatchResult) {
  const applied = applyEvent(inv, state, { type: "result_recorded", eventId: `ev${counter++}`, at: "2026-11-14T09:00:00Z", actor: "desk", matchId, result });
  if (!applied.ok) throw new Error(applied.error.code);
  return applied.value.state;
}

/** Plays a group so that team order by wins equals the order given. */
function playGroupInOrder(inv: Inventory, state: ProgressionState, groupId: string, order: string[]) {
  for (const m of inv.matches.filter((x) => x.groupId === groupId)) {
    const [a, b] = m.slots.map((s) => (s.type === "team" ? s.teamId : ""));
    state = record(inv, state, m.id, win(order.indexOf(a!) < order.indexOf(b!) ? 0 : 1));
  }
  return state;
}

const groupsInventory = () =>
  buildInventory(tournament({ courts: courts(4, [fullDay()]), divisions: [{ id: "MD", teamCount: 8, seeded: true, stages: stages.groupsToKnockout(2, 2, true) }] }));

describe("progression", () => {
  it("starts with group matches ready and playoffs waiting", () => {
    const inv = groupsInventory();
    const state = initialState(inv);
    expect(inv.matches.filter((m) => state.status.get(m.id) === "ready")).toHaveLength(12);
    expect(state.status.get("MD:ko:R1:M1")).toBe("waiting");
  });

  it("resolves semifinal slots only once a group is complete", () => {
    const inv = groupsInventory();
    let state = initialState(inv);
    state = playGroupInOrder(inv, state, "A", ["MD-t4", "MD-t1", "MD-t5", "MD-t8"]);
    expect(state.participants.get("MD:ko:R1:M1")).toEqual(["MD-t4", null]);
    expect(state.participants.get("MD:ko:R1:M2")).toEqual([null, "MD-t1"]);
    state = playGroupInOrder(inv, state, "B", ["MD-t2", "MD-t3", "MD-t6", "MD-t7"]);
    expect(state.participants.get("MD:ko:R1:M1")).toEqual(["MD-t4", "MD-t3"]);
    expect(state.participants.get("MD:ko:R1:M2")).toEqual(["MD-t2", "MD-t1"]);
    expect(state.status.get("MD:ko:R1:M1")).toBe("ready");

    state = record(inv, state, "MD:ko:R1:M1", win(1));
    state = record(inv, state, "MD:ko:R1:M2", win(0));
    expect(state.participants.get("MD:ko:R2:M1")).toEqual(["MD-t3", "MD-t2"]);
    expect(state.participants.get("MD:ko:3P")).toEqual(["MD-t4", "MD-t1"]);
  });

  it("rejects results for matches whose participants are unknown", () => {
    const inv = groupsInventory();
    const r = applyEvent(inv, initialState(inv), { type: "result_recorded", eventId: "x", at: "t", actor: "a", matchId: "MD:ko:R2:M1", result: win(0) });
    expect(!r.ok && r.error.code).toBe("PARTICIPANTS_UNRESOLVED");
  });

  it("protects completed matches: second recording is rejected", () => {
    const inv = groupsInventory();
    const first = inv.matches[0]!.id;
    const state = record(inv, initialState(inv), first, win(0));
    const r = applyEvent(inv, state, { type: "result_recorded", eventId: "dup2", at: "t", actor: "a", matchId: first, result: win(1) });
    expect(!r.ok && r.error.code).toBe("ALREADY_COMPLETED");
  });

  it("rejects duplicate event ids and unknown matches", () => {
    const inv = groupsInventory();
    const event: ProgressionEvent = { type: "result_recorded", eventId: "same", at: "t", actor: "a", matchId: inv.matches[0]!.id, result: win(0) };
    const s1 = applyEvent(inv, initialState(inv), event);
    expect(s1.ok).toBe(true);
    const again = applyEvent(inv, s1.ok ? s1.value.state : initialState(inv), { ...event, matchId: inv.matches[1]!.id });
    expect(!again.ok && again.error.code).toBe("DUPLICATE_EVENT");
    const unknown = applyEvent(inv, initialState(inv), { ...event, eventId: "u", matchId: "nope" });
    expect(!unknown.ok && unknown.error.code).toBe("UNKNOWN_MATCH");
  });

  it("allows a correction that does not affect completed matches and reports affected fixtures", () => {
    const inv = groupsInventory();
    let state = playGroupInOrder(inv, initialState(inv), "A", ["MD-t4", "MD-t1", "MD-t5", "MD-t8"]);
    state = playGroupInOrder(inv, state, "B", ["MD-t2", "MD-t3", "MD-t6", "MD-t7"]);
    // Flip t4 v t1 in group A: t1 now 3 wins, t4 2 wins -> A1 and A2 swap.
    const match = inv.matches.find((m) => m.groupId === "A" && m.slots.every((s) => s.type === "team" && ["MD-t1", "MD-t4"].includes(s.teamId)))!;
    const winnerSide = match.slots[0].type === "team" && match.slots[0].teamId === "MD-t1" ? 0 : 1;
    const r = applyEvent(inv, state, { type: "result_corrected", eventId: "c1", at: "t", actor: "ref", matchId: match.id, result: win(winnerSide), reason: "Scorecard misread" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.participants.get("MD:ko:R1:M1")).toEqual(["MD-t1", "MD-t3"]);
    expect(r.value.affectedMatchIds.sort()).toEqual(["MD:ko:R1:M1", "MD:ko:R1:M2"]);
    expect(auditTrail(r.value.state, match.id).map((e) => e.type)).toEqual(["result_recorded", "result_corrected"]);
  });

  it("rejects a correction that would change who played a completed match", () => {
    const inv = groupsInventory();
    let state = playGroupInOrder(inv, initialState(inv), "A", ["MD-t4", "MD-t1", "MD-t5", "MD-t8"]);
    state = playGroupInOrder(inv, state, "B", ["MD-t2", "MD-t3", "MD-t6", "MD-t7"]);
    state = record(inv, state, "MD:ko:R1:M1", win(0));
    const match = inv.matches.find((m) => m.groupId === "A" && m.slots.every((s) => s.type === "team" && ["MD-t1", "MD-t4"].includes(s.teamId)))!;
    const winnerSide = match.slots[0].type === "team" && match.slots[0].teamId === "MD-t1" ? 0 : 1;
    const r = applyEvent(inv, state, { type: "result_corrected", eventId: "c2", at: "t", actor: "ref", matchId: match.id, result: win(winnerSide), reason: "late protest" });
    expect(!r.ok && r.error.code).toBe("DOWNSTREAM_COMPLETED");
    expect(!r.ok && r.error.matchIds).toEqual(["MD:ko:R1:M1"]);
  });

  it("requires a reason for corrections", () => {
    const inv = groupsInventory();
    const state = record(inv, initialState(inv), inv.matches[0]!.id, win(0));
    const r = applyEvent(inv, state, { type: "result_corrected", eventId: "c3", at: "t", actor: "ref", matchId: inv.matches[0]!.id, result: win(1), reason: " " });
    expect(!r.ok && r.error.code).toBe("MISSING_REASON");
  });

  it("replay is deterministic and stops at the first invalid event", () => {
    const inv = groupsInventory();
    const events: ProgressionEvent[] = inv.matches.slice(0, 3).map((m, i) => ({ type: "result_recorded", eventId: `r${i}`, at: "t", actor: "a", matchId: m.id, result: win(0) }));
    const a = replay(inv, events);
    const b = replay(inv, events);
    expect(a.ok && b.ok && [...a.value.results.keys()]).toEqual(b.ok && [...b.value.results.keys()]);
    const bad = replay(inv, [...events, { ...events[0]!, eventId: "r9" }]);
    expect(!bad.ok && bad.error.code).toBe("ALREADY_COMPLETED");
  });
});

describe("standings and tiebreakers", () => {
  const rrInventory = (tiebreakers: ("wins" | "head_to_head" | "point_difference" | "game_difference" | "points_for" | "seed" | "draw")[]) =>
    buildInventory(
      tournament({
        courts: courts(2, [fullDay()]),
        divisions: [{ id: "R", teamCount: 4, seeded: true, stages: stages.roundRobin(), extra: { standings: { tiebreakers } } }],
      }),
    );
  const find = (inv: Inventory, x: string, y: string) =>
    inv.matches.find((m) => m.slots.every((s) => s.type === "team" && [x, y].includes(s.teamId)))!;
  const beat = (inv: Inventory, state: ProgressionState, w: string, l: string, loserPoints = 5) => {
    const m = find(inv, w, l);
    const side = m.slots[0].type === "team" && m.slots[0].teamId === w ? 0 : 1;
    return record(inv, state, m.id, win(side, loserPoints));
  };

  it("two-way tie is decided head to head", () => {
    const inv = rrInventory(["wins", "head_to_head", "point_difference", "draw"]);
    let s = initialState(inv);
    s = beat(inv, s, "R-t1", "R-t2", 9);
    s = beat(inv, s, "R-t3", "R-t1", 0);
    s = beat(inv, s, "R-t1", "R-t4");
    s = beat(inv, s, "R-t2", "R-t3", 0); // t2 beats t3
    s = beat(inv, s, "R-t2", "R-t4");
    s = beat(inv, s, "R-t4", "R-t3");
    // Wins: t1 2, t2 2, t3 1, t4 1. t1 beat t2 head to head.
    const rows = s.standings.get("R|rr|RR")!.rows.map((r) => r.teamId);
    expect(rows.slice(0, 2)).toEqual(["R-t1", "R-t2"]);
    expect(s.standings.get("R|rr|RR")!.complete).toBe(true);
  });

  it("three-way circular tie falls to point difference, then restarts head to head for the remaining pair", () => {
    const inv = rrInventory(["wins", "head_to_head", "point_difference", "draw"]);
    let s = initialState(inv);
    // t1 > t2 > t3 > t1 circle; all beat t4.
    s = beat(inv, s, "R-t1", "R-t2", 10); // t1 +1
    s = beat(inv, s, "R-t2", "R-t3", 10); // t2 +1
    s = beat(inv, s, "R-t3", "R-t1", 0); //  t3 +11
    s = beat(inv, s, "R-t1", "R-t4", 0); // t1 +11
    s = beat(inv, s, "R-t2", "R-t4", 0); // t2 +11
    s = beat(inv, s, "R-t3", "R-t4", 9); // t3 +2
    // Point diff: t1 = +1 -11 +11 = 1; t2 = -1 +1 +11 = 11; t3 = -1 +11 +2 = 12.
    // t3 first; t1 vs t2 tied? No: t2 (11) > t1 (1).
    const rows = s.standings.get("R|rr|RR")!.rows.map((r) => r.teamId);
    expect(rows).toEqual(["R-t3", "R-t2", "R-t1", "R-t4"]);
  });

  it("after a split, the remaining tied pair is re-ranked head to head", () => {
    const inv = rrInventory(["wins", "head_to_head", "points_for", "draw"]);
    let s = initialState(inv);
    s = beat(inv, s, "R-t1", "R-t2", 9);
    s = beat(inv, s, "R-t2", "R-t3", 9);
    s = beat(inv, s, "R-t3", "R-t1", 0);
    s = beat(inv, s, "R-t1", "R-t4", 0);
    s = beat(inv, s, "R-t2", "R-t4", 0);
    s = beat(inv, s, "R-t3", "R-t4", 0);
    // Points for: t1 = 11+0+11 = 22, t2 = 9+11+11 = 31, t3 = 9+11+11 = 31.
    // points_for splits {t2,t3} from t1; restart: head to head t2 beat t3.
    const rows = s.standings.get("R|rr|RR")!.rows.map((r) => r.teamId);
    expect(rows).toEqual(["R-t2", "R-t3", "R-t1", "R-t4"]);
  });

  it("draw is deterministic and seed tiebreak prefers the better seed", () => {
    const seedFirst = rrInventory(["seed", "draw"]);
    expect(initialState(seedFirst).standings.get("R|rr|RR")!.rows.map((r) => r.teamId)).toEqual(["R-t1", "R-t2", "R-t3", "R-t4"]);
    const drawOnly = rrInventory(["draw"]);
    const a = initialState(drawOnly).standings.get("R|rr|RR")!.rows.map((r) => r.teamId);
    const b = initialState(rrInventory(["draw"])).standings.get("R|rr|RR")!.rows.map((r) => r.teamId);
    expect(a).toEqual(b);
  });
});

describe("score validation", () => {
  it.each<[MatchResult, 1 | 3 | 5, boolean]>([
    [{ winner: 0, outcome: "played", games: [{ a: 11, b: 7 }] }, 1, true],
    [{ winner: 1, outcome: "played", games: [{ a: 11, b: 7 }] }, 1, false],
    [{ winner: 0, outcome: "played", games: [{ a: 11, b: 11 }] }, 1, false],
    [{ winner: 0, outcome: "played", games: [{ a: 11, b: 7 }, { a: 5, b: 11 }, { a: 11, b: 9 }] }, 3, true],
    [{ winner: 0, outcome: "played", games: [{ a: 11, b: 7 }, { a: 11, b: 9 }, { a: 5, b: 11 }] }, 3, false],
    [{ winner: 0, outcome: "played", games: [{ a: 11, b: 7 }] }, 3, false],
    [{ winner: 0, outcome: "walkover", games: [] }, 3, true],
    [{ winner: 0, outcome: "walkover", games: [{ a: 11, b: 0 }] }, 3, false],
    [{ winner: 0, outcome: "retired", games: [{ a: 4, b: 11 }] }, 3, true],
    [{ winner: 0, outcome: "retired", games: [{ a: 4, b: 11 }, { a: 4, b: 11 }] }, 3, false],
    [{ winner: 0, outcome: "played", games: [{ a: -1, b: 11 }] }, 1, false],
  ])("checkScore(%j, bestOf %i) valid=%s", (result, bestOf, valid) => {
    expect(checkScore(result, bestOf) === null).toBe(valid);
  });
});
