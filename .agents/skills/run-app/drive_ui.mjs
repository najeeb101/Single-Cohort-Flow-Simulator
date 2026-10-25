// Browser-drive the CS Intake Planner end-to-end with Playwright.
// Flow: (optional) intro + setup gate -> Intake Planner -> Run analysis (small params) ->
// recommendation card/chart/table -> seat planner -> Apply -> Walkthrough/Bottlenecks/Data/
// Methodology/Plans pages -> Advisor (+ one chat question if a model is configured).
// Run from web/ (see SKILL.md for env vars):
//   cd web && OUT_DIR=/scratch TEST_GATE=1 node ../.agents/skills/run-app/drive_ui.mjs
// CHROME_CHANNEL=chrome uses the system Chrome; unset uses Playwright's bundled Chromium.
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:8001";
const OUT = (process.env.OUT_DIR || os.tmpdir()).replace(/\\/g, "/");
const TEST_GATE = process.env.TEST_GATE === "1";
const ASK_ADVISOR = process.env.ASK_ADVISOR !== "0";

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${!cond && detail ? "  -- " + detail : ""}`);
};
const shot = (n, name) => `${OUT}/ui-${String(n).padStart(2, "0")}-${name}.png`;
const api = (path, body) =>
  fetch(`${API}${path}`, {
    method: body ? "PUT" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

// Small sweep so the browser run takes about a minute (the real default is ~2.5 min on 20 cores).
// Enough seeds that the low intakes come out "ok" rather than "too uncertain".
{
  const r = await api("/config", {
    intake_analysis: { grid_min: 40, grid_max: 120, grid_step: 20, seeds: 8, refine_seeds: 10,
                       reference_runs: 2, steady_seeds: 6, robustness_seeds: 4, min_history_years: 8 },
  });
  ok("set small analysis params via PUT /config", r.ok, `http ${r.status} ${await r.text()}`);
}

const browser = await chromium.launch(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
if (!TEST_GATE) {
  await ctx.addInitScript(() => {
    localStorage.setItem("onboarding-intro-done", "1");
    localStorage.setItem("initial-state-setup-done", "1");
  });
}
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(e.message); console.log("  [pageerror]", e.message); });
page.on("dialog", (d) => d.accept());

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });

  // 1. First run: onboarding intro, then the setup gate.
  if (TEST_GATE) {
    const skipIntro = page.getByRole("button", { name: "Skip intro" });
    if (await skipIntro.waitFor({ timeout: 60000 }).then(() => true).catch(() => false)) {
      await page.screenshot({ path: shot(1, "intro"), fullPage: true });
      await skipIntro.click();
    }
    const gate = page.getByText("Tell the planner about today's department");
    await gate.waitFor({ timeout: 30000 }).catch(() => {});
    ok("setup gate shows on first run", await gate.isVisible().catch(() => false));
    await page.screenshot({ path: shot(2, "gate"), fullPage: true });
    await page.getByRole("button", { name: "Skip for now and use the estimates" }).click();
  }

  // 2. Intake Planner home.
  const runBtn = page.getByRole("button", { name: /^Run analysis/ });
  await runBtn.waitFor({ timeout: 120000 });
  ok("Intake Planner home rendered", await runBtn.isVisible());
  ok("changing-data notice shown", await page.getByText(/Sections and seats change every semester/).first().isVisible().catch(() => false));
  ok("data-quality strip shown", await page.getByText(/QU data/).first().isVisible().catch(() => false));
  await page.screenshot({ path: shot(3, "planner-empty"), fullPage: true });

  // 3. Run an analysis and wait for the recommendation card.
  await runBtn.click();
  const running = await page.getByText(/Intake analysis running/).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  ok("progress shown while the analysis runs", running);
  await page.screenshot({ path: shot(4, "planner-running"), fullPage: false });
  // Wait for the run to finish (an earlier analysis's card may already be on screen).
  await page.getByText(/Intake analysis running/).first().waitFor({ state: "hidden", timeout: 600000 });
  const card = page.getByText(/Recommended for the/);
  await card.waitFor({ timeout: 60000 });
  ok("recommendation card rendered", await card.isVisible());
  ok("upper limit shown", await page.getByText("Upper limit").first().isVisible().catch(() => false));
  ok("chart rendered", await page.getByRole("img", { name: /Graduation and on-time rates/ }).isVisible().catch(() => false));
  ok("per-intake table rendered", await page.getByText("Every intake tried").isVisible().catch(() => false));
  ok("no stale-data banner right after a fresh run",
     !(await page.getByText("The data has changed since this analysis ran").isVisible().catch(() => false)));
  await page.screenshot({ path: shot(5, "planner-result"), fullPage: true });

  // 4. Seat planner: what would it take to admit 120?
  const target = page.locator("label", { hasText: "Target intake" }).locator("input");
  await target.fill("120");
  await page.getByRole("button", { name: "Plan seats for 120" }).click();
  // Wait for this plan to start (the previous plan's result may still be on screen), then finish.
  await page.getByText(/Seat plan for 120 running/).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.getByText(/Seat plan for 120 running/).first().waitFor({ state: "hidden", timeout: 600000 });
  const verdict = page.getByText(/needs [\d,]+ more seats|already carry an intake of 120|still breaks a limit/).first();
  await verdict.waitFor({ timeout: 60000 });
  ok("seat plan result rendered", await verdict.isVisible());
  const apply = page.getByRole("button", { name: "Apply to plan" });
  await page.screenshot({ path: shot(6, "seat-plan"), fullPage: true });
  if (!(await apply.isVisible())) {
    // A reused database may already carry 120 (an earlier run applied the plan).
    ok("seat plan says today's seats already carry 120", await page.getByText(/already carry an intake of 120/).isVisible());
  } else {
    const before = await (await api("/curriculum")).json();
    const step = (await (await api("/meta")).json()).seat_step ?? 5;
    await apply.click();
    await page.getByText(/Applied\. Re-run the analysis/).waitFor({ timeout: 60000 }).catch(() => {});
    const after = await (await api("/curriculum")).json();
    const raised = after.filter((c) => (before.find((b) => b.code === c.code)?.capacity ?? 0) < c.capacity);
    ok("Apply to plan raised course seats", raised.length > 0, `changed=${raised.length}`);
    // Seats, not sections: a new seat count lands on the step, or a top-up adds whole steps.
    ok("raised seats are rounded to the seat step", raised.every((c) => {
      const added = c.capacity - before.find((b) => b.code === c.code).capacity;
      return c.capacity % step === 0 || added % step === 0;
    }));
    await page.waitForTimeout(1500);
    ok("stale-data banner after applying new seats",
       await page.getByText("The data has changed since this analysis ran").isVisible().catch(() => false));
  }

  // 5. Other pages load.
  const pages = [
    ["walkthrough", /Start checkpoint walkthrough|Next up/],
    ["bottlenecks", /which courses limit|Which courses limit/i],
    ["data", /Seats per course/],
    ["data?tab=students", /Past intakes/],
    ["data?tab=policy", /Policy limits/],
    ["about", /How the analysis works/],
    ["plans", /Plan/],
  ];
  let n = 7;
  for (const [path, re] of pages) {
    await page.goto(`${BASE}/${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const seen = await page.getByText(re).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    ok(`/${path} renders`, seen);
    await page.screenshot({ path: shot(n++, path.replace(/[?=]/g, "-")), fullPage: true });
  }

  // 6. Advisor (+ one grounded question when a model is configured).
  await page.goto(`${BASE}/advisor`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const meta = await (await api("/meta")).json();
  await page.getByRole("heading", { name: "Advisor", exact: true }).waitFor({ timeout: 60000 });
  // The advice cards render after the heading, once the latest analysis loads.
  ok("advisor shows the analysis verdict", await page.getByText(/Recommended next intake|No intake meets your limits/).first()
    .waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  if (meta.llm_chat_enabled) {
    const box = page.getByPlaceholder("Ask about the recommendation...");
    ok("advisor chat box shown", await box.isVisible().catch(() => false));
    if (ASK_ADVISOR) {
      await box.fill("In two sentences: why is the recommended intake what it is?");
      await page.getByRole("button", { name: "Send" }).click();
      const answered = await page.getByText(/^Answered by/).first().waitFor({ timeout: 240000 }).then(() => true).catch(() => false);
      ok("advisor chat answered (model label shown)", answered);
    }
  } else {
    ok("advisor explains how to turn on the local model", await page.getByText(/ollama pull/).first().isVisible().catch(() => false));
  }
  await page.screenshot({ path: shot(n++, "advisor"), fullPage: true });

  // 7. Dark mode (the opt-in; light is the default) renders the planner too.
  // Wait for the card first: a click before React hydrates the toggle is silently lost.
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText(/Recommended for the/).waitFor({ timeout: 60000 }).catch(() => {});
  await page.getByRole("button", { name: /Switch to dark mode/ }).first().click();
  ok("dark mode toggles on", await page.waitForFunction(() => document.documentElement.classList.contains("theme-dark"),
    null, { timeout: 10000 }).then(() => true).catch(() => false));
  await page.screenshot({ path: shot(n++, "planner-dark"), fullPage: true });

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
} catch (e) {
  ok("driver completed without exception", false, String(e));
  await page.screenshot({ path: shot(99, "error"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n==== ${failed.length} STEP(S) FAILED ====` : "\n==== ALL UI STEPS PASSED ====");
process.exit(failed.length ? 1 : 0);
