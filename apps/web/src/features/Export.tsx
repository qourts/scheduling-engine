import { useEffect, useMemo, useState } from "react";
import type { Schedule, ScheduleReport } from "@engine";
import type { MatchInfo } from "../engine/core.js";
import { approvalRisks } from "../domain/editing.js";
import { newId, type Revision } from "../domain/project.js";
import { clock } from "../domain/spec.js";
import { downloadText, exportProjectJson, matrixToCsv, safeFilename, scheduleToCsv } from "../storage/exchange.js";
import { useWorkspace } from "../state/workspace.js";
import { Banner, Field, Pill } from "../ui/kit.js";
import { dayLabel } from "../ui/format.js";

export function Export() {
  const w = useWorkspace();
  const project = w.project!;
  const config = w.config!;
  const working = project.working;
  const rules = useMemo(() => project.rules.map((r) => r.instruction), [project.rules]);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [report, setReport] = useState<ScheduleReport | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    void w.runner.matchInfo(config).then(setMatches);
  }, [config, w.runner]);

  useEffect(() => {
    if (!working) return;
    let live = true;
    const locked = working.schedule.assignments.filter((a) => working.locks.includes(a.matchId));
    void w.runner.check(config, working.schedule, rules, locked, true).then((r) => {
      if (!live) return;
      setReport(r.report);
      setValid(r.valid);
      setProblems([...r.violations.map((v) => v.message), ...r.instructionViolations.map((v) => v.message)]);
    });
    return () => {
      live = false;
    };
  }, [working, rules, config, w.runner]);

  if (!working) {
    return (
      <div className="stack">
        <h1>Approve & export</h1>
        <Banner tone="info" title="No schedule yet">Choose a schedule on the Generate & compare step first.</Banner>
      </div>
    );
  }

  const risks = report ? approvalRisks(report, project.spec.experimentalNote) : [];
  const approvedRevision = project.revisions.find((r) => r.id === project.approvedRevisionId) ?? null;
  const isApproved = project.status !== "draft" && approvedRevision !== null;
  const exportSchedule: Schedule = isApproved && approvedRevision ? approvedRevision.schedule : working.schedule;
  const exportLocks = isApproved && approvedRevision ? approvedRevision.locks : working.locks;
  const tag = isApproved ? project.status : "DRAFT";
  const base = `${safeFilename(project.spec.name)}-${tag.toLowerCase()}`;

  const addRevision = (status: Revision["status"], name: string, acknowledgedRisks: string[]) => {
    const revision: Revision = { id: newId("rev"), at: Date.now(), label: name, status, schedule: structuredClone(working.schedule), locks: [...working.locks], acknowledgedRisks };
    w.update((p) => ({ ...p, revisions: [...p.revisions, revision], ...(status === "approved" ? { status: "approved" as const, approvedRevisionId: revision.id } : {}) }));
  };

  const approve = () => {
    addRevision("approved", label.trim() || "Approved schedule", risks);
    setAcknowledged(false);
    setLabel("");
  };

  const restore = (r: Revision) => {
    if (!window.confirm(`Restore "${r.label}" as your working schedule? Your current working schedule will be replaced (it stays available if you saved it as a revision).`)) return;
    w.update((p) => ({ ...p, status: "draft", working: { basedOn: "import", schedule: structuredClone(r.schedule), locks: [...r.locks] } }));
  };

  const canApprove = valid === true && (risks.length === 0 || acknowledged);

  return (
    <div className="stack">
      <div className="row">
        <h1>Approve & export</h1>
        <Pill {...(project.status === "draft" ? {} : { tone: "ok" as const })}>{project.status}</Pill>
      </div>

      <div className="card stack">
        <h2>Status</h2>
        <p className="muted">Draft is work in progress. Approved means you have reviewed this exact schedule. Published marks it as released; sending it to players or other systems is not part of this version.</p>
        {valid === false && <Banner tone="bad" title="This schedule does not pass the rules and cannot be approved"><ul>{problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}</ul></Banner>}
        {valid === true && risks.length > 0 && (
          <Banner tone="warn" title="Review these risks before approving">
            <ul>{risks.slice(0, 10).map((r, i) => <li key={i}>{r}</li>)}</ul>
            {project.spec.experimentalNote && <p><strong>This schedule is not suitable for live operations.</strong> Approval here only records that you reviewed it.</p>}
          </Banner>
        )}
        {project.status !== "draft" && approvedRevision && working.schedule !== approvedRevision.schedule && JSON.stringify(working.schedule) !== JSON.stringify(approvedRevision.schedule) && (
          <Banner tone="info" title="Working schedule differs from the approved one">Exports below use the approved schedule.</Banner>
        )}
        <div className="row">
          <Field label="Name for this version"><input type="text" value={label} placeholder="e.g. Friday final plan" onChange={(e) => setLabel(e.target.value)} /></Field>
        </div>
        {risks.length > 0 && valid === true && (
          <label className="field inline"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I have read these risks and still want to approve this schedule.</label>
        )}
        <div className="row">
          <button className="btn primary" disabled={!canApprove} onClick={approve}>Approve this schedule</button>
          <button className="btn" onClick={() => addRevision("draft", label.trim() || "Saved draft", [])}>Save as a draft revision</button>
          <button className="btn" disabled={project.status !== "approved"} onClick={() => w.update((p) => ({ ...p, status: "published" }))}>Mark as published</button>
          {project.status === "published" && <button className="btn" onClick={() => w.update((p) => ({ ...p, status: "approved" }))}>Withdraw publication</button>}
        </div>
      </div>

      <div className="card stack">
        <h2>Export</h2>
        <p className="muted">Exporting the {isApproved ? project.status : "draft"} schedule. {isApproved ? "" : "File names say DRAFT until you approve."}</p>
        <div className="row">
          <button className="btn" onClick={() => downloadText(`${base}.csv`, scheduleToCsv(config, matches, exportSchedule, exportLocks), "text/csv")}>Match list (CSV)</button>
          <button className="btn" onClick={() => downloadText(`${base}-court-grid.csv`, matrixToCsv(config, matches, exportSchedule), "text/csv")}>Court grid (CSV)</button>
          <button className="btn" onClick={() => downloadText(`${safeFilename(project.spec.name)}.qourts.json`, exportProjectJson(project), "application/json")}>Whole project (JSON)</button>
          <button className="btn accent" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
        <p className="faint">The JSON file includes the setup, rules, every revision and the working schedule, and can be imported on the home screen. It is your backup: this app does not sync or back up your work.</p>
      </div>

      <div className="card stack">
        <h2>Revisions</h2>
        {project.revisions.length === 0 ? <p className="muted">No revisions yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Saved</th><th /></tr></thead>
            <tbody>
              {[...project.revisions].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{r.label}{r.acknowledgedRisks.length > 0 && <div className="faint">{r.acknowledgedRisks.length} risk{r.acknowledgedRisks.length === 1 ? "" : "s"} acknowledged</div>}</td>
                  <td><Pill {...(r.status === "draft" ? {} : { tone: "ok" as const })}>{r.status}{r.id === project.approvedRevisionId ? " · current" : ""}</Pill></td>
                  <td>{new Date(r.at).toLocaleString()}</td>
                  <td><button className="btn small" onClick={() => restore(r)}>Restore as working</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PrintView title={project.spec.name} status={tag} experimental={project.spec.experimentalNote} config={config} matches={matches} schedule={exportSchedule} locks={exportLocks} />
    </div>
  );
}

function PrintView({ title, status, experimental, config, matches, schedule, locks }: { title: string; status: string; experimental: string | null; config: ReturnType<typeof useWorkspace>["config"] & object; matches: MatchInfo[]; schedule: Schedule; locks: string[] }) {
  const info = new Map(matches.map((m) => [m.id, m]));
  const division = new Map(config.divisions.map((d) => [d.id, d.name]));
  return (
    <section className="card stack" aria-label="Printable schedule">
      <h2>Print preview</h2>
      <h1 className="print-only">{title}</h1>
      <p><Pill tone={status === "DRAFT" ? "warn" : "ok"}>{status}</Pill> <span className="faint">Printed {new Date().toLocaleString()}</span></p>
      {experimental && <Banner tone="warn" title="Experimental assumptions - not approved for live operations">{experimental}</Banner>}
      {config.days.map((day) => {
        const todays = schedule.assignments.filter((a) => a.day === day).sort((a, b) => a.start - b.start || a.courtId.localeCompare(b.courtId));
        return (
          <div key={day} className="stack">
            <h3>{dayLabel(day)}</h3>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Start</th><th>End</th><th>Court</th><th>Division</th><th>Match</th><th>Round</th><th /></tr></thead>
                <tbody>
                  {todays.map((a) => {
                    const m = info.get(a.matchId);
                    return (
                      <tr key={a.matchId}>
                        <td className="num">{clock(a.start)}</td>
                        <td className="num">{clock(a.start + (m?.durationMinutes ?? 0))}</td>
                        <td>{config.courts.find((c) => c.id === a.courtId)?.name}</td>
                        <td>{m ? division.get(m.divisionId) : ""}</td>
                        <td>{m?.label}</td>
                        <td>{m?.roundLabel}{m?.phase === "knockout" ? " (participants decided by results)" : ""}</td>
                        <td>{locks.includes(a.matchId) ? "locked" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
