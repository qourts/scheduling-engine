import { useEffect, useState } from "react";
import { Compare } from "./features/Compare.js";
import { Export } from "./features/Export.js";
import { Home } from "./features/Home.js";
import { Matrix } from "./features/Matrix.js";
import { Rules } from "./features/Rules.js";
import { Wizard } from "./features/Wizard.js";
import { useWorkspace, type SaveState } from "./state/workspace.js";
import { Icon } from "./ui/icons.js";
import { Banner, LOGO_ALT, LOGO_SRC, Pill } from "./ui/kit.js";
import { savedAgo } from "./ui/format.js";

export type StepId = "setup" | "rules" | "compare" | "schedule" | "export";

const STEPS: { id: StepId; label: string }[] = [
  { id: "setup", label: "Set up" },
  { id: "rules", label: "Special rules" },
  { id: "compare", label: "Generate & compare" },
  { id: "schedule", label: "Schedule" },
  { id: "export", label: "Approve & export" },
];

type Theme = "light" | "dark";
const THEME_KEY = "qourts.workspace-theme";

function useWorkspaceTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.workspace = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage can be blocked; the theme still applies for this session */
    }
  }, [theme]);
  return [theme, setTheme];
}

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
  const [theme, setTheme] = useWorkspaceTheme();
  const project = w.project;
  const done: Record<StepId, boolean> = {
    setup: !!project && project.spec.divisions.length > 0,
    rules: !!project && project.rules.length > 0,
    compare: !!project?.generation,
    schedule: !!project?.working,
    export: !!project && project.status !== "draft",
  };

  return (
    <div className="app">
      <header className="shell">
        <div className="shell-top">
          <button className="logo-plate" onClick={() => (project ? w.closeProject() : undefined)} aria-label="Qourts Smart Scheduler home">
            <img src={LOGO_SRC} alt={LOGO_ALT} />
          </button>
          <span className="shell-product">Smart Scheduler</span>
          {project && (
            <div className="shell-project">
              <span className="shell-name" title={project.spec.name}>{project.spec.name}</span>
              <Pill {...(project.status === "draft" ? {} : { tone: "ok" as const })}>{project.status}</Pill>
            </div>
          )}
          <span className="spacer" />
          {project && <SaveIndicator />}
          <div className="seg" role="group" aria-label="Workspace theme">
            <button aria-pressed={theme === "light"} onClick={() => setTheme("light")} title="Light workspace"><Icon name="sun" size={15} /><span className="sr-only">Light workspace</span></button>
            <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} title="Dark workspace"><Icon name="moon" size={15} /><span className="sr-only">Dark workspace</span></button>
          </div>
          {project && <button className="btn small" onClick={() => void w.saveNow()}>Save now</button>}
        </div>
        {project && (
          <nav className="steps" aria-label="Workflow">
            {STEPS.map((s, i) => (
              <button key={s.id} className={`step${done[s.id] && step !== s.id ? " done" : ""}`} aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)}>
                <span className="n">{done[s.id] && step !== s.id ? <Icon name="check" size={13} /> : i + 1}</span>
                {s.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className={`workspace${project && step === "schedule" ? " wide" : ""}`}>
        {w.notice && (
          <div className="row" style={{ marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <Banner tone="warn" title="Approval withdrawn">{w.notice}</Banner>
            </div>
            <button className="btn small" onClick={w.dismissNotice}>Dismiss</button>
          </div>
        )}
        {!project ? (
          <Home onOpened={() => setStep("setup")} />
        ) : step === "setup" ? (
          <Wizard onDone={() => setStep("rules")} />
        ) : step === "rules" ? (
          <Rules onNext={() => setStep("compare")} />
        ) : step === "compare" ? (
          <Compare onPicked={() => setStep("schedule")} onReviseLocks={() => setStep("schedule")} />
        ) : step === "schedule" ? (
          <Matrix onNext={() => setStep("export")} onGenerate={() => setStep("compare")} />
        ) : (
          <Export />
        )}
      </main>
    </div>
  );
}
