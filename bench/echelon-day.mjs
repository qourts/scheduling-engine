// Regression scenario shaped like the Echelon Pickleball Cup 2026: ONE day, 10 courts, four categories each
// with its own three-hour window. All teams and players are invented. Plain JavaScript so it runs against both
// the built package (bench/acceptance.mjs) and the sources (vitest).

export const EVENT_DAY = "2026-11-21";
export const DAY_START = 9 * 60;
export const DAY_END = 21 * 60;

const TIEBREAKERS = ["wins", "head_to_head", "game_difference", "point_difference", "points_for", "draw"];

/** Category windows of the event, in the order they run. Minutes since midnight. */
export const CATEGORY_WINDOWS = [
  { id: "GD", name: "Genderless Doubles", gender: "open", start: 9 * 60, end: 12 * 60 },
  { id: "MD", name: "Men's Doubles", gender: "men", start: 12 * 60, end: 15 * 60 },
  { id: "XD", name: "Mixed Doubles", gender: "mixed", start: 15 * 60, end: 18 * 60 },
  { id: "WD", name: "Women's Doubles", gender: "women", start: 18 * 60, end: 21 * 60 },
];

/**
 * Each category: Novice 3 brackets, Low Intermediate 4, High Intermediate 3 (10 brackets of 4 teams, single round robin).
 * Novice and High Intermediate: three bracket winners plus one wildcard (the best second-placed team) reach the semifinals.
 * Low Intermediate: the four bracket winners reach the semifinals. Each division then plays two semifinals, a bronze and a gold match.
 */
export const SKILLS = [
  { id: "NOV", name: "Novice", brackets: 3, wildcard: true },
  { id: "LI", name: "Low Intermediate", brackets: 4, wildcard: false },
  { id: "HI", name: "High Intermediate", brackets: 3, wildcard: true },
];

/**
 * @param {{
 *   minRest?: number, turnover?: number, slotMinutes?: number, playMinutes?: number, transitionMinutes?: number,
 *   medalMinutes?: number, courts?: number, windowExtendMinutes?: number, sharedPlayers?: boolean,
 *   windows?: boolean, eventEndExtendMinutes?: number, categoryWindowMinutes?: number
 * }} [options]
 *  minRest: participant recovery between occupied slots (default 10, an assumption to be confirmed by the organizer).
 *  turnover: additional court turnover buffer; 0 because the 20-minute slot already contains the 5-minute transition.
 *  windowExtendMinutes: extends the END of every category window (a what-if; the approved windows are the default).
 *  sharedPlayers: let the first four Mixed teams of each skill reuse a Genderless player.
 *  windows: set false to drop the category windows (a what-if).
 *  eventEndExtendMinutes: extends the END of the event day itself (a what-if that needs organizer approval).
 *  categoryWindowMinutes: length of each category window (default 180). Windows stay back to back from 09:00, so a longer
 *  window also lengthens the event day (a what-if that needs organizer approval).
 */
export function buildEchelonDayConfig(options = {}) {
  const slot = options.slotMinutes ?? 20;
  const play = options.playMinutes ?? 15;
  const transition = options.transitionMinutes ?? slot - play;
  const players = new Map();
  const person = (id) => {
    if (!players.has(id)) players.set(id, { id, name: id });
    return id;
  };

  // Approved windows are 180 minutes each, back to back from DAY_START; a what-if may lengthen them.
  const length = options.categoryWindowMinutes ?? 180;
  const windowOf = (index) => ({ start: DAY_START + index * length, end: DAY_START + (index + 1) * length });
  const eventEnd = Math.max(DAY_END, DAY_START + CATEGORY_WINDOWS.length * length) + (options.eventEndExtendMinutes ?? 0);

  const divisions = [];
  for (const [categoryIndex, category] of CATEGORY_WINDOWS.entries()) {
    for (const skill of SKILLS) {
      const id = `${category.id}-${skill.id}`;
      const teamCount = skill.brackets * 4;
      const teams = Array.from({ length: teamCount }, (_, k) => {
        const n = k + 1;
        const own = [person(`${id}-t${n}-a`), person(`${id}-t${n}-b`)];
        const playerIds = options.sharedPlayers && category.id === "XD" && n <= 4 ? [person(`GD-${skill.id}-t${n}-a`), own[1]] : own;
        return { id: `${id}-t${n}`, name: `${category.name} ${skill.name} Team ${n}`, playerIds, seed: n };
      });
      const division = {
        id,
        name: `${category.name} ${skill.name}`,
        categoryId: category.id,
        skillLevel: skill.name,
        teams,
        stages: [
          { id: "pool", kind: "groups", groupCount: skill.brackets, legs: 1, allocation: "snake" },
          {
            id: "ko",
            kind: "single_elimination",
            source: { type: "qualifiers", fromStageId: "pool", perGroup: 1, ...(skill.wildcard ? { wildcards: { count: 1, rank: 2 } } : {}) },
            thirdPlaceMatch: true,
          },
        ],
        matchDurationMinutes: slot,
        playMinutes: play,
        transitionMinutes: transition,
        medalMatchDurationMinutes: options.medalMinutes ?? 30,
        scoring: { bestOf: 1 },
        standings: { tiebreakers: TIEBREAKERS },
      };
      if (options.windows !== false) {
        division.playWindows = [{ day: EVENT_DAY, start: windowOf(categoryIndex).start, end: windowOf(categoryIndex).end + (options.windowExtendMinutes ?? 0) }];
      }
      divisions.push(division);
    }
  }

  return {
    id: "echelon-2026-11-21-synthetic",
    name: "Echelon Pickleball Cup 2026 (synthetic regression scenario)",
    days: [EVENT_DAY],
    courts: Array.from({ length: options.courts ?? 10 }, (_, i) => ({
      id: `C${i + 1}`,
      name: i === 0 ? "Court 1 (feature)" : `Court ${i + 1}`,
      availability: [{ day: EVENT_DAY, start: DAY_START, end: eventEnd }],
    })),
    players: [...players.values()],
    categories: CATEGORY_WINDOWS.map((c) => ({ id: c.id, name: c.name, discipline: "doubles", gender: c.gender })),
    divisions,
    rules: { courtTurnoverMinutes: options.turnover ?? 0, minRestMinutes: options.minRest ?? 10 },
  };
}

const preference = (i, weight) => ({ ...i, strength: "preference", weight });

/** Soft organiser wishes for the regression scenario; none is allowed to break a window or any other hard rule. */
export function echelonDayPreferences() {
  return [
    preference({ id: "medals-on-feature-court", kind: "court_allowlist", selector: { roles: ["medal"] }, courtIds: ["C1"] }, 3),
    preference({ id: "comfortable-recovery-15", kind: "min_rest", divisionIds: buildEchelonDayConfig().divisions.map((d) => d.id), minutes: 15 }, 2),
    preference({ id: "pool-play-same-day", kind: "same_day_preliminaries" }, 5),
  ];
}
