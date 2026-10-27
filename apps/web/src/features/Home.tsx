import { useMemo, useRef, useState } from "react";
import { blankEvent } from "../domain/spec.js";
import { reconcileApproval } from "../domain/integrity.js";
import { SAMPLES } from "../domain/samples.js";
import { importProjectJson } from "../storage/exchange.js";
import { useWorkspace } from "../state/workspace.js";
import { useConfirm } from "../ui/confirm.js";
import { Icon } from "../ui/icons.js";
import { Banner, EmptyState, LOGO_ALT, LOGO_SRC, Pill } from "../ui/kit.js";

export function Home({ onOpened }: { onOpened: () => void }) {
  const w = useWorkspace();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const samples = useMemo(() => SAMPLES.map((s) => ({ ...s, spec: s.build() })), []);

  const readFile = async (f: File) => {
    const result = importProjectJson(await f.text());
    if (!result.ok) return setImportError(result.error);
    setImportError(null);
    // An imported approval is only honoured if it is consistent and the engine still passes the approved schedule.
    const { project, notes } = await reconcileApproval(w.runner, result.project);
    w.importProject(project, notes);
    onOpened();
  };

  return (
    <div className="stack" style={{ gap: "var(--s-8)" }}>
      <section className="hero-band" aria-label="Welcome">
        <div>
          <span className="eyebrow" style={{ color: "var(--q-mint)" }}>Tournament operations</span>
          <h1>Plan the whole tournament, court by court.</h1>
          <p>Set up your event, say what matters in plain English, compare three schedules, and fine-tune the one you pick. Every move is checked against the rules before it counts.</p>
          <div className="hero-actions">
            <button className="btn accent" onClick={() => { w.createProject(blankEvent()); onOpened(); }}><Icon name="plus" size={16} />New tournament</button>
            <button className="btn" onClick={() => file.current?.click()}><Icon name="file" size={16} />Import a saved file</button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <div className="hero-logo"><img src={LOGO_SRC} alt={LOGO_ALT} /></div>
      </section>

      {w.storageWarning && <Banner tone="warn" title="Saving is limited">{w.storageWarning}</Banner>}
      {importError && <Banner tone="bad" title="Could not import">{importError}</Banner>}

      <section className="stack">
        <div className="stack tight">
          <h2>Try a realistic example</h2>
          <p className="muted">Each example is a complete tournament you can generate, edit and approve.</p>
        </div>
        <div className="grid3">
          {samples.map((s) => (
            <div key={s.id} className="card interactive example-card">
              <h3>{s.title}{s.id === "echelon" && <Pill tone="warn">Experimental</Pill>}</h3>
              <p className="muted">{s.blurb}</p>
              <div className="example-meta">
                <span><b>{s.spec.courts.length}</b> courts</span>
                <span><b>{s.spec.divisions.length}</b> divisions</span>
                <span><b>{s.spec.days.length}</b> {s.spec.days.length === 1 ? "day" : "days"}</span>
              </div>
              <div>
                <button className="btn" onClick={() => { w.createProject(s.spec); onOpened(); }}>Open example</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="stack tight">
          <h2>Saved in this browser</h2>
          <p className="faint">These live only in this browser on this computer. They are not synchronised or backed up. Export a JSON file to keep a copy elsewhere.</p>
        </div>
        {w.projects.length === 0 ? (
          <EmptyState icon="calendar" title="Nothing saved yet">Your tournaments appear here as soon as you start one. They save automatically in this browser.</EmptyState>
        ) : (
          <div className="card flat" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Tournament</th><th>Status</th><th className="num">Matches placed</th><th>Last changed</th><th /></tr>
              </thead>
              <tbody>
                {w.projects.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td><Pill {...(p.status === "draft" ? {} : { tone: "ok" as const })}>{p.status}</Pill></td>
                    <td className="num">{p.matchesScheduled || "-"}</td>
                    <td>{new Date(p.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn small" onClick={() => void w.openProject(p.id).then(onOpened)}>Open</button>
                        <button
                          className="btn small danger"
                          onClick={async () => {
                            if (await confirm({ title: `Delete "${p.name}"?`, body: "It will be removed from this browser. This cannot be undone. Export it first if you want a copy.", confirmLabel: "Delete", tone: "danger" })) void w.deleteProject(p.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
