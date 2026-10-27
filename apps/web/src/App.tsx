import { useState } from "react";
import { Compare } from "./features/Compare.js";
import { Export } from "./features/Export.js";
import { Home } from "./features/Home.js";
import { Matrix } from "./features/Matrix.js";
import { Rules } from "./features/Rules.js";
import { Wizard } from "./features/Wizard.js";
import { useWorkspace, type SaveState } from "./state/workspace.js";
import { Banner, Pill } from "./ui/kit.js";
import { savedAgo } from "./ui/format.js";

export type StepId = "setup" | "rules" | "compare" | "schedule" | "export";

const STEPS: { id: StepId; label: string }[] = [
  { id: "setup", label: "Set up" },
  { id: "rules", label: "Special rules" },
  { id: "compare", label: "Generate & compare" },
  { id: "schedule", label: "Schedule" },
  { id: "export", label: "Approve & export" },
];

function SaveIndicator() {
  const w = useWorkspace();
  const memory = w.storeKind === "memory";
  const labels: Record<SaveState, { text: string; tone?: "ok" | "warn" | "bad" | "info" }> = {
    idle: { text: "" },
    unsaved: { text: memory ? "Not stored (memory only)" : "Unsaved changes", tone: "warn" },
    saving: { text: "Saving…", tone: "info" },
    saved: { text: memory ? "Kept in memory only" : `Saved in this browser · ${savedAgo(w.lastSavedAt) || "loaded"}`, tone: memory ? "warn" : "ok" },
    error: { text: `Not saved: ${w.saveError ?? "storage failed"}`, tone: "bad" },
  };
  const { text, tone } = labels[w.saveState];
  if (!text) return null;
  return <Pill {...(tone ? { tone } : {})}>{text}</Pill>;
}

export default function App() {
  const w = useWorkspace();
  const [step, setStep] = useState<StepId>("setup");

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => (w.project ? w.closeProject() : undefined)} aria-label="Qourts Smart Scheduler home">
          <span className="mark" aria-hidden="true">Q</span>
          <span>Qourts <small>Smart Scheduler</small></span>
        </button>
        {w.project && <span className="projname">{w.project.spec.name}</span>}
        {w.project && <Pill tone={w.project.status === "draft" ? undefined : "ok"}>{w.project.status}</Pill>}
        <span className="spacer" />
        {w.project && <SaveIndicator />}
        {w.project && <button className="btn small" onClick={() => void w.saveNow()}>Save now</button>}
      </header>

      {w.project && (
        <nav className="steps" aria-label="Workflow">
          {STEPS.map((s, i) => (
            <button key={s.id} className="step" aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)}>
              <span className="n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
      )}

      <main>
        {w.notice && (
          <div className="row" style={{ marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <Banner tone="warn" title="Approval withdrawn">{w.notice}</Banner>
            </div>
            <button className="btn small" onClick={w.dismissNotice}>Dismiss</button>
          </div>
        )}
        {!w.project ? (
          <Home onOpened={() => setStep("setup")} />
        ) : step === "setup" ? (
          <Wizard onDone={() => setStep("rules")} />
        ) : step === "rules" ? (
          <Rules onNext={() => setStep("compare")} />
        ) : step === "compare" ? (
          <Compare onPicked={() => setStep("schedule")} onReviseLocks={() => setStep("schedule")} />
        ) : step === "schedule" ? (
          <Matrix onNext={() => setStep("export")} />
        ) : (
          <Export />
        )}
      </main>
    </div>
  );
}
