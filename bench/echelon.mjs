// Synthetic "Echelon-inspired" tournament for operational acceptance. All teams and players are
// invented; no real tournament data is used or modified. Plain JavaScript so it can run against
// both the built package (bench/acceptance.mjs) and the sources (vitest).

export const DAY1 = "2026-11-14";
export const DAY2 = "2026-11-15";

const TIEBREAKERS = ["wins", "head_to_head", "game_difference", "point_difference", "points_for", "draw"];

export const CATEGORY_LIST = [
  { id: "MD", name: "Men's Doubles", discipline: "doubles", gender: "men" },
  { id: "WD", name: "Women's Doubles", discipline: "doubles", gender: "women" },
  { id: "XD", name: "Mixed Doubles", discipline: "doubles", gender: "mixed" },
  { id: "SN", name: "Seniors Doubles", discipline: "doubles", gender: "open" },
];

export const SKILLS = [
  { id: "ADV", name: "Advanced", pools: 4, perPool: 1 },
  { id: "HI", name: "High Intermediate", pools: 4, perPool: 1 },
  { id: "INT", name: "Intermediate", pools: 2, perPool: 2 },
];

/**
 * 4 categories x 3 skill divisions = 12 divisions.
 * Advanced and High Intermediate: 4 pools of 4 (top 1 advances). Intermediate: 2 pools of 4 (top 2 advance).
 * That is 8 x 4 + 4 x 2 = 40 pools of 4 teams = 240 round-robin matches, and every division sends
 * 4 qualifiers to semifinals + final + third place: 24 semifinals and 24 medal matches, 288 in all.
 *
 * Players are invented. The first six Mixed teams of each skill level reuse a player from the
 * same-level Men's and Women's divisions, so cross-division recovery conflicts are real.
 *
 * @param {{ courts?: number, days?: number, dayStart?: number, dayEnd?: number, matchMinutes?: number, medalMinutes?: number, minRest?: number, turnover?: number }} [options]
 */
export function buildEchelonConfig(options = {}) {
  const courtCount = options.courts ?? 10;
  const dayCount = options.days ?? 2;
  const days = [DAY1, DAY2].slice(0, dayCount);
  const players = new Map();
  const person = (id) => {
    if (!players.has(id)) players.set(id, { id, name: id });
    return id;
  };

  const divisions = [];
  for (const category of CATEGORY_LIST) {
    for (const skill of SKILLS) {
      const id = `${category.id}-${skill.id}`;
      const teamCount = skill.pools * 4;
      const teams = Array.from({ length: teamCount }, (_, k) => {
        const n = k + 1;
        let playerIds = [person(`${id}-t${n}-a`), person(`${id}-t${n}-b`)];
        if (category.id === "XD" && n <= 6) playerIds = [person(`MD-${skill.id}-t${n}-a`), person(`WD-${skill.id}-t${n}-a`)];
        return { id: `${id}-t${n}`, name: `${category.name} ${skill.name} Team ${n}`, playerIds, seed: n };
      });
      divisions.push({
        id,
        name: `${skill.name} ${category.name}`,
        categoryId: category.id,
        skillLevel: skill.name,
        teams,
        stages: [
          { id: "pool", kind: "groups", groupCount: skill.pools, legs: 1, allocation: "snake" },
          { id: "ko", kind: "single_elimination", source: { type: "qualifiers", fromStageId: "pool", perGroup: skill.perPool }, thirdPlaceMatch: true },
        ],
        matchDurationMinutes: options.matchMinutes ?? 20,
        medalMatchDurationMinutes: options.medalMinutes ?? 30,
        scoring: { bestOf: 1 },
        standings: { tiebreakers: TIEBREAKERS },
      });
    }
  }

  const windows = days.map((day) => ({ day, start: options.dayStart ?? 8 * 60, end: options.dayEnd ?? 19 * 60 }));
  return {
    id: "echelon-synthetic",
    name: "Echelon-inspired synthetic tournament",
    days,
    courts: Array.from({ length: courtCount }, (_, i) => ({ id: `C${i + 1}`, name: `Court ${i + 1}`, availability: windows.map((w) => ({ ...w })) })),
    players: [...players.values()],
    categories: CATEGORY_LIST,
    divisions,
    rules: { courtTurnoverMinutes: options.turnover ?? 5, minRestMinutes: options.minRest ?? 15 },
  };
}

const mandatory = (i) => ({ ...i, strength: "mandatory" });
const preference = (i, weight) => ({ ...i, strength: "preference", weight });

/**
 * Category-level scheduling windows that belong to the scenario itself:
 * Seniors must finish by 17:00 each day; Mixed Doubles starts no earlier than 09:00 each day.
 */
export function categoryWindows() {
  return [
    mandatory({ id: "seniors-finish-17", kind: "time_window", selector: { categoryIds: ["SN"] }, latestEnd: { minute: 17 * 60 } }),
    mandatory({ id: "mixed-start-09", kind: "time_window", selector: { categoryIds: ["XD"] }, earliestStart: { minute: 9 * 60 } }),
  ];
}

/**
 * Realistic special requests as explicit structured instructions. "Morning" is defined here as
 * "every match of the division ends by 12:00 on each day" (a clock rule); nothing is parsed from text.
 */
export function instructionCases() {
  return [
    {
      id: "advanced-mens-morning",
      request: "Advanced Men's must play in the morning (ends by 12:00 each day)",
      instructions: [mandatory({ id: "adv-mens-am", kind: "time_window", selector: { divisionIds: ["MD-ADV"] }, latestEnd: { minute: 12 * 60 } })],
    },
    {
      id: "advanced-womens-after-1pm",
      request: "Advanced Women's cannot start before 1 PM (13:00 each day)",
      instructions: [mandatory({ id: "adv-womens-pm", kind: "time_window", selector: { divisionIds: ["WD-ADV"] }, earliestStart: { minute: 13 * 60 } })],
    },
    {
      id: "reserve-court-for-medals",
      request: "Reserve Court 10 for medal matches",
      instructions: [mandatory({ id: "medal-court", kind: "court_reservation", courtIds: ["C10"], selector: { roles: ["medal"] } })],
    },
    {
      id: "high-intermediate-courts",
      request: "High Intermediate only on Courts 1-4",
      instructions: [mandatory({ id: "hi-courts", kind: "court_allowlist", selector: { divisionIds: ["MD-HI", "WD-HI", "XD-HI", "SN-HI"] }, courtIds: ["C1", "C2", "C3", "C4"] })],
    },
    {
      id: "twenty-minutes-between-matches",
      request: "At least 20 minutes between a team's matches (High Intermediate)",
      instructions: [mandatory({ id: "hi-rest-20", kind: "min_rest", divisionIds: ["MD-HI", "WD-HI", "XD-HI", "SN-HI"], minutes: 20 })],
    },
    {
      id: "court-blackout",
      request: "Court 3 unavailable 12:00-13:30 on day 1",
      instructions: [mandatory({ id: "c3-blackout", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY1, start: 12 * 60, end: 13 * 60 + 30 } })],
    },
    {
      id: "lock-existing-match",
      request: "Lock Intermediate Men's pool A round 1 match 1 to Court 2 at 10:00 on day 1",
      instructions: [mandatory({ id: "lock-int-men", kind: "locked_placement", matchId: "MD-INT:pool:A:R1:M1", courtId: "C2", day: DAY1, start: 10 * 60 })],
    },
    {
      id: "preference-consecutive-blocks",
      request: "Prefer Advanced divisions in consecutive blocks (weighted preference)",
      instructions: [preference({ id: "adv-blocks", kind: "consecutive_blocks", divisionIds: ["MD-ADV", "WD-ADV", "XD-ADV", "SN-ADV"] }, 5)],
    },
  ];
}

const absoluteStart = (config, a) => config.days.indexOf(a.day) * 1440 + a.start;
const isMedal = (m) => Boolean(m.thirdPlace) || (m.phase === "knockout" && m.round === 2);

/** Overlap minutes between the time spans of the listed divisions (a measure of "not in consecutive blocks"). */
export function blockOverlapMinutes(inventory, schedule, divisionIds) {
  const spans = divisionIds.map((id) => {
    const own = schedule.assignments.filter((a) => inventory.matchById.get(a.matchId).divisionId === id);
    const starts = own.map((a) => absoluteStart(inventory.config, a));
    const ends = own.map((a, k) => starts[k] + inventory.matchById.get(a.matchId).durationMinutes);
    return { start: Math.min(...starts), end: Math.max(...ends) };
  });
  let total = 0;
  for (let x = 0; x < spans.length; x++) {
    for (let y = x + 1; y < spans.length; y++) total += Math.max(0, Math.min(spans[x].end, spans[y].end) - Math.max(spans[x].start, spans[y].start));
  }
  return total;
}

/**
 * Independent, case-specific check that a schedule honours one of the instruction cases above,
 * evaluated straight from the assignments (it does not use the engine's instruction checker).
 * For the preference case, `baseline` is a schedule produced without the preference.
 */
export function verifyEnforcement(caseId, inventory, schedule, baseline) {
  const { config } = inventory;
  const rows = schedule.assignments.map((a) => {
    const match = inventory.matchById.get(a.matchId);
    return { a, match, start: absoluteStart(config, a), minuteOfDay: a.start, end: a.start + match.durationMinutes };
  });
  const inDivision = (ids) => rows.filter((r) => ids.includes(r.match.divisionId));
  switch (caseId) {
    case "advanced-mens-morning": {
      const own = inDivision(["MD-ADV"]);
      const latest = Math.max(...own.map((r) => r.end));
      return { ok: latest <= 12 * 60, detail: `${own.length} matches, latest end ${fmt(latest)}` };
    }
    case "advanced-womens-after-1pm": {
      const own = inDivision(["WD-ADV"]);
      const earliest = Math.min(...own.map((r) => r.minuteOfDay));
      return { ok: earliest >= 13 * 60, detail: `${own.length} matches, earliest start ${fmt(earliest)}` };
    }
    case "reserve-court-for-medals": {
      const onReserved = rows.filter((r) => r.a.courtId === "C10");
      const bad = onReserved.filter((r) => !isMedal(r.match));
      return { ok: bad.length === 0, detail: `${onReserved.length} matches on Court 10, ${bad.length} of them not medal matches` };
    }
    case "high-intermediate-courts": {
      const own = inDivision(["MD-HI", "WD-HI", "XD-HI", "SN-HI"]);
      const bad = own.filter((r) => !["C1", "C2", "C3", "C4"].includes(r.a.courtId));
      return { ok: bad.length === 0, detail: `${own.length} matches, ${bad.length} outside Courts 1-4` };
    }
    case "twenty-minutes-between-matches": {
      let min = Infinity;
      const own = inDivision(["MD-HI", "WD-HI", "XD-HI", "SN-HI"]);
      const byTeam = new Map();
      for (const r of own) for (const s of r.match.slots) if (s.type === "team") byTeam.set(s.teamId, [...(byTeam.get(s.teamId) ?? []), r]);
      for (const list of byTeam.values()) {
        list.sort((x, y) => x.start - y.start);
        for (let k = 1; k < list.length; k++) min = Math.min(min, list[k].start - list[k - 1].end);
      }
      const ends = new Map(rows.map((r) => [r.match.id, r.end]));
      for (const r of own) for (const s of r.match.slots) if ((s.type === "winner" || s.type === "loser") && ends.has(s.matchId)) min = Math.min(min, r.start - ends.get(s.matchId));
      return { ok: min >= 20, detail: `shortest recovery among High Intermediate teams and feeder links: ${min} minutes` };
    }
    case "court-blackout": {
      const hits = rows.filter((r) => r.a.courtId === "C3" && r.a.day === DAY1 && r.minuteOfDay < 13 * 60 + 30 && 12 * 60 < r.end);
      return { ok: hits.length === 0, detail: `${hits.length} matches overlap the Court 3 blackout` };
    }
    case "lock-existing-match": {
      const a = schedule.assignments.find((x) => x.matchId === "MD-INT:pool:A:R1:M1");
      const ok = Boolean(a) && a.courtId === "C2" && a.day === DAY1 && a.start === 10 * 60;
      return { ok, detail: a ? `placed on ${a.courtId} at ${a.day} ${fmt(a.start)}` : "not scheduled" };
    }
    case "preference-consecutive-blocks": {
      const ids = ["MD-ADV", "WD-ADV", "XD-ADV", "SN-ADV"];
      const now = blockOverlapMinutes(inventory, schedule, ids);
      const before = baseline ? blockOverlapMinutes(inventory, baseline, ids) : null;
      return { ok: before === null ? true : now <= before, detail: `division-span overlap ${now} minutes${before === null ? "" : ` (${before} without the preference)`}` };
    }
    default:
      return { ok: false, detail: `no enforcement check for ${caseId}` };
  }
}

const fmt = (minute) => `${String(Math.floor((minute % 1440) / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays the whole tournament with random results (so every playoff participant becomes known) and
 * returns the player collisions in the schedule that ACTUALLY occur: overlaps, and gaps shorter
 * than the larger minimum rest of the two matches. `api` is `{ initialState, applyEvent }`.
 */
export function actualConflicts(api, inventory, schedule, seed) {
  const random = mulberry(seed);
  let state = api.initialState(inventory);
  let n = 0;
  for (let guard = 0; guard < inventory.matches.length + 1; guard++) {
    const ready = inventory.matches.filter((m) => state.status.get(m.id) === "ready");
    if (ready.length === 0) break;
    for (const match of ready) {
      const winner = random() < 0.5 ? 0 : 1;
      const applied = api.applyEvent(inventory, state, {
        type: "result_recorded",
        eventId: `e${n++}`,
        at: "2026-11-14T10:00:00Z",
        actor: "acceptance",
        matchId: match.id,
        result: { winner, outcome: "played", games: [winner === 0 ? { a: 11, b: Math.floor(random() * 10) } : { a: Math.floor(random() * 10), b: 11 }] },
      });
      if (!applied.ok) throw new Error(applied.error.message);
      state = applied.value.state;
    }
  }
  const { config } = inventory;
  const items = schedule.assignments.map((a) => {
    const match = inventory.matchById.get(a.matchId);
    const division = config.divisions.find((d) => d.id === match.divisionId);
    const start = absoluteStart(config, a);
    const teams = state.participants.get(match.id);
    return {
      id: match.id,
      start,
      end: start + match.durationMinutes,
      players: teams.flatMap((t) => inventory.teamById.get(t).playerIds),
      rest: division.minRestMinutes ?? config.rules.minRestMinutes,
    };
  });
  const problems = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [x, y] = items[i].start <= items[j].start ? [items[i], items[j]] : [items[j], items[i]];
      if (!x.players.some((p) => y.players.includes(p))) continue;
      if (y.start < x.end + Math.max(x.rest, y.rest)) problems.push(`${x.id} -> ${y.id}`);
    }
  }
  return problems;
}

/** Requests that must be rejected or reported, with the kind of answer expected. */
export function problemCases() {
  return [
    {
      id: "contradiction-lock-in-blackout",
      request: "Lock a match to Court 3 at 12:30 on day 1 while Court 3 is blacked out 12:00-13:30",
      instructions: [
        mandatory({ id: "c3-blackout", kind: "court_blackout", courtIds: ["C3"], window: { day: DAY1, start: 12 * 60, end: 13 * 60 + 30 } }),
        mandatory({ id: "lock-clash", kind: "locked_placement", matchId: "MD-INT:pool:A:R1:M1", courtId: "C3", day: DAY1, start: 12 * 60 + 30 }),
      ],
      expect: "invalid_instructions",
    },
    {
      id: "contradiction-window-bounds",
      request: "Women's Advanced starts no earlier than 14:00 but must finish by 12:00",
      instructions: [mandatory({ id: "bad-bounds", kind: "time_window", selector: { divisionIds: ["WD-ADV"] }, earliestStart: { minute: 14 * 60 }, latestEnd: { minute: 12 * 60 } })],
      expect: "invalid_instructions",
    },
    {
      id: "impossible-single-match",
      request: "Advanced Men's must finish by 08:10 (a 20-minute match cannot fit before the first slot ends)",
      instructions: [mandatory({ id: "too-early", kind: "time_window", selector: { divisionIds: ["MD-ADV"] }, latestEnd: { minute: 8 * 60 + 10 } })],
      expect: "proven_infeasible",
    },
    {
      id: "impossible-chain-not-proven",
      request: "Advanced Men's must finish by 09:00 each day (the preliminary-to-medal chain cannot fit)",
      instructions: [mandatory({ id: "chain-too-long", kind: "time_window", selector: { divisionIds: ["MD-ADV"] }, latestEnd: { minute: 9 * 60 } })],
      expect: "not_found",
    },
    {
      id: "unsupported-mandatory-blocks",
      request: "Divisions MUST be played in consecutive blocks (mandatory)",
      instructions: [mandatory({ id: "hard-blocks", kind: "consecutive_blocks", divisionIds: ["MD-ADV", "WD-ADV"] })],
      expect: "invalid_instructions",
    },
    {
      id: "unsupported-kind",
      request: "Delay everything by 30 minutes if it rains (weather_delay)",
      instructions: [mandatory({ id: "rain", kind: "weather_delay", minutes: 30 })],
      expect: "invalid_instructions",
    },
  ];
}
