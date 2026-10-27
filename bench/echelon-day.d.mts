import type { SchedulingInstruction, TournamentConfig } from "../src/index.js";

export const EVENT_DAY: string;
export const DAY_START: number;
export const DAY_END: number;
export const CATEGORY_WINDOWS: { id: string; name: string; gender: string; start: number; end: number }[];
export const SKILLS: { id: string; name: string; brackets: number; wildcard: boolean }[];

export interface EchelonDayOptions {
  minRest?: number;
  turnover?: number;
  slotMinutes?: number;
  playMinutes?: number;
  transitionMinutes?: number;
  medalMinutes?: number;
  courts?: number;
  windowExtendMinutes?: number;
  sharedPlayers?: boolean;
  windows?: boolean;
  eventEndExtendMinutes?: number;
  categoryWindowMinutes?: number;
}

export function buildEchelonDayConfig(options?: EchelonDayOptions): TournamentConfig;
export function echelonDayPreferences(): SchedulingInstruction[];
