import type { Id } from "../config/types.js";
import { weightOf } from "../instructions/types.js";
import type { PlanContext } from "./context.js";

/**
 * Soft-constraint measurement. Everything here is measured on a complete,
 * hard-valid placement. Times are minutes.
 *
 * Recovery gaps are measured where the participant is certain: consecutive
 * definite matches of a player (group matches and fixed first-round slots) and
 * winner/loser links between a feeder and the match it feeds.
 */

export interface ScheduleMetrics {
  /** Absolute minute at which the last match ends. */
  finishMinute: number;
  /** Absolute minute at which the first match starts. */
  startMinute: number;
  divisionFinish: Record<Id, number>;
  busyMinutes: number;
  /** Court time between consecutive matches on the same court and day beyond the required turnover. */
  idleMinutes: number;
  /** busy / (busy + idle), 0..1. */
  utilization: number;
  recoveryGapCount: number;
  backToBackCount: number;
  shortRecoveryCount: number;
  minRecoveryGap: number | null;
  meanRecoveryGap: number | null;
  /** Minutes by which gaps fall short of the comfortable recovery, summed. */
  recoveryShortfallMinutes: number;
  /** Standard deviation of mean recovery gap across players and feeder links; lower is fairer. */
  recoveryFairness: number;
  /** Adjacent matches on one court (same day) that belong to different divisions. */
  courtSwitches: number;
  avgCourtsPerDivision: number;
  /** Teams whose preliminary matches fall on more than one calendar day. */
  teamsSplitAcrossDays: number;
  /** Weighted violation of preference instructions (0 = all satisfied). */
  preferencePenalty: number;
}

export interface Weights {
  /** Per hour of absolute finish time. */
  finish: number;
  /** Per court-hour of idle time. */
  idle: number;
  backToBack: number;
  shortRecovery: number;
  /** Per hour of recovery shortfall. */
  shortfall: number;
  /** Per minute of fairness standard deviation, divided by 10. */
  fairness: number;
  courtSwitch: number;
}

/** Preference weights given by organizers are in "cost per violation hour"; this scales them against the objective weights. */
export const PREFERENCE_SCALE = 5;

export interface Placement {
  readonly start: readonly number[];
  readonly court: readonly number[];
}

export function computeMetrics(ctx: PlanContext, placement: Placement): ScheduleMetrics {
  const { start, court } = placement;
  const n = ctx.size;

  let finish = 0;
  let first = Infinity;
  const divisionFinish: Record<Id, number> = {};
  const courtLists: number[][] = ctx.courts.map(() => []);
  let busy = 0;
  for (let i = 0; i < n; i++) {
    const s = start[i]!;
    const e = s + ctx.duration[i]!;
    finish = Math.max(finish, e);
    first = Math.min(first, s);
    busy += ctx.duration[i]!;
    const division = ctx.divisionOf[i]!;
    divisionFinish[division] = Math.max(divisionFinish[division] ?? 0, e);
    courtLists[court[i]!]!.push(i);
  }

  let idle = 0;
  let switches = 0;
  const courtsOfDivision = new Map<Id, Set<number>>();
  for (let c = 0; c < courtLists.length; c++) {
    const list = courtLists[c]!.sort((a, b) => start[a]! - start[b]!);
    for (let k = 0; k < list.length; k++) {
      const i = list[k]!;
      const set = courtsOfDivision.get(ctx.divisionOf[i]!) ?? new Set<number>();
      set.add(c);
      courtsOfDivision.set(ctx.divisionOf[i]!, set);
      if (k === 0) continue;
      const p = list[k - 1]!;
      if (Math.floor(start[p]! / 1440) !== Math.floor(start[i]! / 1440)) continue;
      idle += Math.max(0, start[i]! - (start[p]! + ctx.duration[p]!) - ctx.turnover);
      if (ctx.divisionOf[p] !== ctx.divisionOf[i]) switches++;
    }
  }
  let courtCounts = 0;
  for (const set of courtsOfDivision.values()) courtCounts += set.size;

  const owners: number[][] = [];
  for (const list of ctx.playerMatches.values()) {
    const sorted = [...list].sort((a, b) => start[a]! - start[b]!);
    const gaps: number[] = [];
    for (let k = 1; k < sorted.length; k++) gaps.push(start[sorted[k]!]! - (start[sorted[k - 1]!]! + ctx.duration[sorted[k - 1]!]!));
    if (gaps.length > 0) owners.push(gaps);
  }
  for (let m = 0; m < n; m++) {
    for (const link of ctx.preds[m]!) {
      if (link.sameParticipant) owners.push([start[m]! - (start[link.other]! + ctx.duration[link.other]!)]);
    }
  }

  let gapCount = 0;
  let b2b = 0;
  let short = 0;
  let minGap = Infinity;
  let sumGap = 0;
  let shortfall = 0;
  const means: number[] = [];
  for (const gaps of owners) {
    let sum = 0;
    for (const g of gaps) {
      gapCount++;
      sum += g;
      sumGap += g;
      minGap = Math.min(minGap, g);
      if (g < ctx.backToBack) b2b++;
      if (g < ctx.comfortRest) {
        short++;
        shortfall += ctx.comfortRest - g;
      }
    }
    means.push(sum / gaps.length);
  }
  const meanOfMeans = means.length === 0 ? 0 : means.reduce((a, b) => a + b, 0) / means.length;
  const fairness = means.length === 0 ? 0 : Math.sqrt(means.reduce((a, b) => a + (b - meanOfMeans) ** 2, 0) / means.length);

  return {
    finishMinute: finish,
    startMinute: Number.isFinite(first) ? first : 0,
    divisionFinish,
    busyMinutes: busy,
    idleMinutes: idle,
    utilization: busy + idle === 0 ? 1 : busy / (busy + idle),
    recoveryGapCount: gapCount,
    backToBackCount: b2b,
    shortRecoveryCount: short,
    minRecoveryGap: gapCount === 0 ? null : minGap,
    meanRecoveryGap: gapCount === 0 ? null : sumGap / gapCount,
    recoveryShortfallMinutes: shortfall,
    recoveryFairness: fairness,
    courtSwitches: switches,
    avgCourtsPerDivision: courtsOfDivision.size === 0 ? 0 : courtCounts / courtsOfDivision.size,
    teamsSplitAcrossDays: splitTeams(ctx, placement, null),
    preferencePenalty: preferencePenalty(ctx, placement),
  };
}

function preferencePenalty(ctx: PlanContext, placement: Placement): number {
  const { start, court } = placement;
  let penalty = 0;
  for (let i = 0; i < ctx.size; i++) {
    const prefs = ctx.constraints.localPreferences.get(ctx.matches[i]!.id);
    if (!prefs) continue;
    const courtId = ctx.courts[court[i]!]!.id;
    for (const p of prefs) penalty += p(courtId, start[i]!, ctx.duration[i]!);
  }

  for (const pref of ctx.constraints.globalPreferences) {
    const weight = weightOf(pref);
    if (pref.kind === "min_rest") {
      // Division-specific targets are approximated by the global recovery gaps of the divisions' players.
      const divisions = new Set(pref.divisionIds);
      let shortfall = 0;
      for (const list of ctx.playerMatches.values()) {
        const sorted = list.filter((i) => divisions.has(ctx.divisionOf[i]!)).sort((a, b) => start[a]! - start[b]!);
        for (let k = 1; k < sorted.length; k++) {
          const gap = start[sorted[k]!]! - (start[sorted[k - 1]!]! + ctx.duration[sorted[k - 1]!]!);
          if (gap < pref.minutes) shortfall += pref.minutes - gap;
        }
      }
      for (let m = 0; m < ctx.size; m++) {
        if (!divisions.has(ctx.divisionOf[m]!)) continue;
        for (const link of ctx.preds[m]!) {
          if (!link.sameParticipant) continue;
          const gap = start[m]! - (start[link.other]! + ctx.duration[link.other]!);
          if (gap < pref.minutes) shortfall += pref.minutes - gap;
        }
      }
      penalty += (weight * shortfall) / 60;
    } else if (pref.kind === "same_day_preliminaries") {
      penalty += weight * splitTeams(ctx, placement, pref.divisionIds ? new Set(pref.divisionIds) : null);
    } else if (pref.kind === "consecutive_blocks") {
      const spans = pref.divisionIds.map((id) => {
        let s = Infinity;
        let e = 0;
        for (let i = 0; i < ctx.size; i++) {
          if (ctx.divisionOf[i] !== id) continue;
          s = Math.min(s, start[i]!);
          e = Math.max(e, start[i]! + ctx.duration[i]!);
        }
        return { s, e };
      });
      let bad = 0;
      for (let a = 0; a < spans.length; a++) {
        for (let b = a + 1; b < spans.length; b++) {
          const x = spans[a]!;
          const y = spans[b]!;
          if (!Number.isFinite(x.s) || !Number.isFinite(y.s)) continue;
          bad += Math.max(0, Math.min(x.e, y.e) - Math.max(x.s, y.s)) + Math.max(0, x.s - y.s);
        }
      }
      penalty += (weight * bad) / 60;
    }
  }
  return penalty;
}

/** Number of teams (optionally only in the given divisions) whose preliminary matches span more than one day. */
function splitTeams(ctx: PlanContext, placement: Placement, divisions: ReadonlySet<Id> | null): number {
  let split = 0;
  for (const list of ctx.teamPoolMatches.values()) {
    if (divisions !== null && !divisions.has(ctx.divisionOf[list[0]!]!)) continue;
    const first = Math.floor(placement.start[list[0]!]! / 1440);
    if (list.some((i) => Math.floor(placement.start[i]! / 1440) !== first)) split++;
  }
  return split;
}

/** Weighted scalar cost used by construction and local search (lower is better). */
export function objectiveCost(m: ScheduleMetrics, w: Weights): number {
  return (
    w.finish * (m.finishMinute / 60) +
    w.idle * (m.idleMinutes / 60) +
    w.backToBack * m.backToBackCount +
    w.shortRecovery * m.shortRecoveryCount +
    w.shortfall * (m.recoveryShortfallMinutes / 60) +
    w.fairness * (m.recoveryFairness / 10) +
    w.courtSwitch * m.courtSwitches +
    PREFERENCE_SCALE * m.preferencePenalty
  );
}
