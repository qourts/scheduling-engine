// Operational acceptance run for the optimizer on a synthetic 288-match tournament.
// Usage: npm run build && node bench/acceptance.mjs [--write]
// Prints a Markdown report built only from measured results; --write saves it to
// docs/acceptance/milestone-2-acceptance.md. All data is synthetic.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import * as engine from "../dist/index.js";
import { actualConflicts, buildEchelonConfig, categoryWindows, instructionCases, problemCases, verifyEnforcement } from "./echelon.mjs";
import { buildEchelonDayConfig, CATEGORY_WINDOWS, DAY_END, DAY_START, echelonDayPreferences } from "./echelon-day.mjs";

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
line("\n# A. General-purpose synthetic multi-day stress test\n");
line("Two days, 08:00-19:00, 10 courts, 20-minute slots with a separate 5-minute court turnover and a 15-minute recovery rule. This is a stress test kept separate from the Echelon regression test in part B: it is NOT the Echelon structure (no wildcards, no category windows, two days).");
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


// ================================================================ PART B: Echelon one-day regression
line("\n# B. Echelon-structure, one-day regression test\n");
partB();

function partB() {
  const { describeTimeAllocation, measurePreferences, verifyAllQualifierOutcomes, applyEvent, initialState } = engine;
  const prefs = echelonDayPreferences();
  const assumedRest = 10;
  const cfg = buildEchelonDayConfig({ minRest: assumedRest });
  const inv = buildInventory(cfg);
  const count = (p) => inv.matches.filter(p).length;
  const windowOf = (categoryId) => CATEGORY_WINDOWS.find((c) => c.id === categoryId);

  heading(2, "B1. Scenario (synthetic participants only)");
  table(
    ["Item", "Value"],
    [
      ["Event", `${cfg.days[0]}, ${hm(DAY_START)}-${hm(DAY_END)}, one day only, ${cfg.courts.length} courts`],
      ["Category windows (mandatory)", CATEGORY_WINDOWS.map((c) => `${c.name} ${hm(c.start)}-${hm(c.end)}`).join("; ")],
      ["Brackets per category", "Novice 3, Low Intermediate 4, High Intermediate 3 (10 brackets of 4 teams, single round robin)"],
      ["Totals", `${new Set(inv.matches.filter((m) => m.phase === "group").map((m) => `${m.divisionId}|${m.groupId}`)).size} brackets, ${inv.teamById.size} teams, ${count((m) => m.phase === "group")} preliminary + ${count((m) => m.phase === "knockout" && m.round === 1)} semifinal + ${count((m) => m.thirdPlace || (m.phase === "knockout" && m.round === 2))} medal = ${inv.matches.length} matches`],
      ["Progression", "Novice and High Intermediate: 3 bracket winners + 1 wildcard (best second-placed team). Low Intermediate: 4 bracket winners. Then 2 semifinals, 1 bronze, 1 gold"],
      ["Configuration valid", String(validateConfig(cfg).valid)],
    ],
  );

  heading(2, "B2. Time-allocation model");
  const allocation = describeTimeAllocation(cfg)[0];
  table(
    ["Quantity", "Minutes", "Meaning"],
    [
      ["Active playing time", String(allocation.activePlayMinutes), "informational"],
      ["Transition allowance (inside the slot)", String(allocation.transitionAllowanceMinutes), "already part of the slot; never added again"],
      ["Scheduled court occupancy, preliminary and semifinal", String(allocation.scheduledSlotMinutes), "15 playing + 5 transition"],
      ["Medal match planning estimate", String(allocation.medalPlanningEstimateMinutes), "an estimate only: medal matches have no hard time cap and must be won by two points"],
      ["Additional turnover buffer", String(allocation.additionalTurnoverMinutes), "only when explicitly configured; 0 here"],
      ["Court cycle (earliest next start on a court)", String(allocation.courtCycleMinutes), "slot + additional turnover"],
      ["Participant recovery (assumed, see B3)", String(allocation.minimumRecoveryMinutes), "between the end of an occupied slot and the same team's next start"],
      ["Participant cycle", String(allocation.participantCycleMinutes), "slot + recovery"],
    ],
  );
  line(`Capacity check, as given: 10 courts x 12 h = ${10 * 720} court-minutes against a nominal need of ${inv.matches.reduce((s, m) => s + m.durationMinutes, 0)} (264 x 20 + 24 x 30). This is a necessary condition only.`);

  // ------------------------------------------------------------ B3 feasibility
  heading(2, `B3. Practical feasibility with the approved windows (recovery assumed ${assumedRest} minutes)`);
  const first = optimizeSchedules(inv, { seed: SEED, instructions: prefs });
  line(`Result: **${first.status === "ok" ? "scheduled" : first.failure.kind}**. ${first.failure ? first.failure.statement : ""}`);
  line();
  const feasibility = analyzeFeasibility(inv);
  table(
    ["Category window check", "Result"],
    feasibility.checks.filter((c) => c.id.startsWith("window_group")).map((c) => [c.message, c.passed ? "pass" : "FAIL"]),
  );
  if (first.failure) {
    line("Why the windows cannot be met: in each category the 60 pool matches alone need 1200 court-minutes, which 10 courts cannot play in less than 120 minutes. The last pool match must then be followed by the recovery gap, a 20-minute semifinal, another recovery gap and a 30-minute medal match. That chain is " + (50 + 2 * assumedRest) + ` minutes at ${assumedRest} minutes of recovery, so no category can finish before ${120 + 50 + 2 * assumedRest} minutes against a 180-minute window.`);
  }

  heading(3, "Smallest meaningful changes, each tested by running the optimizer (reduced budget; nothing here is applied automatically)");
  const study = [];
  const tryConfig = (label, options) => {
    const c = buildEchelonDayConfig(options);
    const r = optimizeSchedules(buildInventory(c), { seed: SEED, budget: { iterationsPerStrategy: 1500 }, diversityAttempts: 0 });
    const finish = r.status === "ok" ? Math.min(...r.options.map((o) => o.metrics.finishMinute)) : null;
    const end = Math.max(...c.courts[0].availability.map((w) => w.end));
    study.push([
      label,
      r.status === "ok" ? "schedule found" : r.failure.kind === "proven_infeasible" ? "PROVEN infeasible" : "no schedule found (not a proof)",
      finish === null ? "-" : `${hm(finish)} (event day ends ${hm(end)}, slack ${end - finish} min)`,
    ]);
  };
  tryConfig(`Approved windows, recovery ${assumedRest} min (assumed)`, { minRest: assumedRest });
  for (const rest of [9, 8, 7, 6, 5, 0]) tryConfig(`Approved windows, recovery ${rest} min`, { minRest: rest });
  for (const length of [185, 190, 200, 210]) tryConfig(`Recovery ${assumedRest} min, windows ${length} min each (event ends ${hm(DAY_START + 4 * length)})`, { minRest: assumedRest, categoryWindowMinutes: length });
  for (const courtsCount of [11, 12]) tryConfig(`Approved windows, recovery ${assumedRest} min, ${courtsCount} courts`, { minRest: assumedRest, courts: courtsCount });
  tryConfig(`Recovery ${assumedRest} min, windows 200 min each, medal estimate 40 min (contingency for long medal matches)`, { minRest: assumedRest, categoryWindowMinutes: 200, medalMinutes: 40 });
  tryConfig("No category windows (whole day shared), recovery 10 min", { minRest: assumedRest, windows: false });
  table(["Variant", "Outcome", "Earliest finish"], study);
  line("Recovery of 5 minutes means at least 10 minutes between the end of active play and the next match, because each slot already contains a 5-minute transition.");

  // ------------------------------------------------------------ B4 valid schedule
  let usableRest = null;
  for (let rest = assumedRest; rest >= 0; rest--) {
    const r = optimizeSchedules(buildInventory(buildEchelonDayConfig({ minRest: rest })), { seed: SEED, budget: { iterationsPerStrategy: 800 }, diversityAttempts: 0 });
    if (r.status === "ok") {
      usableRest = rest;
      break;
    }
  }
  heading(2, `B4. Three-option run at the largest recovery the approved windows allow (${usableRest} minutes)`);
  line(`The recovery requirement is not part of the brief, and ${assumedRest} minutes is infeasible, so this run uses the largest value for which a schedule is found. **It is a demonstration of what the engine does when the rules are feasible, not an approved configuration.**`);
  const dayCfg = buildEchelonDayConfig({ minRest: usableRest });
  const dayInv = buildInventory(dayCfg);
  const started = performance.now();
  const run = optimizeSchedules(dayInv, { seed: SEED, instructions: prefs });
  const elapsed = performance.now() - started;
  line(`Status **${run.status}**, ${run.options.length} options, wall time **${seconds(elapsed)}** (construction ${seconds(run.diagnostics.timing.constructionMs)}, search ${seconds(run.diagnostics.timing.searchMs)}). Time limited: ${run.diagnostics.timeLimited}.`);
  if (run.status !== "ok") {
    line(`Failure: ${run.failure.kind}: ${run.failure.statement}`);
    return;
  }
  const dayReports = new Map(run.options.map((o) => [o.strategy, analyzeSchedule(dayInv, o.schedule)]));
  const dr = (o) => dayReports.get(o.strategy);
  const dayCols = run.options.map((o) => `${o.label} ${o.name}`);
  const dayRow = (label, f) => [label, ...run.options.map((o) => f(o, dr(o)))];
  const categoryOf = (m) => dayCfg.divisions.find((d) => d.id === m.divisionId).categoryId;
  const insideWindows = (o) =>
    o.schedule.assignments.every((a) => {
      const m = dayInv.matchById.get(a.matchId);
      const w = windowOf(categoryOf(m));
      return a.day === dayCfg.days[0] && a.start >= w.start && a.start + m.durationMinutes <= w.end;
    });
  const prefMeasures = (o) => measurePreferences(dayInv, o.schedule, prefs);
  const transitions = (r) => r.divisions.filter((d) => d.transitionMinutes !== null);
  table(
    ["Measure", ...dayCols],
    [
      dayRow("Matches scheduled", (o, r) => `${r.scheduledMatches} of ${r.totalMatches}`),
      dayRow("Earliest and latest match time", (o, r) => `${hm(r.start.minute)} start, ${hm(r.finish.minute)} end (event ${hm(DAY_START)}-${hm(DAY_END)})`),
      dayRow("Every match inside its category window and on the event date", (o) => String(insideWindows(o))),
      dayRow("Teams with preliminary matches split across days", (o, r) => String(r.recovery.teamsSplitAcrossDays)),
      dayRow("Total idle court-minutes", (o, r) => String(r.idleCourtMinutes)),
      dayRow("Overall court utilization", (o, r) => pct(r.courts.reduce((s, c) => s + c.busyMinutes, 0) / r.courts.reduce((s, c) => s + c.availableMinutes, 0))),
      dayRow("Recovery min / average / max (min)", (o, r) => `${r.recovery.minMinutes} / ${r.recovery.meanMinutes.toFixed(1)} / ${r.recovery.maxMinutes}`),
      dayRow(`Back-to-back occurrences (gap < ${dr(run.options[0]).assumptions.backToBackThresholdMinutes} min), teams affected`, (o, r) => `${r.recovery.backToBackOccurrences}, ${r.recovery.backToBackAffectedTeams}`),
      dayRow("Longest wait between a team's matches", (o, r) => `${r.longestWaits[0].longestGapMinutes} min (${r.longestWaits[0].teamName})`),
      dayRow("Playoff progression delay after the pools it depends on (min / mean / max, minutes)", (o, r) => {
        const t = transitions(r);
        return `${Math.min(...t.map((d) => d.transitionMinutes))} / ${(t.reduce((s, d) => s + d.transitionMeanMinutes, 0) / t.length).toFixed(1)} / ${Math.max(...t.map((d) => d.transitionMaxMinutes))}`;
      }),
      dayRow("Medal matches with under 10 min before their court is needed again", (o, r) => String(r.medalSlots.filter((m) => m.courtSlackMinutes !== null && m.courtSlackMinutes < 10).length)),
      dayRow("Violated preferences", (o) => prefMeasures(o).map((p) => `${p.instructionId}: ${p.violated} ${p.unit}`).join("; ")),
      dayRow("validateSchedule violations / instruction violations", (o) => {
        const plain = validateSchedule(dayInv, o.schedule);
        const full = validateScheduleWithInstructions(dayInv, o.schedule, prefs);
        return `${plain.violations.length} / ${full.ok ? full.value.instructionViolations.length : "?"}`;
      }),
    ],
  );

  heading(3, "Completion by category (window end and slack)");
  table(
    ["Category (window)", ...dayCols],
    dayCfg.categories.map((c) => {
      const w = windowOf(c.id);
      return [`${c.name} (${hm(w.start)}-${hm(w.end)})`, ...run.options.map((o) => {
        const f = dr(o).categories.find((x) => x.categoryId === c.id).finish.minute;
        return `${hm(f)} (slack ${w.end - f} min)`;
      })];
    }),
  );
  heading(3, "Court utilization by court");
  table(
    ["Court", ...dayCols],
    dayCfg.courts.map((c) => [c.name, ...run.options.map((o) => {
      const u = dr(o).courts.find((x) => x.courtId === c.id);
      return `${pct(u.utilization)} (${u.matches} matches, idle ${u.idleMinutes})`;
    })]),
  );
  heading(3, "Distinctness of the options");
  table(
    ["Pair", "Matches placed differently", "Differs on", "Pareto relation", "Materially different"],
    run.comparison.relations.map((r) => [`${r.a} vs ${r.b}`, pct(r.assignmentDistance), r.differsOn.join(", ") || "-", r.dominance, String(r.materiallyDifferent)]),
  );
  for (const e of run.comparison.explanation) line(`- ${e}`);
  line();
  line(`**Recommended: ${run.recommended.strategy}.** ${run.recommended.reason}`);
  line();
  line(`Warnings: ${run.options.map((o) => `${o.label}: ${dr(o).warnings.filter((w) => w.severity === "risk").length} risk / ${dr(o).warnings.filter((w) => w.severity === "info").length} info`).join("; ")}.`);
  for (const w of dr(run.options.find((o) => o.strategy === run.recommended.strategy)).warnings.filter((x) => x.code !== "BACK_TO_BACK").slice(0, 5)) line(`- ${w.severity}: ${w.message}`);

  // ------------------------------------------------------------ B5 court matrix
  const rec = run.options.find((o) => o.strategy === run.recommended.strategy);
  heading(2, `B5. Court matrix (${rec.name})`);
  line("Cell code: category (G Genderless, M Men's, X Mixed, W Women's) + level (N Novice, L Low Intermediate, H High Intermediate) + kind (p pool, s semifinal, g gold, b bronze). Columns are 20-minute slots; a cell shows the match that starts in that slot. A medal match continues into the next slot (30 min).");
  line();
  const level = { NOV: "N", LI: "L", HI: "H" };
  const code = (m) => {
    const [cat, skill] = m.divisionId.split("-");
    const kind = m.phase === "group" ? "p" : m.thirdPlace ? "b" : m.round === 1 ? "s" : "g";
    return `${cat[0]}${level[skill]}${kind}`;
  };
  const slotsOfDay = [];
  for (let t = DAY_START; t < DAY_END; t += 20) slotsOfDay.push(t);
  const grid = new Map();
  for (const a of rec.schedule.assignments) {
    const bucket = DAY_START + Math.floor((a.start - DAY_START) / 20) * 20;
    grid.set(`${a.courtId}|${bucket}`, code(dayInv.matchById.get(a.matchId)));
  }
  table(["Court", ...slotsOfDay.map((t) => hm(t))], dayCfg.courts.map((c) => [c.id, ...slotsOfDay.map((t) => grid.get(`${c.id}|${t}`) ?? ".")]));

  // ------------------------------------------------------------ B6 guarantees
  heading(2, "B6. Which guarantees are proven and which are sampled");
  const exhaustive = run.options.map((o) => ({ o, report: verifyAllQualifierOutcomes(dayInv, o.schedule) }));
  table(
    ["Option", "Divisions enumerated", "Outcomes examined", "Match pairs checked", "Violations in any outcome", "Skipped"],
    exhaustive.map(({ o, report }) => [`${o.label} ${o.name}`, String(report.enumerated.length), String(report.enumerated.reduce((s, e) => s + e.outcomes, 0)), String(report.pairsChecked), String(report.violations.length), String(report.skipped.length)]),
  );
  const sampled = run.options.map((o) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) n += actualConflicts({ initialState, applyEvent }, dayInv, o.schedule, seed).length;
    return [`${o.label} ${o.name}`, String(n)];
  });
  table(["Option", "Collisions over 20 sampled full-tournament outcomes (including the wildcard)"], sampled);
  const provisional = dr(run.options[0]).playoffs;
  line(`Playoff matches: ${provisional.length}, of which **${provisional.filter((p) => p.provisional).length} are provisional** (their participants depend on results that do not exist yet; a match with the wildcard can contain any of up to ${Math.max(...provisional.map((p) => p.possibleTeams))} teams).`);
  line();
  table(
    ["Guarantee", "Basis"],
    [
      ["Court, window, dependency and recovery rules for every match whose participants are fixed (pool matches)", "Structural: independent validator, every pair of matches"],
      ["Recovery and collision safety for every possible playoff participant, including the wildcard", "Structural: the validator treats every team that could reach a match as present. The exhaustive check above re-derives it by enumerating every reachable outcome and found no violation"],
      ["Random full-tournament outcomes", "Sampled only (20 outcomes per option): regression coverage, not proof. The exhaustive check is the proof for this format"],
      ["Tiebreaker matches", "NOT covered: the plan contains none (ties are broken by wins, head-to-head, game and point difference, then a deterministic draw)"],
      ["Medal matches finishing on time", "NOT guaranteed: the 30-minute slot is an estimate"],
    ],
  );

  // ------------------------------------------------------------ B7 contingency
  heading(2, "B7. Contingency: ties and extra matches");
  const wildcardDivisions = dayCfg.divisions.filter((d) => d.stages[1].source.wildcards).length;
  line("The plan contains 288 matches and is **not** an unconditional maximum. The engine settles ties without extra matches (wins, head-to-head among the tied teams, game difference, point difference, points for, then a deterministic draw). If the organizer would instead play tiebreaker matches, the worst cases are:");
  line();
  table(
    ["Situation", "Extra matches, worst case", "Where"],
    [
      ["Two teams tied for the qualifying position of a bracket", "1 per bracket", "after that bracket, before its semifinals"],
      ["Three teams tied in a bracket (each 2-1)", "up to 3 per bracket (a mini round robin) or 2 (knockout)", "after that bracket"],
      ["Tie among best second-placed teams for the wildcard", `up to 3 per wildcard division (${wildcardDivisions} divisions)`, "after all three brackets of the division"],
      ["Worst case over the whole event", `up to ${40 * 3 + wildcardDivisions * 3} matches (40 brackets x 3 + ${wildcardDivisions} wildcard divisions x 3), very unlikely`, "-"],
    ],
  );
  line(`Scheduling impact: this schedule has little spare capacity (the final category finishes with ${Math.min(...run.options.map((o) => DAY_END - o.metrics.finishMinute))} minutes of slack at recovery ${usableRest}), and a wildcard tie delays the semifinal that depends on all three brackets of that division. Reserve contingency time, or decide the tie rule, before the event.`);
}

line(`\n---\nGenerated ${new Date().toISOString()} by bench/acceptance.mjs.`);

const text = out.join("\n");
console.log(text);
if (process.argv.includes("--write")) {
  mkdirSync(new URL("../docs/acceptance/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../docs/acceptance/milestone-2-acceptance.md", import.meta.url), text + "\n");
  console.error("Wrote docs/acceptance/milestone-2-acceptance.md");
}
