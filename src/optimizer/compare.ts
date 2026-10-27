import type { ScheduleMetrics } from "./metrics.js";
import type { Placement } from "./metrics.js";

/**
 * Comparing options: how different two schedules really are, which one (if
 * any) is strictly better, and what the trade-off is. Different objective
 * weights do not guarantee different schedules, so this module decides when two
 * options are materially equivalent. Nothing here claims optimality.
 */

export interface DistinctnessThresholds {
  /** Minimum fraction of matches whose court or start time differs. Default 0.1. */
  minAssignmentDistance: number;
  /** Finish times closer than this many minutes are the same. Default 15. */
  finishMinutes: number;
  /** Counts (back-to-backs, short recoveries, court switches) differing by less than max(minCount, relative) are the same. */
  minCount: number;
  /** Relative difference below which measures are the same. Default 0.1. */
  relative: number;
  /** Idle times closer than this many minutes are the same. Default 30. */
  idleMinutes: number;
}

export const DEFAULT_THRESHOLDS: DistinctnessThresholds = {
  minAssignmentDistance: 0.1,
  finishMinutes: 15,
  minCount: 1,
  relative: 0.1,
  idleMinutes: 30,
};

export type Headline = "finish_time" | "idle_time" | "back_to_backs" | "short_recoveries" | "recovery_fairness" | "court_continuity" | "preferences";

/** Fraction of matches placed on a different court or at a different time. */
export function assignmentDistance(a: Placement, b: Placement): number {
  const n = a.start.length;
  if (n === 0) return 0;
  let different = 0;
  for (let i = 0; i < n; i++) if (a.start[i] !== b.start[i] || a.court[i] !== b.court[i]) different++;
  return different / n;
}

/** Headline measures on which two schedules differ by more than the thresholds. */
export function materialDifferences(a: ScheduleMetrics, b: ScheduleMetrics, t: DistinctnessThresholds = DEFAULT_THRESHOLDS): Headline[] {
  const out: Headline[] = [];
  const countDiffers = (x: number, y: number) => Math.abs(x - y) >= Math.max(t.minCount, t.relative * Math.max(x, y));
  if (Math.abs(a.finishMinute - b.finishMinute) >= t.finishMinutes) out.push("finish_time");
  if (Math.abs(a.idleMinutes - b.idleMinutes) >= Math.max(t.idleMinutes, t.relative * Math.max(a.idleMinutes, b.idleMinutes))) out.push("idle_time");
  if (countDiffers(a.backToBackCount, b.backToBackCount)) out.push("back_to_backs");
  if (countDiffers(a.shortRecoveryCount, b.shortRecoveryCount)) out.push("short_recoveries");
  if (Math.abs(a.recoveryFairness - b.recoveryFairness) >= Math.max(2, t.relative * Math.max(a.recoveryFairness, b.recoveryFairness))) out.push("recovery_fairness");
  if (countDiffers(a.courtSwitches, b.courtSwitches)) out.push("court_continuity");
  if (Math.abs(a.preferencePenalty - b.preferencePenalty) >= Math.max(0.5, t.relative * Math.max(a.preferencePenalty, b.preferencePenalty))) out.push("preferences");
  return out;
}

export type Dominance = "a_dominates" | "b_dominates" | "trade_off" | "equivalent";

/** Objective vector for dominance: every entry is "lower is better". */
export function objectiveVector(m: ScheduleMetrics): number[] {
  return [m.finishMinute, m.idleMinutes, m.backToBackCount, m.recoveryShortfallMinutes, m.recoveryFairness, m.courtSwitches, m.preferencePenalty];
}

export function dominance(a: ScheduleMetrics, b: ScheduleMetrics): Dominance {
  const va = objectiveVector(a);
  const vb = objectiveVector(b);
  let aBetter = false;
  let bBetter = false;
  for (let i = 0; i < va.length; i++) {
    if (va[i]! < vb[i]! - 1e-9) aBetter = true;
    else if (vb[i]! < va[i]! - 1e-9) bBetter = true;
  }
  if (aBetter && bBetter) return "trade_off";
  if (aBetter) return "a_dominates";
  if (bBetter) return "b_dominates";
  return "equivalent";
}

const HEADLINE_TEXT: Record<Headline, string> = {
  finish_time: "finish time",
  idle_time: "court idle time",
  back_to_backs: "back-to-back matches",
  short_recoveries: "short recoveries",
  recovery_fairness: "recovery fairness",
  court_continuity: "court continuity",
  preferences: "preference satisfaction",
};

export const headlineText = (h: Headline): string => HEADLINE_TEXT[h];

/** Plain-language, measurement-based description of how `b` differs from `a`. */
export function describeTradeOff(nameA: string, a: ScheduleMetrics, nameB: string, b: ScheduleMetrics, differences: readonly Headline[]): string {
  if (differences.length === 0) return `${nameA} and ${nameB} do not differ materially on any measured objective.`;
  const parts: string[] = [];
  const hours = (m: number) => `${Math.abs(Math.round(m))} min`;
  for (const d of differences) {
    switch (d) {
      case "finish_time":
        parts.push(`finishes ${hours(b.finishMinute - a.finishMinute)} ${b.finishMinute >= a.finishMinute ? "later" : "earlier"}`);
        break;
      case "idle_time":
        parts.push(`${hours(b.idleMinutes - a.idleMinutes)} ${b.idleMinutes >= a.idleMinutes ? "more" : "less"} court idle time`);
        break;
      case "back_to_backs":
        parts.push(`${Math.abs(b.backToBackCount - a.backToBackCount)} ${b.backToBackCount >= a.backToBackCount ? "more" : "fewer"} back-to-back matches`);
        break;
      case "short_recoveries":
        parts.push(`${Math.abs(b.shortRecoveryCount - a.shortRecoveryCount)} ${b.shortRecoveryCount >= a.shortRecoveryCount ? "more" : "fewer"} short recoveries`);
        break;
      case "recovery_fairness":
        parts.push(`${b.recoveryFairness <= a.recoveryFairness ? "fairer" : "less fair"} recovery (spread ${b.recoveryFairness.toFixed(1)} vs ${a.recoveryFairness.toFixed(1)} min)`);
        break;
      case "court_continuity":
        parts.push(`${Math.abs(b.courtSwitches - a.courtSwitches)} ${b.courtSwitches >= a.courtSwitches ? "more" : "fewer"} division changes between consecutive matches on a court`);
        break;
      case "preferences":
        parts.push(`${b.preferencePenalty <= a.preferencePenalty ? "better" : "worse"} preference satisfaction`);
        break;
    }
  }
  return `Compared with ${nameA}, ${nameB}: ${parts.join("; ")}.`;
}
