# Structured scheduling instructions

Instructions are typed, validated, JSON-compatible objects. They work without any language model: a natural-language interface (milestone 3) only has to produce them. Names are never used, only IDs.

Every instruction is **mandatory** or a **preference**:

- `{ strength: "mandatory" }` is a hard rule. The optimizer never violates it, and the independent `checkInstructions` rejects any schedule that does. If the rules cannot all hold, the engine reports `no_schedule` with the reasons rather than bending a mandatory rule.
- `{ strength: "preference", weight }` is measured, weighted and optimised, and never enforced. `weight` is a positive number; roughly, 1 is mild and 10 is strong. A preference is never allowed to break a mandatory rule or a tournament rule.

## Selecting matches

`MatchSelector` picks matches. Fields combine with AND, values within a field with OR. An empty selector selects every match.

| Field | Selects |
|---|---|
| `divisionIds`, `categoryIds`, `stageIds` | by division, category or stage ID |
| `phases` | `"group"` or `"knockout"` |
| `roles` | `"final"`, `"third_place"`, `"medal"` (final or third place), `"semifinal"`, `"quarterfinal"` |
| `matchIds` | specific matches |

Roles are derived from the bracket structure, so "medal matches" works for every division.

## Instruction kinds

| Kind | Meaning | Mandatory | Preference |
|---|---|---|---|
| `time_window` | `earliestStart`, `latestStart` and/or `latestEnd` for selected matches | Hard window | Minutes outside the window, weighted |
| `court_allowlist` | Selected matches only on the listed courts | Hard | Penalty per match off the list |
| `court_reservation` | Listed courts kept free for the selected matches only | Hard | Penalty per other match on those courts |
| `court_blackout` | Listed courts host nothing during a window | Hard | Overlap minutes, weighted |
| `min_rest` | Minimum minutes of rest between a player's matches in the listed divisions | Replaces the division minimum (warns if it lowers it) | Gaps below the target are penalised |
| `locked_placement` | A match fixed to a court, day and start | Hard (frozen) | Not supported (use `time_window` or `court_allowlist`) |
| `consecutive_blocks` | Listed divisions played as consecutive blocks, in order | Not supported | Time-span overlap between divisions, weighted |
| `same_day_preliminaries` | Each team's preliminary matches stay on one calendar day (all divisions unless `divisionIds` is given) | Not supported (configure a single tournament day instead) | Teams split across days, weighted |

`same_day_preliminaries` is for multi-day events and never changes the event dates: a one-day event stays one day, whatever is preferred. `measurePreferences` reports, per preference instruction, what is violated and by how much, independently of the optimizer.

`TimeBound` is `{ minute, day? }`. With `day` it is an absolute instant (a deadline, "not before Saturday 13:00"). Without `day` it is a clock rule that repeats on every tournament day ("before 12:00").

## Examples

| Request | Instruction |
|---|---|
| Schedule Advanced Men's before noon | `{ id, kind: "time_window", strength: "mandatory", selector: { divisionIds: ["ADV-M"] }, latestEnd: { minute: 720 } }` |
| Advanced Women's cannot start before 1 PM | `{ kind: "time_window", strength: "mandatory", selector: { divisionIds: ["ADV-W"] }, earliestStart: { minute: 780 } }` |
| Reserve Court 5 for medal matches | `{ kind: "court_reservation", strength: "mandatory", courtIds: ["C5"], selector: { roles: ["medal"] } }` |
| Keep High Intermediate on Courts 1 and 2 | `{ kind: "court_allowlist", strength: "mandatory", selector: { divisionIds: ["HI"] }, courtIds: ["C1", "C2"] }` |
| At least 20 minutes of rest between a team's matches | `{ kind: "min_rest", strength: "mandatory", divisionIds: ["HI"], minutes: 20 }` |
| Block Court 3 from 12 PM to 1 PM | `{ kind: "court_blackout", strength: "mandatory", courtIds: ["C3"], window: { day: "2026-11-14", start: 720, end: 780 } }` |
| Complete Beginner Mixed before a deadline | `{ kind: "time_window", strength: "mandatory", selector: { divisionIds: ["BEG-X"] }, latestEnd: { day: "2026-11-14", minute: 900 } }` |
| Schedule selected divisions in consecutive blocks | `{ kind: "consecutive_blocks", strength: "preference", weight: 5, divisionIds: ["A", "B", "C"] }` |
| Knockout matches only after 2 PM | `{ kind: "time_window", strength: "mandatory", selector: { divisionIds: ["ADV-M"], phases: ["knockout"] }, earliestStart: { minute: 840 } }` |

## Validation

`validateInstructions(inventory, instructions)` never throws. It returns structured issues (`severity`, `code`, `instructionId`, `message`) for unknown IDs, bad times, duplicate IDs, empty lists, contradictory bounds, invalid weights, conflicting locks and unsupported mandatory kinds. Warnings (an empty selection, a lowered minimum rest) do not block scheduling. Instructions with an error are never passed to the optimizer.

Contradictions between a locked placement and the rest are reported before scheduling, each naming the instruction and what to change: a lock outside court availability or division windows, on a court another mandatory instruction forbids or reserves, inside a blackout, outside a mandatory time window, two locks that overlap on a court, or two locked dependent matches that break the dependency-plus-rest order. An unsupported instruction kind is reported as an error that names the supported kinds; it is never silently ignored. "Morning" and similar words are not interpreted: use explicit `TimeBound` values (for example a `latestEnd` clock bound of 12:00).

## How instructions are enforced

`compileInstructions` produces an effective tournament configuration for rules that map onto existing ones (court blackouts shrink availability, a mandatory minimum rest replaces the division value) and per-match limits (allowed courts, allowed start ranges) for the rest. The original configuration is never mutated.

`checkInstructions` re-evaluates every mandatory instruction directly from its definition and shares no code with the compiler, so a compiler bug cannot hide a violation. `validateScheduleWithInstructions` combines it with `validateSchedule` on the effective configuration and is the right call for manually edited schedules as well as optimizer output.

## Adapter boundary

`InstructionAdapter` is the contract for a future interpreter (natural language, a form, an import). It receives text and an `InstructionVocabulary` (IDs and display names only, no player data) and returns an `InstructionProposal`: instructions plus anything it could not understand. `acceptProposal` validates a proposal and renders each instruction in plain language for the organizer to confirm. Only accepted instructions reach the optimizer, so an interpreter can never inject an invalid or unreviewed rule. The engine itself never calls a language model.
