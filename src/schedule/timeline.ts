import type { TimeWindow, TournamentConfig } from "../config/types.js";
import { MINUTES_PER_DAY, type Interval } from "../util/time.js";

/** Converts day-relative windows to absolute minutes from the first tournament day. */
export class Timeline {
  private readonly dayIndex: Map<string, number>;

  constructor(readonly config: TournamentConfig) {
    this.dayIndex = new Map(config.days.map((d, i) => [d, i]));
  }

  hasDay(day: string): boolean {
    return this.dayIndex.has(day);
  }

  absolute(day: string, minute: number): number {
    const index = this.dayIndex.get(day);
    if (index === undefined) throw new Error(`Unknown day ${day}`);
    return index * MINUTES_PER_DAY + minute;
  }

  window(w: TimeWindow): Interval {
    return { start: this.absolute(w.day, w.start), end: this.absolute(w.day, w.end) };
  }

  dayOf(absolute: number): string {
    return this.config.days[Math.floor(absolute / MINUTES_PER_DAY)]!;
  }

  wholeTournament(): Interval {
    return { start: 0, end: this.config.days.length * MINUTES_PER_DAY };
  }
}
