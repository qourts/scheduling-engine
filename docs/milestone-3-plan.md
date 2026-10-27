# Milestone 3 plan: operator-facing Smart Scheduling application

Status: **draft for approval. No Milestone 3 code has been written.** Scope and architecture below are proposals until approved.

## 1. Goal

Deliver a working application in which a tournament operator can configure an event, state special requirements in plain English, compare three schedule options, edit the chosen schedule by drag and drop with immediate validation, see the impact of each change, lock matches, and save and export the result.

The engine remains the single source of truth. The application never decides what is valid; it asks the engine and shows the answer.

## 2. Scope

### In scope

| # | Capability | Engine support it builds on |
| --- | --- | --- |
| 1 | Tournament configuration wizard | `TournamentConfig`, `validateConfig`, `describeTimeAllocation`, `analyzeFeasibility` |
| 2 | Plain-English special instructions | `Instruction` types, `InstructionAdapter` boundary, `validateInstructions`, `checkInstructions` |
| 3 | Three-option schedule comparison | `optimizeSchedules`, `analyzeSchedule`, `computeMetrics`, `dominance`, `materialDifferences` |
| 4 | Interactive court-by-court schedule matrix | `Schedule`, `Timeline`, report data (court usage, divisions, medal slots) |
| 5 | Drag-and-drop rearrangement | `validateSchedule`, `checkInstructions` |
| 6 | Immediate conflict and rest validation | `validateSchedule` (including `certainty: "possible"` violations) |
| 7 | Before-and-after impact analysis | `analyzeSchedule`, `computeMetrics`, `assignmentDistance` |
| 8 | Manual locking of matches | `locked_placement` instruction and the validator's `frozen` support |
| 9 | Schedule saving and export | Plain-JSON `Schedule`, `TournamentConfig` |

### Out of scope (tracked in [future-requirements.md](future-requirements.md))

- Tiebreaker matches and unresolved qualification (R1), wildcard normalisation (R2), medal contingency scheduling (R3), stronger search for very tight configurations (R4), and live in-event rescheduling (R5).
- Match Control Core and live scoring integration, authentication and multi-user collaboration, and any change to existing Qourts tournament repositories or production systems.

## 3. Architecture

### 3.1 Principles

1. **Engine authority.** Every validity statement shown to a user is produced by `validateSchedule`, `checkInstructions` or `validateConfig`. The UI contains no scheduling rules.
2. **No silent relaxation.** A move the engine rejects stays rejected, with the engine's reason. Warnings, preferences and hard violations are visually distinct.
3. **AI is a translator, not an authority.** Natural language is converted to structured instructions, shown back for confirmation, then validated by the engine.
4. **Plain data in, plain data out.** All state that matters is JSON-serialisable and versioned.
5. **Experimental and unapproved results are labelled.** Configurations marked experimental (for example the five-minute Echelon recovery) carry a visible "not approved for live operations" status ([ADR 0006](adr/0006-echelon-rules-and-experimental-recovery.md)).

### 3.2 Layout

Keep the engine package unchanged and unpublished-by-default. Add the application as an npm workspace so the engine stays dependency-free ([ADR 0001](adr/0001-typescript-zero-runtime-dependencies.md)):

```
/                       engine package (existing, zero runtime dependencies)
apps/web/               operator application (React, TypeScript, Vite)
  src/features/         wizard, instructions, compare, matrix, impact, export
  src/engine/           worker host and typed client (the only place the engine is imported)
  src/storage/          storage port plus the local implementation
  src/ai/               instruction-translation port
```

### 3.3 Key decisions (proposed)

| Concern | Decision | Reason |
| --- | --- | --- |
| UI stack | React + TypeScript + Vite, CSS variables for theming | Same language as the engine, mainstream, testable |
| Engine execution | In a Web Worker, behind a typed message client | Optimisation takes seconds (5.7 s for 288 matches) and must not freeze the UI. Validation per drag must stay interactive |
| Drag validation | Engine `validateSchedule` on the candidate schedule, run in the worker, with the verdict shown during hover and on drop | One source of truth. Needs measurement (see risk A) |
| Persistence | A `ScheduleStore` port with an IndexedDB implementation first | Works offline and with no backend decision. A Supabase adapter can follow behind the same port |
| Natural language | An `InstructionTranslator` port. The first implementation calls a server-side model. A deterministic template fallback needs no model | Keeps keys off the client. The app works, with structured entry, when no model is available |
| Export | JSON (lossless), CSV (court matrix and match list), printable view (print stylesheet to PDF) | Covers operations and archival without new dependencies |
| Testing | Vitest and Testing Library for components, Playwright for the end-to-end flows | Matches the repo's test tooling; the e2e flows are the acceptance suite |

### 3.4 Core data flow

```
Wizard -> TournamentConfig -> validateConfig -> analyzeFeasibility
   -> (+ confirmed Instructions) -> optimizeSchedules -> 3 options + reports
   -> user picks one -> working copy
   -> drag / lock -> candidate -> validateSchedule + checkInstructions -> accept or reject
   -> accepted edit -> analyzeSchedule(new) vs analyzeSchedule(base) -> impact panel
   -> save (versioned document) / export
```

A saved document holds `config`, `instructions`, the chosen option's `strategy` and seed, the current `schedule`, the lock set, an edit history, and a hash of the config so a stale schedule is detected if the config changes.

## 4. Feature design notes

**Wizard.** Steps: event and days, courts and availability, categories and divisions, teams and players, rules (durations, recovery, windows), review. Each step validates with `validateConfig` and shows the time-allocation model and a feasibility verdict before the user can generate. A proven-infeasible configuration shows the engine's quantified remedies and does not offer to generate. A `not_found` result is shown as "no schedule found, not proven impossible".

**Instructions.** The user types a request. The translator proposes structured instructions. The UI shows each as an editable card (kind, targets, strength mandatory/preference, times). Nothing is applied until confirmed. Unsupported requests (for example mandatory consecutive blocks) show the engine's rejection and the nearest supported alternative. Each applied instruction is later reported as enforced or violated by `checkInstructions`.

**Three-option comparison.** Side-by-side cards for Fastest Finish, Balanced Operations and Player-First, using the report's measures, the engine's distinctness verdict (including "materially equivalent") and its recommendation text. Equivalent options are stated as equivalent, never dressed up.

**Court matrix.** Courts as rows, time as columns, matches as blocks coloured by division and marked by kind (pool, semifinal, medal) and state (provisional participants, locked, violating). Provisional playoff matches are labelled as such. Keyboard operation and screen-reader labels are part of the design, not an afterthought.

**Drag and drop.** Pick up a match, and legal drop targets are computed ahead (a full pre-check may be too slow, so see risk A). On hover and drop the engine's verdict decides. A rejected drop snaps back and lists the violated rules. Rest violations name the team and the gap. A keyboard alternative ("move to court / time") is required.

**Impact analysis.** Before the user confirms an edit (and cumulatively against the original option), show: matches moved, finish time, idle court-minutes, back-to-backs, recovery minimum, teams with changed gaps, newly created warnings and resolved warnings.

**Locking.** Locking a match records a `locked_placement`. The optimiser (if re-run) and the editor both treat it as fixed. Locks are visible on the matrix and listed.

**Save and export.** Named, versioned saves with restore. Exports carry the schedule, the config hash, the strategy and the experimental/unapproved status where it applies.

## 5. Delivery phases

Each phase ends in a working, tested vertical slice. Nothing is merged unless typecheck, tests and audit pass.

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 3.0 Foundations | Workspace, Vite app shell, engine worker client, storage port, design tokens, CI for the app. Spikes for risks A and B | Spike results recorded. A hello-world flow runs the engine in the worker |
| 3.1 Configure | Wizard with validation and feasibility display | An Echelon-like and a general config can be built entirely in the UI and reach generation |
| 3.2 Instructions | Translator port, confirmation cards, enforcement display | All structured instruction kinds are creatable. Unsupported ones are explained |
| 3.3 Compare | Three-option generation with progress and cancel, comparison view | Matches the engine report values exactly (tested against fixtures) |
| 3.4 Matrix | Court matrix with filters, detail panel, provisional and lock indicators | 288-match schedule renders and scrolls smoothly. Keyboard navigable |
| 3.5 Edit | Drag and drop, instant validation, locking, undo and redo, impact analysis | Every rejected move cites an engine violation. Accepted edits always pass `validateSchedule` |
| 3.6 Save and export | Versioned saves, JSON, CSV and print exports | Round-trip: export, import, identical schedule |
| 3.7 Hardening | Accessibility pass, error states, performance, end-to-end suite, user acceptance run | All acceptance criteria below met. Report written |

## 6. Acceptance criteria

1. **Integrity:** no schedule the user can save or export fails `validateSchedule`. A property test applies random edits and asserts it.
2. **Fidelity:** every figure on the comparison and impact views equals the engine's value on the same schedule (fixture tests, no recomputation in the UI).
3. **Responsiveness:** the UI never blocks during optimisation. Drag verdicts appear within an agreed budget (proposed 150 ms for a 288-match schedule, to be confirmed by the spike).
4. **Honesty:** `proven_infeasible`, `not_found`, provisional playoff matches, equivalent options and experimental configurations are each shown in plain, distinct language.
5. **Usability:** a new operator completes configure, generate, edit, save and export for a 288-match event without documentation (a timed walkthrough with at least one real operator).
6. **Accessibility:** WCAG 2.2 AA on the main flows, with a keyboard path for every drag action.
7. **Quality gates:** typecheck, unit and end-to-end tests, and `npm audit` all pass. Engine coverage unchanged or higher.

## 7. Risks and open questions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **A. Drag validation speed.** A full `validateSchedule` per hover may be too slow for large events | Laggy editing | Spike in 3.0. If needed, add an incremental validation entry point in the engine (a scoped change, behind a test that it agrees with the full validator) |
| **B. Browser compatibility of the engine.** It targets Node 20. Timing, hashing or other Node APIs may not exist in the browser | Worker fails | Spike in 3.0. Fix by injecting a clock and hash through the existing `util` seam |
| C. Time-capped runs are not bit-for-bit reproducible | Saved options cannot be regenerated exactly | Save the schedule itself, not just the seed. Offer an iteration-capped mode |
| D. Natural-language mistranslation | Wrong constraint applied | Mandatory confirmation step. Engine validation. Show the structured form beside the original text |
| E. Local-only persistence loses data on a cleared browser | Lost work | Prominent export, and a Supabase adapter behind the same port when approved |
| F. Wildcard and tiebreaker gaps (R1, R2) surface in the UI | Operators assume ties are handled | Visible status on affected divisions: "ties settled by draw, race-to-6 not modelled" |

**Decisions needed from you before 3.0 starts:**

1. Persistence target for the first release: local browser storage only, or Supabase from the start?
2. Natural-language provider and where it may run (server-side model, or a deterministic parser only for the first release)?
3. Deployment: internal tool, hosted web app, or desktop wrapper?
4. Who are the first real operators for the usability test, and is there an Echelon-approved recovery value yet?
