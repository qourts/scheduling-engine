import { ENGINE_CALL_NAMES, type EngineRunner, type WorkerRequest, type WorkerResponse } from "./runner.js";
import { createInlineRunner } from "./inlineRunner.js";

/** Engine in a dedicated Web Worker so optimisation never blocks the interface. Falls back to in-thread if Workers fail to start. */
export function createWorkerRunner(): EngineRunner {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch {
    return createInlineRunner();
  }
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.value);
    else entry.reject(new Error(event.data.error));
  };
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || "The scheduling engine stopped unexpectedly."));
    pending.clear();
  };
  const runner: Record<string, unknown> = {};
  for (const name of ENGINE_CALL_NAMES) {
    runner[name] = (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const request: WorkerRequest = { id, fn: name, args };
        worker.postMessage(request);
      });
  }
  return runner as EngineRunner;
}
