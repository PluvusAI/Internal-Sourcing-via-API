/**
 * PLU-509 — the app follows the sourcing backend's per-search limit and reports a broken source
 * connection honestly. The sourcing backend is a recording fake `fetch` (or the in-memory mock);
 * no network, no provider, no model.
 *
 * Run:  npx tsx --test server/limits.test.ts
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createApp } from "./app.js";
import type { Verify } from "./auth.js";
import { baseUrlProblem, loadConfig } from "./config.js";
import { createMockSource } from "./mockSource.js";
import { createInternalSourcingClient } from "./sourceClient.js";

const KEY = "internal-app-test-key-".padEnd(43, "q");
const liveEnv = {
  NODE_ENV: "production",
  SOURCING_API_BASE_URL: "https://sourcing.example.test",
  SOURCING_INTERNAL_APP_API_KEY: KEY,
  CLERK_SECRET_KEY: "sk_test_placeholder",
  CLERK_AUTHORIZED_PARTIES: "https://app.example.test",
  INTERNAL_APP_ALLOWED_USER_IDS: "user_ricky",
};
const verify: Verify = async (t) => (t === "ricky" ? { ok: true, userId: "user_ricky", orgId: null } : { ok: false, code: "session_invalid", message: "Invalid session." });
const auth = { Authorization: "Bearer ricky", "Content-Type": "application/json" };

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));
async function serve(app: ReturnType<typeof createApp>): Promise<string> {
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A fake source whose /meta reports `max.value` and which refuses any search above it, like the backend. */
function limitedSource(max: { value: number }) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init?.method ?? "GET", url, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/meta")) return json(200, { workspace: "internal-sourcing", maxTargetCount: max.value, platforms: ["instagram"], exportFormats: { default: { headers: [], filled: [] }, sheets: { headers: [], filled: [] } } });
    if (url.includes("/operations")) {
      const target = (body as { targetCount?: number }).targetCount ?? 0;
      if (target > max.value) {
        return json(422, { error: { code: "target_exceeds_limit", message: `At most ${max.value} new creators can be requested at a time.`, maxTargetQualified: max.value } });
      }
      return json(202, { operation: { id: "op12345678", status: "queued", targetCount: target }, idempotentReplay: false });
    }
    return json(404, { error: { code: "not_found", message: "No such endpoint." } });
  }) as typeof fetch;
  return { calls, client: createInternalSourcingClient({ baseUrl: "https://sourcing.example.test", apiKey: KEY, fetchImpl }) };
}

const start = (base: string, kind: "initial" | "find_more", targetCount: number, key: string) =>
  fetch(`${base}/api/lists/abcdefgh1234/operations`, { method: "POST", headers: auth, body: JSON.stringify({ kind, targetCount, idempotencyKey: key }) });

test("/api/meta always reports the backend's CURRENT maximum — 25, raised to 100, lowered to 5 — with nothing cached in the app", async () => {
  const max = { value: 25 };
  const fake = limitedSource(max);
  const base = await serve(createApp(loadConfig(liveEnv), { source: fake.client, verify }));
  for (const v of [25, 100, 5]) {
    max.value = v;
    const meta = (await (await fetch(`${base}/api/meta`, { headers: auth })).json()) as { maxTargetCount: number };
    assert.equal(meta.maxTargetCount, v);
  }
  assert.equal(fake.calls.filter((c) => c.url.endsWith("/meta")).length, 3, "every read goes to the backend");
});

test("initial search and Find more: the backend's limit is enforced for both; a refused count starts nothing and is reported as is", async () => {
  const max = { value: 100 };
  const fake = limitedSource(max);
  const base = await serve(createApp(loadConfig(liveEnv), { source: fake.client, verify }));

  // Raised to 100: both kinds may ask for 100.
  assert.equal((await start(base, "initial", 100, "op-key-initial-100")).status, 202);
  assert.equal((await start(base, "find_more", 100, "op-key-more-100")).status, 202);

  // Lowered to 5 while a page still shows 100: the backend refuses; the app passes the refusal on.
  max.value = 5;
  for (const kind of ["initial", "find_more"] as const) {
    const r = await start(base, kind, 60, `op-key-${kind}-stale`);
    assert.equal(r.status, 422);
    assert.deepEqual(await r.json(), { error: { code: "target_exceeds_limit", message: "At most 5 new creators can be requested at a time.", maxTargetQualified: 5 } });
  }
  const starts = fake.calls.filter((c) => c.url.includes("/operations"));
  assert.equal(starts.length, 4, "one call per click: the app never retries or splits a refused search into a new one");
  assert.deepEqual(
    starts.map((c) => (c.body as { targetCount: number }).targetCount),
    [100, 100, 60, 60],
    "the requested count is sent as entered, never trimmed by the app",
  );
});

test("the mock follows a changed limit the same way (meta and refusal), so the forms can be exercised locally", async () => {
  const mock = createMockSource({ maxTargetCount: 5 });
  assert.equal((await mock.meta()).maxTargetCount, 5);
  const list = await mock.createList({ name: "Brand A - Batch 1", criteria: { niche: "skincare", platforms: [{ platform: "instagram" }] }, targetCount: 10 });
  await assert.rejects(mock.startOperation(list.id, { idempotencyKey: "op-mock-000001", kind: "initial" }), (e: { code?: string; details?: { maxTargetQualified?: number } }) => e.code === "target_exceeds_limit" && e.details?.maxTargetQualified === 5);
  assert.equal((await mock.getList(list.id)).operations.length, 0, "nothing started");
  assert.equal((await mock.getList(list.id)).targetCount, 10, "the saved count is kept, not clamped");
  mock.setMaxTargetCount(100);
  assert.equal((await mock.meta()).maxTargetCount, 100);
  assert.equal((await mock.startOperation(list.id, { idempotencyKey: "op-mock-000002", kind: "initial" })).operation.targetCount, 10);
});

test("a mismatched or missing key on either side is an honest setup error, never a sign-in error or sample data", async () => {
  const answer = (status: number, code: string) =>
    createInternalSourcingClient({
      baseUrl: "https://sourcing.example.test",
      apiKey: KEY,
      fetchImpl: (async () => new Response(JSON.stringify({ error: { code, message: "x" } }), { status, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
  const cases: Array<[number, string, number, string]> = [
    [401, "invalid_credentials", 503, "source_auth_failed"], // the app's key differs from the backend's
    [401, "missing_credentials", 503, "source_auth_failed"],
    [503, "not_configured", 503, "source_not_configured"], // the backend has no internal key set
    [404, "not_found", 502, "source_misconfigured"], // the base URL is not the backend
  ];
  for (const [upstream, code, status, expected] of cases) {
    const base = await serve(createApp(loadConfig(liveEnv), { source: answer(upstream, code), verify }));
    const r = await fetch(`${base}/api/meta`, { headers: auth });
    assert.equal(r.status, status, code);
    const body = (await r.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, expected);
    assert.ok(!body.error.message.includes(KEY), "never the key itself");
    if (expected === "source_auth_failed") assert.match(body.error.message, /SOURCING_INTERNAL_APP_API_KEY/);
  }
  // An ordinary not-found list is still an ordinary 404.
  const base = await serve(createApp(loadConfig(liveEnv), { source: answer(404, "list_not_found"), verify }));
  assert.equal((await fetch(`${base}/api/lists/abcdefgh1234`, { headers: auth })).status, 404);
});

test("setup problems name variables: a base URL with an API path, plain http, or no key; deployed modes stay live + clerk", () => {
  assert.equal(baseUrlProblem("https://pluvus-workflow-prototype.example.app"), null);
  assert.equal(baseUrlProblem("https://pluvus-workflow-prototype.example.app/"), null);
  assert.match(baseUrlProblem("https://backend.example.app/api/v1/internal-sourcing")!, /origin only/);
  assert.match(baseUrlProblem("http://backend.example.app")!, /https/);
  assert.equal(baseUrlProblem("http://127.0.0.1:3901"), null, "plain http only for this machine");
  const missing = loadConfig({ ...liveEnv, SOURCING_INTERNAL_APP_API_KEY: "" });
  assert.ok(missing.problems.includes("SOURCING_INTERNAL_APP_API_KEY is not set"));
  const deployed = loadConfig(liveEnv);
  assert.deepEqual([deployed.sourceMode, deployed.authMode, deployed.problems], ["live", "clerk", []]);
});

test("the build's bundle check fails on the internal key's value in browser files, and passes on clean ones", () => {
  const script = fileURLToPath(new URL("../scripts/check-bundle.mjs", import.meta.url));
  const clean = mkdtempSync(join(tmpdir(), "isl-bundle-clean-"));
  writeFileSync(join(clean, "index.js"), "console.log('ui')");
  const dirty = mkdtempSync(join(tmpdir(), "isl-bundle-dirty-"));
  writeFileSync(join(dirty, "index.js"), `const k = "${KEY}";`);
  const env = { ...process.env, SOURCING_INTERNAL_APP_API_KEY: KEY };
  assert.equal(spawnSync(process.execPath, [script, clean], { env }).status, 0);
  const r = spawnSync(process.execPath, [script, dirty], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contains the value of SOURCING_INTERNAL_APP_API_KEY/);
});
