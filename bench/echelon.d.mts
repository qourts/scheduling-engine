import type { Inventory, Schedule, SchedulingInstruction, TournamentConfig } from "../src/index.js";

export const DAY1: string;
export const DAY2: string;
export const CATEGORY_LIST: TournamentConfig["categories"];
export const SKILLS: { id: string; name: string; pools: number; perPool: number }[];

export interface EchelonOptions {
  courts?: number;
  days?: number;
  dayStart?: number;
  dayEnd?: number;
  matchMinutes?: number;
  medalMinutes?: number;
  minRest?: number;
  turnover?: number;
}

export function buildEchelonConfig(options?: EchelonOptions): TournamentConfig;
export function categoryWindows(): SchedulingInstruction[];
export function instructionCases(): { id: string; request: string; instructions: SchedulingInstruction[] }[];
export function blockOverlapMinutes(inventory: Inventory, schedule: Schedule, divisionIds: string[]): number;
export function verifyEnforcement(caseId: string, inventory: Inventory, schedule: Schedule, baseline?: Schedule): { ok: boolean; detail: string };
export function actualConflicts(
  api: { initialState: (inventory: Inventory) => any; applyEvent: (inventory: Inventory, state: any, event: any) => any },
  inventory: Inventory,
  schedule: Schedule,
  seed: number,
): string[];
export function problemCases(): { id: string; request: string; instructions: SchedulingInstruction[]; expect: string }[];
