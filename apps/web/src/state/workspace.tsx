import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TournamentConfig } from "@engine";
import { buildConfig } from "../domain/buildConfig.js";
import { newProject, type Project } from "../domain/project.js";
import { type EventSpec } from "../domain/spec.js";
import type { EngineRunner } from "../engine/runner.js";
import { openStore, type ProjectStore, type ProjectSummary } from "../storage/store.js";

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface Workspace {
  runner: EngineRunner;
  storeKind: ProjectStore["kind"] | "loading";
  storageWarning: string | null;
  projects: ProjectSummary[];
  project: Project | null;
  /** Engine configuration derived from the project spec; null until a project is open. */
  config: TournamentConfig | null;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  createProject(spec: EventSpec): void;
  openProject(id: string): Promise<void>;
  importProject(project: Project): void;
  deleteProject(id: string): Promise<void>;
  closeProject(): void;
  /** Applies an edit to the open project; autosave follows. */
  update(change: (p: Project) => Project): void;
  saveNow(): Promise<void>;
}

const Context = createContext<Workspace | null>(null);

export const useWorkspace = (): Workspace => {
  const w = useContext(Context);
  if (!w) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return w;
};

const AUTOSAVE_DELAY_MS = 700;

export function WorkspaceProvider({ runner, store: injected, children }: { runner: EngineRunner; store?: ProjectStore; children: ReactNode }) {
  const [store, setStore] = useState<ProjectStore | null>(injected ?? null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const dirty = useRef(false);
  const latest = useRef<Project | null>(null);
  latest.current = project;

  useEffect(() => {
    if (injected) return;
    let cancelled = false;
    void openStore().then(({ store: s, warning }) => {
      if (cancelled) return;
      setStore(s);
      setStorageWarning(warning);
    });
    return () => {
      cancelled = true;
    };
  }, [injected]);

  const refresh = useCallback(async (s: ProjectStore) => {
    try {
      setProjects(await s.list());
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : "Could not read saved projects.");
    }
  }, []);

  useEffect(() => {
    if (store) void refresh(store);
  }, [store, refresh]);

  const persist = useCallback(async () => {
    const current = latest.current;
    if (!store || !current || !dirty.current) return;
    setSaveState("saving");
    try {
      await store.put(current);
      dirty.current = latest.current !== current;
      setSaveState(dirty.current ? "unsaved" : "saved");
      setSaveError(null);
      setLastSavedAt(Date.now());
      void refresh(store);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "The save failed.");
    }
  }, [store, refresh]);

  useEffect(() => {
    if (!project || !dirty.current) return;
    const timer = setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, persist]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const open = useCallback((p: Project, markDirty: boolean) => {
    dirty.current = markDirty;
    setProject(p);
    setSaveState(markDirty ? "unsaved" : "saved");
    setSaveError(null);
  }, []);

  const config = useMemo(() => (project ? buildConfig(project.spec) : null), [project?.spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<Workspace>(
    () => ({
      runner,
      storeKind: store?.kind ?? "loading",
      storageWarning,
      projects,
      project,
      config,
      saveState,
      saveError,
      lastSavedAt,
      createProject: (spec) => open(newProject(spec), true),
      importProject: (p) => open({ ...p, updatedAt: Date.now() }, true),
      openProject: async (id) => {
        if (!store) return;
        const p = await store.get(id);
        if (p) open(p, false);
      },
      deleteProject: async (id) => {
        if (!store) return;
        await store.remove(id);
        if (latest.current?.id === id) setProject(null);
        await refresh(store);
      },
      closeProject: () => {
        void persist().then(() => setProject(null));
      },
      update: (change) => {
        setProject((p) => {
          if (!p) return p;
          dirty.current = true;
          return { ...change(p), updatedAt: Date.now() };
        });
        setSaveState("unsaved");
      },
      saveNow: persist,
    }),
    [runner, store, storageWarning, projects, project, config, saveState, saveError, lastSavedAt, open, persist, refresh],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
