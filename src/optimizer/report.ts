import type { Id } from "../config/types.js";
import type { Inventory, Match, MatchId } from "../inventory/types.js";
import { Timeline } from "../schedule/timeline.js";
import type { Schedule } from "../schedule/types.js";
import { formatClock, MINUTES_PER_DAY } from "../util/time.js";

/**
 * Operational report on one schedule, computed from the schedule alone (never from optimizer
 * internals), so it can also describe manually edited schedules.
 *
 * Recovery is measured from the END OF ALLOCATED COURT TIME of a player's previous match
 * (start + matchDurationMinutes, which already includes warm-up and changeover that the
 * configuration puts into the duration) to the START of the next match. Court turnover is a court
 * buffer, not player rest, and is not added to or subtracted from recovery. Because active play
 * ends no later than the allocated end, recovery measured this way is a lower bound on rest from
 * the end of active play. It is the same basis the hard rest rule uses.
 */

export interface ReportOptions {
  /** A recovery gap below this is a back-to-back. Default: the largest minimum rest in the configuration plus 10. */
  backToBackMinutes?: number;
  /** A recovery gap below this is a short recovery. Default: twice the back-to-back threshold. */
  comfortRestMinutes?: number;
  /** A wait between a team's matches above this is flagged as long. Default 240. */
  longWaitMinutes?: number;
  /** How many entries to list in the shortest-recovery and longest-wait rankings. Default 5. */
  top?: number;
}

export interface Moment {
  day: string;
  /** Minutes since midnight of `day`. */
  minute: number;
  /** Minutes since midnight of the first tournament day. */
  absolute: number;
  label: string;
}

export interface CourtUsage {
  courtId: Id;
  name: string;
  matches: number;
  busyMinutes: number;
  /** Court availability inside the schedule's overall start-to-finish span. */
  availableMinutes: number;
  /** busy / available, 0..1. */
  utilization: number;
  /** Gaps between consecutive matches on the same day beyond the court turnover. */
  idleMinutes: number;
}

export interface RecoveryGap {
  /** A team (certain participant) or a feeder link ("winner:<match>" / "loser:<match>"). */
  owner: string;
  ownerName: string;
  gapMinutes: number;
  before: MatchId;
  after: MatchId;
}

export interface TeamWait {
  teamId: Id;
  teamName: string;
  longestGapMinutes: number;
  /** Minutes between the team's first and last match that are not spent playing. */
  totalWaitMinutes: number;
  matches: number;
}

export interface DivisionTimeline {
  divisionId: Id;
  name: string;
  categoryId: Id;
  matches: number;
  firstStart: Moment;
  /** End of the last preliminary (group or round-robin) match, if the division has one. */
  preliminaryFinish: Moment | null;
  /** Start of the first knockout match, if any. */
  playoffStart: Moment | null;
  /**
   * The smallest gap, over the division's first-round knockout matches, between a match starting and
   * the end of the last preliminary match it depends on. A semifinal only waits for the pools that feed
   * it, so this is the guaranteed rest of a qualifier from its own pool, and it is never below the rest rule.
   */
  transitionMinutes: number | null;
  /** True when a knockout match starts before the division's last preliminary match ends (it only needs its own pools). */
  playoffsOverlapPreliminaries: boolean;
  finish: Moment;
}

export type WarningCode = "BACK_TO_BACK" | "SHORT_RECOVERY" | "NO_SLACK" | "LONG_WAIT" | "TIGHT_PLAYOFF_TRANSITION" | "LOW_COURT_UTILIZATION" | "OVERNIGHT_SPLIT" | "UNSCHEDULED_MATCHES";

export interface ReportWarning {
  severity: "risk" | "info";
  code: WarningCode;
  message: string;
  matchIds?: MatchId[];
}

export interface ScheduleReport {
  assumptions: {
    recoveryMeasuredFrom: "end_of_allocated_court_time";
    courtTurnoverIncludedInRecovery: false;
    backToBackThresholdMinutes: number;
    comfortThresholdMinutes: number;
  };
  totalMatches: number;
  scheduledMatches: number;
  start: Moment | null;
  finish: Moment | null;
  /** Minutes from the first match starting to the last match ending, including overnight gaps. */
  spanMinutes: number;
  /** The same span counting only minutes inside court open hours (overnight gaps removed). */
  playingDayMinutes: number;
  courts: CourtUsage[];
  idleCourtMinutes: number;
  recovery: {
    gapCount: number;
    minMinutes: number | null;
    meanMinutes: number | null;
    maxMinutes: number | null;
    backToBackOccurrences: number;
    backToBackAffectedTeams: number;
    shortRecoveryOccurrences: number;
    shortest: RecoveryGap[];
    /** Teams whose certain (preliminary) matches fall on more than one tournament day. */
    teamsSplitAcrossDays: number;
  };
  longestWaits: TeamWait[];
  divisions: DivisionTimeline[];
  categories: { categoryId: Id; finish: Moment }[];
  warnings: ReportWarning[];
}

interface Placed {
  start: number;
  end: number;
  court: Id;
  match: Match;
}

export function analyzeSchedule(inventory: Inventory, schedule: Schedule, options: ReportOptions = {}): ScheduleReport {
  const { config } = inventory;
  const timeline = new Timeline(config);
  const maxRest = Math.max(config.rules.minRestMinutes, ...config.divisions.map((d) => d.minRestMinutes ?? 0));
  const backToBack = options.backToBackMinutes ?? maxRest + 10;
  const comfort = options.comfortRestMinutes ?? 2 * backToBack;
  const longWait = options.longWaitMinutes ?? 240;
  const top = options.top ?? 5;

  const placed = new Map<MatchId, Placed>();
  for (const a of schedule.assignments) {
    const match = inventory.matchById.get(a.matchId);
    if (!match || placed.has(a.matchId) || !timeline.hasDay(a.day)) continue;
    const start = timeline.absolute(a.day, a.start);
    placed.set(a.matchId, { start, end: start + match.durationMinutes, court: a.courtId, match });
  }
  const moment = (absolute: number): Moment => {
    // An instant exactly at a day boundary is the end of the previous day (24:00), never 00:00 of a day that may not exist.
    const endOfDay = absolute > 0 && absolute % MINUTES_PER_DAY === 0;
    const day = timeline.dayOf(endOfDay ? absolute - 1 : absolute);
    const minute = absolute - config.days.indexOf(day) * MINUTES_PER_DAY;
    return { day, minute, absolute, label: `${day} ${formatClock(minute)}` };
  };

  const all = [...placed.values()];
  const warnings: ReportWarning[] = [];
  if (all.length < inventory.matches.length) {
    warnings.push({
      severity: "risk",
      code: "UNSCHEDULED_MATCHES",
      message: `${inventory.matches.length - all.length} of ${inventory.matches.length} matches are not scheduled.`,
      matchIds: inventory.matches.filter((m) => !placed.has(m.id)).map((m) => m.id),
    });
  }
  const first = all.length === 0 ? null : Math.min(...all.map((p) => p.start));
  const last = all.length === 0 ? null : Math.max(...all.map((p) => p.end));

  const courts = courtUsage(inventory, timeline, all, first, last);
  const gaps = recoveryGaps(inventory, placed);
  const values = gaps.map((g) => g.gapMinutes);
  const b2b = gaps.filter((g) => g.gapMinutes < backToBack);
  const shortOnes = gaps.filter((g) => g.gapMinutes < comfort);
  const affected = new Set(b2b.map((g) => g.owner));
  const shortest = [...gaps].sort((a, b) => a.gapMinutes - b.gapMinutes || (a.owner < b.owner ? -1 : 1)).slice(0, top);

  for (const g of b2b.slice(0, 25)) {
    warnings.push({
      severity: "risk",
      code: "BACK_TO_BACK",
      message: `${g.ownerName} has only ${g.gapMinutes} minutes of recovery between ${g.before} and ${g.after} (back-to-back threshold ${backToBack}).`,
      matchIds: [g.before, g.after],
    });
  }
  if (b2b.length > 25) warnings.push({ severity: "risk", code: "BACK_TO_BACK", message: `${b2b.length - 25} further back-to-back occurrences are not listed individually.` });
  if (shortOnes.length > b2b.length) {
    warnings.push({ severity: "info", code: "SHORT_RECOVERY", message: `${shortOnes.length} recoveries are below the ${comfort}-minute comfort level (${b2b.length} of them are back-to-backs).` });
  }
  const minimalSlack = gaps.filter((g) => g.gapMinutes <= minimumRequired(inventory, g) + 5).length;
  if (minimalSlack > 0) {
    warnings.push({ severity: "info", code: "NO_SLACK", message: `${minimalSlack} recovery gaps are within 5 minutes of the minimum rest rule, so a match overrunning its allocated time would breach it at the next start.` });
  }

  const splitTeams = teamsSplitAcrossDays(placed);
  if (splitTeams > 0) {
    warnings.push({
      severity: "info",
      code: "OVERNIGHT_SPLIT",
      message: `${splitTeams} teams play their preliminary matches on more than one day, so they wait overnight between matches.`,
    });
  }
  const waits = teamWaits(inventory, placed);
  const longWaits = waits.filter((w) => w.longestGapMinutes > longWait);
  if (longWaits.length > 0) {
    warnings.push({
      severity: "info",
      code: "LONG_WAIT",
      message: `${longWaits.length} teams wait more than ${longWait} minutes between two matches (longest: ${longWaits[0]!.teamName}, ${longWaits[0]!.longestGapMinutes} minutes).`,
    });
  }

  const divisions = divisionTimelines(inventory, placed, moment);
  for (const d of divisions) {
    if (d.transitionMinutes !== null && d.transitionMinutes < comfort) {
      warnings.push({
        severity: "info",
        code: "TIGHT_PLAYOFF_TRANSITION",
        message: `${d.name}: a first-round knockout match starts only ${d.transitionMinutes} minutes after the last preliminary match it depends on ends, so a qualifier from that pool has little rest.`,
      });
    }
  }
  for (const c of courts) {
    if (c.availableMinutes > 0 && c.utilization < 0.4) {
      warnings.push({ severity: "info", code: "LOW_COURT_UTILIZATION", message: `${c.name} is used ${(c.utilization * 100).toFixed(0)}% of its available time inside the schedule span.` });
    }
  }

  const categoryFinish = new Map<Id, number>();
  for (const d of divisions) categoryFinish.set(d.categoryId, Math.max(categoryFinish.get(d.categoryId) ?? 0, d.finish.absolute));

  return {
    assumptions: { recoveryMeasuredFrom: "end_of_allocated_court_time", courtTurnoverIncludedInRecovery: false, backToBackThresholdMinutes: backToBack, comfortThresholdMinutes: comfort },
    totalMatches: inventory.matches.length,
    scheduledMatches: all.length,
    start: first === null ? null : moment(first),
    finish: last === null ? null : moment(last),
    spanMinutes: first === null || last === null ? 0 : last - first,
    playingDayMinutes: first === null || last === null ? 0 : openHoursSpan(inventory, timeline, first, last),
    courts,
    idleCourtMinutes: courts.reduce((s, c) => s + c.idleMinutes, 0),
    recovery: {
      gapCount: gaps.length,
      minMinutes: values.length === 0 ? null : Math.min(...values),
      meanMinutes: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
      maxMinutes: values.length === 0 ? null : Math.max(...values),
      backToBackOccurrences: b2b.length,
      backToBackAffectedTeams: affected.size,
      shortRecoveryOccurrences: shortOnes.length,
      shortest,
      teamsSplitAcrossDays: splitTeams,
    },
    longestWaits: waits.slice(0, top),
    divisions,
    categories: [...categoryFinish].map(([categoryId, f]) => ({ categoryId, finish: moment(f) })).sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1)),
    warnings,
  };
}

function courtUsage(inventory: Inventory, timeline: Timeline, all: readonly Placed[], first: number | null, last: number | null): CourtUsage[] {
  const { config } = inventory;
  return config.courts.map((court) => {
    const own = all.filter((p) => p.court === court.id).sort((a, b) => a.start - b.start);
    const busy = own.reduce((s, p) => s + (p.end - p.start), 0);
    let available = 0;
    if (first !== null && last !== null) {
      for (const w of court.availability) {
        const iv = timeline.window(w);
        available += Math.max(0, Math.min(iv.end, last) - Math.max(iv.start, first));
      }
    }
    let idle = 0;
    for (let k = 1; k < own.length; k++) {
      const prev = own[k - 1]!;
      const next = own[k]!;
      if (Math.floor(prev.start / MINUTES_PER_DAY) !== Math.floor(next.start / MINUTES_PER_DAY)) continue;
      idle += Math.max(0, next.start - prev.end - config.rules.courtTurnoverMinutes);
    }
    return { courtId: court.id, name: court.name, matches: own.length, busyMinutes: busy, availableMinutes: available, utilization: available === 0 ? 0 : Math.min(1, busy / available), idleMinutes: idle };
  });
}

/** Recovery gaps where the participant is certain: consecutive definite matches of a team, and winner/loser feeder links. */
function recoveryGaps(inventory: Inventory, placed: ReadonlyMap<MatchId, Placed>): RecoveryGap[] {
  const gaps: RecoveryGap[] = [];
  const byTeam = new Map<Id, { start: number; end: number; id: MatchId }[]>();
  for (const [id, p] of placed) {
    for (const slot of p.match.slots) {
      if (slot.type !== "team") continue;
      byTeam.set(slot.teamId, [...(byTeam.get(slot.teamId) ?? []), { start: p.start, end: p.end, id }]);
    }
  }
  for (const [teamId, list] of [...byTeam].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => a.start - b.start);
    const name = inventory.teamById.get(teamId)!.name;
    for (let k = 1; k < list.length; k++) {
      gaps.push({ owner: teamId, ownerName: name, gapMinutes: list[k]!.start - list[k - 1]!.end, before: list[k - 1]!.id, after: list[k]!.id });
    }
  }
  for (const [id, p] of placed) {
    for (const slot of p.match.slots) {
      if (slot.type !== "winner" && slot.type !== "loser") continue;
      const feeder = placed.get(slot.matchId);
      if (!feeder) continue;
      gaps.push({ owner: `${slot.type}:${slot.matchId}`, ownerName: `The ${slot.type} of ${slot.matchId}`, gapMinutes: p.start - feeder.end, before: slot.matchId, after: id });
    }
  }
  return gaps;
}

function minimumRequired(inventory: Inventory, gap: RecoveryGap): number {
  const rest = (id: MatchId) => {
    const match = inventory.matchById.get(id)!;
    return inventory.config.divisions.find((d) => d.id === match.divisionId)!.minRestMinutes ?? inventory.config.rules.minRestMinutes;
  };
  return Math.max(rest(gap.before), rest(gap.after));
}

function teamsSplitAcrossDays(placed: ReadonlyMap<MatchId, Placed>): number {
  const days = new Map<Id, Set<number>>();
  for (const p of placed.values()) {
    for (const slot of p.match.slots) {
      if (slot.type !== "team") continue;
      const set = days.get(slot.teamId) ?? new Set<number>();
      set.add(Math.floor(p.start / MINUTES_PER_DAY));
      days.set(slot.teamId, set);
    }
  }
  return [...days.values()].filter((set) => set.size > 1).length;
}

function teamWaits(inventory: Inventory, placed: ReadonlyMap<MatchId, Placed>): TeamWait[] {
  const byTeam = new Map<Id, { start: number; end: number }[]>();
  for (const p of placed.values()) {
    for (const slot of p.match.slots) {
      if (slot.type !== "team") continue;
      byTeam.set(slot.teamId, [...(byTeam.get(slot.teamId) ?? []), { start: p.start, end: p.end }]);
    }
  }
  const waits: TeamWait[] = [];
  for (const [teamId, list] of byTeam) {
    list.sort((a, b) => a.start - b.start);
    let longest = 0;
    let waiting = 0;
    for (let k = 1; k < list.length; k++) {
      const gap = list[k]!.start - list[k - 1]!.end;
      longest = Math.max(longest, gap);
      waiting += gap;
    }
    waits.push({ teamId, teamName: inventory.teamById.get(teamId)!.name, longestGapMinutes: longest, totalWaitMinutes: waiting, matches: list.length });
  }
  return waits.sort((a, b) => b.longestGapMinutes - a.longestGapMinutes || (a.teamId < b.teamId ? -1 : 1));
}

function divisionTimelines(inventory: Inventory, placed: ReadonlyMap<MatchId, Placed>, moment: (absolute: number) => Moment): DivisionTimeline[] {
  const out: DivisionTimeline[] = [];
  for (const division of inventory.config.divisions) {
    const own = [...placed.values()].filter((p) => p.match.divisionId === division.id);
    if (own.length === 0) continue;
    const prelim = own.filter((p) => p.match.phase === "group");
    const playoff = own.filter((p) => p.match.phase === "knockout");
    const prelimFinish = prelim.length === 0 ? null : Math.max(...prelim.map((p) => p.end));
    const playoffStart = playoff.length === 0 ? null : Math.min(...playoff.map((p) => p.start));
    const gaps: number[] = [];
    for (const p of playoff) {
      const prerequisiteEnds = p.match.dependencies.filter((d) => d.kind === "group_complete").map((d) => placed.get(d.matchId)?.end ?? Number.NaN);
      if (prerequisiteEnds.length > 0 && prerequisiteEnds.every((e) => !Number.isNaN(e))) gaps.push(p.start - Math.max(...prerequisiteEnds));
    }
    out.push({
      divisionId: division.id,
      name: division.name,
      categoryId: division.categoryId,
      matches: own.length,
      firstStart: moment(Math.min(...own.map((p) => p.start))),
      preliminaryFinish: prelimFinish === null ? null : moment(prelimFinish),
      playoffStart: playoffStart === null ? null : moment(playoffStart),
      transitionMinutes: gaps.length === 0 ? null : Math.min(...gaps),
      playoffsOverlapPreliminaries: prelimFinish !== null && playoffStart !== null && playoffStart < prelimFinish,
      finish: moment(Math.max(...own.map((p) => p.end))),
    });
  }
  return out;
}

/** Minutes between the first start and the last end that fall inside some court's open hours (overnight gaps removed). */
function openHoursSpan(inventory: Inventory, timeline: Timeline, first: number, last: number): number {
  const windows = inventory.config.courts.flatMap((c) => c.availability.map((w) => timeline.window(w))).sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = -Infinity;
  for (const w of windows) {
    const start = Math.max(w.start, cursor, first);
    const end = Math.min(w.end, last);
    if (end > start) total += end - start;
    cursor = Math.max(cursor, w.end);
  }
  return total;
}
