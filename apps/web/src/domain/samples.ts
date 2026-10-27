import { DEFAULT_TIEBREAKERS, emptyFormat, newCourts, type CategorySpec, type DivisionSpec, type EventSpec } from "./spec.js";

/** Invented names only. Realistic enough for usability testing; never real players. */
const FIRST = ["Ana", "Ben", "Carla", "Dan", "Elena", "Femi", "Gus", "Hana", "Ivan", "Jade", "Kai", "Lea", "Marco", "Nina", "Omar", "Pia", "Quinn", "Rafa", "Sol", "Tess", "Uri", "Vera", "Wade", "Xia", "Yuri", "Zoe"];
const LAST = ["Reyes", "Lim", "Santos", "Cruz", "Tan", "Ong", "Diaz", "Go", "Lee", "Ramos", "Uy", "Chua", "Bautista", "Velasco", "Flores", "Aquino"];

function names(seed: number, count: number, doubles: boolean): string[] {
  let n = seed * 7;
  const person = () => {
    n += 5;
    return `${FIRST[n % FIRST.length]} ${LAST[(n * 3 + seed) % LAST.length]}`;
  };
  return Array.from({ length: count }, (_, i) => {
    const a = `${person()} ${String.fromCharCode(65 + (i % 26))}.`;
    return doubles ? `${a} / ${person()} ${String.fromCharCode(65 + ((i + 7) % 26))}.` : a;
  });
}

const category = (id: string, name: string, gender: CategorySpec["gender"]): CategorySpec => ({ id, name, discipline: "doubles", gender });

function division(id: string, name: string, categoryId: string, level: string, teamCount: number, pools: number, perPool: number, wildcard: 0 | 1, seed: number, extra: Partial<DivisionSpec> = {}): DivisionSpec {
  return {
    id,
    name,
    categoryId,
    skillLevel: level,
    teams: names(seed, teamCount, true),
    format: { ...emptyFormat("pools_playoff"), groupCount: pools, perPool, wildcard, thirdPlace: true },
    matchMinutes: 20,
    medalMinutes: 30,
    bestOf: 1,
    recoveryMinutes: null,
    window: null,
    tiebreakers: [...DEFAULT_TIEBREAKERS],
    ...extra,
  };
}

/** Two-day club open: 4 categories x 3 levels, 10 courts. Feasible with comfortable slack. */
export function clubWeekendOpen(): EventSpec {
  const categories = [category("MD", "Men's Doubles", "men"), category("WD", "Women's Doubles", "women"), category("XD", "Mixed Doubles", "mixed"), category("SN", "Seniors Doubles", "open")];
  const levels: [string, string][] = [["ADV", "Advanced"], ["HI", "High Intermediate"], ["INT", "Intermediate"]];
  const divisions = categories.flatMap((c, ci) => levels.map(([code, label], li) => division(`${c.id}-${code}`, `${label} ${c.name}`, c.id, label, 8, 2, 2, 0, ci * 3 + li + 1, { medalMinutes: 30 })));
  return {
    name: "Club Weekend Open (sample)",
    days: ["2026-11-14", "2026-11-15"],
    dayWindow: { start: 8 * 60, end: 19 * 60 },
    courts: newCourts(10),
    categories,
    divisions,
    recoveryMinutes: 15,
    courtTurnoverMinutes: 5,
    maxMatchesPerPlayerPerDay: null,
    experimentalNote: null,
  };
}

/**
 * One-day, four-category event shaped like the Echelon regression scenario. The 5-minute recovery is an EXPERIMENTAL
 * feasibility assumption, not an official rule (ADR 0006): at that value the category windows leave zero slack.
 */
export function echelonStyleDay(): EventSpec {
  const categories = [category("GD", "Genderless Doubles", "open"), category("MD", "Men's Doubles", "men"), category("XD", "Mixed Doubles", "mixed"), category("WD", "Women's Doubles", "women")];
  const windows = [[9, 12], [12, 15], [15, 18], [18, 21]] as const;
  const divisions = categories.flatMap((c, ci) => {
    const window = { start: windows[ci]![0] * 60, end: windows[ci]![1] * 60 };
    return [
      division(`${c.id}-NOV`, `Novice ${c.name}`, c.id, "Novice", 12, 3, 1, 1, ci * 3 + 1, { window }),
      division(`${c.id}-LI`, `Low Intermediate ${c.name}`, c.id, "Low Intermediate", 16, 4, 1, 0, ci * 3 + 2, { window }),
      division(`${c.id}-HI`, `High Intermediate ${c.name}`, c.id, "High Intermediate", 12, 3, 1, 1, ci * 3 + 3, { window }),
    ];
  });
  return {
    name: "Echelon-style one-day (experimental)",
    days: ["2026-11-21"],
    dayWindow: { start: 9 * 60, end: 21 * 60 },
    courts: newCourts(10),
    categories,
    divisions,
    recoveryMinutes: 5,
    courtTurnoverMinutes: 0,
    maxMatchesPerPlayerPerDay: null,
    experimentalNote: "Recovery of 5 minutes is an experimental feasibility assumption, not an official Echelon rule. At this value the category windows leave zero slack, so the schedule is operationally fragile and not suitable for live approval. Echelon's race-to-6 tiebreaker is not modelled; ties here fall back to a deterministic draw.",
  };
}

/** A small event that generates in well under a second, for quick trials. */
export function smallClubDay(): EventSpec {
  const categories = [category("MD", "Men's Doubles", "men"), category("XD", "Mixed Doubles", "mixed")];
  return {
    name: "Small club day (sample)",
    days: ["2026-12-05"],
    dayWindow: { start: 9 * 60, end: 17 * 60 },
    courts: newCourts(4),
    categories,
    divisions: [division("MD-A", "Advanced Men's Doubles", "MD", "Advanced", 8, 2, 2, 0, 11), division("XD-B", "Intermediate Mixed Doubles", "XD", "Intermediate", 8, 2, 2, 0, 12)],
    recoveryMinutes: 20,
    courtTurnoverMinutes: 5,
    maxMatchesPerPlayerPerDay: null,
    experimentalNote: null,
  };
}

/**
 * The guided demonstration: a realistic two-day club championship with players who appear in more than one division, so rest
 * and overlap rules matter. Small enough to generate in a couple of seconds, rich enough to exercise every workflow step.
 */
export function qourtsChampionshipDemo(): EventSpec {
  const categories = [category("MD", "Men's Doubles", "men"), category("WD", "Women's Doubles", "women"), category("XD", "Mixed Doubles", "mixed")];
  const d = (id: string, name: string, cat: string, level: string, teams: number, pools: number, perPool: number, wildcard: 0 | 1, seed: number, shared: Record<number, string> = {}) => {
    const division_ = division(id, name, cat, level, teams, pools, perPool, wildcard, seed);
    return { ...division_, teams: division_.teams.map((t, i) => shared[i] ?? t) };
  };
  const divisions = [
    d("MD-ADV", "Advanced Men's Doubles", "MD", "Advanced", 8, 2, 2, 0, 21, { 0: "Ana Reyes / Ben Lim" }),
    d("MD-INT", "Intermediate Men's Doubles", "MD", "Intermediate", 8, 2, 2, 0, 22, { 1: "Dan Cruz / Omar Tan" }),
    d("WD-ADV", "Advanced Women's Doubles", "WD", "Advanced", 8, 2, 2, 0, 23, { 0: "Carla Diaz / Hana Ong" }),
    d("WD-INT", "Intermediate Women's Doubles", "WD", "Intermediate", 8, 2, 2, 0, 24),
    d("XD-ADV", "Advanced Mixed Doubles", "XD", "Advanced", 8, 2, 2, 0, 25, { 0: "Carla Diaz / Ben Lim" }),
    d("XD-INT", "Intermediate Mixed Doubles", "XD", "Intermediate", 12, 3, 1, 1, 26, { 2: "Elena Go / Omar Tan" }),
  ];
  return {
    name: "Qourts Club Championship (guided demo)",
    days: ["2026-11-28", "2026-11-29"],
    dayWindow: { start: 8 * 60, end: 18 * 60 },
    courts: newCourts(6),
    categories,
    divisions,
    recoveryMinutes: 20,
    courtTurnoverMinutes: 5,
    maxMatchesPerPlayerPerDay: null,
    experimentalNote: null,
    demoRequests: [
      "Advanced Men's Doubles must finish by 15:00 on day 1.",
      "Court 3 is unavailable 12:00-13:30 on day 1.",
      "Reserve Court 6 for medal matches.",
      "Women's Doubles cannot start before 1 PM on day 2.",
      "Prefer to keep pool play on one day.",
      "At least 30 minutes between matches for Intermediate.",
    ],
  };
}

export const SAMPLES: { id: string; title: string; blurb: string; build: () => EventSpec }[] = [
  { id: "demo", title: "Guided demo: club championship", blurb: "6 courts, 6 divisions, 2 days, 102 matches, players in several divisions. Follow docs/operator-walkthrough.md.", build: qourtsChampionshipDemo },
  { id: "small", title: "Small club day", blurb: "4 courts, 2 divisions, 1 day. Generates in a blink.", build: smallClubDay },
  { id: "weekend", title: "Club weekend open", blurb: "10 courts, 12 divisions, 2 days, 192 matches.", build: clubWeekendOpen },
  { id: "echelon", title: "Echelon-style one day", blurb: "Category windows, wildcards, zero-slack. Experimental assumptions.", build: echelonStyleDay },
];
