import * as core from "./core.js";
import { ENGINE_CALL_NAMES, type EngineRunner } from "./runner.js";

/** Runs the engine on the calling thread. Used by tests and as a fallback when Workers are unavailable. */
export function createInlineRunner(): EngineRunner {
  const runner: Record<string, unknown> = {};
  for (const name of ENGINE_CALL_NAMES) {
    const fn = core[name] as (...args: unknown[]) => unknown;
    runner[name] = (...args: unknown[]) => Promise.resolve().then(() => fn(...args));
  }
  return runner as EngineRunner;
}
