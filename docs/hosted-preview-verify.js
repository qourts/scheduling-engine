// End-to-end verification of the hosted (static) Smart Scheduler preview, in a real browser (Playwright).
// Run with the Playwright MCP `browser_run_code_unsafe` tool. Replace __URL__ with the site address (with trailing slash)
// and __TMP__ with a writable folder (ending in a slash) the Playwright server may use. Uses only synthetic example data.
async (page) => {
  const URL_ = "__URL__";
  const TMP = "__TMP__";
  const results = {};
  const problems = [];
  const failedRequests = [];
  const requests = [];
  const origin = new globalThis.URL(URL_).origin;
  const basePath = new globalThis.URL(URL_).pathname;
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 160)); });
  page.on("requestfailed", (r) => failedRequests.push(r.url()));
  page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
  page.on("request", (r) => requests.push(r.url()));
  const nav = (n) => page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name: n });
  const readDownload = async (dl) => { const chunks = []; for await (const c of await dl.createReadStream()) chunks.push(c); return Buffer.concat(chunks).toString("utf8"); };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(URL_);
  await page.waitForLoadState("networkidle");

  // 1. Home, branding, assets
  results.title = await page.title();
  results.heroHeadline = await page.locator("h1").first().innerText();
  results.logoLoads = await page.evaluate(async () => { const imgs = [...document.querySelectorAll("img")]; await Promise.all(imgs.map((i) => i.decode().catch(() => {}))); return imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0); });
  results.stylesApplied = await page.evaluate(() => getComputedStyle(document.querySelector(".shell")).backgroundColor);
  results.exampleCards = await page.locator(".example-card").count();

  // 2. Setup wizard
  await page.locator(".card", { hasText: "Guided demo" }).getByRole("button", { name: "Open example" }).click();
  await page.getByRole("tab", { name: "Divisions & teams" }).click();
  await page.getByRole("tab", { name: "Review" }).click();
  results.setupReview = await page.getByText(/No blocking problem found/).waitFor({ timeout: 15000 }).then(() => true, () => false);

  // 3. Special instructions: deterministic interpreter, manual editor, AI switched off
  await nav(/Special rules/).click();
  results.aiButtonHidden = (await page.getByRole("button", { name: /Interpret with AI/ }).count()) === 0;
  results.aiNotice = (await page.getByText(/not available in this hosted preview/).count()) > 0;
  await page.getByRole("button", { name: "Build a rule by hand" }).click();
  results.manualEditorOpens = (await page.getByRole("heading", { name: "Build a rule by hand" }).count()) > 0;
  await page.getByRole("button", { name: "Hide rule editor" }).click();
  await page.getByLabel(/what should the schedule respect/i).fill([
    "Advanced Men's Doubles must finish by 15:00 on day 1.",
    "Court 3 is unavailable 12:00-13:30 on day 1.",
    "Reserve Court 6 for medal matches.",
    "Women's Doubles cannot start before 1 PM on day 2.",
    "Prefer to keep pool play on one day.",
    "At least 30 minutes between matches for Intermediate.",
  ].join("\n"));
  await page.getByRole("button", { name: "Interpret", exact: true }).click();
  await page.waitForTimeout(600);
  for (let i = 0; i < 4; i++) {
    const undecided = page.locator(".card", { has: page.getByRole("button", { name: /Choose hard or preferred first/ }) }).first();
    if (!(await undecided.count())) break;
    await undecided.getByRole("radio", { name: /Mandatory/ }).check();
    await page.waitForTimeout(400);
  }
  for (let i = 0; i < 8; i++) {
    const c = page.getByRole("button", { name: "Confirm rule" }).first();
    if (!(await c.count())) break;
    await c.click();
    await page.waitForTimeout(250);
  }
  results.confirmedRules = await page.getByText(/^(Mandatory|Preferred)$/).count();

  // 4. Generation in the Web Worker, comparison
  await nav(/Generate/).click();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Generate three schedules" }).click();
  await page.getByRole("button", { name: "Use this schedule" }).first().waitFor({ timeout: 90000 });
  results.generationMs = Date.now() - t0;
  results.options = await page.getByRole("button", { name: "Use this schedule" }).count();
  results.workerLoaded = requests.some((u) => /\/assets\/worker-[^/]+\.js/.test(u));
  results.workerUnderBase = requests.filter((u) => /worker-[^/]+\.js/.test(u)).every((u) => new globalThis.URL(u).pathname.startsWith(basePath));
  await page.getByRole("button", { name: "Detailed" }).click();
  results.detailedTable = (await page.getByRole("columnheader", { name: "Balanced Operations" }).count()) > 0;
  await page.getByRole("button", { name: "Summary" }).click();
  await page.locator("section", { hasText: "Balanced Operations" }).getByRole("button", { name: "Use this schedule" }).first().click();

  // 5. Court matrix, inspector, lock, validation
  await page.locator("[data-match]").first().waitFor({ timeout: 15000 });
  results.matrixCards = await page.locator("[data-match]").count();
  await page.locator("[data-match]").nth(14).click();
  results.inspectorOpens = (await page.getByRole("complementary", { name: "Match details" }).count()) > 0;
  await page.getByRole("button", { name: /Lock this match/ }).click();
  results.locked = (await page.getByText(/1 locked/).count()) > 0;
  await page.locator("[data-match]").nth(40).click();
  await page.locator("aside select").first().selectOption({ label: "Court 6" });
  await page.waitForTimeout(900);
  results.engineRejectsReservedCourt = (await page.getByText("Not allowed").count()) > 0;
  results.verifiedByEngine = (await page.getByText(/Verified by the engine/).count()) > 0;

  // 6. Approval, export, print
  await nav(/Approve/).click();
  const ack = page.getByLabel(/I have read these risks/);
  if (await ack.count()) await ack.check();
  await page.getByRole("button", { name: "Approve this schedule" }).click();
  await page.waitForTimeout(600);
  results.approved = (await page.locator(".shell-project .pill", { hasText: "approved" }).count()) > 0;

  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Match list/ }).click()]);
  const csvText = await readDownload(csv);
  results.csvFile = csv.suggestedFilename();
  results.csvRows = csvText.trim().split(/\r?\n/).length - 1;
  const [grid] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Court grid/ }).click()]);
  results.gridCsvOk = (await readDownload(grid)).includes("Court 1");
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Whole project/ }).click()]);
  const jsonPath = TMP + "exported-project.json";
  await json.saveAs(jsonPath);
  const parsed = JSON.parse(await readDownload(json));
  results.jsonFormat = parsed.format + " v" + parsed.version;
  results.jsonStatus = parsed.project.status;

  await page.emulateMedia({ media: "print" });
  results.printHidesShell = (await page.evaluate(() => getComputedStyle(document.querySelector(".shell")).display)) === "none";
  results.printShowsSchedule = (await page.getByRole("region", { name: "Printable schedule" }).count()) > 0;
  try { const pdf = await page.pdf({ format: "A4" }); results.pdfBytes = pdf.length; } catch (e) { results.pdfBytes = "n/a: " + String(e).slice(0, 60); }
  await page.emulateMedia({ media: "screen" });

  // 7. IndexedDB persistence across a reload, and JSON import
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForLoadState("networkidle");
  results.savedProjectsAfterReload = await page.locator("tbody tr").count();
  results.savedStatusAfterReload = (await page.locator("tbody tr").first().innerText()).replace(/\s+/g, " ").slice(0, 80);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await page.waitForTimeout(700);
  results.reopenedApproved = (await page.locator(".shell-project .pill", { hasText: "approved" }).count()) > 0;
  await page.getByRole("button", { name: /Qourts Smart Scheduler home/ }).click();
  await page.waitForTimeout(500);
  await page.locator('input[type="file"]').setInputFiles(jsonPath);
  await page.waitForTimeout(1200);
  results.importOpensProject = (await page.locator(".shell-project").count()) > 0;
  results.importedStatus = (await page.locator(".shell-project .pill").first().innerText()).trim();

  // 8. Network hygiene
  const own = requests.filter((u) => u.startsWith(origin));
  results.requestsOutsideBase = own.filter((u) => !new globalThis.URL(u).pathname.startsWith(basePath));
  results.externalRequests = requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
  results.failedRequests = failedRequests;
  results.problems = problems;
  return JSON.stringify(results, null, 1);
}
