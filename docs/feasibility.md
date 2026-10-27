# Feasibility analysis

`analyzeFeasibility(inventory)` evaluates necessary conditions. Each check is a relaxation of the real problem:

- a **failed** check proves the requirements cannot be met;
- **passing** every check returns `no_blocking_issue_found`, which is not a guarantee. Only a schedule that passes `validateSchedule` proves feasibility.

| Check | What it bounds |
|---|---|
| `window_fit` | Some usable window (eligible court availability ∩ division play windows) is at least one match long |
| `division_capacity` | Matches of the division ≤ Σ over eligible courts and windows of ⌊(L + turnover) / (duration + turnover)⌋ |
| `shared_capacity` | For every set of courts that some divisions are restricted to (and for all courts), the court-minutes those divisions need, including turnover, fit into the usable court-minutes |
| `dependency_chain` | With unlimited courts: each team plays its group matches in sequence with rest, a group takes at least `matches / ⌊teams/2⌋` match lengths, and every knockout match waits for its prerequisites plus rest, inside the windows. Also yields `earliestFinish` per division |
| `player_load` | For players entered in several divisions (or with restrictions): the most matches they could be required to play (group matches plus the longest bracket path in each division) fit into their available time with rest, and under the daily cap |

Remedies are computed by re-running the failed check with one parameter changed and reporting the smallest change that makes that check pass on its own: shorter match duration, extra courts, a longer last day, less rest, less turnover. They are suggestions only; the configuration is never modified. A remedy that fixes one check does not guarantee the others pass.

The property test `test/property/feasibility.property.test.ts` checks that no check ever reports infeasibility for a tournament that has a validated schedule.
