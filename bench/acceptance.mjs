// Operational acceptance run for the optimizer on a synthetic 288-match tournament.
// Usage: npm run build && node bench/acceptance.mjs [--write]
// Prints a Markdown report built only from measured results; --write saves it to
// docs/acceptance/milestone-2-acceptance.md. All data is synthetic.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import * as engine from "../dist/index.js";
import { actualConflicts, buildEchelonConfig, categoryWindows, instructionCases, problemCases, verifyEnforcement } from "./echelon.mjs";

const { buildInventory, optimizeSchedules, analyzeSchedule, validateSchedule, validateScheduleWithInstructions, validateConfig, analyzeFeasibility, describeInstruction } = engine;

const out = [];
const line = (text = "") => out.push(text);
const heading = (level, text) => line(`\n${"#".repeat(level)} ${text}\n`);
const table = (headers, rows) => {
  line(`| ${headers.join(" | ")} |`);
  line(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) line(`| ${row.join(" | ")} |`);
  line();
};
const hm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.round(minute % 60)).padStart(2, "0")}`;
const hours = (minutes) => `${(minutes / 60).toFixed(1)} h`;
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;

const SEED = 1;
const config = buildEchelonConfig();
const inventory = buildInventory(config);
const base = categoryWindows();
const cpu = os.cpus()[0];

line("# Milestone 2 operational acceptance report");
line();
line("Synthetic data only. Every number below was produced by `bench/acceptance.mjs` on the machine described here; nothing is asserted without a measurement.");
heading(2, "0. Environment");
line(`- Node ${process.version}, ${os.platform()} ${os.arch()}, ${cpu.model.trim()} x${os.cpus().length}, ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB RAM`);
line(`- Optimizer seed ${SEED}, default budget (time cap ${inventory.matches.length <= 300 ? "8" : "24"} s, 30000 iterations per strategy)`);

// ---------------------------------------------------------------- 1. scenario
heading(2, "1. Scenario");
const valid = validateConfig(config);
const count = (p) => inventory.matches.filter(p).length;
const prelim = count((m) => m.phase === "group");
const semis = count((m) => m.phase === "knockout" && m.round === 1);
const medal = count((m) => m.thirdPlace || (m.phase === "knockout" && m.round === 2));
const pools = new Set(inventory.matches.filter((m) => m.phase === "group").map((m) => `${m.divisionId}|${m.groupId}`)).size;
table(
  ["Item", "Value"],
  [
    ["Courts", `${config.courts.length}, ${config.days.length} days, ${hm(config.courts[0].availability[0].start)}-${hm(config.courts[0].availability[0].end)} each day`],
    ["Categories x skill divisions", `${config.categories.length} x 3 = ${config.divisions.length} divisions`],
    ["Pools (brackets) of 4 teams", `${pools} (teams: ${inventory.teamById.size})`],
    ["Preliminary round-robin matches", String(prelim)],
    ["Semifinals / medal matches", `${semis} / ${medal}`],
    ["Total matches", String(inventory.matches.length)],
    ["Durations", `preliminary and semifinal ${config.divisions[0].matchDurationMinutes} min, medal ${config.divisions[0].medalMatchDurationMinutes} min, court turnover ${config.rules.courtTurnoverMinutes} min`],
    ["Minimum recovery rule", `${config.rules.minRestMinutes} min`],
    ["Category windows (mandatory)", base.map((i) => describeInstruction(i, config)).join(" ")],
    ["Configuration valid", String(valid.valid)],
    ["Feasibility (necessary conditions)", analyzeFeasibility(inventory).status],
  ],
);

// ---------------------------------------------------------------- 2. run
heading(2, "2. Three-option run");
const t0 = performance.now();
const result = optimizeSchedules(inventory, { seed: SEED, instructions: base });
const wall = performance.now() - t0;
const d = result.diagnostics;
line(`Status **${result.status}**, ${result.options.length} options, wall time **${seconds(wall)}** (target 10 s for typical events).`);
line();
table(
  ["Phase", "Time"],
  [
    ["Construction (all strategies, outside the search cap)", seconds(d.timing.constructionMs)],
    ["Local search", seconds(d.timing.searchMs)],
    ["Verification (independent validators)", seconds(d.timing.verificationMs)],
    ["Diversification and finish pass", seconds(d.timing.diversificationMs)],
    ["Total", seconds(d.timing.totalMs)],
  ],
);
line(`Construction method per strategy: ${Object.entries(d.construction).map(([k, v]) => `${k}=${v}`).join(", ")}. Time limited: ${d.timeLimited}. Budget overrun: ${d.budgetOverrunMs.toFixed(0)} ms.`);
if (result.status !== "ok") {
  line(`Failure: ${result.failure?.kind} - ${result.failure?.statement}`);
  console.log(out.join("\n"));
  process.exit(1);
}

const reports = new Map(result.options.map((o) => [o.strategy, analyzeSchedule(inventory, o.schedule)]));
const rep = (o) => reports.get(o.strategy);

// ---------------------------------------------------------------- 3. comparison
heading(2, "3. Side-by-side comparison (measured)");
const cols = result.options.map((o) => `${o.label} ${o.name}`);
const row = (label, f) => [label, ...result.options.map((o) => f(o, rep(o)))];
table(
  ["Measure", ...cols],
  [
    row("Planned start", (o, r) => r.start.label),
    row("Planned finish", (o, r) => r.finish.label),
    row("Total scheduling duration (first start to last end)", (o, r) => `${hours(r.spanMinutes)} (${hours(r.playingDayMinutes)} inside court open hours)`),
    row("Matches successfully scheduled", (o, r) => `${r.scheduledMatches} of ${r.totalMatches}`),
    row("Total idle court-minutes", (o, r) => String(r.idleCourtMinutes)),
    row("Overall court utilization", (o, r) => pct(r.courts.reduce((s, c) => s + c.busyMinutes, 0) / r.courts.reduce((s, c) => s + c.availableMinutes, 0))),
    row("Recovery gaps measured", (o, r) => String(r.recovery.gapCount)),
    row("Back-to-back occurrences (gap < " + rep(result.options[0]).assumptions.backToBackThresholdMinutes + " min)", (o, r) => String(r.recovery.backToBackOccurrences)),
    row("Teams / feeder links affected by back-to-backs", (o, r) => String(r.recovery.backToBackAffectedTeams)),
    row("Recoveries below comfort (" + rep(result.options[0]).assumptions.comfortThresholdMinutes + " min)", (o, r) => String(r.recovery.shortRecoveryOccurrences)),
    row("Recovery min / average / max (min)", (o, r) => `${r.recovery.minMinutes} / ${r.recovery.meanMinutes.toFixed(1)} / ${r.recovery.maxMinutes}`),
    row("Recovery fairness (std dev of mean recovery, min)", (o) => o.metrics.recoveryFairness.toFixed(1)),
    row("Teams whose pool play is split across both days", (o, r) => String(r.recovery.teamsSplitAcrossDays)),
    row("Longest wait between a team's matches", (o, r) => `${r.longestWaits[0].longestGapMinutes} min (${r.longestWaits[0].teamName})`),
    row("Court switches between divisions", (o) => String(o.metrics.courtSwitches)),
    row("Warnings (risk / info)", (o, r) => `${r.warnings.filter((w) => w.severity === "risk").length} / ${r.warnings.filter((w) => w.severity === "info").length}`),
  ],
);

heading(3, "Court utilization by court (busy minutes / available minutes inside the schedule span)");
table(
  ["Court", ...cols],
  config.courts.map((c) => [c.name, ...result.options.map((o) => {
    const u = rep(o).courts.find((x) => x.courtId === c.id);
    return `${pct(u.utilization)} (${u.matches} matches, idle ${u.idleMinutes})`;
  })]),
);

heading(3, "Completion by category");
table(
  ["Category", ...cols],
  config.categories.map((c) => [c.name, ...result.options.map((o) => rep(o).categories.find((x) => x.categoryId === c.id).finish.label)]),
);

heading(3, "Completion by division, and preliminary-to-playoff transition (minutes between a semifinal starting and the last pool match it depends on ending; never below the rest rule)");
table(
  ["Division", ...cols],
  config.divisions.map((dv) => [dv.name, ...result.options.map((o) => {
    const t = rep(o).divisions.find((x) => x.divisionId === dv.id);
    return `${t.finish.label}; transition ${t.transitionMinutes} min`;
  })]),
);

heading(3, "Teams with the shortest recovery (certain participants and feeder links)");
for (const o of result.options) {
  line(`**${o.label} ${o.name}**`);
  line();
  table(["Team / link", "Gap (min)", "Between"], rep(o).recovery.shortest.map((g) => [g.ownerName, String(g.gapMinutes), `${g.before} -> ${g.after}`]));
}
heading(3, "Teams with the longest waits");
for (const o of result.options) {
  line(`**${o.label} ${o.name}**`);
  line();
  table(["Team", "Longest gap (min)", "Total waiting (min)", "Matches"], rep(o).longestWaits.map((w) => [w.teamName, String(w.longestGapMinutes), String(w.totalWaitMinutes), String(w.matches)]));
}

heading(3, "Warnings and operational risks");
for (const o of result.options) {
  const r = rep(o);
  const byCode = {};
  for (const w of r.warnings) byCode[w.code] = (byCode[w.code] ?? 0) + 1;
  line(`**${o.label} ${o.name}**: ${Object.entries(byCode).map(([k, v]) => `${k} x${v}`).join(", ") || "none"}`);
  for (const w of r.warnings.filter((x) => x.code !== "BACK_TO_BACK").slice(0, 4)) line(`- ${w.severity}: ${w.message}`);
  for (const w of r.warnings.filter((x) => x.code === "BACK_TO_BACK").slice(0, 3)) line(`- ${w.severity}: ${w.message}`);
  line();
}

// ---------------------------------------------------------------- distinctness
heading(3, "Distinctness of the options");
table(
  ["Pair", "Matches placed differently", "Differs on", "Pareto relation", "Materially different"],
  result.comparison.relations.map((r) => [`${r.a} vs ${r.b}`, pct(r.assignmentDistance), r.differsOn.join(", ") || "-", r.dominance, String(r.materiallyDifferent)]),
);
for (const r of result.comparison.relations) line(`- ${r.summary}`);
for (const e of result.comparison.explanation) line(`- ${e}`);
line();
const best = {};
for (const o of result.options) best[o.strategy] = o;
const A = best.fastest_finish;
const B = best.balanced_operations;
const C = best.player_first;
heading(3, "Recommendation");
line(`**Recommended: ${result.recommended.strategy}.** ${result.recommended.reason}`);
if (A && B && C) {
  const ra = rep(A);
  const rb = rep(B);
  const rc = rep(C);
  line();
  line("Calculated basis:");
  line(`- Finish: A ${ra.finish.label}, B ${rb.finish.label}, C ${rc.finish.label}.`);
  line(`- Back-to-backs: A ${ra.recovery.backToBackOccurrences}, B ${rb.recovery.backToBackOccurrences}, C ${rc.recovery.backToBackOccurrences}. Minimum recovery: A ${ra.recovery.minMinutes}, B ${rb.recovery.minMinutes}, C ${rc.recovery.minMinutes} min.`);
  line(`- Idle court-minutes: A ${ra.idleCourtMinutes}, B ${rb.idleCourtMinutes}, C ${rc.idleCourtMinutes}.`);
  line(`- Overall, B finishes ${B.metrics.finishMinute - A.metrics.finishMinute} min after A and ${C.metrics.finishMinute - B.metrics.finishMinute} min before C, with ${ra.recovery.backToBackOccurrences - rb.recovery.backToBackOccurrences} fewer back-to-backs than A and ${rb.recovery.backToBackOccurrences - rc.recovery.backToBackOccurrences} more than C.`);
}

// ---------------------------------------------------------------- 4. sample schedule
const rec = best[result.recommended.strategy];
heading(2, `4. Sample court-by-court schedule (${rec.name}, day 1, first 8 matches per court)`);
for (const c of config.courts) {
  const own = rec.schedule.assignments.filter((a) => a.courtId === c.id && a.day === config.days[0]).sort((x, y) => x.start - y.start).slice(0, 8);
  line(`- **${c.name}**: ${own.map((a) => { const m = inventory.matchById.get(a.matchId); return `${hm(a.start)}-${hm(a.start + m.durationMinutes)} ${m.divisionId} ${m.label}`; }).join("; ")}`);
}

// ---------------------------------------------------------------- 5. short-rest examples
heading(2, "5. Examples of short-rest and back-to-back warnings (recommended option)");
for (const g of rep(rec).recovery.shortest) line(`- ${g.ownerName}: ${g.gapMinutes} minutes between ${g.before} and ${g.after}.`);
line();
line(`Recovery basis: ${JSON.stringify(rep(rec).assumptions)}. A match's allocated time already includes warm-up; court turnover (${config.rules.courtTurnoverMinutes} min) is a court buffer and is neither added to nor removed from player recovery. Recovery from the end of active play is therefore at least the figures above.`);

// ---------------------------------------------------------------- 6. instruction cases
heading(2, "6. Structured special-instruction tests (instructions enforced on all returned options)");
const cases = instructionCases();
const rows = [];
for (const c of cases) {
  const started = performance.now();
  const r = optimizeSchedules(inventory, { seed: SEED, instructions: [...base, ...c.instructions] });
  const ms = performance.now() - started;
  if (r.status !== "ok") {
    rows.push([c.request, r.status, "-", r.failure ? `${r.failure.kind}: ${r.failure.statement}` : (r.instructionIssues ?? []).map((i) => i.message).join(" "), seconds(ms)]);
    continue;
  }
  const checks = r.options.map((o) => {
    const baselineOption = result.options.find((x) => x.strategy === o.strategy);
    const independent = verifyEnforcement(c.id, inventory, o.schedule, baselineOption?.schedule);
    const full = validateScheduleWithInstructions(inventory, o.schedule, [...base, ...c.instructions]);
    const valid = full.ok && full.value.valid;
    return `${o.label}: ${independent.ok ? "enforced" : "NOT ENFORCED"}, ${valid ? "valid" : "INVALID"} (${independent.detail})`;
  });
  rows.push([c.request, `ok, ${r.options.length} options`, c.instructions.map((i) => i.strength === "mandatory" ? "mandatory" : "preference").join(", "), checks.join("<br>"), seconds(ms)]);
}
table(["Request (structured; times are explicit boundaries)", "Result", "Strength", "Independent enforcement check", "Time"], rows);

heading(3, "Contradictory, impossible and unsupported requests");
const problemRows = [];
for (const c of problemCases()) {
  const r = optimizeSchedules(inventory, { seed: SEED, instructions: [...base, ...c.instructions], budget: { iterationsPerStrategy: 1500 }, diversityAttempts: 0 });
  const kind = r.status === "no_schedule" ? r.failure.kind : r.status;
  const message = r.status === "invalid_instructions" ? r.instructionIssues.filter((i) => i.severity === "error").map((i) => `[${i.code}] ${i.message}`).join(" ") : r.status === "no_schedule" ? r.failure.statement : "scheduled";
  problemRows.push([c.request, c.expect, kind, kind === c.expect ? "PASS" : "FAIL", message]);
}
table(["Request", "Expected", "Actual", "Match", "Message returned to the organizer"], problemRows);

// ---------------------------------------------------------------- 7. verification
heading(2, "7. Independent verification");
const verification = [];
for (const o of result.options) {
  const plain = validateSchedule(inventory, o.schedule);
  const withInstructions = validateScheduleWithInstructions(inventory, o.schedule, base);
  const conflicts = [];
  for (let seed = 1; seed <= 20; seed++) conflicts.push(...actualConflicts(engine, inventory, o.schedule, seed));
  verification.push([`${o.label} ${o.name}`, plain.valid ? "0" : String(plain.violations.length), withInstructions.ok && withInstructions.value.valid ? "0" : "FAIL", String(conflicts.length)]);
}
table(["Option", "validateSchedule violations", "Instruction violations", "Actual player collisions or rest breaches over 20 simulated outcomes"], verification);

const options2 = { seed: SEED, instructions: base, budget: { iterationsPerStrategy: 6000 }, diversityAttempts: 2 };
const first = optimizeSchedules(inventory, options2);
const second = optimizeSchedules(inventory, options2);
const same = JSON.stringify(first.options.map((o) => o.schedule)) === JSON.stringify(second.options.map((o) => o.schedule));
line(`- Deterministic reproduction (same seed, iteration budget, no time cap): **${same ? "identical schedules on two runs" : "DIFFERENT SCHEDULES"}**.`);
const finishes = result.options.map((o) => o.metrics.finishMinute);
line(`- Fastest Finish finishes at minute ${A.metrics.finishMinute}; earliest among the options is ${Math.min(...finishes)}: **${A.metrics.finishMinute === Math.min(...finishes) ? "Fastest Finish has the earliest finish" : "EXCEPTION: Fastest Finish is not earliest"}**.`);
line(`- Overall duration versus idle: A idle ${rep(A).idleCourtMinutes}, B idle ${rep(B).idleCourtMinutes}, C idle ${rep(C).idleCourtMinutes}. Duration and idle time are separate measures${rep(A).idleCourtMinutes > Math.min(rep(B).idleCourtMinutes, rep(C).idleCourtMinutes) ? ": here Fastest Finish does NOT have the least idle time" : ": in this run Fastest Finish also happens to have the least idle time, which is not guaranteed"}.`);
const metricsAgree = result.options.every((o) => rep(o).finish.absolute === o.metrics.finishMinute && rep(o).idleCourtMinutes === o.metrics.idleMinutes);
line(`- Report and optimizer metrics agree on finish and idle minutes for every option: **${metricsAgree}**.`);

// ---------------------------------------------------------------- 8. tightness
heading(2, "8. Tight configurations and failure classification");
const sweep = [];
for (const [courts, dayEnd] of [[10, 19 * 60], [10, 17 * 60], [10, 15 * 60], [10, 14 * 60 + 40], [10, 14 * 60 + 30], [10, 14 * 60 + 10], [10, 13 * 60 + 30], [10, 12 * 60], [6, 19 * 60], [4, 19 * 60]]) {
  const cfg = buildEchelonConfig({ courts, dayEnd });
  const inv = buildInventory(cfg);
  const started = performance.now();
  const r = optimizeSchedules(inv, { seed: SEED, instructions: [], budget: { iterationsPerStrategy: 1500 }, diversityAttempts: 0 });
  const ms = performance.now() - started;
  const finish = r.status === "ok" ? Math.min(...r.options.map((o) => o.metrics.finishMinute)) : null;
  const methods = r.status === "ok" ? [...new Set(Object.values(r.diagnostics.construction))].join("+") : "-";
  sweep.push([`${courts} courts, days end ${hm(dayEnd)}`, r.status === "ok" ? "scheduled" : r.failure.kind, finish === null ? "-" : `day ${Math.floor(finish / 1440) + 1} ${hm(finish % 1440)}`, methods, r.status === "ok" ? "-" : r.failure.proof.slice(0, 1).join("; ") || "no proof: heuristic did not place every match", seconds(ms)]);
}
table(["Configuration", "Outcome", "Earliest finish", "Construction", "Why (first failed condition)", "Time"], sweep);
line("`proven_infeasible` means a necessary condition fails (a proof). `not_found` means the bounded construction attempts failed and is explicitly not a proof.");

line(`\n---\nGenerated ${new Date().toISOString()} by bench/acceptance.mjs.`);

const text = out.join("\n");
console.log(text);
if (process.argv.includes("--write")) {
  mkdirSync(new URL("../docs/acceptance/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../docs/acceptance/milestone-2-acceptance.md", import.meta.url), text + "\n");
  console.error("Wrote docs/acceptance/milestone-2-acceptance.md");
}
