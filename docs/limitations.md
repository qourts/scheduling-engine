# Assumptions and known limitations

## Assumptions

- Times are integer minutes in the venue's local time. Timezones and DST are handled by adapters. Matches do not cross midnight.
- Each match occupies its court for exactly `matchDurationMinutes` (playing time plus warm-up); turnover is separate.
- Rest between two matches of a player is the larger of the two divisions' minimum rest. Rest also applies after every match of a feeding group before a qualifier-fed knockout match, because any group team could qualify.
- A player may be entered in several divisions, but on only one team per division.
- Unresolved participants are treated conservatively: a schedule must be valid for every outcome. This can over-constrain multi-division players before results are known; recorded results narrow the sets.

## Known limitations (milestone 1)

- The two schedulers under `test/support/` are test fixtures only; the product optimizer is described under milestone 2 below.
- **Feasibility is necessary, not sufficient.** Checks are relaxations: the chain bound ignores court contention, capacity ignores dependencies, player load uses the shortest match duration of the player's divisions and merges their windows.
- **Formats not yet supported:** double elimination, consolation/back-draw brackets, best-third-placed qualification, re-seeding qualifiers by record, more than two stages, pool-play crossovers other than top *k* per group.
- **Tiebreakers:** head-to-head counts wins among tied teams; game and point differences are over all group matches, not only among tied teams. Walkovers count as a win without games or points, which favours opponents in point-based tiebreakers.
- **Scoring validation** checks game counts and winners only, not point rules (to 11, win by 2, rally scoring).
- **Corrections** that would change participants of an already completed match are rejected; there is no void-and-replay workflow yet.
- **Locks** are supported by the validator (`frozen`) but are not yet events in the progression log.
- **Daily cap** counts matches by the day they start.
- **Crossover** search is exhaustive only up to 50,000 tier arrangements (for example up to 8 groups × 2, or 5 groups × 3); larger cases use a swap heuristic.
- **Performance** of the milestone 1 modules was measured at about 320 matches (build, feasibility and validation each well under 100 ms on a sparse schedule). Optimizer timings are in [Optimizer](optimizer.md).

## Known limitations (milestone 2)

- **Heuristic.** The optimizer reaches a local optimum of its moves under a budget. It never proves optimality, and an option that looks improvable may be. Reported lower bounds are optimistic and ignore court contention, rest and availability gaps.
- **Construction can fail on very tight events** even when a schedule exists: placement is greedy with alternative orders and bounded randomised retries, and no backtracking. In the 288-match acceptance scenario day lengths ending 14:10 and 14:30 (about 94-99% of court capacity) end as `not_found`, while 14:40 is scheduled; whether the 14:30 case is truly infeasible is unknown. The engine reports `not_found` (explicitly not a proof) with reasons and the feasibility analysis, never an invalid schedule.
- **Pool play can be split overnight.** Nothing in the objectives discourages a team's preliminary matches falling on different days. In the acceptance scenario Fastest Finish splits 47 of 160 teams across both days (longest wait 1305 minutes), Balanced 57, and Player-First none (longest wait 485 minutes). A same-day pool-play objective is a recommended refinement.
- **Playoff transition guarantees are the rest rule.** A first-round knockout match can start as soon as the pools it depends on finish plus the minimum rest, so a qualifier may get no more than that.
- **The deterministic construction attempts are not covered by the search time cap** (see `diagnostics.timing`; about 0.4 s for 288 matches). The randomised retries do stop at the cap, so a very small budget can shorten them or skip them.
- **Default-budget runs are not bit-for-bit reproducible.** With the time cap the search stops on the clock, so repeated runs can differ slightly (the same 288-match run gave 1330 and 1335 idle court-minutes for Balanced). Use `budget.iterationsPerStrategy` alone for exact reproduction.
- **Fastest Finish does not guarantee the least idle time.** Its search weights finish time first. In the 513-match benchmark case Balanced had less measured idle time than Fastest Finish.
- **Distinctness is not guaranteed.** On capacity-bound or trivially small tournaments the three options can be equivalent. The engine says so and why instead of inventing differences.
- **Recovery is measured for certain participants only** (group and fixed first-round matches, and winner/loser links). Unresolved playoff participants are covered by the hard rules for every outcome but not by the recovery metrics.
- **Instruction support:** mandatory `consecutive_blocks` and preference `locked_placement` are rejected. Division-specific minimum-rest preferences are measured over the players' definite matches and feeder links only.
- **Daily cap in the optimizer** mirrors the validator's rule exactly (including possible bracket paths) but is evaluated incrementally, which makes dense caps slower to schedule.
- **Reproducibility under a time cap:** with `budget.totalMs` set, results are bit-for-bit reproducible only if the iteration cap is reached first. Use `budget.iterationsPerStrategy` alone for exact reproducibility.
- **Timing targets are engineering targets**, measured on one machine (see [Optimizer](optimizer.md)), not guarantees.
