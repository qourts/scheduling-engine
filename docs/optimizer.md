# Optimizer (milestone 2)

`optimizeSchedules(inventory, options)` returns up to three hard-valid schedule options for one tournament, plus a comparison. It is a deterministic heuristic, not an exact solver, and it never claims optimality.

```ts
import { buildInventory, optimizeSchedules } from "@qourts/scheduling-engine";

const result = optimizeSchedules(buildInventory(config), {
  seed: 1,
  instructions,                          // optional, see instructions.md
  budget: { totalMs: 10_000 },           // or { iterationsPerStrategy: 30_000 } for exact reproducibility
});
// result.status: "ok" | "no_schedule" | "invalid_instructions"
// result.options: [A Fastest Finish, B Balanced Operations, C Player-First]
// result.recommended, result.comparison, result.diagnostics
```

## Pipeline

1. **Compile instructions** (`compileInstructions`). Invalid instructions stop here with `invalid_instructions`.
2. **Construct** with dependency-aware list scheduling. The ready match with the largest "earliest start plus remaining critical path" goes next and is placed in the feasible slot with the lowest weighted cost. If a strategy's own weights fill the day too early, progressively simpler fallbacks follow, ending with Fastest Finish weights; the local search then reshapes that schedule under the strategy's weights.
3. **Search**: seeded local search (relocate one match, or swap two) under the strategy's weights. Every move is first tested against the hard rules, so the search never leaves the feasible region. A move is kept if it does not worsen the weighted cost. The result is a local optimum relative to these moves.
4. **Verify** every candidate with the independent `validateSchedule` and `checkInstructions`. A search result that fails verification is never returned: it is recorded in `result.rejected` and replaced by the verified construction baseline (`option.search.stopReason` is then `fallback_baseline`). If the baseline fails too, that strategy produces no option. This should never happen; it exists so that a search bug can never leak an invalid schedule or hide itself.
5. **Distinctness**: detect duplicate or materially equivalent options and try to produce real alternatives (below).
6. **Compare and recommend.**

## Result statuses

| `status` | Meaning |
|---|---|
| `ok` | At least one verified option. See `comparison` for how many are distinct |
| `no_schedule` | Nothing could be placed (or every candidate failed verification). `failure` lists unplaced matches with reasons, locked placements that conflict with other rules, and the feasibility analysis |
| `invalid_instructions` | An instruction failed validation. `instructionIssues` lists every problem; nothing was scheduled |
| `invalid_options` | The optimizer options are invalid (for example an empty `strategies` list, a NaN budget, a granularity that does not divide 1440). `optionIssues` lists every problem |

Invalid inputs are reported, never silently corrected.

## Strategies

Three objective weightings over the same measured quantities. Hard rules and mandatory instructions are never traded against any weight.

| Option | Character |
|---|---|
| A: Fastest Finish | Earliest finish, busy courts, minimal idle gaps |
| B: Balanced Operations | Balances finish, utilisation, recovery, recovery fairness and court continuity. Default recommendation |
| C: Player-First | Minimises back-to-backs and short recovery, evens out recovery, accepts a later finish |

## Metrics

Measured on every option (`option.metrics`), all in minutes unless noted.

| Metric | Definition |
|---|---|
| `finishMinute` | Absolute minute the last match ends |
| `idleMinutes` | Court time between consecutive matches on one court and day beyond the turnover |
| `utilization` | busy / (busy + idle) |
| `backToBackCount` | Recovery gaps shorter than the back-to-back threshold (default: largest minimum rest + 10) |
| `shortRecoveryCount`, `recoveryShortfallMinutes` | Gaps below the comfort threshold (default 2 × back-to-back threshold) and their total shortfall |
| `recoveryFairness` | Standard deviation of mean recovery gap across players and feeder links (lower is fairer) |
| `courtSwitches`, `avgCourtsPerDivision` | Operational continuity: division changes between consecutive matches on a court; courts used per division |
| `preferencePenalty` | Weighted violation of preference instructions |

Recovery is measured where the participant is certain: consecutive definite matches of a player, and winner/loser links between a feeder and the match it feeds. Unresolved playoff participants cannot be attributed to a player and do not enter these measures, although the hard rules still cover them for every possible outcome.

## Duplicate and equivalent options

Different weights do not guarantee different schedules, so the engine checks.

- `assignmentDistance`: fraction of matches on a different court or start.
- Two options are **materially different** only if at least 10% of matches differ **and** at least one headline measure differs beyond a threshold (finish by 15 min, idle by 30 min or 10%, counts by 1 or 10%, fairness by 2 min or 10%). Thresholds are configurable (`distinctness`).
- If an option is equivalent to another, it is reworked with amplified weights and a pull away from its twin, up to `diversityAttempts` (default 2). A reworked schedule is accepted only if it is a **genuine alternative**: materially different and not worse than the twin on every measure. A schedule that merely differs by being worse is never presented as an option.
- If equivalence remains, `comparison.equivalent` lists it and `comparison.explanation` says why, from measurements (for example "the best finish is within 12 minutes of an optimistic lower bound" or "no option has back-to-backs"). It always notes that failing to find a different schedule does not prove none exists.
- `comparison.relations` gives, for each pair, the distance, the measures that differ, the Pareto relation (`a_dominates`, `b_dominates`, `trade_off`, `equivalent`) and a measured plain-language trade-off.
- `recommended` is Balanced unless another option is at least as good on every measure and better on one, in which case that option is recommended and the reason says so.

## Budgets, determinism and degradation

- `budget.totalMs` caps wall-clock time (default 8 s up to 300 matches, 24 s above). Reaching it is not an error: the best valid schedule found so far is returned and `option.budgetExhausted` is true. The cap applies to the search and diversification phases; construction and verification cannot be interrupted, so a very small cap can be exceeded. `diagnostics.budgetOverrunMs` reports by how much.
- `budget.iterationsPerStrategy` caps local-search moves (default 30,000). With this set and `totalMs` unset the run is bit-for-bit reproducible for a seed. With a time cap, reproducibility holds only when the iteration cap is reached first.
- `option.search.stopReason` is `iterations`, `time` or `converged` (no improvement for a long stretch).
- The core is a pure function of its inputs: nothing is mutated, and the clock is only used to enforce the safety cap (inject `clock` in tests).

## Performance targets and benchmark

Targets (engineering goals, **not guarantees**): typical tournament (5-10 courts, 100-300 matches) complete three-option generation and evaluation within 10 s; large tournament (up to 20 courts, 500 matches) within 30 s. `npm run bench` builds the package and measures synthetic tournaments (`bench/generate.mjs`), verifying every option with the independent validator.

Measured on: **Node v24.16.0, win32 x64, AMD Ryzen 7 6800H (16 threads), 23.2 GiB RAM**, default budgets, seed 1:

| Case | Matches | Courts | Days | Time | Target | Independently valid |
|---|---|---|---|---|---|---|
| typical-small | 109 | 5 | 2 | 1.9 s | 10 s | yes (3 options) |
| typical-mid | 210 | 8 | 2 | 4.9 s | 10 s | yes (3 options) |
| typical-upper | 303 | 10 | 3 | 7.0 s | 10 s | yes (3 options) |
| large | 513 | 20 | 2 | 12.9 s | 30 s | yes (3 options) |

Other machines, Node versions or tournaments with more cross-division players, tighter capacity or dense mandatory instructions will differ. Run `npm run bench` to measure your own. The generated tournaments have at most two divisions per player and about 45-65% court utilisation; a tournament near its capacity limit is harder.

### Extending the limits

Everything that scales is behind small seams: the strategy weights (`STRATEGIES`), the search moves (`search.ts`), the construction order (`construct.ts`), and the budget. Larger events can raise the budget, add moves, or put an exact solver behind the same `ScheduleOption` contract (see ADR 0005) without changing the validator, the instruction model or the result types.
