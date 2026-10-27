import { useEffect, useMemo, useState } from "react";
import type { PrepareResult } from "../engine/core.js";
import { DEFAULT_TIEBREAKERS, clock, emptyFormat, newCourts, parseClockInput, type CategorySpec, type CourtSpec, type DayWindow, type DivisionSpec, type EventSpec, type FormatSpec } from "../domain/spec.js";
import { useWorkspace } from "../state/workspace.js";
import { Banner, Field, Pill, Progress, Segmented, Stat } from "../ui/kit.js";
import { useConfirm } from "../ui/confirm.js";

type Part = "event" | "courts" | "divisions" | "review";
const PARTS: { id: Part; label: string }[] = [
  { id: "event", label: "Event & timing" },
  { id: "courts", label: "Courts" },
  { id: "divisions", label: "Divisions & teams" },
  { id: "review", label: "Review" },
];

function TimeInput({ label, value, onChange }: { label: string; value: number; onChange: (m: number) => void }) {
  return (
    <Field label={label}>
      <input
        type="time"
        value={clock(Math.min(value, 1439))}
        onChange={(e) => {
          const m = parseClockInput(e.target.value);
          if (m !== null) onChange(m);
        }}
      />
    </Field>
  );
}

const num = (v: string, min: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.round(n) : fallback;
};

/** Suggests a sensible format from the number of teams. The operator can change every value. */
export function suggestFormat(teamCount: number): FormatSpec {
  const pools = Math.max(1, Math.ceil(teamCount / 4));
  if (teamCount <= 5) return { ...emptyFormat("round_robin"), thirdPlace: false };
  if (pools === 2) return { ...emptyFormat(), groupCount: 2, perPool: 2, wildcard: 0 };
  if (pools === 3) return { ...emptyFormat(), groupCount: 3, perPool: 1, wildcard: 1 };
  return { ...emptyFormat(), groupCount: pools, perPool: 1, wildcard: 0 };
}

export function Wizard({ onDone }: { onDone: () => void }) {
  const w = useWorkspace();
  const [part, setPart] = useState<Part>("event");
  const [advanced, setAdvanced] = useState(false);
  const spec = w.project!.spec;
  const set = (fn: (s: EventSpec) => EventSpec) => w.update((p) => ({ ...p, spec: fn(p.spec) }));

  return (
    <div className="stack">
      <div className="row">
        <h1>Set up your tournament</h1>
        <span className="spacer" />
        <Segmented label="Detail level" value={advanced ? "advanced" : "simple"} onChange={(v) => setAdvanced(v === "advanced")} options={[{ value: "simple", label: "Simple" }, { value: "advanced", label: "Advanced" }]} />
      </div>
      {spec.experimentalNote && (
        <Banner tone="warn" title="Experimental assumptions in this example">
          {spec.experimentalNote}
        </Banner>
      )}
      <div className="seg" role="tablist" aria-label="Setup sections" style={{ justifySelf: "start" }}>
        {PARTS.map((p) => (
          <button key={p.id} role="tab" aria-selected={part === p.id} aria-pressed={part === p.id} onClick={() => setPart(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {part === "event" && <EventPart spec={spec} set={set} advanced={advanced} />}
      {part === "courts" && <CourtsPart spec={spec} set={set} advanced={advanced} />}
      {part === "divisions" && <DivisionsPart spec={spec} set={set} advanced={advanced} />}
      {part === "review" && <Review onDone={onDone} />}
      {part !== "review" && (
        <div className="row">
          <button className="btn primary" onClick={() => setPart(PARTS[PARTS.findIndex((p) => p.id === part) + 1]!.id)}>
            Next: {PARTS[PARTS.findIndex((p) => p.id === part) + 1]!.label}
          </button>
        </div>
      )}
    </div>
  );
}

interface PartProps {
  spec: EventSpec;
  set: (fn: (s: EventSpec) => EventSpec) => void;
  advanced: boolean;
}

function EventPart({ spec, set, advanced }: PartProps) {
  const addDay = () => set((s) => {
    const last = s.days[s.days.length - 1] ?? new Date().toISOString().slice(0, 10);
    const next = new Date(`${last}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { ...s, days: [...s.days, next.toISOString().slice(0, 10)] };
  });
  return (
    <div className="grid2">
      <div className="card stack">
        <h2>Event</h2>
        <Field label="Tournament name">
          <input type="text" value={spec.name} onChange={(e) => set((s) => ({ ...s, name: e.target.value }))} />
        </Field>
        <div className="stack">
          <span className="faint">Tournament days</span>
          {spec.days.map((d, i) => (
            <div className="row" key={i}>
              <input aria-label={`Day ${i + 1}`} type="date" value={d} style={{ maxWidth: 190 }} onChange={(e) => set((s) => ({ ...s, days: s.days.map((x, j) => (j === i ? e.target.value : x)) }))} />
              {spec.days.length > 1 && (
                <button className="btn small danger" onClick={() => set((s) => ({ ...s, days: s.days.filter((_, j) => j !== i) }))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <div>
            <button className="btn small" onClick={addDay}>Add a day</button>
          </div>
        </div>
        <div className="row">
          <TimeInput label="Courts open" value={spec.dayWindow.start} onChange={(m) => set((s) => ({ ...s, dayWindow: { ...s.dayWindow, start: m } }))} />
          <TimeInput label="Courts close" value={spec.dayWindow.end} onChange={(m) => set((s) => ({ ...s, dayWindow: { ...s.dayWindow, end: m } }))} />
        </div>
      </div>
      <div className="card stack">
        <h2>Recovery</h2>
        <Field label="Minimum recovery between a team's matches (minutes)" help="Time from the end of one match slot to the start of the team's next. You decide this for your event; there is no built-in official value.">
          <input type="number" min={0} value={spec.recoveryMinutes} onChange={(e) => set((s) => ({ ...s, recoveryMinutes: num(e.target.value, 0, s.recoveryMinutes) }))} />
        </Field>
        {spec.recoveryMinutes < 10 && (
          <Banner tone="warn" title="Very little recovery">
            Players will have {spec.recoveryMinutes} minutes between matches. Schedules built on this leave almost no room for a match to run long.
          </Banner>
        )}
        {advanced && (
          <>
            <Field label="Extra court buffer between matches (minutes)" help="On top of each match slot. Leave at 0 when the slot already includes changeover.">
              <input type="number" min={0} value={spec.courtTurnoverMinutes} onChange={(e) => set((s) => ({ ...s, courtTurnoverMinutes: num(e.target.value, 0, 0) }))} />
            </Field>
            <Field label="Maximum matches per player per day" help="Leave empty for no limit.">
              <input
                type="number"
                min={1}
                value={spec.maxMatchesPerPlayerPerDay ?? ""}
                onChange={(e) => set((s) => ({ ...s, maxMatchesPerPlayerPerDay: e.target.value === "" ? null : num(e.target.value, 1, 1) }))}
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function CourtsPart({ spec, set, advanced }: PartProps) {
  const setCourt = (i: number, fn: (c: CourtSpec) => CourtSpec) => set((s) => ({ ...s, courts: s.courts.map((c, j) => (j === i ? fn(c) : c)) }));
  return (
    <div className="card stack">
      <h2>Courts</h2>
      <Field label="Number of courts">
        <input type="number" min={1} max={40} value={spec.courts.length} onChange={(e) => set((s) => ({ ...s, courts: newCourts(num(e.target.value, 1, s.courts.length), s.courts) }))} />
      </Field>
      {advanced ? (
        <table>
          <thead>
            <tr><th>Name</th><th>Tags</th>{spec.days.map((d) => <th key={d}>{d}</th>)}</tr>
          </thead>
          <tbody>
            {spec.courts.map((c, i) => (
              <tr key={c.id}>
                <td><input aria-label="Court name" type="text" value={c.name} onChange={(e) => setCourt(i, (x) => ({ ...x, name: e.target.value }))} /></td>
                <td><input aria-label="Court tags" type="text" placeholder="feature, indoor" value={c.tags.join(", ")} onChange={(e) => setCourt(i, (x) => ({ ...x, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) }))} /></td>
                {spec.days.map((d) => {
                  const o = c.overrides[d];
                  const mode = o === undefined ? "default" : o === null ? "closed" : "custom";
                  const win: DayWindow = o ?? spec.dayWindow;
                  return (
                    <td key={d}>
                      <select aria-label={`${c.name} on ${d}`} value={mode} onChange={(e) => setCourt(i, (x) => ({ ...x, overrides: { ...withoutKey(x.overrides, d), ...(e.target.value === "closed" ? { [d]: null } : e.target.value === "custom" ? { [d]: { ...spec.dayWindow } } : {}) } }))}>
                        <option value="default">Event hours</option>
                        <option value="closed">Closed</option>
                        <option value="custom">Custom hours</option>
                      </select>
                      {mode === "custom" && (
                        <div className="row">
                          <input aria-label="Opens" type="time" value={clock(Math.min(win.start, 1439))} onChange={(e) => { const m = parseClockInput(e.target.value); if (m !== null) setCourt(i, (x) => ({ ...x, overrides: { ...x.overrides, [d]: { ...win, start: m } } })); }} />
                          <input aria-label="Closes" type="time" value={clock(Math.min(win.end, 1439))} onChange={(e) => { const m = parseClockInput(e.target.value); if (m !== null) setCourt(i, (x) => ({ ...x, overrides: { ...x.overrides, [d]: { ...win, end: m } } })); }} />
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">{spec.courts.length} courts, all open during the event hours. Switch to Advanced to name courts, tag a feature court, or close a court for part of the event.</p>
      )}
    </div>
  );
}

function withoutKey<T>(o: Record<string, T>, k: string): Record<string, T> {
  const copy = { ...o };
  delete copy[k];
  return copy;
}

function DivisionsPart({ spec, set, advanced }: PartProps) {
  const [quick, setQuick] = useState({ categoryId: spec.categories[0]?.id ?? "", levels: "Advanced, Intermediate", teams: 8 });
  const nextId = (base: string) => {
    let n = 1;
    while (spec.divisions.some((d) => d.id === `${base}-${n}`)) n++;
    return `${base}-${n}`;
  };
  const addQuick = () => {
    const category = spec.categories.find((c) => c.id === quick.categoryId);
    if (!category) return;
    const levels = quick.levels.split(",").map((l) => l.trim()).filter(Boolean);
    const created: DivisionSpec[] = levels.map((level, i) => ({
      id: nextId(`${category.id}${i}`),
      name: `${level} ${category.name}`,
      categoryId: category.id,
      skillLevel: level,
      teams: Array.from({ length: quick.teams }, (_, t) => `${level} Team ${t + 1}`),
      format: suggestFormat(quick.teams),
      matchMinutes: 20,
      medalMinutes: 30,
      bestOf: 1,
      recoveryMinutes: null,
      window: null,
      tiebreakers: [...DEFAULT_TIEBREAKERS],
    }));
    set((s) => ({ ...s, divisions: [...s.divisions, ...created] }));
  };
  const setDivision = (i: number, fn: (d: DivisionSpec) => DivisionSpec) => set((s) => ({ ...s, divisions: s.divisions.map((d, j) => (j === i ? fn(d) : d)) }));
  const setCategory = (i: number, fn: (c: CategorySpec) => CategorySpec) => set((s) => ({ ...s, categories: s.categories.map((c, j) => (j === i ? fn(c) : c)) }));

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Categories</h2>
        {spec.categories.map((c, i) => (
          <div className="row" key={c.id}>
            <input aria-label="Category name" type="text" value={c.name} style={{ maxWidth: 240 }} onChange={(e) => setCategory(i, (x) => ({ ...x, name: e.target.value }))} />
            <select aria-label="Discipline" value={c.discipline} style={{ maxWidth: 130 }} onChange={(e) => setCategory(i, (x) => ({ ...x, discipline: e.target.value as CategorySpec["discipline"] }))}>
              <option value="doubles">Doubles</option>
              <option value="singles">Singles</option>
            </select>
            <select aria-label="Gender" value={c.gender} style={{ maxWidth: 130 }} onChange={(e) => setCategory(i, (x) => ({ ...x, gender: e.target.value as CategorySpec["gender"] }))}>
              <option value="men">Men</option>
              <option value="women">Women</option>
              <option value="mixed">Mixed</option>
              <option value="open">Open</option>
            </select>
            <button className="btn small danger" disabled={spec.divisions.some((d) => d.categoryId === c.id)} title={spec.divisions.some((d) => d.categoryId === c.id) ? "Remove its divisions first" : ""} onClick={() => set((s) => ({ ...s, categories: s.categories.filter((x) => x.id !== c.id) }))}>
              Remove
            </button>
          </div>
        ))}
        <div>
          <button className="btn small" onClick={() => set((s) => ({ ...s, categories: [...s.categories, { id: `CAT${s.categories.length + 1}-${Date.now() % 1000}`, name: "New category", discipline: "doubles", gender: "open" }] }))}>
            Add a category
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2>Add divisions quickly</h2>
        <p className="muted">Pick a category and list the skill levels. Each level becomes a division with placeholder teams and a format chosen from the team count. You can change everything afterwards.</p>
        <div className="row">
          <Field label="Category">
            <select value={quick.categoryId} onChange={(e) => setQuick({ ...quick, categoryId: e.target.value })}>
              {spec.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Levels (comma separated)">
            <input type="text" value={quick.levels} onChange={(e) => setQuick({ ...quick, levels: e.target.value })} />
          </Field>
          <Field label="Teams in each">
            <input type="number" min={2} max={64} value={quick.teams} onChange={(e) => setQuick({ ...quick, teams: num(e.target.value, 2, 8) })} />
          </Field>
          <button className="btn accent" disabled={!quick.categoryId || !quick.levels.trim()} onClick={addQuick}>Add divisions</button>
        </div>
      </div>

      {spec.divisions.length === 0 && <Banner tone="info" title="No divisions yet">Add divisions above to continue.</Banner>}
      {spec.divisions.map((d, i) => (
        <DivisionCard key={d.id} d={d} spec={spec} advanced={advanced} onChange={(fn) => setDivision(i, fn)} onRemove={() => set((s) => ({ ...s, divisions: s.divisions.filter((x) => x.id !== d.id) }))} />
      ))}
    </div>
  );
}

function DivisionCard({ d, spec, advanced, onChange, onRemove }: { d: DivisionSpec; spec: EventSpec; advanced: boolean; onChange: (fn: (d: DivisionSpec) => DivisionSpec) => void; onRemove: () => void }) {
  const f = d.format;
  const confirm = useConfirm();
  const setFormat = (patch: Partial<FormatSpec>) => onChange((x) => ({ ...x, format: { ...x.format, ...patch } }));
  const teamCount = d.teams.filter((t) => t.trim()).length;
  return (
    <section className="card stack" aria-label={d.name}>
      <div className="row">
        <h3>{d.name || "Untitled division"}</h3>
        <Pill>{teamCount} teams</Pill>
        <span className="spacer" />
        <button className="btn small danger" onClick={async () => { if (await confirm({ title: `Remove ${d.name}?`, body: "Its teams and format are removed from this tournament.", confirmLabel: "Remove division", tone: "danger" })) onRemove(); }}>Remove division</button>
      </div>
      <div className="grid2">
        <Field label="Division name"><input type="text" value={d.name} onChange={(e) => onChange((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Category">
          <select value={d.categoryId} onChange={(e) => onChange((x) => ({ ...x, categoryId: e.target.value }))}>
            {spec.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Skill level"><input type="text" value={d.skillLevel} onChange={(e) => onChange((x) => ({ ...x, skillLevel: e.target.value }))} /></Field>
      </div>
      <Field label="Teams, one per line" help='Write "Ana Cruz / Ben Lim" to name the players. A player with the same name in two divisions is treated as one person, so their matches never overlap. Order sets the seeding.'>
        <textarea value={d.teams.join("\n")} onChange={(e) => onChange((x) => ({ ...x, teams: e.target.value.split("\n") }))} />
      </Field>
      <div className="row">
        <Field label="Format">
          <select value={f.kind} onChange={(e) => onChange((x) => ({ ...x, format: { ...suggestFormat(teamCount), ...x.format, kind: e.target.value as FormatSpec["kind"] } }))}>
            <option value="pools_playoff">Pools, then playoffs</option>
            <option value="round_robin">Round robin only</option>
            <option value="knockout">Knockout only</option>
          </select>
        </Field>
        {f.kind === "pools_playoff" && (
          <>
            <Field label="Pools"><input type="number" min={1} value={f.groupCount} onChange={(e) => setFormat({ groupCount: num(e.target.value, 1, f.groupCount) })} /></Field>
            <Field label="Advance per pool"><input type="number" min={1} value={f.perPool} onChange={(e) => setFormat({ perPool: num(e.target.value, 1, f.perPool) })} /></Field>
            <Field label="Wildcard" help="Best next-placed team">
              <select value={f.wildcard} onChange={(e) => setFormat({ wildcard: Number(e.target.value) as 0 | 1 })}>
                <option value={0}>None</option>
                <option value={1}>One wildcard</option>
              </select>
            </Field>
          </>
        )}
        {f.kind === "round_robin" && (
          <label className="field inline"><input type="checkbox" checked={f.doubleRoundRobin} onChange={(e) => setFormat({ doubleRoundRobin: e.target.checked })} /> Play everyone twice</label>
        )}
        {f.kind !== "round_robin" && (
          <label className="field inline"><input type="checkbox" checked={f.thirdPlace} onChange={(e) => setFormat({ thirdPlace: e.target.checked })} /> Third-place match</label>
        )}
      </div>
      <div className="row">
        <Field label="Match slot (minutes)" help="Play plus warm-up"><input type="number" min={5} value={d.matchMinutes} onChange={(e) => onChange((x) => ({ ...x, matchMinutes: num(e.target.value, 5, x.matchMinutes) }))} /></Field>
        <Field label="Medal match slot" help="Planning estimate"><input type="number" min={5} value={d.medalMinutes ?? d.matchMinutes} onChange={(e) => onChange((x) => ({ ...x, medalMinutes: num(e.target.value, 5, x.matchMinutes) }))} /></Field>
        <Field label="Games per match">
          <select value={d.bestOf} onChange={(e) => onChange((x) => ({ ...x, bestOf: Number(e.target.value) as 1 | 3 | 5 }))}>
            <option value={1}>One game</option>
            <option value={3}>Best of 3</option>
            <option value={5}>Best of 5</option>
          </select>
        </Field>
      </div>
      {advanced && (
        <div className="row">
          <Field label="Recovery for this division (minutes)" help="Empty uses the event value">
            <input type="number" min={0} value={d.recoveryMinutes ?? ""} onChange={(e) => onChange((x) => ({ ...x, recoveryMinutes: e.target.value === "" ? null : num(e.target.value, 0, 0) }))} />
          </Field>
          <label className="field inline">
            <input type="checkbox" checked={d.window !== null} onChange={(e) => onChange((x) => ({ ...x, window: e.target.checked ? { ...spec.dayWindow } : null }))} />
            Restrict to a time window each day
          </label>
          {d.window && (
            <>
              <TimeInput label="From" value={d.window.start} onChange={(m) => onChange((x) => ({ ...x, window: x.window ? { ...x.window, start: m } : x.window }))} />
              <TimeInput label="Until" value={d.window.end} onChange={(m) => onChange((x) => ({ ...x, window: x.window ? { ...x.window, end: m } : x.window }))} />
            </>
          )}
        </div>
      )}
      {advanced && d.tiebreakers[d.tiebreakers.length - 1] === "draw" && (
        <p className="faint">Ties are settled by: {d.tiebreakers.join(" → ").replace(/_/g, " ")}. The final step is a deterministic draw. A tiebreaker match (such as a race to 6) is not modelled; if your rules require one, play it outside the scheduler.</p>
      )}
    </section>
  );
}

function Review({ onDone }: { onDone: () => void }) {
  const w = useWorkspace();
  const spec = w.project!.spec;
  const config = w.config!;
  const [prep, setPrep] = useState<PrepareResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const key = useMemo(() => JSON.stringify(config), [config]);

  useEffect(() => {
    let live = true;
    setPrep(null);
    setFailure(null);
    w.runner.prepare(config).then((r) => live && setPrep(r), (e: unknown) => live && setFailure(e instanceof Error ? e.message : "The engine could not check this configuration."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (failure) return <Banner tone="bad" title="Could not check the configuration">{failure}</Banner>;
  if (!prep) return <div className="stack tight" role="status"><Progress label="Checking your setup" /><p className="muted">Checking your setup…</p></div>;

  const errors = prep.issues.filter((i) => i.severity === "error");
  const warnings = prep.issues.filter((i) => i.severity !== "error");
  const failed = prep.feasibility?.checks.filter((c) => !c.passed) ?? [];
  const infeasible = prep.feasibility?.status === "infeasible";
  const teams = spec.divisions.reduce((n, d) => n + d.teams.filter((t) => t.trim()).length, 0);

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ gap: 32 }}>
          <Stat value={spec.divisions.length} label="divisions" />
          <Stat value={teams} label="teams" />
          <Stat value={prep.valid ? prep.matchCount : "-"} label="matches" />
          <Stat value={spec.courts.length} label="courts" />
          <Stat value={spec.days.length} label={spec.days.length === 1 ? "day" : "days"} />
          <Stat value={`${spec.recoveryMinutes} min`} label="recovery you set" />
        </div>
      </div>
      {errors.length > 0 && (
        <Banner tone="bad" title="Fix these before generating">
          <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="warn" title="Worth a look">
          <ul>{warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </Banner>
      )}
      {prep.valid && infeasible && (
        <Banner tone="bad" title="No schedule can satisfy this setup (proven)">
          <p>The engine proved that at least one necessary condition fails, so generating would not help. Nothing was changed for you; here is what would fix each problem on its own:</p>
          <ul>
            {failed.map((c) => (
              <li key={c.id}>
                {c.message}
                {c.remedies.length > 0 && <ul>{c.remedies.map((r, i) => <li key={i}>{r.message}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {prep.valid && !infeasible && (
        <Banner tone="ok" title="No blocking problem found">
          This is not a guarantee that a schedule exists, only that none of the necessary conditions fail. Generating will tell you for certain.
        </Banner>
      )}
      <div className="row">
        <button className="btn primary" disabled={!prep.valid || infeasible} onClick={onDone}>
          Continue to special rules
        </button>
      </div>
    </div>
  );
}
