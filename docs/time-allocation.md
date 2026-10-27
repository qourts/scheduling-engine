# Time-allocation model

Five different quantities are easy to confuse, and counting one of them twice silently removes court time or participant rest. The engine keeps them apart.

| Quantity | Where it is configured | Meaning |
|---|---|---|
| Active playing time | `Division.playMinutes` (optional) | Informational. The time actually spent playing |
| Transition allowance | `Division.transitionMinutes` (optional) | Warm-up and changeover that is **already inside the scheduled slot** |
| Scheduled court occupancy | `Division.matchDurationMinutes` | How long a match holds its court. For a medal match: `medalMatchDurationMinutes`, a planning estimate |
| Additional turnover buffer | `rules.courtTurnoverMinutes` | Extra court time between two matches on one court. **0 unless explicitly configured** |
| Participant recovery | `rules.minRestMinutes`, `Division.minRestMinutes` | Minimum time between the end of one occupied slot and the same participant's next start |

Derived: a court can start its next match `matchDurationMinutes + courtTurnoverMinutes` after a start, and a participant can start their next match `matchDurationMinutes + minRestMinutes` after a start. `describeTimeAllocation(config)` returns both per division.

## Example: 15 + 5 = 20

For a 15-minute match with a 5-minute transition, configure `playMinutes: 15`, `transitionMinutes: 5`, `matchDurationMinutes: 20` and `courtTurnoverMinutes: 0`. The slot already contains the transition, so no further 5 minutes is added anywhere:

- a court's next match may start exactly 20 minutes after the previous one started;
- capacity checks count 20 court-minutes per match, not 25;
- recovery is measured from the end of the 20-minute slot to the next start, so a recovery of 5 minutes means at least 10 minutes between the end of active play and the next match (the 5-minute transition plus the 5-minute recovery).

## Guard against double counting

`validateConfig` rejects a division whose `playMinutes + transitionMinutes` is not `matchDurationMinutes` (`TIME_ALLOCATION_MISMATCH`), with a message saying that the transition is already inside the slot. If a venue really needs extra court time between matches, set `courtTurnoverMinutes` explicitly: it is then added for courts only, never to recovery. Tests cover that a court may restart exactly at the end of a slot when turnover is 0, that the configured turnover is enforced and nothing more, that capacity proofs use the real durations, and that recovery is measured without the transition or turnover.

## Medal matches are estimates

A medal match with no time cap and a win-by-two rule can run longer than any planning figure. `medalMatchDurationMinutes` is the planning estimate (the final and the third-place match only); the engine does not reserve extra time for overruns. Instead `analyzeSchedule` reports, for each medal match, the court slack after its planned end and warns (`MEDAL_OVERRUN_RISK`) when a court is needed again within 10 minutes. Contingency options for the organizer, none applied automatically: a longer estimate, an explicit turnover buffer after medal courts, or spare court time at the end of each window.
