import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { Schedule, ScheduleReport, TournamentConfig } from "@engine";
import type { MatchInfo } from "../engine/core.js";
import { impactOf, proposeMove, proposeSwap, reasonsOf, type Impact, type Proposal } from "../domain/editing.js";
import { clock, parseClockInput } from "../domain/spec.js";
import { useWorkspace } from "../state/workspace.js";
import { Banner, Field, Pill, Segmented } from "../ui/kit.js";
import { dayLabel, hours } from "../ui/format.js";

const SNAP = 5;
const ZOOMS = [2.2, 4, 6];

interface Snapshot {
  schedule: Schedule;
  locks: string[];
}

interface Target {
  matchId: string;
  courtId: string;
  day: string;
  start: number;
}

function dayAxis(config: TournamentConfig, day: string) {
  let s = 1440;
  let e = 0;
  for (const c of config.courts) for (const a of c.availability) if (a.day === day) { s = Math.min(s, a.start); e = Math.max(e, a.end); }
  if (s >= e) return { start: 8 * 60, end: 18 * 60 };
  return { start: Math.floor(s / 60) * 60, end: Math.ceil(e / 60) * 60 };
}

export function Matrix({ onNext }: { onNext: () => void }) {
  const w = useWorkspace();
  const project = w.project!;
  const config = w.config!;
  const working = project.working;
  const rules = useMemo(() => project.rules.map((r) => r.instruction), [project.rules]);

  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [day, setDay] = useState(config.days[0]!);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<(Target & { source: "drag" | "form" }) | null>(null);
  const [swapWith, setSwapWith] = useState<string>("");
  const [preview, setPreview] = useState<{ proposal: Proposal; impact: Impact | null } | null>(null);
  const [rejection, setRejection] = useState<string[] | null>(null);
  const [baseReport, setBaseReport] = useState<ScheduleReport | null>(null);
  const [baseValid, setBaseValid] = useState<boolean | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const evalToken = useRef(0);
  const grabOffset = useRef(0);

  useEffect(() => {
    void w.runner.matchInfo(config).then(setMatches);
  }, [config, w.runner]);

  const info = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const hue = useMemo(() => {
    const ids = config.divisions.map((d) => d.id);
    return new Map(ids.map((id, i) => [id, Math.round((i * 360) / Math.max(1, ids.length) + 15) % 360]));
  }, [config]);

  const schedule = working?.schedule ?? null;
  const locks = useMemo(() => working?.locks ?? [], [working?.locks]);
  const lockedAssignments = useMemo(() => (schedule ? schedule.assignments.filter((a) => locks.includes(a.matchId)) : []), [schedule, locks]);

  // The committed schedule is re-verified by the engine whenever it changes.
  useEffect(() => {
    if (!schedule) return;
    let live = true;
    void w.runner.check(config, schedule, rules, lockedAssignments, true).then((r) => {
      if (!live) return;
      setBaseReport(r.report);
      setBaseValid(r.valid);
    });
    return () => {
      live = false;
    };
  }, [schedule, rules, lockedAssignments, config, w.runner]);

  const commit = useCallback(
    (nextSchedule: Schedule, nextLocks: string[]) => {
      if (!working) return;
      past.current.push({ schedule: working.schedule, locks: working.locks });
      future.current = [];
      w.update((p) => ({ ...p, status: "draft", working: p.working ? { ...p.working, schedule: nextSchedule, locks: nextLocks } : p.working }));
      setVersion((v) => v + 1);
    },
    [working, w],
  );

  const undo = () => {
    const prev = past.current.pop();
    if (!prev || !working) return;
    future.current.push({ schedule: working.schedule, locks: working.locks });
    w.update((p) => ({ ...p, status: "draft", working: p.working ? { ...p.working, ...prev } : p.working }));
    setVersion((v) => v + 1);
    setPreview(null);
    setTarget(null);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !working) return;
    past.current.push({ schedule: working.schedule, locks: working.locks });
    w.update((p) => ({ ...p, status: "draft", working: p.working ? { ...p.working, ...next } : p.working }));
    setVersion((v) => v + 1);
    setPreview(null);
    setTarget(null);
  };

  const evaluate = useCallback(
    async (t: Target): Promise<{ proposal: Proposal; impact: Impact | null }> => {
      const proposal = await proposeMove(w.runner, config, schedule!, rules, locks, t.matchId, { courtId: t.courtId, day: t.day, start: t.start });
      return { proposal, impact: proposal.report && baseReport ? impactOf(baseReport, proposal.report, schedule!, proposal.candidate) : null };
    },
    [w.runner, config, schedule, rules, locks, baseReport],
  );

  // Live preview of a move (from dragging or from the form).
  useEffect(() => {
    if (!target || !schedule) return;
    const cur = schedule.assignments.find((a) => a.matchId === target.matchId);
    if (cur && cur.courtId === target.courtId && cur.day === target.day && cur.start === target.start) {
      setPreview(null);
      return;
    }
    const token = ++evalToken.current;
    const timer = setTimeout(() => {
      void evaluate(target).then((r) => {
        if (token === evalToken.current) setPreview(r);
      });
    }, 70);
    return () => clearTimeout(timer);
  }, [target, schedule, evaluate]);

  // Live preview of a swap.
  useEffect(() => {
    if (!selected || !swapWith || !schedule) return;
    const token = ++evalToken.current;
    void proposeSwap(w.runner, config, schedule, rules, locks, selected, swapWith).then((proposal) => {
      if (token !== evalToken.current) return;
      setPreview({ proposal, impact: proposal.report && baseReport ? impactOf(baseReport, proposal.report, schedule, proposal.candidate) : null });
    });
  }, [selected, swapWith, schedule, rules, locks, config, w.runner, baseReport]);

  if (!working || !schedule) {
    return (
      <div className="stack">
        <h1>Schedule</h1>
        <Banner tone="info" title="No schedule chosen yet">Generate and compare schedules first, then pick the one to refine.</Banner>
      </div>
    );
  }

  const selectedAssignment = selected ? schedule.assignments.find((a) => a.matchId === selected) ?? null : null;
  const selectedInfo = selected ? info.get(selected) : undefined;
  const isLocked = (id: string) => locks.includes(id);
  const axis = dayAxis(config, day);
  const scale = ZOOMS[zoom]!;
  const width = (axis.end - axis.start) * scale;
  const hits = new Set(preview ? preview.proposal.violations.flatMap((v) => v.matchIds) : []);

  const select = (id: string) => {
    const a = schedule.assignments.find((x) => x.matchId === id);
    setSelected(id);
    setSwapWith("");
    setPreview(null);
    setRejection(null);
    setTarget(a ? { matchId: id, courtId: a.courtId, day: a.day, start: a.start, source: "form" } : null);
    if (a) setDay(a.day);
  };

  const applyPreview = (p: Proposal) => {
    if (!p.valid) return setRejection(reasonsOf(p));
    commit(p.candidate, locks);
    setPreview(null);
    setSwapWith("");
    setRejection(null);
    const moved = p.matchIds[0]!;
    const a = p.candidate.assignments.find((x) => x.matchId === moved);
    setTarget(a ? { matchId: moved, courtId: a.courtId, day: a.day, start: a.start, source: "form" } : null);
  };

  const toggleLock = (id: string) => commit(schedule, isLocked(id) ? locks.filter((x) => x !== id) : [...locks, id]);

  const onDragStart = (e: DragEvent, id: string) => {
    if (isLocked(id)) return e.preventDefault();
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    grabOffset.current = (e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) / scale;
    setDragId(id);
    setSelected(id);
    setSwapWith("");
    setRejection(null);
  };

  const slotAt = (e: DragEvent, courtId: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const minute = axis.start + (e.clientX - rect.left) / scale - grabOffset.current;
    return { courtId, day, start: Math.max(axis.start, Math.round(minute / SNAP) * SNAP) };
  };

  const onTrackOver = (e: DragEvent, courtId: string) => {
    if (!dragId) return;
    e.preventDefault();
    const s = slotAt(e, courtId);
    if (!target || target.courtId !== s.courtId || target.start !== s.start || target.day !== s.day || target.matchId !== dragId) setTarget({ matchId: dragId, ...s, source: "drag" });
  };

  const onTrackDrop = async (e: DragEvent, courtId: string) => {
    e.preventDefault();
    if (!dragId) return;
    const t = { matchId: dragId, ...slotAt(e, courtId) };
    setDragId(null);
    const r = await evaluate(t);
    if (r.proposal.valid) applyPreview(r.proposal);
    else {
      setPreview(null);
      setRejection(reasonsOf(r.proposal));
      const a = schedule.assignments.find((x) => x.matchId === t.matchId);
      if (a) setTarget({ matchId: t.matchId, courtId: a.courtId, day: a.day, start: a.start, source: "form" });
    }
  };

  const onBlockDrop = async (e: DragEvent, overId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragId || dragId === overId) return setDragId(null);
    const id = dragId;
    setDragId(null);
    const p = await proposeSwap(w.runner, config, schedule, rules, locks, id, overId);
    if (p.valid) applyPreview(p);
    else {
      setPreview(null);
      setRejection(reasonsOf(p));
    }
  };

  const ghost = target && target.day === day && (dragId || preview) ? target : null;
  const ghostInfo = ghost ? info.get(ghost.matchId) : undefined;

  const nudge = (dc: number, dm: number) => {
    if (!target) return;
    const idx = config.courts.findIndex((c) => c.id === target.courtId);
    const court = config.courts[Math.min(config.courts.length - 1, Math.max(0, idx + dc))]!;
    setSwapWith("");
    setTarget({ ...target, courtId: court.id, start: Math.max(0, target.start + dm), source: "form" });
  };

  return (
    <div className="stack">
      <div className="row">
        <h1>Schedule</h1>
        {baseValid === true && <Pill tone="ok">Verified valid by the engine</Pill>}
        {baseValid === false && <Pill tone="bad">Does not pass the rules</Pill>}
        <Pill>{schedule.assignments.length} matches</Pill>
        {locks.length > 0 && <Pill tone="info">{locks.length} locked</Pill>}
        <span className="spacer" />
        <button className="btn small" onClick={undo} disabled={past.current.length === 0} aria-keyshortcuts="Control+Z">Undo</button>
        <button className="btn small" onClick={redo} disabled={future.current.length === 0}>Redo</button>
        <button className="btn primary" onClick={onNext}>Approve & export</button>
      </div>
      <span className="sr-only" aria-live="polite">{rejection ? `Move rejected. ${rejection[0] ?? ""}` : ""}{version > 0 ? `Change ${version} applied.` : ""}</span>

      <div className="row">
        {config.days.length > 1 ? (
          <Segmented label="Day" value={day} onChange={setDay} options={config.days.map((d) => ({ value: d, label: dayLabel(d) }))} />
        ) : (
          <Pill>{dayLabel(config.days[0]!)}</Pill>
        )}
        <Segmented label="Zoom" value={String(zoom)} onChange={(v) => setZoom(Number(v))} options={[{ value: "0", label: "Overview" }, { value: "1", label: "Normal" }, { value: "2", label: "Detail" }]} />
        <span className="faint">Drag a match to a new court or time, drop it on another match to swap, or select it and use the panel.</span>
      </div>

      <div className="layout">
        <div className="stack">
          <div className="matrix-scroll" role="region" aria-label="Court matrix" tabIndex={0}>
            <div className="matrix" style={{ width: width + 96 }}>
              <div className="m-axis" style={{ paddingLeft: 96 }}>
                <div style={{ position: "relative", width }}>
                  {Array.from({ length: (axis.end - axis.start) / 60 + 1 }, (_, i) => (
                    <span key={i} className="tick" style={{ left: i * 60 * scale }}>{clock(axis.start + i * 60)}</span>
                  ))}
                </div>
              </div>
              {config.courts.map((court) => {
                const open = court.availability.filter((a) => a.day === day);
                const closed: { from: number; to: number }[] = [];
                let cursor = axis.start;
                for (const a of [...open].sort((x, y) => x.start - y.start)) {
                  if (a.start > cursor) closed.push({ from: cursor, to: a.start });
                  cursor = Math.max(cursor, a.end);
                }
                if (cursor < axis.end) closed.push({ from: cursor, to: axis.end });
                const here = schedule.assignments.filter((a) => a.courtId === court.id && a.day === day);
                const isTarget = dragId !== null && target?.courtId === court.id && target.day === day;
                return (
                  <div className="m-row" key={court.id}>
                    <div className="m-label">{court.name}</div>
                    <div
                      className={`m-track${isTarget && preview ? (preview.proposal.valid ? " drop-ok" : " drop-bad") : ""}`}
                      style={{ width, backgroundSize: `${60 * scale}px 100%` }}
                      onDragOver={(e) => onTrackOver(e, court.id)}
                      onDrop={(e) => void onTrackDrop(e, court.id)}
                    >
                      {closed.map((c, i) => <div key={i} className="m-closed" style={{ left: (c.from - axis.start) * scale, width: (c.to - c.from) * scale }} title="Court closed" />)}
                      {here.map((a) => {
                        const m = info.get(a.matchId);
                        const dur = m?.durationMinutes ?? 20;
                        const medal = m?.thirdPlace || m?.roundLabel === "Final" || /^(F|3P)$/.test(m?.label ?? "");
                        const provisional = m?.phase === "knockout";
                        const cls = ["m-block", medal ? "medal" : "", provisional ? "provisional" : "", selected === a.matchId ? "sel" : "", isLocked(a.matchId) ? "locked" : "", dragId === a.matchId ? "dragging" : "", hits.has(a.matchId) ? "hit" : ""].join(" ");
                        return (
                          <div
                            key={a.matchId}
                            role="button"
                            tabIndex={0}
                            draggable={!isLocked(a.matchId)}
                            className={cls}
                            style={{ left: (a.start - axis.start) * scale, width: dur * scale - 2, "--h": hue.get(m?.divisionId ?? "") ?? 200 } as CSSProperties}
                            aria-label={`${m?.divisionId ?? ""} ${m?.label ?? a.matchId}, ${court.name}, ${clock(a.start)}${isLocked(a.matchId) ? ", locked" : ""}`}
                            aria-pressed={selected === a.matchId}
                            title={`${m?.divisionId ?? ""} ${m?.roundLabel ?? ""} ${m?.label ?? ""}\n${clock(a.start)}-${clock(a.start + dur)}`}
                            onClick={() => select(a.matchId)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(a.matchId); } }}
                            onDragStart={(e) => onDragStart(e, a.matchId)}
                            onDragEnd={() => { setDragId(null); }}
                            onDragOver={(e) => { if (dragId && dragId !== a.matchId) e.preventDefault(); }}
                            onDrop={(e) => void onBlockDrop(e, a.matchId)}
                          >
                            <b>{isLocked(a.matchId) ? "🔒 " : ""}{m?.divisionId}</b>
                            {m?.label} · {clock(a.start)}
                          </div>
                        );
                      })}
                      {ghost && ghost.courtId === court.id && (
                        <div className={`m-ghost${preview && !preview.proposal.valid ? " bad" : ""}`} style={{ left: (ghost.start - axis.start) * scale, width: (ghostInfo?.durationMinutes ?? 20) * scale - 2 }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="legend" aria-label="Divisions">
            {config.divisions.map((d) => (
              <span key={d.id} className="sw" style={{ "--h": hue.get(d.id) } as CSSProperties}><i />{d.name}</span>
            ))}
          </div>
          <p className="faint">Dashed outline: playoff match whose players are not known yet, checked against every team that could reach it. Yellow underline: medal match. Hatched: court closed.</p>
        </div>

        <aside className="side" aria-label="Match details">
          <div className="card stack" aria-live="polite">
            {!selected || !selectedAssignment ? (
              <p className="muted">Select a match to see its details, move it with the controls, swap it, or lock it.</p>
            ) : (
              <>
                <div className="row">
                  <h3>{selectedInfo?.divisionId} {selectedInfo?.label}</h3>
                  {isLocked(selected) && <Pill tone="info">Locked</Pill>}
                </div>
                <p className="muted">{selectedInfo?.roundLabel} · {selectedInfo?.durationMinutes} min · {config.courts.find((c) => c.id === selectedAssignment.courtId)?.name} · {dayLabel(selectedAssignment.day)} {clock(selectedAssignment.start)}</p>
                <button className="btn small" onClick={() => toggleLock(selected)}>{isLocked(selected) ? "Unlock match" : "Lock this match in place"}</button>

                {!isLocked(selected) && target && (
                  <>
                    <h3>Move to</h3>
                    <div className="row">
                      <Field label="Court">
                        <select value={target.courtId} onChange={(e) => { setSwapWith(""); setTarget({ ...target, courtId: e.target.value, source: "form" }); }}>
                          {config.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </Field>
                      {config.days.length > 1 && (
                        <Field label="Day">
                          <select value={target.day} onChange={(e) => { setSwapWith(""); setTarget({ ...target, day: e.target.value, source: "form" }); setDay(e.target.value); }}>
                            {config.days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                          </select>
                        </Field>
                      )}
                      <Field label="Start">
                        <input type="time" step={SNAP * 60} value={clock(Math.min(1439, target.start))} onChange={(e) => { const m = parseClockInput(e.target.value); if (m !== null) { setSwapWith(""); setTarget({ ...target, start: m, source: "form" }); } }} />
                      </Field>
                    </div>
                    <div className="row" aria-label="Nudge">
                      <button className="btn small" aria-label="Earlier by 5 minutes" onClick={() => nudge(0, -SNAP)}>◀ 5 min</button>
                      <button className="btn small" aria-label="Later by 5 minutes" onClick={() => nudge(0, SNAP)}>5 min ▶</button>
                      <button className="btn small" aria-label="Court above" onClick={() => nudge(-1, 0)}>▲ court</button>
                      <button className="btn small" aria-label="Court below" onClick={() => nudge(1, 0)}>▼ court</button>
                    </div>
                    <Field label="Or swap with">
                      <select value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
                        <option value="">Choose a match…</option>
                        {schedule.assignments.filter((a) => a.matchId !== selected && !isLocked(a.matchId)).sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start).map((a) => {
                          const m = info.get(a.matchId);
                          return <option key={a.matchId} value={a.matchId}>{m?.divisionId} {m?.label} · {clock(a.start)} · {config.courts.find((c) => c.id === a.courtId)?.name}</option>;
                        })}
                      </select>
                    </Field>
                  </>
                )}
              </>
            )}
          </div>

          {preview && <PreviewCard preview={preview} onApply={() => applyPreview(preview.proposal)} onCancel={() => { setPreview(null); setSwapWith(""); if (selectedAssignment) setTarget({ matchId: selected!, courtId: selectedAssignment.courtId, day: selectedAssignment.day, start: selectedAssignment.start, source: "form" }); }} />}
          {rejection && !preview && (
            <Banner tone="bad" title="That change was not made">
              <ul>{rejection.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}</ul>
            </Banner>
          )}
        </aside>
      </div>
    </div>
  );
}

function PreviewCard({ preview, onApply, onCancel }: { preview: { proposal: Proposal; impact: Impact | null }; onApply: () => void; onCancel: () => void }) {
  const { proposal, impact } = preview;
  const reasons = reasonsOf(proposal);
  const delta = (before: number | null, after: number | null, lowerBetter = true) => {
    if (before === null || after === null || before === after) return <span>{after ?? "-"}</span>;
    const good = lowerBetter ? after < before : after > before;
    return <span className={good ? "good" : "badtxt"}>{before} → {after}</span>;
  };
  return (
    <div className="card stack" aria-live="polite">
      <div className="row">
        <h3>{proposal.kind === "swap" ? "Swap preview" : "Move preview"}</h3>
        <Pill tone={proposal.valid ? "ok" : "bad"}>{proposal.valid ? "Allowed" : "Not allowed"}</Pill>
      </div>
      {!proposal.valid && <ul style={{ margin: 0, paddingLeft: 18 }}>{reasons.slice(0, 6).map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {proposal.valid && impact && (
        <table aria-label="Impact of this change">
          <tbody>
            <tr><td>Matches moved</td><td className="num">{impact.matchesMoved}</td></tr>
            <tr><td>Event finish</td><td className="num">{impact.finishMinute.before === impact.finishMinute.after ? "No change" : `${hours(Math.abs((impact.finishMinute.after ?? 0) - (impact.finishMinute.before ?? 0)))} ${((impact.finishMinute.after ?? 0) > (impact.finishMinute.before ?? 0)) ? "later" : "earlier"}`}</td></tr>
            <tr><td>Idle court time</td><td className="num">{delta(impact.idleCourtMinutes.before, impact.idleCourtMinutes.after)}</td></tr>
            <tr><td>Back-to-backs</td><td className="num">{delta(impact.backToBacks.before, impact.backToBacks.after)}</td></tr>
            <tr><td>Shortest recovery</td><td className="num">{delta(impact.shortestRecovery.before, impact.shortestRecovery.after, false)}</td></tr>
          </tbody>
        </table>
      )}
      {proposal.valid && impact && impact.newWarnings.length > 0 && <Banner tone="warn" title="New warnings"><ul>{impact.newWarnings.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}</ul></Banner>}
      {proposal.valid && impact && impact.resolvedWarnings.length > 0 && <Banner tone="ok" title="Warnings resolved"><ul>{impact.resolvedWarnings.slice(0, 5).map((m, i) => <li key={i}>{m}</li>)}</ul></Banner>}
      <div className="row">
        <button className="btn primary" disabled={!proposal.valid} onClick={onApply}>{proposal.valid ? "Apply change" : "Cannot apply"}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
