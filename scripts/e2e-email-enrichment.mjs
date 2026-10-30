// Real local API + embedded Postgres + fake provider. Never point this at a deployed database.
// NODE_PATH=<backend>/node_modules node scripts/e2e-email-enrichment.mjs http://127.0.0.1:5068
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:5068';
assert.equal(new URL(base).hostname, '127.0.0.1', 'local stack only');
const config = await (await fetch(`${base}/api/session/config`)).json();
assert.equal(config.authMode, 'dev'); assert.equal(config.sourceMode, 'live');
const backendBase = process.env.SOURCING_TEST_BACKEND_BASE ?? 'http://127.0.0.1:3917';
assert.equal(new URL(backendBase).hostname, '127.0.0.1', 'local backend only');
const backendHealth = await (await fetch(`${backendBase}/health`)).json();
assert.equal(backendHealth.service, 'internal-sourcing-local-stack');
const shots = process.argv[3] ?? './artifacts/email-enrichment'; mkdirSync(shots, { recursive: true });
const api = async (path, method = 'GET', body) => {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text(); assert.ok(res.ok, `${method} ${path}: ${res.status} ${text}`); return JSON.parse(text);
};
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = []; page.on('pageerror', e => errors.push(e.message));
async function submitEmails(beforeFinish) {
  const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && /\/email-jobs$/.test(new URL(r.url()).pathname));
  await page.getByRole('dialog').getByRole('button', { name: 'Find emails', exact: true }).click();
  const response = await responsePromise; assert.ok(response.ok()); const started = await response.json();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  if (beforeFinish) await beforeFinish();
  for (let i = 0; i < 60; i++) { const {job} = await api(`/lists/${listId}/email-jobs`); if (job?.id === started.job.id && !['queued','running'].includes(job.status)) break; await new Promise(r => setTimeout(r, 500)); }
  await page.getByText('Email lookup finished', { exact: true }).waitFor({ timeout: 30000 });
}
let listId;
try {
  const prior = await api('/lists?pageSize=100');
  const list = await api('/lists', 'POST', { name: `Email verification ${Date.now()}`, criteria: { platforms: [{ platform: 'instagram' }], niche: 'skincare routines', idealCreator: 'Skincare educational creators' }, targetCount: 3, excludedListIds: prior.lists.filter(l => l.eligibleForExclusion).map(l => l.id) });
  listId = list.id;
  await api(`/lists/${list.id}/operations`, 'POST', { kind: 'initial', idempotencyKey: `email-e2e-${Date.now()}`, baseRevision: list.draftRevision });
  for (let i = 0; i < 90; i++) { const state = await api(`/lists/${list.id}`); if (!['queued', 'sourcing'].includes(state.status)) break; await new Promise(r => setTimeout(r, 500)); }
  const sourced = (await api(`/lists/${list.id}/members`)).members;
  assert.equal(sourced.length, 3);
  const missingHandle = `missing_e2e_${list.id.slice(0,8)}`;
  const provided = (await api(`/lists/${list.id}/members`, 'POST', { platform: 'instagram', handle: `provided_e2e_${list.id.slice(0,8)}`, email: 'supplied@example.com' })).member;
  const cleared = (await api(`/lists/${list.id}/members`, 'POST', { platform: 'instagram', handle: `cleared_e2e_${list.id.slice(0,8)}` })).member;
  await api(`/lists/${list.id}/members/${cleared.id}`, 'PATCH', { email: null });
  await api(`/lists/${list.id}/members`, 'POST', { platform: 'instagram', handle: missingHandle });
  await api(`/lists/${list.id}/selection`, 'PUT', { selected: true, memberIds: sourced.slice(0, 2).map(m => m.id) });
  await page.goto(`${base}/lists/${list.id}`);
  await page.getByRole('button', { name: 'Find selected emails', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByText('0.40 credits', { exact: true }).waitFor();
  await page.screenshot({ path: join(shots, '01-preview-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(shots, '02-preview-phone.png'), fullPage: true, animations: 'disabled' });
  await submitEmails(async () => { await page.getByRole('button', { name: sourced[0].displayName, exact: true }).click(); });
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  assert.equal(await page.getByRole('dialog').locator('input[type="email"]').inputValue(), `${sourced[0].handle}@example.com`, 'editing a drawer opened before lookup finished uses the latest saved email');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  let members = (await api(`/lists/${list.id}/members`)).members;
  assert.equal(members.filter(m => m.email).length, 3); // Two selected sourced profiles plus supplied address.
  assert.equal(members.find(m => m.id === sourced[2].id).email, null);
  assert.equal(members.find(m => m.id === provided.id).email, 'supplied@example.com');
  await page.reload(); await page.getByText('Email lookup finished', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const target = sourced[2];
  await page.getByRole('button', { name: `Find email for ${target.displayName ?? target.handle}`, exact: true }).click();
  await page.getByRole('dialog').getByText('0.20 credits', { exact: true }).waitFor();
  await submitEmails();
  await page.getByRole('button', { name: 'Find emails', exact: true }).first().click();
  await page.getByRole('dialog').getByText('Estimated maximum spend', { exact: true }).waitFor();
  await submitEmails();
  members = (await api(`/lists/${list.id}/members`)).members;
  assert.equal(members.find(m => m.id === cleared.id).email, null);
  assert.equal(members.find(m => m.handle === missingHandle).emailLookupStatus, 'not_found');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(shots, '03-results-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(shots, '04-results-phone-dark.png'), fullPage: true, animations: 'disabled' });
  for (const format of ['default', 'sheets']) {
    const res = await fetch(`${base}/api/lists/${list.id}/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all', format }) });
    assert.ok(res.ok); const csv = await res.text(); assert.match(csv, /supplied@example.com/); assert.match(csv, new RegExp(`${sourced[0].handle}@example.com`));
    assert.match(csv, /23456/);
    if (format === 'sheets') { assert.match(csv, /instagram_media_count/); assert.match(csv, /Paid profile details/); assert.match(csv, /,77,/); }
  }
  const beforeExport = await api(`/lists/${list.id}/email-jobs`);
  await page.getByRole('button', { name: 'Export selected', exact: true }).click();
  const exportDialog = page.getByRole('dialog');
  await exportDialog.getByRole('radio', { name: /Full details/ }).waitFor();
  assert.ok(await exportDialog.getByRole('radio', { name: /Full details/ }).isChecked());
  const request = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith(`/lists/${list.id}/export`));
  const downloaded = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const sent = (await request).postDataJSON(); assert.equal(sent.format, 'sheets'); assert.equal(sent.scope, 'selected');
  const csv = readFileSync(await (await downloaded).path(), 'utf8');
  assert.equal(csv.split('\r\n')[0].replace(/^\uFEFF/, '').split(',').length, 93);
  assert.match(csv, new RegExp(`${sourced[0].handle}@example.com`)); assert.match(csv, /Paid profile details/); assert.match(csv, /,77,/);
  assert.doesNotMatch(csv, /supplied@example.com/, 'selected export includes only the selected sourced profiles');
  await exportDialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  assert.deepEqual(await api(`/lists/${list.id}/email-jobs`), beforeExport, 'download adds no email job or credits');
  assert.deepEqual(errors, []);
  console.log('PASS: real backend selected/single/all email retrieval, cost preview, reload persistence, supplied/cleared preservation, both exports, phone layout and dark mode.');
} catch (err) { console.error(await page.getByRole('dialog').innerText().catch(() => 'No dialog')); await page.screenshot({ path: join(shots, 'failure.png'), fullPage: true, animations: 'disabled' }); throw err; } finally { await browser.close(); }
