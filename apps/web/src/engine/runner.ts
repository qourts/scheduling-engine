import type * as Core from "./core.js";

/**
 * Execution adapter. The UI only ever talks to an EngineRunner. Today it is backed by a Web Worker in the browser (or the
 * engine in-thread under test); a RemoteRunner that posts the same calls to a server can replace it later without UI changes,
 * which keeps the optimizer movable behind a private service if the algorithms must not ship to browsers.
 */
export type EngineCalls = {
  prepare: typeof Core.prepare;
  generate: typeof Core.generate;
  check: typeof Core.check;
  checkInstructionProposal: typeof Core.checkInstructionProposal;
  validateRules: typeof Core.validateRules;
  describe: typeof Core.describe;
  matchInfo: typeof Core.matchInfo;
};

export type EngineRunner = { [K in keyof EngineCalls]: (...args: Parameters<EngineCalls[K]>) => Promise<ReturnType<EngineCalls[K]>> };

export const ENGINE_CALL_NAMES: (keyof EngineCalls)[] = ["prepare", "generate", "check", "checkInstructionProposal", "validateRules", "describe", "matchInfo"];

export interface WorkerRequest {
  id: number;
  fn: keyof EngineCalls;
  args: unknown[];
}

export type WorkerResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };
