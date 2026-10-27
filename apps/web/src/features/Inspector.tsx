import type { TournamentConfig } from "@engine";
import type { MatchDetail, Neighbor } from "../engine/inspect.js";
import { reasonsOf, type Impact, type Proposal } from "../domain/editing.js";
import { clock, parseClockInput } from "../domain/spec.js";
import { Icon } from "../ui/icons.js";
import { Banner, Field, Pill } from "../ui/kit.js";
import { dayLabel, hours } from "../ui/format.js";

const SNAP = 5;

export interface MoveTarget {
  matchId: string;
  courtId: string;
  day: string;
  start: number;
}

export interface InspectorProps {
  config: TournamentConfig;
  detail: MatchDetail | null;
  assignment: { courtId: string; day: string; start: number } | null;
  locked: boolean;
  target: MoveTarget | null;
  swapWith: string;
  swapOptions: { id: string; label: string }[];
  warnings: string[];
  preview: { proposal: Proposal; impact: Impact | null } | null;
  rejection: string[] | null;
  humanize(text: string): string;
  onClose(): void;
  onToggleLock(): void;
  onTarget(patch: Partial<MoveTarget>): void;
  onNudge(courts: number, minutes: number): void;
  onSwapWith(id: string): void;
  onApply(p: Proposal): void;
  onCancelPreview(): void;
  onSelectMatch(id: string): void;
}

const when = (n: Neighbor) => `${n.courtName} · ${clock(n.start)}`;

function Sequence({ title, items, onSelect, empty }: { title: string; items: Neighbor[]; onSelect(id: string): void; empty: string }) {
  return (
    <div className="stack tight">
      <span className="faint">{title}</span>
      {items.length === 0 ? <span className="muted">{empty}</span> : items.map((n) => (
        <button key={n.matchId} className="ins-link" onClick={() => onSelect(n.matchId)} title="Select this match">
          <b>{n.name}</b>
          <span>{when(n)}</span>
        </button>
      ))}
    </div>
  );
}

function restLine(prefix: string, n: Neighbor | null, required: number, none: string) {
  if (!n) return <div className="ins-rest"><span>{prefix}</span><b>{none}</b></div>;
  const gap = n.gapMinutes;
  const tone = gap === null ? "" : gap < required ? "badtxt" : gap < required + 5 ? "" : "good";
  return (
    <div className="ins-rest">
      <span>{prefix} {n.name}</span>
      <b className={tone}>{gap === null ? `another day (${dayLabel(n.day)})` : `${gap} min rest`}</b>
    </div>
  );
}

export function Inspector(p: InspectorProps) {
  const { detail, assignment, config } = p;
  if (!detail || !assignment) return null;
  const court = config.courts.find((c) => c.id === assignment.courtId);
  const end = assignment.start + detail.durationMinutes;

  return (
    <aside className="inspector" aria-label="Match details">
      <div className="ins-head">
        <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
          <span className="eyebrow">{detail.divisionName}</span>
          <h2 className="ins-title">{detail.divisionId} · {detail.label}</h2>
          <span className="mono ins-id">{detail.id}</span>
        </div>
        <button className="btn small icon ghost" aria-label="Close match details" onClick={p.onClose}><Icon name="x" /></button>
      </div>
      <div className="ins-chips">
        <Pill tone={detail.kind === "medal" ? "warn" : detail.kind === "semi" ? "ok" : undefined}>{detail.kind === "medal" && <Icon name="star" size={12} />}{detail.kindLabel}</Pill>
        {p.locked && <Pill tone="info"><Icon name="lock" size={12} />Locked</Pill>}
        {detail.provisional && <Pill>Players decided by results</Pill>}
      </div>

      <section className="ins-sec">
        <h3>Schedule</h3>
        <dl className="ins-dl">
          <dt>Court</dt><dd>{court?.name ?? assignment.courtId}</dd>
          <dt>Day</dt><dd>{dayLabel(assignment.day)}</dd>
          <dt>Time</dt><dd>{clock(assignment.start)} to {clock(end)}</dd>
          <dt>Slot</dt><dd>{detail.durationMinutes} min</dd>
        </dl>
      </section>

      <section className="ins-sec">
        <h3>Match</h3>
        <dl className="ins-dl">
          <dt>Stage</dt><dd>{detail.stageLabel}{detail.groupLabel ? ` · Group ${detail.groupLabel}` : ""}</dd>
          <dt>Round</dt><dd>{detail.roundLabel}</dd>
          {detail.skillLevel && (<><dt>Level</dt><dd>{detail.skillLevel}</dd></>)}
        </dl>
      </section>

      <section className="ins-sec">
        <h3>Teams</h3>
        {detail.slots.map((s, i) => (
          <div className="ins-team" key={i}>
            <span className="faint">{i === 0 ? "Side A" : "Side B"}</span>
            <span className="who">{s.text}</span>
            {s.teamId === null && <span className="faint">Decided by earlier results</span>}
          </div>
        ))}
      </section>

      <section className="ins-sec">
        <h3>Sequence</h3>
        <Sequence title="Must finish first" items={detail.before} onSelect={p.onSelectMatch} empty="Nothing: this match does not wait for another." />
        <Sequence title="Comes after this" items={detail.after} onSelect={p.onSelectMatch} empty="No later match depends on this one." />
      </section>

      {detail.recovery.length > 0 && (
        <section className="ins-sec">
          <h3>Recovery</h3>
          {detail.recovery.map((r) => (
            <div className="stack tight" key={r.team}>
              <b>{r.team}</b>
              {restLine("After", r.previous, r.restRequiredMinutes, "First match")}
              {restLine("Before", r.next, r.restRequiredMinutes, "Last match")}
              <span className="faint">Rule: at least {r.restRequiredMinutes} min</span>
            </div>
          ))}
        </section>
      )}

      <section className="ins-sec">
        <h3>Warnings</h3>
        {p.warnings.length === 0 ? <span className="good"><Icon name="check" size={15} /> Nothing flagged for this match.</span> : p.warnings.map((w, i) => (
          <div className="ins-warn" key={i}><Icon name="alert" size={15} /><span>{w}</span></div>
        ))}
      </section>

      <section className="ins-sec">
        <h3>Edit</h3>
        <button className="btn small" onClick={p.onToggleLock}><Icon name={p.locked ? "unlock" : "lock"} size={15} />{p.locked ? "Unlock match" : "Lock this match in place"}</button>
        {!p.locked && p.target && (
          <>
            <div className="row">
              <Field label="Court">
                <select value={p.target.courtId} onChange={(e) => p.onTarget({ courtId: e.target.value })}>
                  {config.courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              {config.days.length > 1 && (
                <Field label="Day">
                  <select value={p.target.day} onChange={(e) => p.onTarget({ day: e.target.value })}>
                    {config.days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Start">
                <input type="time" step={SNAP * 60} value={clock(Math.min(1439, p.target.start))} onChange={(e) => { const m = parseClockInput(e.target.value); if (m !== null) p.onTarget({ start: m }); }} />
              </Field>
            </div>
            <div className="row" aria-label="Nudge">
              <button className="btn small" aria-label="Earlier by 5 minutes" onClick={() => p.onNudge(0, -SNAP)}><Icon name="left" size={14} />5 min</button>
              <button className="btn small" aria-label="Later by 5 minutes" onClick={() => p.onNudge(0, SNAP)}>5 min<Icon name="right" size={14} /></button>
              <button className="btn small" aria-label="Court above" onClick={() => p.onNudge(-1, 0)}><Icon name="up" size={14} />Court</button>
              <button className="btn small" aria-label="Court below" onClick={() => p.onNudge(1, 0)}><Icon name="down" size={14} />Court</button>
            </div>
            <Field label="Or swap with">
              <select value={p.swapWith} onChange={(e) => p.onSwapWith(e.target.value)}>
                <option value="">Choose a match…</option>
                {p.swapOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
          </>
        )}
      </section>

      {p.preview && <PreviewCard humanize={p.humanize} preview={p.preview} onApply={() => p.onApply(p.preview!.proposal)} onCancel={p.onCancelPreview} />}
      {p.rejection && !p.preview && (
        <div className="ins-preview">
          <Banner tone="bad" title="That change was not made"><ul>{p.rejection.slice(0, 6).map((r, i) => <li key={i}>{p.humanize(r)}</li>)}</ul></Banner>
        </div>
      )}
    </aside>
  );
}

function PreviewCard({ preview, onApply, onCancel, humanize }: { preview: { proposal: Proposal; impact: Impact | null }; onApply(): void; onCancel(): void; humanize(text: string): string }) {
  const { proposal, impact } = preview;
  const reasons = reasonsOf(proposal);
  const delta = (before: number | null, after: number | null, lowerBetter = true) => {
    if (before === null || after === null || before === after) return <span>{after ?? "-"}</span>;
    const good = lowerBetter ? after < before : after > before;
    return <span className={good ? "good" : "badtxt"}>{before} → {after}</span>;
  };
  return (
    <div className="ins-preview" aria-live="polite">
      <div className="row">
        <h3 style={{ fontSize: "var(--fs-md)" }}>{proposal.kind === "swap" ? "Swap preview" : "Move preview"}</h3>
        <Pill tone={proposal.valid ? "ok" : "bad"}><Icon name={proposal.valid ? "check" : "alert"} size={12} />{proposal.valid ? "Allowed" : "Not allowed"}</Pill>
      </div>
      {!proposal.valid && <ul style={{ margin: 0, paddingLeft: 18 }}>{reasons.slice(0, 6).map((r, i) => <li key={i}>{humanize(r)}</li>)}</ul>}
      {proposal.valid && impact && (
        <table aria-label="Impact of this change">
          <tbody>
            <tr><td>Matches moved</td><td className="num">{impact.matchesMoved}</td></tr>
            <tr><td>Event finish</td><td className="num">{impact.finishMinute.before === impact.finishMinute.after ? "No change" : `${hours(Math.abs((impact.finishMinute.after ?? 0) - (impact.finishMinute.before ?? 0)))} ${(impact.finishMinute.after ?? 0) > (impact.finishMinute.before ?? 0) ? "later" : "earlier"}`}</td></tr>
            <tr><td>Idle court time</td><td className="num">{delta(impact.idleCourtMinutes.before, impact.idleCourtMinutes.after)}</td></tr>
            <tr><td>Back-to-backs</td><td className="num">{delta(impact.backToBacks.before, impact.backToBacks.after)}</td></tr>
            <tr><td>Shortest recovery</td><td className="num">{delta(impact.shortestRecovery.before, impact.shortestRecovery.after, false)}</td></tr>
          </tbody>
        </table>
      )}
      {proposal.valid && impact && impact.newWarnings.length > 0 && <Banner tone="warn" title="New warnings"><ul>{impact.newWarnings.slice(0, 5).map((m, i) => <li key={i}>{humanize(m)}</li>)}</ul></Banner>}
      {proposal.valid && impact && impact.resolvedWarnings.length > 0 && <Banner tone="ok" title="Warnings resolved"><ul>{impact.resolvedWarnings.slice(0, 5).map((m, i) => <li key={i}>{humanize(m)}</li>)}</ul></Banner>}
      <div className="row">
        <button className="btn primary" disabled={!proposal.valid} onClick={onApply}>{proposal.valid ? "Apply change" : "Cannot apply"}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
