import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";
import { handleInterpret, handleStatus, type InterpretDeps } from "./interpret.js";

const MAX_BODY_BYTES = 120_000;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, json: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(json));
}

/**
 * Local development adapter. The Anthropic key is read from the server environment (or an untracked .env file) and never
 * reaches the browser bundle. With no key configured the status endpoint says so and the interface hides AI interpretation.
 * A hosted deployment must put this behind authentication and rate limiting before use.
 */
export function interpretPlugin(): Plugin {
  let deps: InterpretDeps;
  return {
    name: "qourts-interpret-adapter",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      deps = { apiKey: process.env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL ?? env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5", fetchImpl: fetch };
    },
    configureServer(server) {
      server.middlewares.use("/api/interpret", (req, res) => {
        const url = req.url ?? "/";
        if (req.method === "GET" && url.startsWith("/status")) return send(res, 200, handleStatus(deps));
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
        readBody(req)
          .then((body) => handleInterpret(body, deps))
          .then((r) => send(res, r.status, r.json))
          .catch(() => send(res, 400, { error: "Bad request" }));
      });
    },
  };
}
