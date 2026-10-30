// Intentionally delayed local requests verify rendered async states and actual animation.
// Run only against SOURCE_MODE=mock, AUTH_MODE=dev. No paid provider calls.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5065';
const shots = process.argv[3] ?? './artifacts/full-ui-audit/component-states';
mkdirSync(shots, { recursive: true });
const api = async (path, method = 'GET', body) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(r.ok, `${method} ${path}: ${r.status}`); return r.json();
};
const config = await api('/session/config');
assert.equal(config.sourceMode, 'mock'); assert.equal(config.authMode, 'dev');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const shot = name => page.screenshot({ path: join(shots, `${name}.png`), animations: 'allow' });
const close = async () => { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); };
async function hold(pattern, method = 'GET', json) {
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  await page.route(pattern, async route => {
    if (route.request().method() !== method) return route.fallback();
    enter(); await released;
    return json ? route.fulfill({ json }) : route.continue();
  }, { times: 1 });
  return { entered, release };
}
async function rotating(locator) {
  await locator.waitFor();
  assert.equal(await locator.evaluate(n => getComputedStyle(n).animationName), 'spin');
  assert.ok(await locator.evaluate(async n => {
    const before = getComputedStyle(n).transform;
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    return getComputedStyle(n).transform !== before;
  }), 'spinner rotates across actual browser frames');
}
async function lockedDialog() {
  await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].find(n => n.textContent.trim() === 'Cancel')?.disabled);
  assert.ok(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled());
  assert.ok(await page.getByRole('button', { name: 'Close', exact: true }).isDisabled());
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
  await page.keyboard.press('Tab');
  assert.ok(await page.getByRole('dialog').evaluate(n => n.contains(document.activeElement)), 'focus stays inside submitting dialog');
}
try {
  const tag = Date.now().toString(36);
  const list = await api('/lists', 'POST', { name: `Component states ${tag}`, criteria: { platforms: [{ platform: 'instagram' }], niche: 'Skincare' }, targetCount: 1 });
  for (let i = 1; i <= 3; i++) await api(`/lists/${list.id}/members`, 'POST', { platform: 'instagram', handle: `motion_${tag}_${i}`, displayName: `Motion Creator ${i}` });
  await api(`/lists/${list.id}/operations`, 'POST', { kind: 'initial', idempotencyKey: `motion-${tag}`, baseRevision: list.draftRevision });
  for (let i = 0; i < 8; i++) { if ((await api(`/lists/${list.id}`)).status === 'complete') break; }
  const detailGate = await hold(`**/api/lists/${list.id}`);
  const memberGate = await hold(`**/api/lists/${list.id}/members?*`);
  await page.goto(`${base}/lists/${list.id}`); await detailGate.entered;
  await page.getByRole('status', { name: 'Loading list', exact: true }).waitFor();
  await rotating(page.locator('.page-skeleton .loader-spinner').first()); await shot('page-loading');
  detailGate.release(); await memberGate.entered;
  await page.getByRole('status', { name: 'Loading creators', exact: true }).waitFor();
  await rotating(page.locator('.table-skeleton .loader-spinner'));
  assert.equal(await page.locator('.skeleton').first().evaluate(n => getComputedStyle(n, '::after').animationName), 'skeleton-shimmer');
  await shot('creators-loading'); memberGate.release();
  await page.getByRole('button', { name: 'Motion Creator 1', exact: true }).waitFor();
  const refreshGate = await hold(`**/api/lists/${list.id}/members?*`);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await refreshGate.entered;
  assert.ok(await page.getByRole('button', { name: /Refreshing…/ }).isDisabled());
  assert.equal(await page.locator('.members-table tbody tr').count(), 4, 'refresh retains saved rows');
  await rotating(page.locator('.creator-table-status .loader-spinner')); await shot('creators-refreshing');
  refreshGate.release(); await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
  const selectGate = await hold(`**/api/lists/${list.id}/selection`, 'PUT');
  await page.getByRole('checkbox', { name: 'Select Motion Creator 1', exact: true }).check(); await selectGate.entered;
  assert.ok(await page.getByRole('button', { name: /Saving selection/ }).isDisabled());
  await rotating(page.locator('.creator-table-status .loader-spinner')); selectGate.release();
  await page.getByRole('button', { name: 'Export selected (1)', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Export selected (1)', exact: true }).click();
  const exportGate = await hold(`**/api/lists/${list.id}/export`, 'POST');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click(); await exportGate.entered;
  await lockedDialog(); assert.ok(await page.getByRole('radio', { name: /Export all/ }).isDisabled());
  await rotating(page.getByRole('button', { name: 'Preparing CSV…', exact: true }).locator('.loader-spinner')); await shot('export-preparing');
  const download = page.waitForEvent('download'); exportGate.release(); await download;
  await page.getByText(/Download started/).waitFor(); await close();
  const renameGate = await hold(`**/api/lists/${list.id}`, 'PATCH');
  await page.getByRole('button', { name: 'Rename list', exact: true }).click();
  await page.getByLabel('List name', { exact: true }).fill(`Renamed ${tag}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await renameGate.entered;
  await rotating(page.getByRole('button', { name: /Saving…/ }).locator('.loader-spinner'));
  assert.ok(await page.getByRole('button', { name: 'Cancel', exact: true }).isDisabled());
  assert.ok(await page.getByLabel('List name', { exact: true }).evaluate(n => n.readOnly));
  renameGate.release(); await page.getByRole('heading', { name: `Renamed ${tag}`, exact: true }).waitFor();
  const moreGate = await hold(`**/api/lists/${list.id}/operations`, 'POST');
  await page.getByRole('button', { name: 'Find more', exact: true }).click();
  await page.getByLabel('Additional new creators').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Find more', exact: true }).click(); await moreGate.entered;
  await lockedDialog(); await rotating(page.getByRole('button', { name: 'Starting search…', exact: true }).locator('.loader-spinner'));
  moreGate.release(); await page.getByRole('dialog').waitFor({ state: 'detached' });
  for (let i = 0; i < 8; i++) { if ((await api(`/lists/${list.id}`)).status === 'complete') break; }
  await page.reload(); await page.getByRole('button', { name: 'Motion Creator 1', exact: true }).waitFor();
  const emailGate = await hold(`**/api/lists/${list.id}/email-jobs/preview`, 'POST');
  await page.getByRole('button', { name: 'Find emails', exact: true }).click(); await emailGate.entered;
  await page.getByRole('status', { name: 'Checking saved contacts and cost', exact: true }).waitFor();
  await rotating(page.getByRole('dialog').locator('.loader-spinner'));
  assert.ok(await page.getByRole('dialog').getByRole('button', { name: 'Find emails', exact: true }).isDisabled());
  emailGate.release(); await page.getByText('Estimated maximum spend', { exact: true }).waitFor();
  let emailJob = { id: 'animation-fixture', status: 'queued', outcome: null, counts: { pending: 2, running: 0, found: 0 }, total: 2, creditsSpent: 0, creditsHeld: 0.4, creditCap: 1, createdAt: new Date().toISOString(), completedAt: null, pollAfterSeconds: 3 };
  // Render the email job lifecycle with intercepted responses; this never submits a real lookup.
  await page.route(`**/api/lists/${list.id}/email-jobs`, route => route.fulfill({ json: { job: emailJob } }));
  const emailStartGate = await hold(`**/api/lists/${list.id}/email-jobs`, 'POST', { job: emailJob });
  await page.getByRole('dialog').getByRole('button', { name: 'Find emails', exact: true }).click(); await emailStartGate.entered;
  await lockedDialog(); await rotating(page.getByRole('button', { name: 'Starting lookup…', exact: true }).locator('.loader-spinner'));
  emailStartGate.release(); await page.getByRole('dialog').waitFor({ state: 'detached' });
  await rotating(page.locator('.email-progress .loader-spinner'));
  emailJob = { ...emailJob, status: 'completed', counts: { pending: 0, running: 0, found: 1, not_found: 1 }, creditsSpent: 0.2, creditsHeld: 0.2, completedAt: new Date().toISOString(), pollAfterSeconds: null };
  await page.reload(); await page.getByText('Email lookup finished', { exact: true }).waitFor();
  assert.equal(await page.locator('.email-progress .loader-spinner').count(), 0);
  await page.unroute(`**/api/lists/${list.id}/email-jobs`);

  // Slow image request: shimmer -> actual image, without swapping to a different portrait.
  const members = await api(`/lists/${list.id}/members`);
  members.members[0].pictureUrl = `${base}/motion-avatar.svg`;
  await page.route(`**/api/lists/${list.id}/members?*`, route => route.fulfill({ json: members }));
  let releasePhoto, enterPhoto;
  const photoEntered = new Promise(resolve => { enterPhoto = resolve; });
  await page.route('**/motion-avatar.svg', async route => { await new Promise(resolve => { releasePhoto = resolve; enterPhoto(); }); await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#73a090"/></svg>' }); });
  await page.reload(); await page.locator('.creator-avatar[data-loading="true"]').waitFor();
  assert.equal(await page.locator('.creator-avatar[data-loading="true"]').first().evaluate(n => getComputedStyle(n, '::after').animationName), 'skeleton-shimmer');
  await photoEntered; releasePhoto(); await page.locator('.creator-avatar img[data-loaded="true"]').waitFor();
  await page.getByRole('button', { name: /^Remove Motion Creator 1/ }).click();
  await page.getByRole('dialog').waitFor(); await shot('remove-confirmation'); await close();
  await page.getByRole('link', { name: 'All lists', exact: true }).click();
  await page.getByRole('button', { name: 'Import list', exact: true }).click();
  const previewGate = await hold('**/api/imports/preview', 'POST');
  await page.getByLabel('CSV file').setInputFiles({ name: `motion-${tag}.csv`, mimeType: 'text/csv', buffer: Buffer.from('platform,handle,name\ninstagram,slow_creator,Slow Creator') }); await previewGate.entered;
  await page.getByRole('status', { name: 'Checking import rows', exact: true }).waitFor();
  await rotating(page.getByRole('dialog').locator('.loader-spinner')); previewGate.release();
  await page.getByText('Will be imported', { exact: true }).waitFor();
  const importGate = await hold('**/api/imports', 'POST');
  await page.getByRole('button', { name: 'Import 1 creator', exact: true }).click(); await importGate.entered;
  await lockedDialog(); await rotating(page.getByRole('button', { name: 'Importing creators…', exact: true }).locator('.loader-spinner'));
  importGate.release(); await page.getByRole('heading', { name: 'Import report', exact: true }).waitFor();
  await page.getByRole('link', { name: 'All lists', exact: true }).click();
  await page.getByRole('button', { name: 'New sourcing list', exact: true }).click();
  await page.getByLabel('List name', { exact: true }).fill(`New motion draft ${tag}`);
  const createGate = await hold('**/api/lists', 'POST');
  await page.getByRole('button', { name: 'Create list', exact: true }).click(); await createGate.entered;
  await lockedDialog(); await rotating(page.getByRole('button', { name: 'Creating list…', exact: true }).locator('.loader-spinner'));
  createGate.release(); await page.getByRole('heading', { name: 'Define your ideal creators', exact: true }).waitFor();
  const draftId = new URL(page.url()).pathname.split('/').at(-1);
  const saveGate = await hold(`**/api/lists/${draftId}`, 'PATCH');
  await page.getByRole('checkbox', { name: 'Instagram', exact: true }).check(); await saveGate.entered;
  await rotating(page.locator('.saving .loader-spinner')); saveGate.release(); await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByLabel('Short brief').fill('Skincare routines with gentle products and educational explanations.');
  const suggestGate = await hold('**/api/criteria/suggest', 'POST');
  await page.getByRole('button', { name: 'Suggest criteria', exact: true }).click(); await suggestGate.entered;
  await rotating(page.getByRole('button', { name: /Suggesting…/ }).locator('.loader-spinner')); suggestGate.release();
  await page.locator('.suggested-label').first().waitFor();
  await page.getByRole('button', { name: 'Continue to exclusions' }).click();
  const unionGate = await hold('**/api/exclusions/preview', 'POST');
  await page.getByRole('checkbox', { name: `motion-${tag}`, exact: true }).check(); await unionGate.entered;
  await rotating(page.locator('.summary-line .loader-spinner')); unionGate.release();
  await page.getByText(/1 list selected; 1 unique creator excluded/).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}px`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: /^Criteria/ }).click();
  const reducedSave = await hold(`**/api/lists/${draftId}`, 'PATCH');
  await page.getByLabel('Niche / search query', { exact: true }).fill('Skincare reduced motion'); await reducedSave.entered;
  assert.equal(await page.locator('.saving .loader-spinner').evaluate(n => getComputedStyle(n).animationName), 'none');
  reducedSave.release(); await page.getByText('Saved', { exact: true }).waitFor();
  // Pagination retains its controls while the next page is loading; old rows cannot be selected.
  const paginationPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const allRows = Array.from({ length: 52 }, (_, i) => ({ ...members.members[0], id: `pagination-${i}`, displayName: `Paged creator ${i + 1}`, handle: `paged_${i}`, pictureUrl: null, selected: false }));
  let releaseSecondPage, enterSecondPage;
  const secondPageEntered = new Promise(resolve => { enterSecondPage = resolve; });
  await paginationPage.route(`**/api/lists/${list.id}/members?*`, async route => {
    const n = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
    if (n === 2) await new Promise(resolve => { releaseSecondPage = resolve; enterSecondPage(); });
    await route.fulfill({ json: { ...members, total: 52, selectedCount: 0, page: n, pageSize: 50, members: allRows.slice((n - 1) * 50, n * 50) } });
  });
  await paginationPage.goto(`${base}/lists/${list.id}`);
  await paginationPage.getByRole('button', { name: 'Paged creator 1', exact: true }).waitFor();
  await paginationPage.getByRole('navigation', { name: 'Creator pages', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
  await secondPageEntered;
  await paginationPage.getByRole('status', { name: 'Loading creators', exact: true }).waitFor();
  assert.equal(await paginationPage.locator('.members-table tbody tr').count(), 0);
  assert.ok(await paginationPage.getByRole('navigation', { name: 'Creator pages', exact: true }).getByRole('button', { name: 'Next', exact: true }).isDisabled());
  releaseSecondPage(); await paginationPage.getByRole('button', { name: 'Paged creator 51', exact: true }).waitFor();
  assert.equal(await paginationPage.locator('.members-table tbody tr').count(), 2);
  await paginationPage.close();
  assert.deepEqual(errors, []);
  console.log('✓ component states: actual spinner rotation, shimmer, photo arrival, refresh, selection/export ordering, submitting dialog focus, rename, Find more, email preview, import, creation, autosave, suggestions, exclusions, reduced motion and responsive widths');
} catch (error) { await shot('failure').catch(() => {}); console.error(error); process.exitCode = 1; }
finally { await browser.close(); }
