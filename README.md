# Qourts Scheduling Engine

Deterministic, independently testable scheduling and match-progression engine for Qourts tournament operations.

The engine turns a tournament configuration into a complete match inventory with playoff dependencies, checks whether the requirements can possibly be met, validates any proposed schedule against every hard rule for every possible tournament outcome, and manages results and progression through an append-only event log.

It is a pure TypeScript library with no runtime dependencies. It does not depend on Supabase, any existing Qourts application, or a frontend framework.

## Status

**Milestone 1 (foundation): implemented and tested.**

| Capability | Status |
|---|---|
| Tournament configuration model and validation | Implemented |
| Categories, divisions, stages, groups, brackets | Implemented |
| Round robin (1 or 2 legs), groups, single elimination with seeding and byes, third-place match, groups → knockout with crossover | Implemented |
| Match dependency graph, unresolved playoff participants, possible-participant sets | Implemented |
| Results, standings, configurable tiebreakers, corrections, audit log | Implemented |
| Independent hard-constraint schedule validator | Implemented |
| Feasibility analysis (necessary conditions) with quantified remedies | Implemented |
| Structured scheduling instructions (mandatory constraints and preferences) | **Milestone 2 (in progress)** |
| Schedulers: Fastest Finish, Balanced Operations, Player-First | **Milestone 2 (in progress)** |
| Soft-constraint metrics and option comparison | **Milestone 2 (in progress)** |
| Visual scheduling interface, natural-language instructions, manual schedule editing | **Planned (milestone 3)** |
| Live rescheduling | **Planned (milestone 4)**; the validator already supports frozen assignments |

Roadmap note: the optimizer was originally labelled milestone 3 and live rescheduling milestone 5. The milestones were renumbered when the roadmap was reorganised, so the optimizer is milestone 2, the visual interface (with natural-language instructions and manual editing) is milestone 3 and live rescheduling is milestone 4. No decisions changed.

The repository contains two **test-only** schedulers (`test/support/`) used to produce positive fixtures. They are not product schedulers.

## Usage

```ts
import { analyzeFeasibility, applyEvent, buildInventory, initialState, validateConfig, validateSchedule } from "@qourts/scheduling-engine";

const check = validateConfig(config);          // structured issues; never mutates input
const inventory = buildInventory(config);      // throws InvalidConfigError if invalid
const feasibility = analyzeFeasibility(inventory);
const report = validateSchedule(inventory, schedule);   // { valid, violations[] }

let state = initialState(inventory);
const applied = applyEvent(inventory, state, {
  type: "result_recorded", eventId: "evt-1", at: "2026-11-14T09:31:00Z", actor: "desk-1",
  matchId: "MD35:groups:A:R1:M1",
  result: { winner: 0, outcome: "played", games: [{ a: 11, b: 7 }] },
});
if (applied.ok) state = applied.value.state;
```

See `test/scenarios/clubDay.ts` for a complete, realistic configuration.

## Development

```bash
npm install
npm run check     # typecheck + all tests
npm run build     # emits dist/
```

Requires Node 20+. Dev dependencies: TypeScript, Vitest, fast-check.

## Documentation

- [Architecture](docs/architecture.md)
- [Competition formats](docs/formats.md)
- [Constraints: hard rules and preferences](docs/constraints.md)
- [Feasibility analysis](docs/feasibility.md)
- [Assumptions and known limitations](docs/limitations.md)
- [Architecture decision records](docs/adr/)
