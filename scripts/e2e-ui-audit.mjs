// Local sample-mode UI verification: metrics, photos, loading, overlays and responsive states.
// NODE_PATH=/path/to/playwright/node_modules node scripts/e2e-ui-audit.mjs http://127.0.0.1:5065
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5065';
const shots = process.argv[3] ?? './artifacts/full-ui-audit/screens';
mkdirSync(shots, { recursive: true });
const config = await (await fetch(`${base}/api/session/config`)).json();
assert.equal(config.sourceMode, 'mock', 'run only against isolated sample data');
assert.equal(config.authMode, 'dev');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const api = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.json();
};
const shot = async name => { const overlay = await page.getByRole('dialog').count() > 0; if (!overlay) await page.evaluate(() => scrollTo(0, 0)); return page.screenshot({ path: join(shots, `${name}.png`), fullPage: !overlay, animations: 'disabled' }); };
const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
const closeDialog = async () => { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }); };
try {
  const list = await api('/lists', 'POST', { name: `UI audit · Skincare creators ${Date.now().toString(36)}`, criteria: { platforms: [{ platform: 'instagram' }], niche: 'Skincare routines' }, targetCount: 5 });
  await api(`/lists/${list.id}/operations`, 'POST', { kind: 'initial', idempotencyKey: `ui-audit-${Date.now()}`, baseRevision: list.draftRevision });
  let detail;
  for (let i = 0; i < 8; i++) { detail = await api(`/lists/${list.id}`); if (detail.status === 'complete') break; }
  assert.equal(detail.status, 'complete');
  const op = detail.operations.at(-1);
  // Distinct fixture counters ensure the labels do not accidentally display one repeated value.
  detail.operations[detail.operations.length - 1] = { ...op, counters: { considered: 42, excluded: 7, duplicates: 3 } };
  await page.route(`**/api/lists/${list.id}`, route => route.fulfill({ json: detail }));
  await page.route('**/audit-photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#d0ddce"/><circle cx="40" cy="28" r="14" fill="#55745a"/><path d="M12 80a28 28 0 0 1 56 0" fill="#55745a"/></svg>' }));
  await page.route('**/audit-missing-photo.png', route => route.fulfill({ status: 404, body: '' }));
  const members = await api(`/lists/${list.id}/members`);
  const originals = structuredClone(members.members);
  await page.route(`**/api/lists/${list.id}/members?*`, route => {
    const data = structuredClone(members);
    data.members[0].pictureUrl = `${base}/audit-photo.svg`;
    data.members[0].displayName = 'Photo available';
    data.members[1].pictureUrl = `${base}/audit-missing-photo.png`;
    data.members[1].displayName = 'Photo unavailable';
    return route.fulfill({ json: data });
  });
  await page.goto(`${base}/lists/${list.id}`);
  await page.getByRole('button', { name: 'Photo available', exact: true }).waitFor();
  for (const [label, value] of [['Creators considered', '42'], ['Qualified & saved', '5'], ['Skipped by exclusions', '7'], ['Already on this list', '3']]) {
    assert.equal(await page.locator('.search-metric').filter({ has: page.getByText(label, { exact: true }) }).locator('dd strong').innerText(), value);
  }
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '5');
  await page.waitForFunction(() => document.querySelector('.creator-avatar img')?.naturalWidth > 0);
  await page.waitForFunction(() => document.querySelectorAll('.creator-avatar img').length === 1);
  assert.equal(await page.locator('.creator-avatar').nth(1).innerText(), 'PU');
  assert.equal(await page.locator('.creator-avatar').nth(2).innerText(), 'SC');
  await page.locator('.search-details > summary').click();
  const panels = await page.locator('.search-context > section').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
  assert.equal(panels[0], panels[1], 'summary cards align on desktop');
  await noOverflow(); await shot('search-details');
  await page.locator('.search-details > summary').click();
  await shot('results-desktop');
  await page.getByRole('button', { name: 'Photo available', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.locator('.creator-avatar-large img').count(), 1);
  await page.getByRole('button', { name: 'Close details', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Edit details', 'drawer traps backward focus');
  await shot('creator-drawer'); await closeDialog();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Photo available', 'drawer restores focus');
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(); await shot(`results-${width}`);
  }
  await page.emulateMedia({ colorScheme: 'dark' }); await shot('results-mobile-dark');
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Find more', exact: true }).click();
  await page.getByLabel('Additional new creators').waitFor();
  assert.equal(await page.getByRole('dialog').evaluate(n => getComputedStyle(n).animationName), 'none');
  await shot('find-more-dialog'); await closeDialog();
  await page.getByRole('button', { name: 'Export all (5)', exact: true }).click();
  await page.getByRole('button', { name: 'Download CSV', exact: true }).waitFor();
  await shot('export-dialog'); await closeDialog();
  await page.getByRole('button', { name: /^Edit Photo available/ }).click();
  await page.getByRole('dialog').waitFor(); await shot('edit-creator-dialog'); await closeDialog();
  // Queued, running, partial and failed states all keep the same truthful progress UI.
  for (const [status, listStatus] of [['queued', 'queued'], ['running', 'sourcing'], ['partial', 'partial'], ['failed', 'failed']]) {
    detail.status = listStatus;
    detail.activeOperationId = ['queued', 'running'].includes(status) ? op.id : null;
    detail.operations[detail.operations.length - 1] = { ...op, status, listStatus, admittedCount: status === 'queued' ? 0 : 2, completedAt: ['queued', 'running'].includes(status) ? null : op.completedAt, counters: { considered: 42, excluded: 7, duplicates: 3 }, outcome: ['queued', 'running'].includes(status) ? null : { code: 'search_exhausted', message: 'The search stopped with fewer qualifying creators.' } };
    await page.reload(); await page.getByRole('region', { name: 'Search progress', exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), status === 'queued' ? '0' : '2');
    if (['queued', 'running'].includes(status)) assert.equal(await page.locator('.search-progress-status .loader-spinner').evaluate(n => getComputedStyle(n).animationName), 'none');
    await shot(`search-${status}`);
  }
  await page.goto(`${base}/?q=${encodeURIComponent(list.name)}`);
  await page.getByRole('link', { name: list.name, exact: true }).waitFor();
  await shot('library-desktop');
  await page.getByRole('button', { name: 'Import list', exact: true }).click();
  await page.getByLabel('CSV file').waitFor(); await shot('import-dialog');
  await page.getByLabel('CSV file').setInputFiles({ name: 'audit.csv', mimeType: 'text/csv', buffer: Buffer.from('platform,handle,display_name\ninstagram,audit_creator,Audit Creator') });
  await page.getByText('Will be imported', { exact: true }).waitFor();
  await shot('import-preview'); await closeDialog();
  await page.getByRole('button', { name: 'New sourcing list', exact: true }).click();
  await page.getByRole('dialog').waitFor(); await shot('new-list-dialog'); await closeDialog();
  let release;
  await page.route('**/api/lists?*', async route => { await new Promise(resolve => { release = resolve; }); await route.continue(); }, { times: 1 });
  await page.getByPlaceholder('Search lists by brand or list name').fill('loading-audit');
  await page.getByRole('status', { name: 'Loading lists', exact: true }).waitFor();
  assert.equal(await page.locator('.skeleton').first().evaluate(n => getComputedStyle(n, '::after').animationName), 'none');
  await shot('library-loading'); release();
  await page.getByText('No matching lists', { exact: true }).waitFor(); await shot('library-empty');
  await page.route('**/api/lists?*', route => route.fulfill({ status: 503, json: { error: { code: 'audit_failure', message: 'Temporary list service failure.' } } }));
  await page.reload();
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
  await shot('library-error');
  await page.unroute('**/api/lists?*');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('No matching lists', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(originals.length, 5);
  console.log('✓ UI audit: counters, photos/fallbacks, focus, reduced motion, dialogs, search states, loading, dark mode and 320/390/768/1440px layouts passed');
} catch (error) {
  await shot('failure').catch(() => {}); console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
