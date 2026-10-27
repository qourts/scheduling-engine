import { PROJECT_SCHEMA_VERSION, type Project } from "../domain/project.js";

/**
 * Persistence port. The first release is local-first (IndexedDB in this browser); a cloud implementation can be added
 * behind the same interface later. Nothing here synchronises or backs data up, and the UI must never say it does.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  status: Project["status"];
  matchesScheduled: number;
}

export interface ProjectStore {
  /** "browser": IndexedDB. "memory": nothing survives a reload. */
  readonly kind: "browser" | "memory";
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project | null>;
  put(project: Project): Promise<void>;
  remove(id: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export const summarise = (p: Project): ProjectSummary => ({ id: p.id, name: p.spec.name, updatedAt: p.updatedAt, status: p.status, matchesScheduled: p.working?.schedule.assignments.length ?? 0 });

/** Holds projects in memory only. Used when IndexedDB is unavailable, and in tests. */
export function createMemoryStore(): ProjectStore {
  const items = new Map<string, Project>();
  return {
    kind: "memory",
    list: async () => [...items.values()].map(summarise).sort((a, b) => b.updatedAt - a.updatedAt),
    get: async (id) => {
      const p = items.get(id);
      return p ? structuredClone(p) : null;
    },
    put: async (p) => void items.set(p.id, structuredClone(p)),
    remove: async (id) => void items.delete(id),
  };
}

const DB_NAME = "qourts-smart-scheduler";
const STORE = "projects";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError(request.error?.message ?? "Browser storage request failed.", request.error));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new StorageError("This browser does not provide IndexedDB storage."));
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (error) {
      return reject(new StorageError("Browser storage is blocked (private mode or site settings).", error));
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError(request.error?.message ?? "Could not open browser storage.", request.error));
    request.onblocked = () => reject(new StorageError("Browser storage is blocked by another open tab."));
  });
}

/** IndexedDB-backed store. Every operation reports failure as a StorageError so the UI can say the save did not happen. */
export async function createIndexedDbStore(): Promise<ProjectStore> {
  const db = await openDb();
  const run = async <T>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    try {
      const tx = db.transaction(STORE, mode);
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new StorageError(tx.error?.message ?? "Browser storage write failed.", tx.error));
        tx.onabort = () => reject(new StorageError(tx.error?.name === "QuotaExceededError" ? "Browser storage is full. Export your work and free space." : (tx.error?.message ?? "Browser storage write was aborted."), tx.error));
      });
      const value = await promisify(body(tx.objectStore(STORE)));
      await done;
      return value;
    } catch (error) {
      throw error instanceof StorageError ? error : new StorageError("Browser storage failed.", error);
    }
  };
  return {
    kind: "browser",
    list: async () => (await run("readonly", (s) => s.getAll() as IDBRequest<Project[]>)).map(summarise).sort((a, b) => b.updatedAt - a.updatedAt),
    get: async (id) => (await run("readonly", (s) => s.get(id) as IDBRequest<Project | undefined>)) ?? null,
    put: async (p) => void (await run("readwrite", (s) => s.put(p))),
    remove: async (id) => void (await run("readwrite", (s) => s.delete(id))),
  };
}

/** Best available store. Never throws: falls back to memory and says why. */
export async function openStore(): Promise<{ store: ProjectStore; warning: string | null }> {
  try {
    return { store: await createIndexedDbStore(), warning: null };
  } catch (error) {
    const why = error instanceof Error ? error.message : "Browser storage is unavailable.";
    return { store: createMemoryStore(), warning: `${why} Your work is kept in memory only and will be lost on reload. Export a JSON file to keep it.` };
  }
}

export { PROJECT_SCHEMA_VERSION };
