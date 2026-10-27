// Playwright scenario used to capture the Smart Scheduler screens at realistic desktop and tablet sizes.
// Run with the Playwright MCP `browser_run_code_unsafe` tool (or adapt to a local Playwright install) against `npm run app`.
// Replace __OUT__ with an output folder that ends in a slash. It uses only roles, labels and visible text so it keeps
// working across visual changes. It builds the guided demo event from scratch in a clean browser profile.
async (page) => {
  const OUT = "__OUT__";
  const log = [];
  const nav = (name) => page.getByRole("navigation", { name: "Workflow" }).getByRole("button", { name });
  const shot = async (name) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}${name}.png` });
    log.push(name);
  };
  const blocks = page.locator(".m-block, [data-match]");

  // ---- build the demo event once, at desktop size ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("http://localhost:5173/");
  await page.waitForTimeout(800);
  await shot("01-home-desktop");

  await page.locator(".card", { hasText: "Guided demo" }).getByRole("button", { name: "Open example" }).click();
  await shot("02-setup-event-desktop");
  await page.getByRole("tab", { name: "Divisions & teams" }).click();
  await shot("03-setup-divisions-desktop");
  await page.getByRole("tab", { name: "Review" }).click();
  await shot("04-setup-review-desktop");

  await nav(/Special rules/).click();
  await page.getByLabel(/what should the schedule respect/i).fill(
    [
      "Advanced Men's Doubles must finish by 15:00 on day 1.",
      "Court 3 is unavailable 12:00-13:30 on day 1.",
      "Reserve Court 6 for medal matches.",
      "Women's Doubles cannot start before 1 PM on day 2.",
      "Prefer to keep pool play on one day.",
      "At least 30 minutes between matches for Intermediate.",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "Interpret", exact: true }).click();
  await page.waitForTimeout(800);
  await shot("05-rules-review-desktop");
  for (let i = 0; i < 4; i++) {
    const undecided = page.locator(".card", { has: page.getByRole("button", { name: /Choose hard or preferred first/ }) }).first();
    if (!(await undecided.count())) break;
    await undecided.getByRole("radio", { name: /Mandatory/ }).check();
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 8; i++) {
    const confirm = page.getByRole("button", { name: "Confirm rule" }).first();
    if (!(await confirm.count())) break;
    await confirm.click();
    await page.waitForTimeout(300);
  }
  await shot("06-rules-confirmed-desktop");

  await nav(/Generate/).click();
  await shot("07-compare-empty-desktop");
  await page.getByRole("button", { name: "Generate three schedules" }).click();
  await page.waitForTimeout(350);
  await shot("08-compare-loading-desktop");
  await page.getByRole("button", { name: "Use this schedule" }).first().waitFor({ timeout: 60000 });
  await shot("09-compare-summary-desktop");
  await page.getByRole("button", { name: "Detailed" }).click();
  await shot("10-compare-detailed-desktop");
  await page.getByRole("button", { name: "Summary" }).click();
  await page.locator("section", { hasText: "Balanced Operations" }).getByRole("button", { name: "Use this schedule" }).first().click();

  // ---- matrix and inspector ----
  await blocks.first().waitFor({ timeout: 15000 });
  await shot("11-matrix-desktop");
  await blocks.nth(14).click();
  await shot("12-matrix-selected-desktop");
  await page.getByRole("button", { name: /Lock this match/ }).click();
  await blocks.nth(30).click();
  await page.getByRole("button", { name: /Lock this match/ }).click();
  await shot("13-matrix-locked-desktop");
  await blocks.nth(40).click();
  await page.locator("aside select").first().selectOption({ label: "Court 6" });
  await page.waitForTimeout(900);
  await shot("14-matrix-invalid-desktop");

  await nav(/Approve/).click();
  await shot("15-export-desktop");

  // ---- the same screens at tablet size ----
  await page.setViewportSize({ width: 1024, height: 768 });
  await nav(/Set up/).click();
  await shot("20-setup-tablet");
  await nav(/Special rules/).click();
  await shot("21-rules-tablet");
  await nav(/Generate/).click();
  await shot("22-compare-tablet");
  await nav(/Schedule/).click();
  await blocks.nth(14).click();
  await shot("23-matrix-tablet");
  await nav(/Approve/).click();
  await shot("24-export-tablet");
  return log.join("\n");
}
