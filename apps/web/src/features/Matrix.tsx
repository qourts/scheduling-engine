import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { Schedule, ScheduleReport, TournamentConfig } from "@engine";
import type { MatchInfo } from "../engine/core.js";
import type { MatchDetail } from "../engine/inspect.js";
import { impactOf, proposeMove, proposeSwap, reasonsOf, type Impact, type Proposal } from "../domain/editing.js";
import { clock } from "../domain/spec.js";
import { useWorkspace } from "../state/workspace.js";
import { Icon } from "../ui/icons.js";
import { EmptyState, Pill, Segmented } from "../ui/kit.js";
import { dayLabel } from "../ui/format.js";
import { Inspector, type MoveTarget } from "./Inspector.js";
import { useMatchNames } from "./useMatchNames.js";

const SNAP = 5;

/** Timeline density: pixels per minute. Card width is always proportional to the match's real duration. */
const DENSITIES = [
  { id: "compact", label: "Compact", scale: 4 },
  { id: "comfortable", label: "Comfortable", scale: 5.2 },
  { id: "detail", label: "Detailed", scale: 7.4 },
] as const;

interface Snapshot {
  schedule: Schedule;
  locks: string[];
}

type Target = MoveTarget & { source: "drag" | "form" };

function dayAxis(config: TournamentConfig, day: string) {
  let s = 1440;
  let e = 0;
  for (const c of config.courts) for (const a of c.availability) if (a.day === day) { s = Math.min(s, a.start); e = Math.max(e, a.end); }
  if (s >= e) return { start: 8 * 60, end: 18 * 60 };
  return { start: Math.floor(s / 60) * 60, end: Math.ceil(e / 60) * 60 };
}

export function Matrix({ onNext, onGenerate }: { onNext: () => void; onGenerate: () => void }) {
  const w = useWorkspace();
  const project = w.project!;
  const config = w.config!;
  const working = project.working;
  const rules = useMemo(() => project.rules.map((r) => r.instruction), [project.rules]);
  const humanize = useMatchNames();

  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [day, setDay] = useState(config.days[0]!);
  const [density, setDensity] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
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
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void w.runner.matchInfo(config).then(setMatches).catch(() => setMatches([]));
  }, [config, w.runner]);

  const info = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const categoryIndex = useMemo(() => new Map(config.categories.map((c, i) => [c.id, i])), [config]);

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
    }).catch(() => live && setBaseValid(false));
    return () => {
      live = false;
    };
  }, [schedule, rules, lockedAssignments, config, w.runner]);

  // Full information for the selected match lives in the inspector; the matrix itself stays concise.
  useEffect(() => {
    if (!selected || !schedule) return void setDetail(null);
    let live = true;
    void w.runner.inspectMatch(config, schedule, selected).then((d) => live && setDetail(d)).catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [selected, schedule, config, w.runner]);

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
    async (t: MoveTarget): Promise<{ proposal: Proposal; impact: Impact | null }> => {
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
        <EmptyState icon="grid" title="No schedule chosen yet" action={<button className="btn primary" onClick={onGenerate}>Go to Generate & compare</button>}>
          Generate the three schedule options, compare them, and pick the one to refine. It will appear here as a court-by-court timeline.
        </EmptyState>
      </div>
    );
  }

  const selectedAssignment = selected ? schedule.assignments.find((a) => a.matchId === selected) ?? null : null;
  const isLocked = (id: string) => locks.includes(id);
  const axis = dayAxis(config, day);
  const scale = DENSITIES[density]!.scale;
  const width = (axis.end - axis.start) * scale;
  const hits = new Set(preview ? preview.proposal.violations.flatMap((v) => v.matchIds) : []);
  const selectedWarnings = selected && baseReport ? baseReport.warnings.filter((x) => x.matchIds?.includes(selected)).map((x) => x.message) : [];
  const riskCount = baseReport ? baseReport.warnings.filter((x) => x.severity === "risk").length : 0;

  const select = (id: string) => {
    const a = schedule.assignments.find((x) => x.matchId === id);
    setSelected(id);
    setSwapWith("");
    setPreview(null);
    setRejection(null);
    setTarget(a ? { matchId: id, courtId: a.courtId, day: a.day, start: a.start, source: "form" } : null);
    if (a) setDay(a.day);
  };

  const closeInspector = () => {
    setSelected(null);
    setTarget(null);
    setPreview(null);
    setSwapWith("");
    setRejection(null);
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

  const scrollBy = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * Math.round((scroller.current.clientWidth - 140) * 0.7), behavior: "smooth" });
  const jumpToSelected = () => scroller.current?.querySelector(`[data-match="${CSS.escape(selected ?? "")}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });

  const swapOptions = schedule.assignments
    .filter((a) => a.matchId !== selected && !isLocked(a.matchId))
    .sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start)
    .map((a) => {
      const m = info.get(a.matchId);
      return { id: a.matchId, label: `${m?.divisionId ?? ""} ${m?.label ?? a.matchId} · ${clock(a.start)} · ${config.courts.find((c) => c.id === a.courtId)?.name ?? ""}` };
    });

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Schedule</h1>
        {baseValid === true && <Pill tone="ok"><Icon name="check" size={12} />Verified by the engine</Pill>}
        {baseValid === false && <Pill tone="bad"><Icon name="alert" size={12} />Does not pass the rules</Pill>}
        <Pill>{schedule.assignments.length} matches</Pill>
        {locks.length > 0 && <Pill tone="info"><Icon name="lock" size={12} />{locks.length} locked</Pill>}
        {riskCount > 0 && <Pill tone="warn"><Icon name="alert" size={12} />{riskCount} risk warning{riskCount === 1 ? "" : "s"}</Pill>}
        <span className="spacer" />
        <button className="btn small" onClick={undo} disabled={past.current.length === 0} aria-keyshortcuts="Control+Z"><Icon name="undo" size={15} />Undo</button>
        <button className="btn small" onClick={redo} disabled={future.current.length === 0}><Icon name="redo" size={15} />Redo</button>
        <button className="btn accent" onClick={onNext}>Approve & export</button>
      </div>
      <span className="sr-only" aria-live="polite">{rejection ? `Move rejected. ${rejection[0] ?? ""}` : ""}{version > 0 ? `Change ${version} applied.` : ""}</span>

      <div className="mx-toolbar">
        {config.days.length > 1 ? (
          <Segmented label="Day" value={day} onChange={setDay} options={config.days.map((d) => ({ value: d, label: dayLabel(d) }))} />
        ) : (
          <Pill><Icon name="calendar" size={12} />{dayLabel(config.days[0]!)}</Pill>
        )}
        <Segmented label="Timeline density" value={String(density)} onChange={(v) => setDensity(Number(v))} options={DENSITIES.map((d, i) => ({ value: String(i), label: d.label }))} />
        <div className="row" style={{ gap: 4 }} role="group" aria-label="Timeline navigation">
          <button className="btn small icon" aria-label="Scroll timeline earlier" onClick={() => scrollBy(-1)}><Icon name="left" size={16} /></button>
          <button className="btn small icon" aria-label="Scroll timeline later" onClick={() => scrollBy(1)}><Icon name="right" size={16} /></button>
          <button className="btn small" disabled={!selected} onClick={jumpToSelected}><Icon name="locate" size={15} />Jump to selected</button>
        </div>
        <span className="faint">Drag a match to move it, drop on another to swap, or select it to edit.</span>
      </div>

      <div className={`mx-layout${selected ? "" : " no-sel"}`}>
        <div className="mx-main">
          <div className="mx-scroll" ref={scroller} role="region" aria-label="Court matrix" tabIndex={0}>
            <div className="mx" data-density={DENSITIES[density]!.id} style={{ width: width + 132 }}>
              <div className="mx-head">
                <div className="mx-corner"><span className="eyebrow">Court</span></div>
                <div className="mx-time" style={{ width }}>
                  {Array.from({ length: (axis.end - axis.start) / 30 + 1 }, (_, i) => {
                    const minute = axis.start + i * 30;
                    const half = i % 2 === 1;
                    if (half && scale < 5) return null;
                    return <span key={i} className={`mx-tick${half ? " half" : ""}`} style={{ left: i * 30 * scale }}>{clock(minute)}</span>;
                  })}
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
                  <div className="mx-row" key={court.id}>
                    <div className="mx-court"><b>{court.name}</b><span>{here.length} match{here.length === 1 ? "" : "es"}</span></div>
                    <div
                      className={`mx-track${isTarget && preview ? (preview.proposal.valid ? " drop-ok" : " drop-bad") : ""}`}
                      style={{ width, backgroundSize: `${60 * scale}px 100%, ${30 * scale}px 100%` }}
                      onDragOver={(e) => onTrackOver(e, court.id)}
                      onDrop={(e) => void onTrackDrop(e, court.id)}
                    >
                      {closed.map((c, i) => <div key={i} className="mx-closed" style={{ left: (c.from - axis.start) * scale, width: (c.to - c.from) * scale }} title="Court closed" />)}
                      {here.map((a) => {
                        const m = info.get(a.matchId);
                        const dur = m?.durationMinutes ?? 20;
                        const kind = m?.kind ?? "prelim";
                        const locked = isLocked(a.matchId);
                        const cls = ["mx-card", m?.phase === "knockout" ? "provisional" : "", selected === a.matchId ? "sel" : "", locked ? "locked" : "", dragId === a.matchId ? "dragging" : "", hits.has(a.matchId) ? "hit" : ""].filter(Boolean).join(" ");
                        const catVar = `var(--mx-cat-${((categoryIndex.get(m?.categoryId ?? "") ?? 0) % 4) + 1})`;
                        return (
                          <div
                            key={a.matchId}
                            role="button"
                            tabIndex={0}
                            data-match={a.matchId}
                            data-kind={kind}
                            draggable={!locked}
                            className={cls}
                            style={{ left: (a.start - axis.start) * scale, width: dur * scale - 3, "--cat": catVar } as CSSProperties}
                            aria-label={`${m?.divisionId ?? ""} ${m?.label ?? a.matchId}, ${kind === "medal" ? "medal match, " : kind === "semi" ? "knockout match, " : ""}${court.name}, ${clock(a.start)}${locked ? ", locked" : ""}${hits.has(a.matchId) ? ", conflict" : ""}`}
                            aria-pressed={selected === a.matchId}
                            title={`${m?.divisionId ?? ""} ${m?.roundLabel ?? ""} ${m?.label ?? ""}\n${clock(a.start)}-${clock(a.start + dur)}`}
                            onClick={() => select(a.matchId)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(a.matchId); } }}
                            onDragStart={(e) => onDragStart(e, a.matchId)}
                            onDragEnd={() => setDragId(null)}
                            onDragOver={(e) => { if (dragId && dragId !== a.matchId) e.preventDefault(); }}
                            onDrop={(e) => void onBlockDrop(e, a.matchId)}
                          >
                            <span className="mx-top"><i className="mx-dot" /><span className="mx-div">{m?.divisionId}</span></span>
                            <b className="mx-label">{m?.label}</b>
                            <span className="mx-clock">{clock(a.start)}–{clock(a.start + dur)}</span>
                            <span className="mx-teams">{m ? `${m.sides[0]} vs ${m.sides[1]}` : ""}</span>
                            <span className="mx-badges">
                              {hits.has(a.matchId) && <Icon name="alert" size={13} />}
                              {kind === "medal" && <Icon name="star" size={13} />}
                              {locked && <Icon name="lock" size={13} />}
                            </span>
                          </div>
                        );
                      })}
                      {ghost && ghost.courtId === court.id && (
                        <div className={`mx-ghost${preview && !preview.proposal.valid ? " bad" : ""}`} style={{ left: (ghost.start - axis.start) * scale, width: (ghostInfo?.durationMinutes ?? 20) * scale - 3 }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mx-legend" aria-label="Legend">
            <span className="sw"><i className="mx-key" />Preliminary</span>
            <span className="sw"><i className="mx-key" data-kind="semi" />Semifinal or knockout</span>
            <span className="sw"><i className="mx-key" data-kind="medal" />Medal match</span>
            <span className="sw"><i className="mx-key dashed" />Players decided by results</span>
            <span className="sw"><i className="mx-key lock" />Locked</span>
            <span className="sw"><Icon name="alert" size={13} />Conflict if moved here</span>
          </div>
        </div>

        {selected ? (
          <Inspector
            config={config}
            detail={detail}
            assignment={selectedAssignment}
            locked={isLocked(selected)}
            target={target}
            swapWith={swapWith}
            swapOptions={swapOptions}
            warnings={selectedWarnings.map(humanize)}
            humanize={humanize}
            preview={preview}
            rejection={rejection}
            onClose={closeInspector}
            onToggleLock={() => toggleLock(selected)}
            onTarget={(patch) => { setSwapWith(""); if (target) setTarget({ ...target, ...patch, source: "form" }); if (patch.day) setDay(patch.day); }}
            onNudge={nudge}
            onSwapWith={setSwapWith}
            onApply={applyPreview}
            onCancelPreview={() => { setPreview(null); setSwapWith(""); if (selectedAssignment) setTarget({ matchId: selected, courtId: selectedAssignment.courtId, day: selectedAssignment.day, start: selectedAssignment.start, source: "form" }); }}
            onSelectMatch={select}
          />
        ) : (
          <div className="card ins-empty-card">
            <div className="ins-empty">
              <span className="empty-icon" style={{ display: "grid", placeItems: "center", width: 48, height: 48, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)" }}><Icon name="grid" size={22} /></span>
              <h3>Match details</h3>
              <p className="muted">Select a match to see its teams, sequence, recovery and warnings, and to move, swap or lock it.</p>
              {rejection && <p className="badtxt">{rejection[0]}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
