# Supported competition formats

A division has one stage, or a group/round-robin stage followed by a single-elimination stage.

## Round robin

Every team plays every other team once (`legs: 1`) or twice (`legs: 2`, slot order reversed in the second leg). Pairings use the circle method:

- matches: `legs · n(n−1)/2`
- rounds: `legs · (n−1)` for even *n*, `legs · n` for odd *n*
- every team plays at most once per round; with odd *n* exactly one team sits out each round

Rounds are a pairing structure, not a schedule; the scheduler may interleave them subject to rest rules.

## Groups

`groupCount` groups whose sizes differ by at most one. Allocation:

- `snake`: seeds dealt A, B, C, C, B, A, A, … (balanced strength)
- `sequential`: listed order fills A, then B, …

Seeded teams are ordered by seed first, then unseeded teams in listed order. Each group is a round robin. A round-robin stage is represented as one group with id `RR`.

## Single elimination

Entrants in seed order; bracket size is the next power of two, using standard seeding (`1 v 8, 4 v 5, 2 v 7, 3 v 6` for 8). Properties, each property-tested for 2–128 entrants:

- `n − 1` matches, plus one third-place match if enabled (needs at least 4 entrants)
- byes go only to the top seeds; a bye never meets a bye
- seeds 1 and 2 can only meet in the final; the top 2^k seeds occupy different 1/2^k sections
- a team that receives a bye enters directly in round 2 (no placeholder match)

## Groups → knockout

The top `perGroup` finishers of every group qualify. Group winners take knockout seeds 1..G in group order, runners-up the next G seeds, and so on. Within each tier the group order is chosen to minimise, lexicographically, same-group pairs meeting in their first knockout match, then their second, etc. (bye-aware). Arrangements are searched exhaustively when there are at most 50,000; beyond that a deterministic swap search is used. Any unavoidable first-match meeting is reported in `sameGroupFirstMatchMeetings` (example: 2 groups × top 3 forces 2).

Because positions are fixed by group letter, the full bracket is known before play starts.

### Wildcards

`source.wildcards: { count, rank }` adds the best `count` teams that finished in position `rank` across all groups (for example `{ count: 1, rank: 2 }` is the best second-placed team). With three groups, `perGroup: 1` and one wildcard the knockout has four qualifiers: the three winners plus the wildcard, which takes the lowest seed. Wildcards are ranked by wins, game difference, point difference, points for, then a deterministic draw. Who the wildcard is stays unknown until every group has finished, so a match with the wildcard waits for every group of the stage and, for scheduling and validation, may contain any team of the stage. `count` must not exceed the number of groups and `rank` must be greater than `perGroup`.

### Time allocation

`matchDurationMinutes` is the scheduled court occupancy. `playMinutes` and `transitionMinutes` may break it down (and must add up to it); `medalMatchDurationMinutes` is a planning estimate for the final and third-place match. See [Time allocation](time-allocation.md).

## Standings and tiebreakers

Per team: played, wins, losses, games won/lost, points for/against. The ordered tiebreaker list is required and must end with `draw`:

`wins`, `head_to_head` (wins among the teams still tied), `game_difference`, `point_difference`, `points_for`, `seed`, `draw`.

When a criterion splits a tie into smaller ties, each smaller tie restarts from the first criterion. `draw` is a deterministic hash of tournament, division, group and team IDs, so it is reproducible and cannot be influenced by input order.

Recommended order: `STANDARD_TIEBREAKERS` (wins, head-to-head, game difference, point difference, points for, draw). It is never applied implicitly.

## Scoring

`bestOf` 1, 3 or 5. Outcomes: `played` (winner takes exactly the required games, last game decides), `retired` (partial games, nobody had won yet), `walkover` (no games).
