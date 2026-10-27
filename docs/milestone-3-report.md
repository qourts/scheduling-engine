# Milestone 3 report: Qourts Smart Scheduler (internal)

Branch: `feature/milestone-3-app`. Not merged. The engine in `src/` is unchanged; the application lives in `apps/web`.

## What an operator can do

1. **Set up** a tournament without code: days, court hours, courts (names, tags, per-day closures in Advanced), categories, divisions, teams (one per line, optionally naming players), formats (pools then playoffs with one wildcard, round robin, knockout), match and medal slots, recovery, and optional per-division windows. Recovery is always the operator's number; there is no built-in official value.
2. **State special rules** in plain English. The built-in interpreter proposes structured rules; an optional server-side Claude adapter handles looser wording when configured; a manual rule editor always works. Every proposal is validated by the engine against the real courts and divisions and shown with its plain-English rendering. Only rules the operator confirms are applied. When the wording does not say hard or preferred, the operator must choose; nothing defaults to mandatory.
3. **Generate and compare** the three engine schedules (Fastest Finish, Balanced Operations, Player-First) with a summary and a detailed view. Equivalent options, time-limited searches, `not_found` (not a proof) and `proven_infeasible` (a proof) are each shown in their own words.
4. **Edit the schedule** on a court-by-court matrix: drag to move, drop on another match to swap, or select a match and use the panel (court, day, time, nudge buttons, swap-with list). Lock matches. Undo and redo. Every proposed change is evaluated by the engine before it can be applied, with the violated rules listed and a before-and-after impact table (matches moved, finish, idle court time, back-to-backs, shortest recovery, new and resolved warnings).
5. **Approve and export.** Draft, approved and published are distinct states. Approval is blocked if the schedule fails the rules, and needs an explicit acknowledgement when the engine reports risks or the event carries experimental assumptions. Exports: match list CSV, court grid CSV, whole-project JSON (versioned, importable) and a print view. Revisions are kept and restorable.

## Decisions as taken

| Topic | Decision |
| --- | --- |
| Storage | IndexedDB via a `ProjectStore` port, debounced autosave with a visible save state, honest wording ("saved in this browser", never "synced" or "backed up"), memory-only fallback with a warning when storage is blocked, versioned JSON export and import. A Supabase store can implement the same port later. |
| Engine execution | A Web Worker behind an `EngineRunner` interface. `engine/core.ts` is DOM-free, so the same calls can sit behind a server `RemoteRunner` if the optimizer must stop shipping to browsers. |
| Engine as source of truth | The UI contains no scheduling rules. Validity comes only from `validateScheduleWithInstructions`, `validateConfig`, `analyzeFeasibility` and `optimizeSchedules`. |
| Natural language | `nlp/parser.ts` (deterministic) and `server/interpret.ts` (Anthropic Messages API, forced tool call for structured output). The key is read from the server environment only (`ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`), never bundled, and the AI path is hidden when no key is set. Nothing was provisioned and no API call has been made. |
| State management | One React context with an `update()` function and autosave. No state library. |
| Locks | Locks protect matches during manual editing (a locked match cannot be moved or swapped, and the engine verifies it unchanged). They do not yet survive regeneration. |
| Echelon | The Echelon-style example carries the experimental note on setup, compare, approval and the print view. It is never silently approved. |

## Phase 3.0 results

| Check | Result |
| --- | --- |
| Engine uses browser-safe APIs only | Yes: `performance.now` with a `Date.now` fallback, no Node modules; the build config already compiles `src/` with no Node types. |
| Engine runs in a Web Worker in a real browser | Yes (Chromium in the Claude desktop browser pane): setup checks, generation and validation all run in the worker bundle (about 109 kB). |
| 288-match validation speed, Node | `validateSchedule` median 2.4 ms, p95 3.2 ms; with instructions 2.6 ms median; `analyzeSchedule` 5.4 ms. |
| 288-match speed in the browser | Preparing the Echelon-style event 15 ms; generating three options 1.25 s; a candidate edit checked with a full report median 3.7 ms, p95 4.4 ms. |
| Conclusion | An incremental validator is **not** needed. Every drag target can be fully validated by the engine live. No engine change was required. |

## Tests and checks

- Engine: 262 tests unchanged and passing.
- App: 45 tests across 6 files: sample events against the real engine, the deterministic parser (including Women's versus Men's, High Intermediate versus Intermediate, "cannot start before" read as a lower bound, undecided strength), engine-validated move, swap and lock edits, IndexedDB store and fallback, versioned JSON round trip, CSV formula-injection protection, the AI adapter with a mocked network, and the confirm-before-apply flow in the real Rules screen.
- Typecheck, production build and `npm audit` clean.
- Manual run in a real browser: configure, interpret and confirm rules, generate (including an honest `not_found` for a too-tight rule), compare, pick, select, see an engine rejection onto a reserved court, preview and apply a valid swap with impact, undo and redo, approve with risk acknowledgement, reload and reopen from IndexedDB.

## Known limitations

- Locks do not carry into regeneration, and regenerating replaces the working schedule after a confirmation.
- Drag-and-drop uses HTML5 drag events, which do not work on touch screens. The click path (select, then the panel) is the touch alternative. Full keyboard drag is not implemented; selecting with Enter and the nudge buttons are the keyboard path.
- The AI adapter is implemented and unit-tested against a mocked network but has not been exercised against the live API, because no key was configured and no charges were authorised.
- The adapter is a local development server plugin. A hosted deployment needs authentication and rate limiting in front of it first.
- All limitations in [limitations.md](limitations.md) and the tracked requirements R1-R5 in [future-requirements.md](future-requirements.md) still apply (tiebreaker matches, wildcard normalisation, medal overruns, tight-configuration search, live rescheduling).
- No cloud sync, accounts or collaboration, by design for this release.

## Usability test script (director and Match Control operator)

1. Open "Club weekend open", read the review step, generate three schedules, and decide which to use and why.
2. Add "Court 3 is unavailable 12:00-13:30 on day 1" and "Seniors Doubles cannot start before 1 PM". Confirm, regenerate, and find the court gap on the matrix.
3. Lock the first medal match, then try to move it. Try to move a semifinal before its pools finish and read the reason given.
4. Swap two matches, read the impact table, apply it, undo it.
5. Open "Echelon-style one day". Find every place the experimental warning appears and try to approve it.
6. Approve a schedule, export CSV and JSON, reload the page, import the JSON on a fresh browser profile.
