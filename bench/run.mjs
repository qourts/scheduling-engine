// Optimizer benchmark. Run `npm run bench` (builds first). Results depend on the machine:
// the numbers are engineering measurements on the hardware printed below, not guarantees.
import os from "node:os";
import { performance } from "node:perf_hooks";
import { buildInventory, optimizeSchedules, validateSchedule } from "../dist/index.js";
import { generateTournament } from "./generate.mjs";

const CASES = [
  { name: "typical-small", courts: 5, targetMatches: 100, days: 2, targetSeconds: 10 },
  { name: "typical-mid", courts: 8, targetMatches: 200, days: 2, targetSeconds: 10 },
  { name: "typical-upper", courts: 10, targetMatches: 300, days: 3, targetSeconds: 10 },
  { name: "large", courts: 20, targetMatches: 500, days: 2, targetSeconds: 30 },
];

const only = process.argv[2];
const cpu = os.cpus()[0];
console.log(`Node ${process.version} on ${os.platform()} ${os.arch()} (${os.release()})`);
console.log(`CPU: ${cpu.model.trim()} x${os.cpus().length}, RAM ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB`);
console.log("");

for (const c of CASES) {
  if (only && c.name !== only) continue;
  const config = generateTournament({ courts: c.courts, targetMatches: c.targetMatches, days: c.days, seed: 11 });
  const inventory = buildInventory(config);
  const started = performance.now();
  const result = optimizeSchedules(inventory, { seed: 1 });
  const seconds = (performance.now() - started) / 1000;
  const independentlyValid = result.options.every((o) => validateSchedule(inventory, o.schedule).valid);
  console.log(`${c.name}: ${inventory.matches.length} matches, ${c.courts} courts, ${c.days} day(s)`);
  console.log(`  status=${result.status} options=${result.options.length} time=${seconds.toFixed(2)}s (target ${c.targetSeconds}s, ${seconds <= c.targetSeconds ? "met" : "MISSED"}) independently valid=${independentlyValid}`);
  for (const o of result.options) {
    const m = o.metrics;
    console.log(
      `  ${o.label} ${o.name.padEnd(20)} finish=${m.finishMinute} idle=${m.idleMinutes} b2b=${m.backToBackCount} short=${m.shortRecoveryCount} fairness=${m.recoveryFairness.toFixed(1)} stop=${o.search.stopReason} budgetExhausted=${o.budgetExhausted}`,
    );
  }
  for (const line of result.comparison.explanation) console.log(`  note: ${line}`);
  if (result.failure) console.log(`  unplaced: ${result.failure.unplaced.length}`);
  console.log("");
}
