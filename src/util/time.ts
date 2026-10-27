/**
 * Time inside the engine is integer minutes. A wall-clock time is minutes since
 * local midnight of a tournament day; an absolute time is minutes since midnight
 * of the first tournament day. Timezones and DST are handled by adapters.
 */

export const MINUTES_PER_DAY = 1440;

/** Parses "HH:MM" (24h) into minutes since midnight. "24:00" is allowed as end of day. */
export function parseClock(text: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) throw new Error(`Invalid clock time "${text}", expected HH:MM`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) {
    throw new Error(`Invalid clock time "${text}"`);
  }
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** A half-open interval [start, end) in absolute minutes. */
export interface Interval {
  start: number;
  end: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Sorts and merges intervals; touching intervals are merged. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const current of sorted) {
    const last = out[out.length - 1];
    if (last && current.start <= last.end) last.end = Math.max(last.end, current.end);
    else out.push({ ...current });
  }
  return out;
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = mergeIntervals(a);
  const right = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i]!;
    const y = right[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (start < end) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

export function subtractIntervals(base: readonly Interval[], remove: readonly Interval[]): Interval[] {
  let result = mergeIntervals(base);
  for (const cut of mergeIntervals(remove)) {
    const next: Interval[] = [];
    for (const piece of result) {
      if (!overlaps(piece, cut)) {
        next.push(piece);
        continue;
      }
      if (piece.start < cut.start) next.push({ start: piece.start, end: cut.start });
      if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end });
    }
    result = next;
  }
  return result;
}

export function totalLength(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}
