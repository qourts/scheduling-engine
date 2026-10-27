# Assumptions and known limitations

## Assumptions

- Times are integer minutes in the venue's local time. Timezones and DST are handled by adapters. Matches do not cross midnight.
- Each match occupies its court for exactly `matchDurationMinutes` (playing time plus warm-up); turnover is separate.
- Rest between two matches of a player is the larger of the two divisions' minimum rest. Rest also applies after every match of a feeding group before a qualifier-fed knockout match, because any group team could qualify.
- A player may be entered in several divisions, but on only one team per division.
- Unresolved participants are treated conservatively: a schedule must be valid for every outcome. This can over-constrain multi-division players before results are known; recorded results narrow the sets.

## Known limitations (milestone 1)

- **No product scheduler yet.** The two schedulers under `test/support/` are test fixtures only. Fastest Finish, Balanced Operations and Player-First arrive in milestone 2 (originally labelled milestone 3).
- **Soft constraints are not measured yet** (back-to-backs, fairness, utilisation).
- **Feasibility is necessary, not sufficient.** Checks are relaxations: the chain bound ignores court contention, capacity ignores dependencies, player load uses the shortest match duration of the player's divisions and merges their windows.
- **Formats not yet supported:** double elimination, consolation/back-draw brackets, best-third-placed qualification, re-seeding qualifiers by record, more than two stages, pool-play crossovers other than top *k* per group.
- **Tiebreakers:** head-to-head counts wins among tied teams; game and point differences are over all group matches, not only among tied teams. Walkovers count as a win without games or points, which favours opponents in point-based tiebreakers.
- **Scoring validation** checks game counts and winners only, not point rules (to 11, win by 2, rally scoring).
- **Corrections** that would change participants of an already completed match are rejected; there is no void-and-replay workflow yet.
- **Locks** are supported by the validator (`frozen`) but are not yet events in the progression log.
- **Daily cap** counts matches by the day they start.
- **Crossover** search is exhaustive only up to 50,000 tier arrangements (for example up to 8 groups × 2, or 5 groups × 3); larger cases use a swap heuristic.
- **Performance** has been measured at about 320 matches (build, feasibility and validation each well under 100 ms on a sparse schedule). Dense 600-match schedules have not been benchmarked yet.
