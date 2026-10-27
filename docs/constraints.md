# Constraints

## Hard rules (validated by `validateSchedule`)

A schedule violating any of these is invalid. Rules involving undecided playoff participants are checked for every possible outcome.

| Code | Rule |
|---|---|
| `UNSCHEDULED_MATCH`, `DUPLICATE_ASSIGNMENT`, `UNKNOWN_*`, `INVALID_START`, `WRONG_TOURNAMENT` | Every match is scheduled exactly once on an existing court and tournament day |
| `COURT_OVERLAP`, `COURT_TURNOVER` | A court hosts one match at a time, with the configured turnover between matches |
| `OUTSIDE_COURT_AVAILABILITY` | A match lies entirely inside one availability window of its court |
| `OUTSIDE_DIVISION_WINDOW` | A match lies entirely inside one of its division's play windows (if set) |
| `COURT_NOT_ELIGIBLE` | A match is on one of its division's eligible courts (if set) |
| `DEPENDENCY_ORDER` | A match starts no earlier than each prerequisite's end plus the division's minimum rest (feeder matches and, for qualifiers, every match of the feeding groups) |
| `PLAYER_OVERLAP`, `PLAYER_REST` | No player is in two overlapping matches, and consecutive matches of a player are separated by the larger of the two divisions' minimum rest; across all divisions, including possible participants |
| `PARTICIPANT_UNAVAILABLE` | No match overlaps an unavailability window of a player or team who plays or could play in it |
| `PLAYER_DAILY_CAP` | If set, no player could be required to play more than the cap on one day (fixed matches plus the longest possible bracket path that day) |
| `FROZEN_MATCH_CHANGED` | Locked, in-progress or completed assignments passed as `frozen` are unchanged |

Each violation carries `certainty`: `definite`, or `possible` (occurs for at least one outcome of undecided matches).

## Configurable preferences (planned for milestone 3)

Measured and optimised, never enforced by the validator:

- finish time per division and overall
- rest above the minimum; back-to-back avoidance
- fairness: spread of rest and waiting time across teams; early/late burden
- court utilisation balance and idle gaps
- keeping a division on a contiguous block of courts
- preferred times (e.g. finals in a feature slot)
- disruption minimisation during rescheduling

Organizers can turn a preference into a hard rule where the configuration supports it today: division play windows, eligible courts, minimum rest, daily cap and unavailability windows. Further promotable rules (for example "never back-to-back") will be added with the optimizer.
