import { useRef, useState } from "react";
import { blankEvent } from "../domain/spec.js";
import { SAMPLES } from "../domain/samples.js";
import { reconcileApproval } from "../domain/integrity.js";
import { importProjectJson } from "../storage/exchange.js";
import { useWorkspace } from "../state/workspace.js";
import { Banner, Pill } from "../ui/kit.js";

export function Home({ onOpened }: { onOpened: () => void }) {
  const w = useWorkspace();
  const file = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

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
    <div className="stack">
      <section className="hero">
        <h1>Plan the whole tournament, court by court.</h1>
        <p className="muted">Set up your event, say what matters in plain English, compare three schedules, and fine-tune the one you pick. Every move is checked against the rules before it counts.</p>
      </section>

      {w.storageWarning && (
        <Banner tone="warn" title="Saving is limited">
          {w.storageWarning}
        </Banner>
      )}

      <div className="row">
        <button
          className="btn primary"
          onClick={() => {
            w.createProject(blankEvent());
            onOpened();
          }}
        >
          New tournament
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          Import a saved file
        </button>
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
      {importError && (
        <Banner tone="bad" title="Could not import">
          {importError}
        </Banner>
      )}

      <section className="stack">
        <h2>Try a realistic example</h2>
        <div className="grid3">
          {SAMPLES.map((s) => (
            <div key={s.id} className="card stack">
              <h3>{s.title}</h3>
              <p className="muted">{s.blurb}</p>
              {s.id === "echelon" && <Pill tone="warn">Experimental assumptions</Pill>}
              <div>
                <button
                  className="btn"
                  onClick={() => {
                    w.createProject(s.build());
                    onOpened();
                  }}
                >
                  Open example
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Saved in this browser</h2>
        <p className="faint">These live only in this browser on this computer. They are not synchronised or backed up. Export a JSON file to keep a copy elsewhere.</p>
        {w.projects.length === 0 ? (
          <p className="muted">Nothing saved yet.</p>
        ) : (
          <div className="card flat">
            <table>
              <thead>
                <tr>
                  <th>Tournament</th>
                  <th>Status</th>
                  <th>Matches placed</th>
                  <th>Last changed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {w.projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      <Pill {...(p.status === "draft" ? {} : { tone: "ok" as const })}>{p.status}</Pill>
                    </td>
                    <td className="num">{p.matchesScheduled || "-"}</td>
                    <td>{new Date(p.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="row">
                        <button className="btn small" onClick={() => void w.openProject(p.id).then(onOpened)}>
                          Open
                        </button>
                        <button
                          className="btn small danger"
                          onClick={() => {
                            if (window.confirm(`Delete "${p.name}" from this browser? This cannot be undone.`)) void w.deleteProject(p.id);
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
