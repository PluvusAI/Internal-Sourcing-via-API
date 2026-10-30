// Disposable local-stack regression: archive visibility, cross-page Undo, restore and direct delete.
// NODE_PATH=<backend>/node_modules node scripts/e2e-list-lifecycle.mjs http://127.0.0.1:5074
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5074';
assert.equal(new URL(base).hostname, '127.0.0.1', 'run only against the disposable local stack');
const config = await (await fetch(`${base}/api/session/config`)).json();
assert.equal(config.authMode, 'dev'); assert.equal(config.sourceMode, 'live');
assert.equal((await (await fetch('http://127.0.0.1:3919/health')).json()).service, 'internal-sourcing-local-stack');
const shots = process.argv[3] ?? './artifacts/list-lifecycle'; mkdirSync(shots, { recursive: true });
const api = async (path, method = 'GET', body) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text(); assert.ok(r.ok, `${method} ${path}: ${r.status} ${text}`); return JSON.parse(text);
};
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const tag = Date.now().toString(36);
const fresh = name => api('/lists', 'POST', { name: `${name} ${tag}` });
const absent = async id => assert.equal((await fetch(`${base}/api/lists/${id}`)).status, 404);
const screenshot = async name => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true, animations: 'disabled' }); };
const confirmDelete = async name => {
  await page.getByRole('button', { name: `Delete list ${name}`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this list?' }).getByRole('button', { name: 'Delete list', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
};
try {
  const target = await fresh('Archive target');
  const other = await fresh('Other archived brand'); await api(`/lists/${other.id}/archive`, 'POST', { archived: true });
  // Archive from a detail page whose originating library search does not match its name.
  await page.goto(`${base}/lists/${target.id}?from=${encodeURIComponent('/?q=Unrelated+brand&page=4')}`);
  await page.getByRole('button', { name: 'Archive draft', exact: true }).click();
  await page.getByRole('button', { name: 'Undo archive', exact: true }).waitFor();
  assert.equal(new URL(await page.getByRole('link', { name: 'Archived lists', exact: true }).getAttribute('href'), base).searchParams.get('q'), null);
  await page.getByRole('link', { name: 'View archive', exact: true }).click();
  await page.getByRole('link', { name: target.name, exact: true }).waitFor();
  await page.getByRole('link', { name: other.name, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('q'), null);
  await screenshot('01-archived-visible-with-undo');
  await page.getByRole('button', { name: 'Undo archive', exact: true }).click();
  await page.getByRole('link', { name: target.name, exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('link', { name: 'View active lists', exact: true }).click();
  await page.getByRole('link', { name: target.name, exact: true }).waitFor();
  assert.equal((await api(`/lists/${target.id}`)).archivedAt, null);
  // Generic archive navigation clears the active search instead of silently hiding archived lists.
  await page.goto(`${base}/?q=${encodeURIComponent(target.name)}`);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('link', { name: other.name, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('q'), null);
  // A keystroke still waiting on its debounce must not enter the newly opened view.
  await page.getByRole('button', { name: 'Active lists', exact: true }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByPlaceholder('Search lists by brand or list name').fill('Pending unrelated search');
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.clock.fastForward(300);
  await page.clock.resume();
  await page.getByRole('link', { name: other.name, exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('q'), null);
  assert.equal(await page.getByPlaceholder('Search lists by brand or list name').inputValue(), '');
  // Undo remains available after opening a different list page.
  await page.getByRole('button', { name: 'Active lists', exact: true }).click();
  await page.getByRole('button', { name: `Archive ${target.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Undo archive', exact: true }).waitFor();
  await page.getByRole('link', { name: 'View archive', exact: true }).click();
  await page.getByRole('link', { name: other.name, exact: true }).click();
  await page.getByRole('button', { name: 'Undo archive', exact: true }).click();
  await page.getByRole('link', { name: 'View active lists', exact: true }).waitFor();
  assert.equal((await api(`/lists/${target.id}`)).archivedAt, null);
  // Restore works after reload even without a transient Undo message.
  await page.reload(); await page.getByRole('button', { name: 'Restore list', exact: true }).click();
  await page.getByRole('link', { name: 'All lists', exact: true }).click();
  await page.getByRole('link', { name: other.name, exact: true }).waitFor();
  // A new list can be deleted immediately; canceling its confirmation retains it.
  const draft = await fresh('Delete new draft');
  await page.goto(`${base}/lists/${draft.id}`);
  await page.getByRole('button', { name: `Delete list ${draft.name}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep list', exact: true }).click();
  assert.equal((await api(`/lists/${draft.id}`)).id, draft.id);
  await confirmDelete(draft.name); await page.waitForURL(url => url.pathname === '/'); await absent(draft.id);
  // Imported lists can be deleted directly from the active library.
  const csv = 'platform,handle\ninstagram,lifecycle_test'; const preview = await api('/imports/preview', 'POST', { csv });
  const imported = (await api('/imports', 'POST', { csv, name: `Delete active imported ${tag}`, mapping: preview.mapping })).list;
  await page.reload(); await confirmDelete(imported.name); await absent(imported.id);
  // Finished sourced lists can be deleted directly, and active jobs remain protected.
  const sourced = await api('/lists', 'POST', { name: `Delete completed source ${tag}`, criteria: { platforms: [{ platform: 'instagram' }], niche: 'skincare routines' }, targetCount: 1 });
  await api(`/lists/${sourced.id}/operations`, 'POST', { kind: 'initial', idempotencyKey: `lifecycle-${tag}`, baseRevision: sourced.draftRevision });
  for (let i = 0; i < 60; i++) { const l = await api(`/lists/${sourced.id}`); if (!['queued', 'sourcing'].includes(l.status)) break; await new Promise(r => setTimeout(r, 300)); }
  await page.goto(`${base}/lists/${sourced.id}`); await confirmDelete(sourced.name); await absent(sourced.id);
  // Deleting an archived list clears its Undo and removes it from both library views.
  const archivedDelete = await fresh('Delete archived list'); await page.goto(`${base}/lists/${archivedDelete.id}`);
  await page.getByRole('button', { name: 'Archive draft', exact: true }).click();
  await page.getByRole('button', { name: 'Undo archive', exact: true }).waitFor();
  await page.getByRole('link', { name: 'View archive', exact: true }).click();
  await confirmDelete(archivedDelete.name); await absent(archivedDelete.id);
  assert.equal(await page.getByRole('button', { name: 'Undo archive', exact: true }).count(), 0);
  assert.equal((await api(`/lists?q=${encodeURIComponent(archivedDelete.name)}&archivedOnly=1`)).total, 0);
  // Library summaries omit email jobs; confirmation must check the current detail.
  const busy = await fresh('Email job protects deletion'); await page.goto(`${base}/`);
  const busyRoute = `**/api/lists/${busy.id}`;
  await page.route(busyRoute, async route => {
    const response = await route.fetch(); const json = await response.json();
    await route.fulfill({ response, json: { ...json, emailJob: { status: 'running' } } });
  });
  await page.getByRole('button', { name: `Delete list ${busy.name}`, exact: true }).click();
  await page.getByText('Wait for the current search or email lookup to finish before deleting this list.', { exact: true }).waitFor();
  assert.ok(await page.getByRole('dialog').getByRole('button', { name: 'Delete list', exact: true }).isDisabled());
  await page.getByRole('dialog').getByRole('button', { name: 'Keep list', exact: true }).click();
  await page.unroute(busyRoute); assert.equal((await api(`/lists/${busy.id}`)).id, busy.id);
  // A missing detail keeps its originating archived search and page on the error link.
  const failedRoute = `**/api/lists/${busy.id}`;
  await page.route(failedRoute, route => route.fulfill({ status: 404, json: { error: { code: 'list_not_found', message: 'Test list unavailable.' } } }));
  const from = '/?archived=1&q=Saved+brand&page=2';
  await page.goto(`${base}/lists/${busy.id}?from=${encodeURIComponent(from)}`);
  await page.getByText('List not found', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Archived lists', exact: true }).getAttribute('href'), from);
  await page.unroute(failedRoute);
  // Deletion can finish before an already-successful archive response reaches the browser.
  const late = await fresh('Delayed archive after delete'); await page.goto(`${base}/`);
  let releaseResponse;
  const captured = new Promise(resolve => {
    page.route(`**/api/lists/${late.id}/archive`, async route => {
      const response = await route.fetch();
      await new Promise(release => { releaseResponse = release; resolve(); });
      await route.fulfill({ response });
    }, { times: 1 });
  });
  await page.getByRole('button', { name: `Archive ${late.name}`, exact: true }).click(); await captured;
  await confirmDelete(late.name); await absent(late.id);
  const delivered = page.waitForResponse(r => r.url().endsWith(`/lists/${late.id}/archive`));
  const refresh = page.waitForRequest(r => new URL(r.url()).pathname === '/api/lists' && r.method() === 'GET');
  releaseResponse(); await delivered; await (await refresh).response();
  await page.locator('.library-card[aria-busy="false"]').waitFor();
  assert.equal(await page.getByRole('link', { name: late.name, exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Undo archive', exact: true }).count(), 0);
  // Pending archive reads and writes stay consistent if the user changes views mid-request.
  const pending = await fresh('Pending archive'); await page.goto(`${base}/`);
  let release; const intercepted = new Promise(resolve => { page.route(`**/api/lists/${pending.id}/archive`, async route => { await new Promise(r => { release = r; resolve(); }); await route.continue(); }, { times: 1 }); });
  await page.getByRole('button', { name: `Archive ${pending.name}`, exact: true }).click(); await intercepted;
  await page.getByRole('button', { name: 'Archived', exact: true }).click(); release();
  await page.getByRole('link', { name: pending.name, exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone layout fits');
  await screenshot('02-archive-phone-dark');
  assert.deepEqual(errors, []);
  console.log('PASS: archived visibility, cleared filters, cross-route Undo, restore after reload, new/imported/completed/archived deletion, cancel, pending input, email-job protection, failed-load navigation, and archive/delete/view races.');
} catch (err) { await screenshot('failure').catch(() => {}); throw err; }
finally { await browser.close(); }
