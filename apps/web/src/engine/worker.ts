import * as core from "./core.js";
import type { EngineCalls, WorkerRequest, WorkerResponse } from "./runner.js";

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, fn, args } = event.data;
  let response: WorkerResponse;
  try {
    const call = core[fn] as (...a: unknown[]) => unknown;
    response = { id, ok: true, value: call(...args) };
  } catch (error) {
    response = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  (self as unknown as Worker).postMessage(response);
};

export type { EngineCalls };
