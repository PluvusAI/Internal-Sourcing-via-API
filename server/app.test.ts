/**
 * The internal app's server: setup errors, sign-in gate, the explicit API surface, error mapping.
 * The sourcing backend is a recording fake `fetch`; no network.
 *
 * Run:  npx tsx --test server/app.test.ts
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { createApp } from "./app.js";
import type { Verify } from "./auth.js";
import { loadConfig, type AppConfig } from "./config.js";
import { createMockSource } from "./mockSource.js";
import { createInternalSourcingClient } from "./sourceClient.js";

const KEY = "internal-app-test-key-".padEnd(43, "k");
const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

async function serve(app: ReturnType<typeof createApp>): Promise<string> {
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const liveEnv = {
  NODE_ENV: "production",
  SOURCING_API_BASE_URL: "https://sourcing.example.test",
  SOURCING_INTERNAL_APP_API_KEY: KEY,
  CLERK_SECRET_KEY: "sk_test_placeholder",
  CLERK_AUTHORIZED_PARTIES: "https://app.example.test",
  INTERNAL_APP_ALLOWED_ORG_IDS: "org_allowed1",
};

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A fake sourcing backend: records every call, answers with `reply`. */
function fakeSource(reply: (r: Recorded) => { status: number; body: unknown; headers?: Record<string, string> } = () => ({ status: 200, body: {} })) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const rec = { url: String(input), method: init?.method ?? "GET", headers, body: (init?.body as string | undefined) ?? null };
    calls.push(rec);
    const r = reply(rec);
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status, headers: { "content-type": typeof r.body === "string" ? "text/csv" : "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { calls, client: createInternalSourcingClient({ baseUrl: "https://sourcing.example.test", apiKey: KEY, fetchImpl }) };
}

const allowVerify: Verify = async (token) =>
  token === "good-org" ? { ok: true, userId: "user_ricky", orgId: "org_allowed1" } : token === "no-org" ? { ok: true, userId: "user_ricky", orgId: null } : token === "other-org" ? { ok: true, userId: "user_x", orgId: "org_other" } : { ok: false, code: "session_invalid", message: "Invalid session. Sign in again." };

const authed = (token = "good-org", extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extra });

test("health answers without sign-in; missing configuration is an honest 503, never sample data", async () => {
  const cfg = loadConfig({ NODE_ENV: "production" });
  assert.ok(cfg.problems.includes("SOURCING_API_BASE_URL is not set"));
  assert.ok(cfg.problems.includes("SOURCING_INTERNAL_APP_API_KEY is not set"));
  assert.ok(cfg.problems.includes("CLERK_SECRET_KEY is not set"));
  const base = await serve(createApp(cfg, { source: null }));
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const lists = await fetch(`${base}/api/lists`);
  assert.equal(lists.status, 503);
  const body = (await lists.json()) as { error: { code: string; problems: string[] } };
  assert.equal(body.error.code, "setup_required");
  assert.ok(body.error.problems.every((p) => !p.includes(KEY)), "problems name variables, never values");
  const config = (await (await fetch(`${base}/api/session/config`)).json()) as { setupProblems: string[] };
  assert.ok(config.setupProblems.length > 0);
});

test("mock data and development sign-in are refused in production", () => {
  const cfg = loadConfig({ ...liveEnv, SOURCE_MODE: "mock", AUTH_MODE: "dev" });
  assert.equal(cfg.sourceMode, "live");
  assert.equal(cfg.authMode, "clerk");
  assert.ok(cfg.problems.some((p) => p.startsWith("SOURCE_MODE=mock is not allowed")));
  assert.ok(cfg.problems.some((p) => p.startsWith("AUTH_MODE=dev is not allowed")));
  const dev = loadConfig({ NODE_ENV: "development", SOURCE_MODE: "mock", AUTH_MODE: "dev" });
  assert.deepEqual([dev.sourceMode, dev.authMode, dev.problems], ["mock", "dev", []]);
});

test("a complete live configuration has no problems; an allowlist is required", () => {
  assert.deepEqual(loadConfig(liveEnv).problems, []);
  const noAllow = loadConfig({ ...liveEnv, INTERNAL_APP_ALLOWED_ORG_IDS: "" });
  assert.ok(noAllow.problems.some((p) => p.includes("INTERNAL_APP_ALLOWED_ORG_IDS or INTERNAL_APP_ALLOWED_USER_IDS")));
  assert.ok(loadConfig({ ...liveEnv, SOURCING_API_BASE_URL: "http://sourcing.example.test" }).problems.some((p) => p.includes("https")));
  for (const url of ["https://sourcing.example.test/api/v1/internal-sourcing", "https://sourcing.example.test/?x=1", "https://user:pass@sourcing.example.test"]) {
    assert.ok(loadConfig({ ...liveEnv, SOURCING_API_BASE_URL: url }).problems.some((p) => p.includes("SOURCING_API_BASE_URL")), url);
  }
});

test("sign-in: no token 401, bad token 401, wrong organization 403, no active organization 403, removed member cannot write", async () => {
  const { client } = fakeSource(() => ({ status: 200, body: { q: "", page: 1, pageSize: 25, total: 0, matchingNotEligible: 0, lists: [] } }));
  let member = true;
  const base = await serve(createApp(loadConfig(liveEnv), { source: client, verify: allowVerify, memberships: async () => (member ? ["org_allowed1"] : []) }));
  assert.equal((await fetch(`${base}/api/lists`)).status, 401);
  assert.equal((await fetch(`${base}/api/lists`, { headers: authed("forged") })).status, 401);
  const other = await fetch(`${base}/api/lists`, { headers: authed("other-org") });
  assert.equal(other.status, 403);
  const noOrg = await fetch(`${base}/api/lists`, { headers: authed("no-org") });
  assert.equal(((await noOrg.json()) as { error: { code: string } }).error.code, "organization_required");
  assert.equal((await fetch(`${base}/api/lists`, { headers: authed() })).status, 200);
  member = false;
  const write = await fetch(`${base}/api/lists`, { method: "POST", headers: authed(), body: JSON.stringify({ name: "x" }) });
  assert.equal(write.status, 403);
  assert.equal(((await write.json()) as { error: { code: string } }).error.code, "membership_required");
});

test("each UI endpoint calls exactly one source endpoint, with the server-held key and the signed-in user as attribution", async () => {
  const fake = fakeSource((r) => (r.url.includes("/export") ? { status: 200, body: "﻿email,first_name\r\n,Ana\r\n", headers: { "x-export-count": "1", "content-disposition": 'attachment; filename="brand-a-all-2026-10-28.csv"' } } : { status: 200, body: { ok: true } }));
  const base = await serve(createApp(loadConfig(liveEnv), { source: fake.client, verify: allowVerify, memberships: async () => ["org_allowed1"] }));
  await fetch(`${base}/api/lists?q=Brand%20A&eligible=1&page=2`, { headers: authed() });
  await fetch(`${base}/api/lists/abcdefgh1234`, { method: "PATCH", headers: authed(), body: JSON.stringify({ name: "Brand A - Batch 1" }) });
  const exp = await fetch(`${base}/api/lists/abcdefgh1234/export`, { method: "POST", headers: authed(), body: JSON.stringify({ format: "default", scope: "all" }) });
  assert.equal(exp.headers.get("x-export-count"), "1");
  assert.match(exp.headers.get("content-disposition") ?? "", /brand-a-all-2026-10-28\.csv/);
  assert.match(await exp.text(), /email,first_name/);

  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[0]!.url, "https://sourcing.example.test/api/v1/internal-sourcing/lists?q=Brand+A&page=2&eligible=1");
  for (const c of fake.calls) assert.equal(c.headers["authorization"], `Bearer ${KEY}`);
  assert.equal(fake.calls[1]!.headers["x-internal-user"], "user_ricky");
  assert.equal(fake.calls[1]!.method, "PATCH");
});

test("there is no pass-through: unknown paths 404 and never reach the source; a search needs an idempotency key", async () => {
  const fake = fakeSource();
  const base = await serve(createApp(loadConfig(liveEnv), { source: fake.client, verify: allowVerify, memberships: async () => ["org_allowed1"] }));
  for (const path of ["/api/v1/sourcing/requests", "/api/lists/abcdefgh1234/../../admin", "/api/campaigns"]) {
    assert.equal((await fetch(`${base}${path}`, { headers: authed() })).status, 404, path);
  }
  const noKey = await fetch(`${base}/api/lists/abcdefgh1234/operations`, { method: "POST", headers: authed(), body: JSON.stringify({ kind: "initial" }) });
  assert.equal(noKey.status, 400);
  assert.equal(fake.calls.length, 0);
});

test("source errors reach the UI with their code; an unreachable source is a 502, not a crash", async () => {
  const conflict = fakeSource(() => ({ status: 409, body: { error: { code: "operation_active", message: "A search is already running for this list.", operationId: "op123456789" } } }));
  const base = await serve(createApp(loadConfig(liveEnv), { source: conflict.client, verify: allowVerify, memberships: async () => ["org_allowed1"] }));
  const r = await fetch(`${base}/api/lists/abcdefgh1234/operations`, { method: "POST", headers: authed(), body: JSON.stringify({ kind: "find_more", idempotencyKey: "op-0123456789abcdef", targetCount: 5 }) });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: { code: "operation_active", message: "A search is already running for this list.", operationId: "op123456789" } });
  assert.equal(conflict.calls[0]!.headers["idempotency-key"], "op-0123456789abcdef");

  const down = createInternalSourcingClient({ baseUrl: "https://sourcing.example.test", apiKey: KEY, fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch });
  const base2 = await serve(createApp(loadConfig(liveEnv), { source: down, verify: allowVerify }));
  const d = await fetch(`${base2}/api/lists`, { headers: authed() });
  assert.equal(d.status, 502);
  assert.equal(((await d.json()) as { error: { code: string } }).error.code, "upstream_unavailable");
});

test("a missing list stays a 404; a missing source metadata route is a setup error", async () => {
  const fake = fakeSource((r) => ({ status: 404, body: { error: { code: "not_found", message: r.url.endsWith("/meta") ? "No metadata route." : "No such list." } } }));
  const base = await serve(createApp(loadConfig(liveEnv), { source: fake.client, verify: allowVerify, memberships: async () => ["org_allowed1"] }));
  const list = await fetch(`${base}/api/lists/abcdefgh1234`, { headers: authed() });
  assert.equal(list.status, 404);
  assert.deepEqual(await list.json(), { error: { code: "not_found", message: "No such list." } });
  const meta = await fetch(`${base}/api/meta`, { headers: authed() });
  assert.equal(meta.status, 502);
  assert.equal(((await meta.json()) as { error: { code: string } }).error.code, "source_misconfigured");
  for (const path of ["/api/meta/", "/api/META"]) {
    const alias = await fetch(`${base}${path}`, { headers: authed() });
    assert.equal(alias.status, 502);
    assert.equal(((await alias.json()) as { error: { code: string } }).error.code, "source_misconfigured");
  }
});

test("source metadata and its changing limit control new operations without an app-side ceiling", async () => {
  let maxTargetCount = 100;
  let savedTarget = 0;
  let accepted = 0;
  const fake = fakeSource((r) => {
    if (r.url.endsWith("/meta")) return { status: 200, body: { workspace: "internal-sourcing", maxTargetCount, platforms: ["instagram"], exportFormats: { default: { headers: [], filled: [] }, sheets: { headers: [], filled: [] } } } };
    if (r.method === "PATCH") {
      savedTarget = (JSON.parse(r.body ?? "{}") as { targetCount: number }).targetCount;
      return { status: 200, body: { targetCount: savedTarget } };
    }
    const body = JSON.parse(r.body ?? "{}") as { kind: string; targetCount?: number };
    const requested = body.kind === "initial" ? savedTarget : body.targetCount ?? 0;
    if (requested > maxTargetCount) return { status: 422, body: { error: { code: "target_exceeds_limit", message: `At most ${maxTargetCount} new creators can be requested at a time.`, maxTargetQualified: maxTargetCount } } };
    accepted++;
    return { status: 202, body: { operation: { targetCount: requested }, idempotentReplay: false } };
  });
  const base = await serve(createApp(loadConfig(liveEnv), { source: fake.client, verify: allowVerify, memberships: async () => ["org_allowed1"] }));
  const meta = await fetch(`${base}/api/meta`, { headers: authed() });
  assert.equal(meta.status, 200);
  assert.equal(((await meta.json()) as { maxTargetCount: number }).maxTargetCount, 100);
  assert.equal((await fetch(`${base}/api/lists/abcdefgh1234`, { method: "PATCH", headers: authed(), body: JSON.stringify({ targetCount: 100 }) })).status, 200);
  const initial = await fetch(`${base}/api/lists/abcdefgh1234/operations`, { method: "POST", headers: authed(), body: JSON.stringify({ kind: "initial", idempotencyKey: "initial-0123456789" }) });
  assert.equal(initial.status, 202);
  assert.equal(((await initial.json()) as { operation: { targetCount: number } }).operation.targetCount, 100);
  maxTargetCount = 25;
  const stale = await fetch(`${base}/api/lists/abcdefgh1234/operations`, { method: "POST", headers: authed(), body: JSON.stringify({ kind: "find_more", targetCount: 100, idempotencyKey: "more-0123456789" }) });
  assert.equal(stale.status, 422);
  assert.equal(((await stale.json()) as { error: { code: string; maxTargetQualified: number } }).error.code, "target_exceeds_limit");
  assert.equal(accepted, 1, "the rejected request did not start an operation");
  assert.equal(((await (await fetch(`${base}/api/meta`, { headers: authed() })).json()) as { maxTargetCount: number }).maxTargetCount, 25);
  const more = await fetch(`${base}/api/lists/abcdefgh1234/operations`, { method: "POST", headers: authed(), body: JSON.stringify({ kind: "find_more", targetCount: 25, idempotencyKey: "more-1234567890" }) });
  assert.equal(more.status, 202);
  assert.equal(accepted, 2);
  assert.equal(fake.calls.filter((c) => c.url.endsWith("/meta")).length, 2);
  assert.ok(fake.calls.every((c) => c.headers["authorization"] === `Bearer ${KEY}`));
});

test("a mismatched internal secret is a setup error naming the variable, not a sign-in failure", async () => {
  const wrong = "wrong-internal-app-key-".padEnd(43, "x");
  const client = createInternalSourcingClient({
    baseUrl: "https://sourcing.example.test",
    apiKey: wrong,
    fetchImpl: (async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)["Authorization"], `Bearer ${wrong}`);
      return new Response(JSON.stringify({ error: { code: "invalid_credentials", message: "Invalid internal app key." } }), { status: 401, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });
  const base = await serve(createApp(loadConfig({ ...liveEnv, SOURCING_INTERNAL_APP_API_KEY: wrong }), { source: client, verify: allowVerify, memberships: async () => ["org_allowed1"] }));
  const response = await fetch(`${base}/api/meta`, { headers: authed() });
  assert.equal(response.status, 503, "a 401 here would read as the user's own sign-in failing");
  const body = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "source_auth_failed");
  assert.match(body.error.message, /SOURCING_INTERNAL_APP_API_KEY/);
  assert.ok(!body.error.message.includes(wrong), "never the key itself");
});

test("mock mode works end to end in development and is labelled", async () => {
  const cfg: AppConfig = loadConfig({ NODE_ENV: "development", SOURCE_MODE: "mock", AUTH_MODE: "dev" });
  const base = await serve(createApp(cfg, { source: createMockSource() }));
  assert.deepEqual(await (await fetch(`${base}/api/session/config`)).json(), { sourceMode: "mock", authMode: "dev", setupProblems: [] });
  const created = await fetch(`${base}/api/imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv: "platform,handle\ninstagram,@ana\ninstagram,@ben", name: "Brand A - Existing creators", mapping: null }),
  });
  assert.equal(created.status, 201);
  const found = (await (await fetch(`${base}/api/lists?q=brand%20a`)).json()) as { total: number };
  assert.equal(found.total, 1);
});
