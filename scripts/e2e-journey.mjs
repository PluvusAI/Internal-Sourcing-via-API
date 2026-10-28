// End-to-end browser journey for the internal sourcing app (PLU-505). Verification tool, not CI.
//
// Drives the real UI in Chromium through Ricky's journey: import named lists, brand search,
// select-all-matching exclusions, find creators, review, select + export, Find more, and start
// the next batch from the last one. Point it at a running app whose server uses development
// sign-in (AUTH_MODE=dev), e.g. one connected to server/scripts/internalSourcingLocalStack.ts.
//
//   node scripts/e2e-journey.mjs http://127.0.0.1:5173 ./e2e-shots
//
// Needs Playwright with Chromium installed (not a dependency of this app); CHROMIUM_PATH can name
// the browser binary.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const shots = process.argv[3] ?? join(tmpdir(), "isl-e2e");
mkdirSync(shots, { recursive: true });
const work = join(tmpdir(), `isl-e2e-files-${Date.now()}`);
mkdirSync(work, { recursive: true });

const csv = (name, rows) => {
  const p = join(work, name);
  writeFileSync(p, rows.map((r) => r.join(",")).join("\n"));
  return p;
};
const ig = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ["Instagram", `@instagram_creator_${from + i}`, `Creator ${from + i}`]);

// CHROMIUM_PATH: a specific Chromium binary, when the resolved Playwright's own browser is not installed.
// Brand names unique to this run, so the journey can be repeated against the same backend.
const tag = Date.now().toString(36).slice(-4).toUpperCase();
const A = `Brand A${tag}`;
const B = `Brand B${tag}`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: join(shots, `${n}.png`), fullPage: true });
const step = (s) => console.log(`• ${s}`);

async function importList(name, file, { acknowledge }) {
  await page.goto(base);
  await page.getByRole("button", { name: "Import list" }).click();
  await page.getByLabel("CSV file").setInputFiles(file);
  await page.getByLabel("List name", { exact: true }).fill(name);
  await page.getByText("Will be imported").waitFor();
  if (acknowledge) await page.getByRole("checkbox", { name: /Save the \d+ usable creators/ }).check();
  await page.getByRole("button", { name: /^Import \d+ creators$/ }).click();
  await page.getByRole("heading", { name: "Import report" }).waitFor();
}

async function waitForStatus(re, timeout = 90_000) {
  await page.locator(".page-head .badge").filter({ hasText: re }).first().waitFor({ timeout });
}

const handlesOnPage = async () => (await page.locator("table.table tbody td:nth-child(3) .muted").allTextContents()).map((t) => t.replace(/^@/, ""));

try {
  step("import Brand A - Existing creators (with a duplicate and an unusable row)");
  await importList(
    `${A} - Existing creators`,
    csv("existing.csv", [["Platform", "Handle", "Name"], ...ig(0, 5), ["instagram", "https://www.instagram.com/instagram_creator_0/", "dup"], ["", "", "Name only"]]),
    { acknowledge: true },
  );
  await shot("01-imported-list");
  const report = await page.locator(".stats").first().innerText();
  assert.match(report, /6\s*Imported/);
  assert.match(report, /1\s*Duplicates/);
  assert.match(report, /1\s*Invalid/);

  step("import two more lists");
  await importList(`${A} - Lookbook`, csv("lookbook.csv", [["Platform", "Handle", "Name"], ...ig(5, 8)]), { acknowledge: false });
  await importList(`${B} - Existing creators`, csv("brandb.csv", [["Platform", "Handle", "Name"], ...ig(9, 10)]), { acknowledge: false });

  step("search Brand A on Lists home");
  await page.goto(base);
  await page.getByPlaceholder("Search lists by brand or list name").fill(A);
  await page.getByText(`2 lists match “${A}”`).waitFor();
  await shot("02-home-brand-search");
  assert.ok(new URL(page.url()).searchParams.get("q") === A, "the search is kept in the URL");

  step("create Brand A - Batch 1 and enter criteria");
  await page.getByRole("button", { name: "New sourcing list" }).click();
  await page.getByLabel("List name", { exact: true }).fill(`${A} - Batch 1`);
  await page.getByRole("button", { name: "Create list" }).click();
  await page.getByRole("heading", { name: "Creator criteria" }).waitFor();
  await page.getByRole("checkbox", { name: "Instagram" }).check();
  await page.getByLabel("Min followers").fill("10000");
  await page.getByLabel("Max followers").fill("200000");
  await page.getByLabel("Niche / search query").fill("skincare routines");
  await page.getByLabel("New qualifying creators to find").fill("5");

  step("picker: search Brand A, select all matching");
  const picker = page.locator(".picker");
  await picker.getByPlaceholder("Search lists by brand or list name").fill(A);
  await picker.getByText("2 matching lists", { exact: true }).waitFor();
  await picker.getByRole("button", { name: "Select all 2 matching lists" }).click();
  await picker.getByText(/2 lists selected; 9 unique creators excluded/).waitFor();
  step("…search another brand: earlier selections stay");
  await picker.getByPlaceholder("Search lists by brand or list name").fill(B);
  await picker.getByText("1 matching list", { exact: true }).waitFor();
  assert.equal(await picker.locator(".chip").count(), 2, "both Brand A lists stay selected while searching Brand B");
  await picker.getByPlaceholder("Search lists by brand or list name").fill(A);
  await page.getByText("Saved", { exact: true }).waitFor();
  await shot("03-draft-with-exclusions");

  step("find creators");
  await page.getByRole("button", { name: "Find creators" }).click();
  await page.getByRole("heading", { name: "Latest search" }).waitFor();
  await waitForStatus(/Complete|Partial|Empty|Failed/);
  await page.getByText("5 of 5 new creators", { exact: true }).waitFor();
  const batch1 = await handlesOnPage();
  assert.equal(batch1.length, 5);
  for (let i = 0; i <= 8; i++) assert.ok(!batch1.includes(`instagram_creator_${i}`), `excluded creator ${i} must not appear`);
  await shot("04-batch1-results");
  const batch1Url = page.url();

  step("reload restores the same results and starts nothing");
  await page.reload();
  await waitForStatus(/Complete/);
  assert.deepEqual(await handlesOnPage(), batch1);
  assert.equal(await page.locator("details summary", { hasText: "All searches" }).count(), 0, "still one search");

  step("drawer opens and closes back to the same table");
  await page.locator("table.table tbody td.name button").first().click();
  await page.getByRole("dialog").getByText("Why they fit").waitFor();
  await shot("05-drawer");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  step("select two rows and export them");
  await page.locator("table.table tbody input[type=checkbox]").nth(0).check();
  await page.locator("table.table tbody input[type=checkbox]").nth(1).check();
  await page.getByRole("button", { name: "Export selected (2)" }).waitFor();
  await page.getByRole("button", { name: "Export selected (2)" }).click();
  await page.getByRole("dialog").getByText("Export selected (2)").waitFor();
  await shot("06-export-dialog");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  const file = join(work, download.suggestedFilename());
  await download.saveAs(file);
  const lines = readFileSync(file, "utf8").replace(/^﻿/, "").trimEnd().split("\r\n");
  assert.equal(lines.length, 3, "header + 2 selected rows");
  assert.ok(lines[0].startsWith("email,first_name,location,language,instagram_link"));
  await page.getByText(/Download started/).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).first().click();

  step("find more 3");
  await page.getByRole("button", { name: "Find more" }).click();
  await page.getByLabel("Additional new creators").fill("3");
  await page.getByRole("dialog").getByRole("button", { name: "Find more" }).click();
  await page.getByText("3 of 3 new creators", { exact: true }).waitFor({ timeout: 90_000 });
  await waitForStatus(/Complete/);
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForTimeout(800);
  const afterMore = await handlesOnPage();
  assert.equal(afterMore.length, 8);
  assert.equal(new Set(afterMore).size, 8, "no duplicates after Find more");
  assert.deepEqual(afterMore.slice(0, 5), batch1, "earlier rows keep their place");
  assert.equal(await page.locator("table.table tbody input[type=checkbox]:checked").count(), 2, "selection kept");
  await shot("07-after-find-more");

  step("new list using these criteria carries the exclusions plus Batch 1");
  await page.getByRole("button", { name: "New list using these criteria" }).click();
  await page.getByLabel("List name", { exact: true }).fill(`${A} - Batch 2`);
  await page.getByRole("button", { name: "Create list" }).click();
  await page.getByRole("heading", { name: "Creator criteria" }).waitFor();
  const chips = await page.locator(".picker .chip").allInnerTexts();
  assert.equal(chips.length, 3);
  assert.ok(chips.some((c) => c.includes(`${A} - Existing creators`)) && chips.some((c) => c.includes(`${A} - Lookbook`)) && chips.some((c) => c.includes(`${A} - Batch 1`)));
  assert.equal(await page.getByLabel("Niche / search query").inputValue(), "skincare routines");
  await page.getByText(/3 lists selected; 17 unique creators excluded/).waitFor();
  await shot("08-batch2-draft");
  await page.getByRole("button", { name: "Find creators" }).click();
  await waitForStatus(/Complete|Partial|Empty/);
  const batch2 = await handlesOnPage();
  for (const h of [...afterMore, ...Array.from({ length: 9 }, (_, i) => `instagram_creator_${i}`)]) assert.ok(!batch2.includes(h), `${h} must not repeat in Batch 2`);
  await shot("09-batch2-results");

  step("Back returns to the searched list library");
  await page.goto(`${base}/?q=${encodeURIComponent(A)}`);
  await page.getByText(`4 lists match “${A}”`).waitFor();
  await page.getByRole("link", { name: `${A} - Batch 1` }).first().click();
  await page.getByRole("heading", { name: "Latest search" }).waitFor();
  await page.goBack();
  await page.getByText(`4 lists match “${A}”`).waitFor();
  assert.equal(await page.getByPlaceholder("Search lists by brand or list name").inputValue(), A);
  await shot("10-home-after-back");

  assert.deepEqual(errors, [], `no browser errors: ${errors.join(" | ")}`);
  console.log(`\n✓ journey passed — screenshots in ${shots} (batch 1 at ${batch1Url})`);
} catch (err) {
  await shot("zz-failure").catch(() => undefined);
  console.error(`\n✗ journey failed: ${err instanceof Error ? err.stack : err}\nbrowser errors: ${errors.join(" | ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
