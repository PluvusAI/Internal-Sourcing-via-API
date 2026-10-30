// PLU-509 browser check: both sourcing forms follow the sourcing backend's per-search limit.
// Verification tool, not CI. Run against an app with development sign-in, e.g. mock mode with a
// chosen limit (MOCK_MAX_TARGET_COUNT=5 or 100), or one connected to a local backend stack.
//
//   node scripts/e2e-limits.mjs http://127.0.0.1:5173 ./e2e-shots
//
// It reads the limit M the backend reports (/api/meta), then checks:
//   1. the first-search form says "Up to M", flags M+1 at once without trimming it, and accepts M;
//   2. Find more says "1 to M", starts at min(10, M), refuses M+1 and accepts M;
//   3. a page that still holds an older, higher limit sends too many: the backend refuses, nothing
//      starts, the typed count stays, and the page re-reads and shows M — for both forms.
// Needs Playwright with Chromium (not a dependency); CHROMIUM_PATH can name the browser binary.

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const shots = process.argv[3] ?? join(tmpdir(), "isl-e2e-limits");
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const step = (s) => console.log(`• ${s}`);
const tag = Date.now().toString(36).slice(-4).toUpperCase();

const apiGet = (path) => page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), path);
/** Make /api/meta report an OLDER limit, as a page loaded before the backend changed would hold. */
const staleMeta = (max) =>
  page.route("**/api/meta", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, maxTargetCount: max } });
  });
const freshMeta = () => page.unroute("**/api/meta");

async function newDraft(name) {
  await page.goto(base);
  await page.getByRole("button", { name: "New sourcing list" }).first().click();
  await page.getByLabel("List name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await page.getByRole("heading", { name: "Define your ideal creators" }).waitFor();
  await page.getByRole("checkbox", { name: "Instagram" }).check();
  await page.getByLabel("Niche / search query").fill("skincare routines");
  const id = new URL(page.url()).pathname.split("/lists/")[1];
  await page.getByRole("button", { name: "Continue to exclusions" }).click();
  await page.getByRole("button", { name: "Continue to review" }).click();
  return id;
}
const target = () => page.getByLabel("New qualifying creators to find");
const saved = () => page.getByText("Saved", { exact: true }).waitFor();

try {
  await page.goto(base);
  const M = (await apiGet("/meta")).maxTargetCount;
  assert.ok(Number.isInteger(M) && M > 0);
  step(`the backend reports a limit of ${M} new creators per search`);

  step("first search: the form shows the limit, flags M+1 at once, keeps it, accepts M");
  const first = await newDraft(`Brand L${tag} - Batch 1`);
  await page.getByText(`Up to ${M} per search`).waitFor();
  await target().fill(String(M + 1));
  await page.getByText(`At most ${M} new creators per search`).first().waitFor();
  await saved();
  assert.equal((await apiGet(`/lists/${first}`)).targetCount, M + 1, "the over-limit count is saved as entered, not trimmed");
  assert.ok(await page.getByRole("button", { name: "Find creators" }).isDisabled());
  assert.equal((await apiGet(`/lists/${first}`)).operations.length, 0, "an over-limit count starts nothing");
  await page.screenshot({ path: join(shots, "limits-1-initial-over.png"), fullPage: true });
  await target().fill(String(M));
  await page.getByText(`At most ${M} new creators per search`).waitFor({ state: "detached" });
  await target().fill(String(Math.min(3, M)));
  await saved();
  await page.getByRole("button", { name: "Find creators" }).click();
  await page.getByRole("heading", { name: "Latest search" }).waitFor();
  await page.locator(".page-head .badge").filter({ hasText: /Complete|Partial|Empty|Failed/ }).first().waitFor({ timeout: 90_000 });

  step("Find more: the dialog shows the limit, starts at min(10, M), refuses M+1, accepts M");
  await page.getByRole("button", { name: "Find more" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(`1 to ${M} per search`).waitFor();
  const amount = dialog.getByLabel("Additional new creators");
  assert.equal(await amount.inputValue(), String(Math.min(10, M)));
  await amount.fill(String(M + 1));
  await dialog.getByText(`At most ${M} new creators per search`).waitFor();
  assert.ok(await dialog.getByRole("button", { name: "Find more" }).isDisabled());
  await page.screenshot({ path: join(shots, "limits-2-findmore-over.png"), fullPage: true });
  await amount.fill(String(M));
  assert.ok(await dialog.getByRole("button", { name: "Find more" }).isEnabled());
  await dialog.getByRole("button", { name: "Cancel" }).click();

  step("stale page, Find more: the backend refuses the old count, nothing starts, the dialog learns M");
  const opsBefore = (await apiGet(`/lists/${first}`)).operations.length;
  await staleMeta(M + 50);
  await page.getByRole("button", { name: "Find more" }).click();
  await dialog.getByText(`1 to ${M + 50} per search`).waitFor();
  await freshMeta();
  await amount.fill(String(M + 10));
  await dialog.getByRole("button", { name: "Find more" }).click();
  await dialog.getByText("Nothing was started").waitFor();
  await dialog.getByText(`1 to ${M} per search`).waitFor();
  await dialog.getByText(`The limit is now ${M}.`).waitFor();
  assert.equal(await amount.inputValue(), String(M + 10), "the typed count is kept");
  assert.equal((await apiGet(`/lists/${first}`)).operations.length, opsBefore, "no operation was started");
  await page.screenshot({ path: join(shots, "limits-3-findmore-stale.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Cancel" }).click();

  step("stale page, first search: refused, nothing starts, the form learns M and keeps the saved count");
  await staleMeta(M + 50);
  const second = await newDraft(`Brand L${tag} - Batch 2`);
  await page.getByText(`Up to ${M + 50} per search`).waitFor();
  await freshMeta();
  await target().fill(String(M + 10));
  await saved();
  await page.getByRole("button", { name: "Find creators" }).click();
  await page.getByText("The search did not start").waitFor();
  await page.getByText(`Up to ${M} per search`).waitFor();
  await page.getByText(`At most ${M} new creators per search`).first().waitFor();
  assert.equal(await target().inputValue(), String(M + 10));
  const after = await apiGet(`/lists/${second}`);
  assert.equal(after.operations.length, 0, "no operation was started");
  assert.equal(after.targetCount, M + 10, "the saved count is unchanged");
  await page.screenshot({ path: join(shots, "limits-4-initial-stale.png"), fullPage: true });

  assert.deepEqual(errors, []);
  console.log(`\n✓ limits check passed for a backend limit of ${M} — screenshots in ${shots}`);
} catch (err) {
  await page.screenshot({ path: join(shots, "limits-zz-failure.png"), fullPage: true }).catch(() => undefined);
  console.error(`\n✗ limits check failed: ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
