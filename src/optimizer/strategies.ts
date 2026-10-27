import type { Weights } from "./metrics.js";

export type StrategyId = "fastest_finish" | "balanced_operations" | "player_first";

export interface Strategy {
  id: StrategyId;
  /** Option label shown to organizers. */
  label: "A" | "B" | "C";
  name: string;
  summary: string;
  /** Objective weights for construction and local search. */
  weights: Weights;
  /** Feasible start times examined per court when placing a match. */
  candidatesPerCourt: number;
}

/**
 * The three mandatory options as three objective weightings. Weights are
 * relative: finish is per hour, idle per court-hour, recovery terms per
 * occurrence or hour of shortfall. Hard rules and mandatory instructions are
 * never traded against any weight.
 */
export const STRATEGIES: Readonly<Record<StrategyId, Strategy>> = {
  fastest_finish: {
    id: "fastest_finish",
    label: "A",
    name: "Fastest Finish",
    summary: "Earliest feasible tournament completion with courts kept busy and idle gaps minimised.",
    weights: { finish: 20, idle: 4, backToBack: 0.2, shortRecovery: 0.1, shortfall: 0.1, fairness: 0.05, courtSwitch: 0.02 },
    candidatesPerCourt: 1,
  },
  balanced_operations: {
    id: "balanced_operations",
    label: "B",
    name: "Balanced Operations",
    summary: "Balances completion time, court utilisation, player recovery, recovery fairness and court continuity. The default recommendation.",
    weights: { finish: 6, idle: 2, backToBack: 1.5, shortRecovery: 0.6, shortfall: 0.6, fairness: 0.8, courtSwitch: 0.15 },
    candidatesPerCourt: 3,
  },
  player_first: {
    id: "player_first",
    label: "C",
    name: "Player-First",
    summary: "Minimises back-to-back matches and short recovery and evens out recovery across players, accepting a later finish when that helps.",
    weights: { finish: 1, idle: 0.3, backToBack: 6, shortRecovery: 2.5, shortfall: 2, fairness: 2, courtSwitch: 0.02 },
    candidatesPerCourt: 5,
  },
};

export const STRATEGY_ORDER: readonly StrategyId[] = ["fastest_finish", "balanced_operations", "player_first"];
