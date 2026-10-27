import { useEffect, useMemo, useState } from "react";
import type { FailureReport, ScheduleReport, StrategyId } from "@engine";
import { inputsKey, type Generation } from "../domain/project.js";
import { lockRules, lockedAssignments, lockedMatchesInIssues } from "../domain/locks.js";
import { plainRuleIds } from "../domain/editing.js";
import { useConfirm } from "../ui/confirm.js";
import { useMatchNames } from "./useMatchNames.js";
import { useWorkspace } from "../state/workspace.js";
import { Banner, EmptyState, Pill, Progress, Segmented, Stat } from "../ui/kit.js";
import { hours, shortMoment } from "../ui/format.js";

const BUDGET_MS = (matches: number) => (matches > 300 ? 24000 : 8000);

type Row = { label: string; value: (r: ScheduleReport) => number | null; text?: (r: ScheduleReport) => string; better: "lower" | "higher" | "none" };

const ROWS: Row[] = [
  { label: "Finishes", value: (r) => r.finish?.absolute ?? null, text: (r) => shortMoment(r.finish?.label ?? "-"), better: "lower" },
  { label: "Time on court days", value: (r) => r.playingDayMinutes, text: (r) => hours(r.playingDayMinutes), better: "lower" },
  { label: "Idle court time", value: (r) => r.idleCourtMinutes, text: (r) => `${r.idleCourtMinutes} court-min`, better: "lower" },
  { label: "Court utilisation", value: (r) => (r.courts.length ? r.courts.reduce((n, c) => n + c.busyMinutes, 0) / Math.max(1, r.courts.reduce((n, c) => n + c.availableMinutes, 0)) : null), text: (r) => `${Math.round((r.courts.reduce((n, c) => n + c.busyMinutes, 0) / Math.max(1, r.courts.reduce((n, c) => n + c.availableMinutes, 0))) * 100)}%`, better: "higher" },
  { label: "Back-to-back matches", value: (r) => r.recovery.backToBackOccurrences, better: "lower" },
  { label: "Shortest recovery", value: (r) => r.recovery.minMinutes, text: (r) => (r.recovery.minMinutes === null ? "-" : `${r.recovery.minMinutes} min`), better: "higher" },
  { label: "Average recovery", value: (r) => r.recovery.meanMinutes, text: (r) => (r.recovery.meanMinutes === null ? "-" : `${Math.round(r.recovery.meanMinutes)} min`), better: "none" },
  { label: "Teams whose pool play spans days", value: (r) => r.recovery.teamsSplitAcrossDays, better: "lower" },
  { label: "Longest wait for a team", value: (r) => r.longestWaits[0]?.longestGapMinutes ?? null, text: (r) => (r.longestWaits[0] ? `${r.longestWaits[0].longestGapMinutes} min` : "-"), better: "lower" },
  { label: "Risk warnings", value: (r) => r.warnings.filter((w) => w.severity === "risk").length, better: "lower" },
  { label: "Notes", value: (r) => r.warnings.filter((w) => w.severity === "info").length, better: "none" },
];

interface LockConflict {
  title: string;
  lines: string[];
  /** Match ids of the locks the engine implicated; empty when it could not tell which. */
  implicated: string[];
  /** Readable names for `implicated`, in the same order. */
  names: string[];
}

export function Compare({ onPicked, onReviseLocks }: { onPicked: () => void; onReviseLocks: () => void }) {
  const w = useWorkspace();
  const confirm = useConfirm();
  const humanize = useMatchNames();
  const project = w.project!;
  const config = w.config!;
  const gen = project.generation;
  const working = project.working;
  const lockCount = working?.locks.length ?? 0;
  const lockedNow = useMemo(() => (working ? lockedAssignments(working.schedule, working.locks) : []), [working]);
  const key = useMemo(() => inputsKey(project.spec, project.rules, lockedNow), [project.spec, project.rules, lockedNow]);
  const stale = gen !== null && gen.inputsKey !== key;
  const [lockConflict, setLockConflict] = useState<LockConflict | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; text: string; lines: string[] } | null>(null);
  const [reports, setReports] = useState<Partial<Record<StrategyId, ScheduleReport>>>({});
  const [view, setView] = useState<"executive" | "detailed">("executive");

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    let live = true;
    setReports({});
    if (!gen) return;
    void Promise.all(
      gen.options.map(async (o) => [o.strategy, (await w.runner.check(config, o.schedule, project.rules.map((r) => r.instruction), [], true)).report] as const),
    ).then((entries) => {
      if (!live) return;
      const next: Partial<Record<StrategyId, ScheduleReport>> = {};
      for (const [s, r] of entries) if (r) next[s] = r;
      setReports(next);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen?.at]);

  /**
   * Generates around the operator's locked matches (mandatory placements the engine freezes). `release` is only ever set by an
   * explicit operator choice after a conflict: nothing is released automatically.
   */
  const run = async (release?: string[] | "all") => {
    setRunning(true);
    setElapsed(0);
    setError(null);
    setFailure(null);
    setLockConflict(null);
    try {
      const matches = await w.runner.matchInfo(config);
      const name = (id: string) => {
        const m = matches.find((x) => x.id === id);
        return m ? `${m.divisionId} ${m.label}` : id;
      };
      const names = new Map(matches.map((m) => [m.id, `${m.divisionId} ${m.label}`]));
      const human = (text: string) => plainRuleIds(text, names);
      const before = working?.locks ?? [];
      const kept = release === "all" ? [] : release ? before.filter((m) => !release.includes(m)) : before;
      const released = before.filter((m) => !kept.includes(m));
      if (released.length > 0) w.update((p) => ({ ...p, working: p.working ? { ...p.working, locks: kept } : p.working }));
      const locked = working ? lockedAssignments(working.schedule, kept) : [];
      const rules = project.rules.map((r) => r.instruction);
      const instructions = [...rules, ...(working ? lockRules(working.schedule, kept) : [])];
      const generationKey = inputsKey(project.spec, project.rules, locked);
      const matchCount = matches.length;
      const { result } = await w.runner.generate(config, instructions, 1, BUDGET_MS(matchCount));
      if (result.status === "ok") {
        const notes = [
          ...(locked.length > 0 ? [`Kept ${locked.length} locked match${locked.length === 1 ? "" : "es"} exactly where you placed ${locked.length === 1 ? "it" : "them"}; everything else was scheduled around ${locked.length === 1 ? "it" : "them"}.`] : []),
          ...(released.length > 0 ? [`Released ${released.length} lock${released.length === 1 ? "" : "s"} at your request: ${released.map(name).join(", ")}.`] : []),
          ...result.comparison.explanation,
          ...result.comparison.equivalent.map((e) => `${labelOf(e.strategy)} is materially equivalent to ${labelOf(e.equivalentTo)}.`),
          ...(result.diagnostics.timeLimited ? ["The time budget ended the search early. These schedules are valid but may be improvable."] : []),
          ...(result.options.length < 3 ? [`Only ${result.options.length} schedule${result.options.length === 1 ? "" : "s"} could be produced.`] : []),
        ];
        const next: Generation = {
          at: Date.now(),
          seed: 1,
          inputsKey: generationKey,
          options: result.options.map((o) => ({ strategy: o.strategy, label: o.label, name: o.name, summary: o.summary, schedule: o.schedule })),
          recommended: result.recommended?.strategy ?? null,
          reason: result.recommended?.reason ?? null,
          notes,
        };
        w.update((p) => ({ ...p, generation: next }));
      } else if (result.status === "no_schedule" && result.failure) {
        const f = result.failure;
        const conflict = (title: string, lines: string[], implicated: string[]): LockConflict => ({ title, lines: lines.map(human), implicated, names: implicated.map(name) });
        if (kept.length > 0 && f.kind === "contradictory_instructions") {
          setLockConflict(conflict("Your locked matches contradict the rules or each other", [f.statement], f.lockedProblems.map(String)));
        } else if (kept.length > 0) {
          // Is the schedule impossible because of the locks, or regardless of them? Ask the engine without them.
          const without = await w.runner.generate(config, rules, 1, 3000);
          if (without.result.status === "ok") {
            setLockConflict(conflict("Your locks make a schedule impossible to find", [f.statement, "Without the locks the engine can build a schedule, so the locks are what stands in the way."], f.lockedProblems.map(String)));
          } else setFailure(describeFailure(f));
        } else setFailure(describeFailure(f));
      } else if (result.status === "invalid_instructions") {
        const issues = result.instructionIssues ?? [];
        const implicated = lockedMatchesInIssues(issues);
        if (implicated.length > 0) setLockConflict({ title: "Some locked matches conflict with the rules or each other", lines: issues.map((i) => human(i.message)), implicated, names: implicated.map(name) });
        else setFailure({ title: "A confirmed rule cannot be used", text: "Remove or fix the rule below, then generate again.", lines: issues.map((i) => i.message) });
      } else {
        setFailure({ title: "Could not generate", text: "The options were not valid.", lines: result.optionIssues ?? [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setRunning(false);
    }
  };

  const pick = async (strategy: StrategyId) => {
    const option = gen?.options.find((o) => o.strategy === strategy);
    if (!option) return;
    const locks = project.working?.locks ?? [];
    // Locks are frozen during generation, so every one must be exactly where the operator put it. Never drop one silently.
    const moved = lockedNow.filter((l) => !option.schedule.assignments.some((a) => a.matchId === l.matchId && a.courtId === l.courtId && a.day === l.day && a.start === l.start));
    if (moved.length > 0) return setFailure({ title: "This option does not keep your locks", text: "Generate again so the locked matches are respected.", lines: moved.map((l) => l.matchId) });
    const note = locks.length > 0 ? ` Your ${locks.length} lock${locks.length === 1 ? "" : "s"} stay in place.` : "";
    if (project.working && !(await confirm({ title: "Replace your working schedule?", body: `This replaces your current working schedule and its manual edits. Earlier approved revisions are kept.${note}`, confirmLabel: "Use this schedule" }))) return;
    w.update((p) => ({ ...p, status: "draft", approvedRevisionId: null, working: { basedOn: strategy, schedule: structuredClone(option.schedule), locks: [...locks] } }));
    onPicked();
  };

  const fragile = project.spec.experimentalNote !== null;

  return (
    <div className="stack">
      <div className="row">
        <h1>Generate and compare</h1>
        <span className="spacer" />
        {gen && !running && (
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "executive", label: "Summary" }, { value: "detailed", label: "Detailed" }]} />
        )}
      </div>

      {fragile && <Banner tone="warn" title="Experimental assumptions">{project.spec.experimentalNote}</Banner>}
      {stale && <Banner tone="warn" title="These schedules are out of date">The setup or rules changed after they were generated. Generate again before you rely on them.</Banner>}

      <div className="card row">
        <button className={`btn ${gen ? "primary" : "accent"}`} disabled={running} onClick={() => void run()}>
          {gen ? "Generate again" : "Generate three schedules"}
        </button>
        {running && <span role="status" className="muted">Working in the background… {elapsed}s. Very large events can take up to about 30 seconds.</span>}
        <span className="faint">
          {project.rules.length} confirmed rule{project.rules.length === 1 ? "" : "s"} applied
          {lockCount > 0 ? `, and ${lockCount} locked match${lockCount === 1 ? "" : "es"} kept in place.` : "."}
        </span>
      </div>

      {running && <Progress label="Generating schedules" />}
      {!gen && !running && !failure && !lockConflict && !error && (
        <EmptyState icon="grid" title="No schedules yet">Generate three distinct schedules from your setup and rules. You will compare them side by side before choosing one to refine.</EmptyState>
      )}

      {lockConflict && (
        <Banner tone="bad" title={lockConflict.title}>
          <ul>{lockConflict.lines.slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p>Nothing was changed. Your locks are still in place. Choose what to do:</p>
          <div className="row">
            <button className="btn" onClick={onReviseLocks}>Revise the locks on the Schedule step</button>
            {lockConflict.implicated.length > 0 && lockConflict.implicated.length < lockCount && (
              <button
                className="btn danger"
                onClick={async () => { if (await confirm({ title: `Release ${lockConflict.implicated.length} lock${lockConflict.implicated.length === 1 ? "" : "s"} and generate?`, body: `${lockConflict.names.join(", ")} may be placed elsewhere.`, confirmLabel: "Release and generate", tone: "danger" })) void run(lockConflict.implicated); }}
              >
                Release the {lockConflict.implicated.length} conflicting lock{lockConflict.implicated.length === 1 ? "" : "s"} and generate
              </button>
            )}
            <button className="btn danger" onClick={async () => { if (await confirm({ title: `Release all ${lockCount} lock${lockCount === 1 ? "" : "s"} and generate?`, body: "Every match may be placed elsewhere.", confirmLabel: "Release all and generate", tone: "danger" })) void run("all"); }}>
              Release all {lockCount} lock{lockCount === 1 ? "" : "s"} and generate
            </button>
            <button className="btn" onClick={() => setLockConflict(null)}>Keep everything as it is</button>
          </div>
        </Banner>
      )}

      {error && <Banner tone="bad" title="Generation failed">{error}</Banner>}
      {failure && (
        <Banner tone="bad" title={failure.title}>
          <p>{failure.text}</p>
          {failure.lines.length > 0 && <ul>{failure.lines.slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}</ul>}
        </Banner>
      )}

      {gen && !running && (
        <>
          {gen.notes.length > 0 && <Banner tone="info" title="About these options"><ul>{gen.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Banner>}
          {gen.recommended && gen.reason && <Banner tone="ok" title={`Recommended: ${labelOf(gen.recommended)}`}>{gen.reason}</Banner>}
          {view === "executive" ? (
            <div className="grid3">
              {gen.options.map((o) => {
                const r = reports[o.strategy];
                const risks = r?.warnings.filter((x) => x.severity === "risk").length ?? 0;
                return (
                  <section key={o.strategy} className={`card opt-card${o.strategy === gen.recommended ? " recommended" : ""}`} aria-label={o.name}>
                    <div className="opt-head"><h2>{o.name}</h2>{o.strategy === gen.recommended && <Pill tone="ok">Recommended</Pill>}</div>
                    <p className="muted">{o.summary}</p>
                    {r ? (
                      <div className="opt-metrics">
                        <Stat value={shortMoment(r.finish?.label ?? "-")} label="finishes" />
                        <Stat value={r.recovery.backToBackOccurrences} label="back-to-backs" />
                        <Stat value={r.recovery.minMinutes === null ? "-" : `${r.recovery.minMinutes}m`} label="shortest recovery" />
                      </div>
                    ) : <p className="faint">Measuring…</p>}
                    {risks > 0 ? <Pill tone="warn">{risks} risk warning{risks === 1 ? "" : "s"}</Pill> : <Pill tone="ok">No risk warnings</Pill>}
                    <div><button className="btn primary" disabled={stale} onClick={() => pick(o.strategy)}>Use this schedule</button></div>
                  </section>
                );
              })}
            </div>
          ) : (
            <Detailed gen={gen} reports={reports} stale={stale} onPick={pick} humanize={humanize} />
          )}
        </>
      )}
    </div>
  );
}

const labelOf = (s: StrategyId) => (s === "fastest_finish" ? "Fastest Finish" : s === "balanced_operations" ? "Balanced Operations" : "Player-First");

function describeFailure(f: FailureReport): { title: string; text: string; lines: string[] } {
  const titles: Record<FailureReport["kind"], string> = {
    proven_infeasible: "No schedule can exist (proven)",
    contradictory_instructions: "Your rules contradict each other",
    not_found: "No schedule was found (this is not a proof)",
    verification_failed: "Schedules failed the safety check",
  };
  const lines = f.kind === "proven_infeasible" ? [...f.proof, ...f.feasibility.checks.filter((c) => !c.passed).flatMap((c) => c.remedies.map((r) => r.message))] : f.unplaced.map((u) => `${u.matchId}: ${u.reason}`);
  return { title: titles[f.kind], text: f.statement, lines };
}

function Detailed({ gen, reports, stale, onPick, humanize }: { gen: Generation; reports: Partial<Record<StrategyId, ScheduleReport>>; stale: boolean; onPick: (s: StrategyId) => void; humanize: (t: string) => string }) {
  return (
    <div className="stack">
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              {gen.options.map((o) => <th key={o.strategy}>{o.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const values = gen.options.map((o) => { const r = reports[o.strategy]; return r ? row.value(r) : null; });
              const present = values.filter((v): v is number => v !== null);
              const best = row.better === "none" || new Set(present).size < 2 ? null : row.better === "lower" ? Math.min(...present) : Math.max(...present);
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {gen.options.map((o, i) => {
                    const r = reports[o.strategy];
                    return <td key={o.strategy} className={`num${best !== null && values[i] === best ? " best" : ""}`}>{r ? (row.text ? row.text(r) : (values[i] ?? "-")) : "…"}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="faint">Green marks the best value when the options differ. Recovery is measured from the end of each match slot for teams whose opponents are already known; playoff opponents are protected by the rules but not measured.</p>
      </div>
      <div className="grid3">
        {gen.options.map((o) => {
          const r = reports[o.strategy];
          return (
            <section key={o.strategy} className="card stack" aria-label={`${o.name} warnings`}>
              <h3>{o.name}: warnings</h3>
              {!r ? <p className="faint">Measuring…</p> : r.warnings.length === 0 ? <p className="good">Nothing to flag.</p> : (
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {r.warnings.map((x, i) => <li key={i}><Pill tone={x.severity === "risk" ? "warn" : undefined}>{x.severity}</Pill> {humanize(x.message)}</li>)}
                </ul>
              )}
              <div><button className="btn primary" disabled={stale} onClick={() => onPick(o.strategy)}>Use this schedule</button></div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
