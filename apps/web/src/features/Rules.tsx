import { useEffect, useState } from "react";
import type { InstructionBody, InstructionIssue, InstructionVocabulary, SchedulingInstruction } from "@engine";
import { aiInterpret, aiStatus } from "../nlp/adapter.js";
import { DEFAULT_PREFERENCE_WEIGHT, finalizeRule } from "../nlp/finalize.js";
import { SUPPORTED_PATTERNS, parseInstructions, type Interpretation } from "../nlp/parser.js";
import { newId } from "../domain/project.js";
import { parseClockInput } from "../domain/spec.js";
import { useWorkspace } from "../state/workspace.js";
import { Banner, Field, Pill } from "../ui/kit.js";

interface Pending {
  key: string;
  interp: Interpretation;
  origin: "parser" | "claude" | "manual";
  strength: "mandatory" | "preference" | null;
  weight: number;
}

/** Drops the engine's "Must:" / "Should (weight n):" prefix (strength is shown separately) and capitalises the sentence. */
const stripStrength = (text: string) => {
  const rest = text.replace(/^[^:]+:\s*/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};

export function Rules({ onNext }: { onNext: () => void }) {
  const w = useWorkspace();
  const config = w.config!;
  const [vocab, setVocab] = useState<InstructionVocabulary | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [unresolved, setUnresolved] = useState<{ text: string; reason: string }[]>([]);
  const [ai, setAi] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    let live = true;
    void w.runner.prepare(config).then((r) => live && setVocab(r.vocabulary));
    void aiStatus().then((s) => live && setAi(s.available));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config)]);

  const addPending = (items: Interpretation[], origin: Pending["origin"]) =>
    setPending((p) => [...p, ...items.map((interp) => ({ key: newId("p"), interp, origin, strength: interp.strength, weight: DEFAULT_PREFERENCE_WEIGHT }))]);

  const interpretLocal = () => {
    if (!vocab) return;
    const out = parseInstructions(text, vocab);
    addPending(out.interpretations, "parser");
    setUnresolved(out.unresolved);
    if (out.unresolved.length === 0) setText("");
  };

  const interpretAi = async () => {
    if (!vocab) return;
    setBusy(true);
    setAiError(null);
    try {
      const out = await aiInterpret(text, vocab);
      addPending(out.interpretations, "claude");
      setUnresolved(out.unresolved);
      if (out.unresolved.length === 0) setText("");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "The AI service failed. The built-in interpreter still works.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = (p: Pending) => {
    if (p.strength === null) return;
    const instruction = finalizeRule(p.interp.body, newId("rule"), p.strength, p.weight);
    w.update((proj) => ({ ...proj, rules: [...proj.rules, { instruction, sourceText: p.interp.sourceText, origin: p.origin, confirmedAt: Date.now() }] }));
    setPending((list) => list.filter((x) => x.key !== p.key));
  };

  const remove = (id: string) => w.update((proj) => ({ ...proj, rules: proj.rules.filter((r) => r.instruction.id !== id) }));
  const setWeight = (id: string, weight: number) =>
    w.update((proj) => ({ ...proj, rules: proj.rules.map((r) => (r.instruction.id === id && r.instruction.strength === "preference" ? { ...r, instruction: { ...r.instruction, weight } as SchedulingInstruction } : r)) }));

  const rules = w.project!.rules;

  return (
    <div className="stack">
      <h1>Special rules</h1>
      <p className="muted">Tell the scheduler what matters in plain English. Nothing is applied until you confirm it, and every rule is checked against your actual courts and divisions first.</p>

      <div className="card stack">
        <Field label="What should the schedule respect?">
          <textarea value={text} placeholder={"Advanced Men's Doubles must play in the morning.\nReserve Court 10 for medal matches."} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="row">
          <button className="btn primary" disabled={!text.trim() || !vocab} onClick={interpretLocal}>
            Interpret
          </button>
          {ai && (
            <button className="btn" disabled={!text.trim() || busy} onClick={() => void interpretAi()}>
              {busy ? "Asking…" : "Interpret with AI"}
            </button>
          )}
          <button className="btn" onClick={() => setManual((m) => !m)}>
            {manual ? "Hide rule editor" : "Build a rule by hand"}
          </button>
        </div>
        {(w.project!.spec.demoRequests?.length ?? 0) > 0 && (
          <div className="stack">
            <span className="faint">Try these requests for the demo (click to add):</span>
            <div className="row">
              {w.project!.spec.demoRequests!.map((r) => (
                <button key={r} className="btn small" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${r}` : r))}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
        {ai === false && <p className="faint">AI interpretation is not set up. The built-in interpreter understands the patterns below, and you can always build a rule by hand.</p>}
        {aiError && <Banner tone="warn" title="AI interpretation failed">{aiError}</Banner>}
        <details>
          <summary>Phrases the built-in interpreter understands</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {SUPPORTED_PATTERNS.map((p) => (
              <div key={p.title}>
                <strong>{p.title}</strong>
                <ul>{p.examples.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            ))}
          </div>
        </details>
      </div>

      {manual && vocab && <ManualRule vocab={vocab} onAdd={(interp) => { addPending([interp], "manual"); setManual(false); }} />}

      {unresolved.length > 0 && (
        <Banner tone="warn" title="Not understood, nothing was applied for these">
          <ul>{unresolved.map((u, i) => <li key={i}><em>{u.text}</em> {u.reason}</li>)}</ul>
        </Banner>
      )}

      {pending.length > 0 && (
        <section className="stack">
          <h2>Review before applying</h2>
          {pending.map((p) => (
            <PendingCard key={p.key} p={p} existing={rules.map((r) => r.instruction)} onChange={(patch) => setPending((l) => l.map((x) => (x.key === p.key ? { ...x, ...patch } : x)))} onConfirm={() => confirm(p)} onDiscard={() => setPending((l) => l.filter((x) => x.key !== p.key))} />
          ))}
        </section>
      )}

      <section className="stack">
        <h2>Confirmed rules</h2>
        {rules.length === 0 ? (
          <p className="muted">None yet. The schedule will follow only the tournament setup.</p>
        ) : (
          rules.map((r) => <ConfirmedCard key={r.instruction.id} instruction={r.instruction} source={r.sourceText} origin={r.origin} onRemove={() => remove(r.instruction.id)} onWeight={(n) => setWeight(r.instruction.id, n)} />)
        )}
      </section>

      <div className="row">
        <button className="btn primary" onClick={onNext}>Continue to generate</button>
        <span className="faint">Changing a rule makes any generated schedules out of date; you will be asked to regenerate.</span>
      </div>
    </div>
  );
}

function useDescription(instruction: SchedulingInstruction | null) {
  const w = useWorkspace();
  const [text, setText] = useState("");
  const key = JSON.stringify(instruction);
  useEffect(() => {
    let live = true;
    if (instruction) void w.runner.describe(w.config!, instruction).then((t) => live && setText(t));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return text;
}

function PendingCard({ p, existing, onChange, onConfirm, onDiscard }: { p: Pending; existing: SchedulingInstruction[]; onChange: (patch: Partial<Pending>) => void; onConfirm: () => void; onDiscard: () => void }) {
  const w = useWorkspace();
  const chosen = p.strength ?? "preference";
  const provisional = finalizeRule(p.interp.body, "pending", chosen, p.weight);
  const description = stripStrength(useDescription(provisional));
  const [issues, setIssues] = useState<InstructionIssue[]>([]);
  useEffect(() => {
    let live = true;
    void w.runner.validateRules(w.config!, [...existing, provisional]).then((i) => live && setIssues(i));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(provisional), existing.length]);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="card stack">
      <div className="row">
        <Pill tone="info">{p.origin === "parser" ? "Built-in interpreter" : p.origin === "claude" ? "AI interpreter" : "Built by hand"}</Pill>
        {p.interp.sourceText && <span className="faint">You wrote: “{p.interp.sourceText}”</span>}
      </div>
      <h3>{description}</h3>
      {p.interp.notes.length > 0 && <ul className="muted">{p.interp.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {p.interp.preferenceOnly ? (
        <p><Pill tone="info">Preference</Pill> <span className="faint">This kind of rule can only be a preference.</span></p>
      ) : (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="faint">
            {p.strength === null ? "Is this a hard rule or a preference? Choose one." : "Hard rule or preference?"}
          </legend>
          <div className="row">
            <label className="field inline"><input type="radio" name={p.key} checked={p.strength === "mandatory"} onChange={() => onChange({ strength: "mandatory" })} /> Mandatory: never broken</label>
            <label className="field inline"><input type="radio" name={p.key} checked={p.strength === "preference"} onChange={() => onChange({ strength: "preference" })} /> Preferred: tried, may be traded off</label>
          </div>
        </fieldset>
      )}
      {p.strength === "preference" && (
        <Field label={`Importance: ${p.weight}`} help="1 = nice to have, 10 = strongly wanted">
          <input type="range" min={1} max={10} value={p.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })} />
        </Field>
      )}
      {errors.length > 0 && <Banner tone="bad" title="This rule cannot be used as written"><ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></Banner>}
      {warnings.length > 0 && <Banner tone="warn" title="Heads up"><ul>{warnings.map((e, i) => <li key={i}>{e.message}</li>)}</ul></Banner>}
      <div className="row">
        <button className="btn primary" disabled={p.strength === null || errors.length > 0} onClick={onConfirm}>
          {p.strength === null ? "Choose hard or preferred first" : "Confirm rule"}
        </button>
        <button className="btn" onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}

function ConfirmedCard({ instruction, source, origin, onRemove, onWeight }: { instruction: SchedulingInstruction; source: string | null; origin: string; onRemove: () => void; onWeight: (n: number) => void }) {
  // The engine's own wording, kept whole ("Must: ..." or "Should (weight n): ...") so a confirmed rule reads as a rule.
  const description = useDescription(instruction);
  return (
    <div className="card flat row">
      <Pill tone={instruction.strength === "mandatory" ? "bad" : "info"}>{instruction.strength === "mandatory" ? "Mandatory" : "Preferred"}</Pill>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div>{description}</div>
        {source && <div className="faint">“{source}” · {origin}</div>}
      </div>
      {instruction.strength === "preference" && (
        <label className="field inline">Importance <input aria-label="Importance" type="range" min={1} max={10} value={instruction.weight} onChange={(e) => onWeight(Number(e.target.value))} /></label>
      )}
      <button className="btn small danger" onClick={onRemove}>Remove</button>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  time_window: "Play window for divisions",
  court_allowlist: "Divisions only on certain courts",
  court_reservation: "Reserve courts for medal or knockout matches",
  court_blackout: "Court unavailable for a period",
  min_rest: "Minimum rest for divisions",
  same_day_preliminaries: "Keep pool play on one day",
};

function ManualRule({ vocab, onAdd }: { vocab: InstructionVocabulary; onAdd: (i: Interpretation) => void }) {
  const [kind, setKind] = useState("time_window");
  const [divisionIds, setDivisionIds] = useState<string[]>([]);
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [day, setDay] = useState("");
  const [earliest, setEarliest] = useState("");
  const [latestStart, setLatestStart] = useState("");
  const [latestEnd, setLatestEnd] = useState("");
  const [roles, setRoles] = useState<("medal" | "semifinal" | "final")[]>(["medal"]);
  const [minutes, setMinutes] = useState(20);
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("13:30");
  const [strength, setStrength] = useState<"mandatory" | "preference" | null>(null);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const bound = (t: string) => {
    const minute = parseClockInput(t);
    return minute === null ? undefined : day ? { day, minute } : { minute };
  };

  const build = (): InstructionBody | null => {
    switch (kind) {
      case "time_window": {
        const e = bound(earliest);
        const ls = bound(latestStart);
        const le = bound(latestEnd);
        return { id: "", kind: "time_window", selector: { divisionIds }, ...(e ? { earliestStart: e } : {}), ...(ls ? { latestStart: ls } : {}), ...(le ? { latestEnd: le } : {}) };
      }
      case "court_allowlist": return { id: "", kind: "court_allowlist", selector: { divisionIds }, courtIds };
      case "court_reservation": return { id: "", kind: "court_reservation", courtIds, selector: { roles } };
      case "court_blackout": {
        const s = parseClockInput(from);
        const e = parseClockInput(to);
        return s === null || e === null ? null : { id: "", kind: "court_blackout", courtIds, window: { day: day || vocab.days[0]!, start: s, end: e } };
      }
      case "min_rest": return { id: "", kind: "min_rest", divisionIds, minutes };
      default: return { id: "", kind: "same_day_preliminaries", ...(divisionIds.length ? { divisionIds } : {}) };
    }
  };
  const needsDivisions = ["time_window", "court_allowlist", "min_rest"].includes(kind);
  const needsCourts = ["court_allowlist", "court_reservation", "court_blackout"].includes(kind);
  const body = build();
  const ready = body !== null && (!needsDivisions || divisionIds.length > 0) && (!needsCourts || courtIds.length > 0) && (kind !== "time_window" || earliest || latestStart || latestEnd) && (strength !== null || kind === "same_day_preliminaries");

  return (
    <div className="card stack">
      <h2>Build a rule by hand</h2>
      <Field label="Kind of rule">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      {(needsDivisions || kind === "same_day_preliminaries") && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="faint">{kind === "same_day_preliminaries" ? "Divisions (none selected = all)" : "Divisions"}</legend>
          <div className="row">{vocab.divisions.map((d) => <label key={d.id} className="field inline"><input type="checkbox" checked={divisionIds.includes(d.id)} onChange={() => toggle(divisionIds, setDivisionIds, d.id)} /> {d.name}</label>)}</div>
        </fieldset>
      )}
      {needsCourts && (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="faint">Courts</legend>
          <div className="row">{vocab.courts.map((c) => <label key={c.id} className="field inline"><input type="checkbox" checked={courtIds.includes(c.id)} onChange={() => toggle(courtIds, setCourtIds, c.id)} /> {c.name}</label>)}</div>
        </fieldset>
      )}
      {kind === "court_reservation" && (
        <div className="row">{(["medal", "semifinal", "final"] as const).map((r) => <label key={r} className="field inline"><input type="checkbox" checked={roles.includes(r)} onChange={() => setRoles((l) => (l.includes(r) ? l.filter((x) => x !== r) : [...l, r]))} /> {r} matches</label>)}</div>
      )}
      {kind === "time_window" && (
        <div className="row">
          <Field label="Start no earlier than"><input type="time" value={earliest} onChange={(e) => setEarliest(e.target.value)} /></Field>
          <Field label="Start no later than"><input type="time" value={latestStart} onChange={(e) => setLatestStart(e.target.value)} /></Field>
          <Field label="Finish by"><input type="time" value={latestEnd} onChange={(e) => setLatestEnd(e.target.value)} /></Field>
        </div>
      )}
      {kind === "court_blackout" && (
        <div className="row">
          <Field label="From"><input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}
      {kind === "min_rest" && <Field label="Minimum rest (minutes)"><input type="number" min={0} value={minutes} onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))} /></Field>}
      {(kind === "time_window" || kind === "court_blackout") && vocab.days.length > 1 && (
        <Field label="Which day">
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {kind === "time_window" && <option value="">Every day</option>}
            {vocab.days.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      )}
      {kind !== "same_day_preliminaries" && (
        <div className="row">
          <label className="field inline"><input type="radio" name="manual-strength" checked={strength === "mandatory"} onChange={() => setStrength("mandatory")} /> Mandatory</label>
          <label className="field inline"><input type="radio" name="manual-strength" checked={strength === "preference"} onChange={() => setStrength("preference")} /> Preferred</label>
        </div>
      )}
      <div>
        <button className="btn primary" disabled={!ready} onClick={() => body && onAdd({ sourceText: "", body, strength: kind === "same_day_preliminaries" ? "preference" : strength, preferenceOnly: kind === "same_day_preliminaries", notes: kind === "court_blackout" && vocab.days.length > 1 ? ["Applies to one day. Add another rule for other days."] : [] })}>
          Add for review
        </button>
      </div>
    </div>
  );
}
