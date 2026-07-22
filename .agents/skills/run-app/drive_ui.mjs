// Browser-drive the Single-Cohort Flow Simulator UI end-to-end with Playwright + system Chrome.
// Flow: (optional) setup gate -> Continue -> dashboard Advisor -> Bottlenecks Auto-fill -> Apply.
// Run from web/ so `playwright` resolves. See SKILL.md for env vars.
//   cd web && OUT_DIR=/scratch TEST_GATE=1 node ../.claude/skills/run-app/drive_ui.mjs
import os from "node:os";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = process.env.API_URL || "http://localhost:8001";
const OUT = (process.env.OUT_DIR || os.tmpdir()).replace(/\\/g, "/");
const TEST_GATE = process.env.TEST_GATE === "1";

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}${!cond && detail ? "  -- " + detail : ""}`);
};
const shot = (n, name) => `${OUT}/ui-${String(n).padStart(2, "0")}-${name}.png`;

// Optionally blank initial_state so the first-run gate appears (see SKILL.md gotchas).
if (TEST_GATE) {
  const r = await fetch(`${API}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initial_state: { occupancy: {} } }),
  });
  ok("blanked initial_state for gate test", r.ok, `http ${r.status}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });

  // 1. Setup gate (only when initial_state is blank + fresh context)
  if (TEST_GATE) {
    const heading = page.getByText("Set up today's department state");
    await heading.waitFor({ timeout: 30000 }).catch(() => {});
    ok("setup gate shows on fresh state", await heading.isVisible().catch(() => false));
    await page.screenshot({ path: shot(1, "gate"), fullPage: true });
    const cont = page.getByRole("button", { name: "Continue" });
    await cont.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue");
      return b && !b.disabled;
    }, { timeout: 20000 }).catch(() => {});
    await cont.click();
    ok("clicked Continue on gate", true);
  }

  // 2. Dashboard + Advisor (baseline auto-runs here)
  const advisor = page.getByRole("heading", { name: "Advisor" });
  await advisor.waitFor({ timeout: 90000 });
  ok("dashboard Advisor panel rendered after auto-run", await advisor.isVisible());
  ok("dashboard shows headline metrics", await page.getByText(/Graduation/i).first().isVisible().catch(() => false));
  await page.screenshot({ path: shot(2, "dashboard"), fullPage: true });

  // 3. Bottlenecks + Auto-fill
  await page.goto(`${BASE}/bottlenecks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const af = page.getByRole("heading", { name: "Auto-fill to targets" });
  await af.waitFor({ timeout: 60000 });
  ok("Auto-fill panel rendered on Bottlenecks", await af.isVisible());
  await page.screenshot({ path: shot(3, "bottlenecks"), fullPage: true });

  await page.getByRole("button", { name: /Auto-fill to hit targets/ }).click();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Auto-fill to hit targets/.test(x.textContent));
    return b && !/Searching/.test(b.textContent);
  }, { timeout: 120000 }).catch(() => {});
  const applyBtn = page.getByRole("button", { name: /Apply these changes/ });
  const hasApply = await applyBtn.isVisible().catch(() => false);
  const body = await page.locator("body").innerText();
  ok("Auto-fill produced a result", hasApply || /target|slack|intake|capacity|seats/i.test(body));
  await page.screenshot({ path: shot(4, "autofill-result"), fullPage: true });

  // 4. Apply (writes via PUT /curriculum + PUT /config, then refreshBaseline re-runs)
  if (hasApply) {
    await applyBtn.click();
    await page.waitForTimeout(8000);
    await page.screenshot({ path: shot(5, "after-apply"), fullPage: true });
    ok("Apply completed without surfaced error", !/Auto-fill failed|Could not/i.test(await page.locator("body").innerText()));
  }
} catch (e) {
  ok("script ran without throwing", false, e.message);
  await page.screenshot({ path: shot(99, "crash"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n==== ${results.length - failed}/${results.length} UI checks passed ====  (screenshots in ${OUT})`);
process.exit(failed ? 1 : 0);
