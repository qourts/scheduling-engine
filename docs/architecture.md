# Architecture

## Principles

- Competition rules and scheduling mathematics are deterministic domain logic. The same input always produces the same matches, IDs, standings and reports.
- AI is not an authority for match generation or schedule validity. It may later explain results computed here.
- Every schedule is validated by a component that shares no scheduling logic with the scheduler that produced it.
- Hard rules are never relaxed by the engine. Infeasible requirements are reported with quantified remedies; the organizer decides.
- The core takes plain JSON-compatible objects and returns plain objects. Persistence (Supabase), transport and UI live outside it.

## Modules

```
src/
  config/        Input types (TournamentConfig) and validateConfig
  competition/   Pure format mathematics: round robin, knockout planning, group allocation, crossover
  inventory/     buildInventory: matches, slots, dependencies; dependency graph; participant model
  progression/   Event log, results, standings, tiebreakers, slot resolution
  schedule/      Schedule and Assignment types, absolute timeline
  validation/    validateSchedule: the independent hard-constraint validator
  feasibility/   analyzeFeasibility: necessary conditions and remedies
  util/          Time intervals, hashing, result type
```

Dependency direction: `config → competition → inventory → {progression, validation, feasibility}`. `validation` and `feasibility` never import each other or any scheduler.

Planned additions (not implemented): `scheduling/` (strategy interface and the three strategies), `metrics/` (soft-constraint measurement and comparison), adapters for Qourts Match Control Core and Supabase in separate packages.

## Domain model

- **Tournament** has days, courts (with availability windows and tags), players, categories, divisions, global rules and restrictions.
- **Category** is the event type (e.g. Mixed Doubles) and fixes the discipline, hence team size.
- **Division** is a bracket within a category (e.g. Mixed Doubles 4.0). It owns teams, stages, match duration, scoring, tiebreakers, optional rest override, play windows and eligible courts.
- **Stage**: `round_robin`, `groups`, or `single_elimination` (from seeded teams, or from the top *k* of each group of the previous stage).
- **Match** has two **slots**. A slot is a fixed team, the winner or loser of another match, or a group finishing position. Unresolved playoff participants are first-class.
- **Dependencies** are derived from slots: `winner`/`loser` (feeder match) and `group_complete` (every match of a feeding group).
- **IDs** are caller-supplied for tournament, courts, players, teams, divisions and stages; match IDs are derived deterministically, e.g. `MD35:groups:A:R2:M1`, `MD35:playoffs:R2:M1`, `MD35:playoffs:3P`.

## Unresolved participants

`ParticipantModel` answers "who could play in this match?" for every slot: the team itself, every team of a group for a group position, or the union over a feeder match. Progression results narrow these sets (`Resolution`).

Possible-team sets alone would forbid things that can never happen, such as both semifinals at the same time. Two structural facts are applied, and both are proven safe by simulation tests:

1. In a bracket, a team follows a single path of winner/loser links. Two knockout matches of the same stage that are not dependency-ordered (the two semifinals, or the final and the third-place match) never contain the same team.
2. In a group, two matches share a team only if they share an entry position.

Matches that are dependency-ordered are kept apart by the dependency-plus-rest rule. Everything else that could share a player, including a multi-division player in an undecided playoff, is treated as a conflict. Such violations are reported with `certainty: "possible"` and are just as invalid as definite ones.

## Progression

State is derived from the inventory plus the accepted events. There is one derivation path, so standings and bracket participants can never drift from the results.

- `result_recorded` is accepted only when both participants are known and the match has no result.
- `result_corrected` needs a reason. It is rejected if it would change who played in any other completed match; otherwise it is applied and the affected pending matches are listed.
- Event IDs are unique; timestamps and actors are supplied by the caller (the engine never reads the clock).

## Planned optimization approach (milestone 3)

1. Constructive, dependency-aware list scheduling prioritised by remaining critical path.
2. Seeded local search (move, swap, re-insert) that only accepts moves keeping all hard rules satisfied.
3. Three strategies as three objective weightings: Fastest Finish (makespan), Balanced Operations (utilisation evenness, court clustering), Player-First (rest, back-to-backs, waiting fairness).
4. Seeded PRNG plus iteration budget for reproducibility; wall-clock time only as a safety cap.
5. Every candidate passes through `validateSchedule`; the gap to feasibility lower bounds is reported.
6. Live rescheduling reuses the same machinery with frozen assignments and a disruption term.

A CP-SAT (OR-Tools) solver remains an option behind the same interface if real instances outgrow heuristics.
