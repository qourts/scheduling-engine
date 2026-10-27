import react from "@vitejs/plugin-react";
import { interpretPlugin } from "./server/interpretPlugin.js";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The engine is consumed from source so the app never needs a prebuilt dist. The only place that imports "@engine"
// is src/engine (the execution adapter) plus pure domain helpers; UI components talk to the engine through them.
export default defineConfig({
  plugins: [react(), interpretPlugin()],
  resolve: { alias: { "@engine": fileURLToPath(new URL("../../src/index.ts", import.meta.url)) } },
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
