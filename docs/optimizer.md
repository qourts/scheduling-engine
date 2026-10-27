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

## Why no schedule was returned

`no_schedule` always carries a `failure` whose `kind` says what is and is not established:

| `failure.kind` | Meaning |
|---|---|
| `proven_infeasible` | A necessary condition fails (court capacity, a division that cannot fit its windows, a match with no court and start time that satisfy the rules, a player who cannot play every possible match). This is a proof. `failure.proof` lists the failed conditions and `failure.feasibility` gives quantified remedies |
| `contradictory_instructions` | Locked placements contradict the rules or each other. Most such contradictions are caught earlier, by `validateInstructions`, as `invalid_instructions` with a message naming the instruction and what to change |
| `verification_failed` | Schedules were constructed but the independent validators rejected every candidate (see `rejected`). It should never happen, and it is not a proof of impossibility |
| `not_found` | The construction heuristics did not place every match. **This is not a proof that no schedule exists.** The statement says so and suggests relaxing windows, adding court time or day length, or raising the budget |

Construction is bounded: six deterministic attempts (the strategy's own weights, then Fastest Finish weights, in different placement orders) followed by eight seeded randomised retries. In measured tight cases the deterministic alternative orders did the rescuing (for example a day-length at which the default order left 48 matches unplaced and the time-sweep order placed all 288). An evict-and-reinsert repair step was also tried and removed because it placed nothing extra in any measured case.

A search that merely ran out of time is not a failure: the options are valid, `diagnostics.timeLimited` is true and `option.budgetExhausted` marks the affected options.

### Proofs that use the dependency chain

Besides capacity, the feasibility analysis applies a tail bound to divisions that share the same courts and windows (for example every division of a category that has its own window). The last of their first-round matches (those with no prerequisite) cannot end before the courts have had time to play all first-round work, and the longest chain of dependent matches (recovery plus duration of each step) must still run after it. If that finish lies beyond the window, no schedule exists. For a category of 60 pool matches, 20 minutes each on 10 courts, a 20-minute semifinal and a 30-minute medal match, the pools cannot end before 120 minutes and the chain needs `50 + 2 x recovery` more: 70 minutes at 10 minutes of recovery, which exceeds a 180-minute window by 10 minutes. The remedies quantify the smallest changes (here recovery 5 minutes, or 10 more minutes per window). The bound ignores turnover, window gaps and every instruction, so it only ever fires when a schedule really cannot exist. A run that finds a proof reports it without climbing the construction ladder.

## Recovery definition

Recovery is measured from the **end of allocated court time** of a player's previous match (start + the match's duration, which already contains any warm-up or changeover the configuration puts into the duration) to the **start** of the next match. Court turnover is a court buffer, not player rest: it is neither added to nor subtracted from recovery, and the hard rest rule uses the same basis. Active play ends no later than the allocated end, so the recovery reported is a lower bound on rest measured from the end of active play. If a venue wants rest to start after an assumed active-play end, shorten the match duration and carry the difference in `minRestMinutes`.

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

## Schedule report

`analyzeSchedule(inventory, schedule)` describes any schedule (optimizer output or manually edited), computed from the schedule alone: planned start and finish, span, per-court matches, utilisation and idle minutes, recovery minimum, mean and maximum, back-to-back occurrences and affected teams, the teams with the shortest recovery and the longest waits, teams whose pool play is split across days, completion and preliminary-to-playoff transition per division and category, and warnings. A playoff transition is measured per first-round knockout match against the pools it depends on, because a semifinal only waits for its own pools. Warnings are `risk` (back-to-backs, unscheduled matches) or `info`.

## Same-day pool play

`same_day_preliminaries` (a preference) keeps each team's preliminary matches on one calendar day. `metrics.teamsSplitAcrossDays` and `analyzeSchedule(...).recovery.teamsSplitAcrossDays` report how many teams are split. On the two-day stress scenario the preference cut the split teams from 32/57/6 (Fastest Finish, Balanced, Player-First) to 2/4/0 without delaying Fastest Finish. A one-day event can never split a team.

## Fastest Finish guarantee

After the other options are final, Fastest Finish is checked against them. If any returned option finishes earlier, the search continues from that option's schedule under Fastest Finish weights. If that cannot reproduce the earlier finish the exception is stated in `comparison.explanation`. Overall duration and total idle court-minutes are different measures, and Fastest Finish is not guaranteed to have the least idle time.

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
- `diagnostics.timing` reports construction, search, verification and diversification time separately. The deterministic construction attempts are not interrupted by the search cap (the randomised retries are); in the measured cases construction took under half a second for 288 matches and a few percent of the total, and `budgetOverrunMs` reports any overrun.
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
