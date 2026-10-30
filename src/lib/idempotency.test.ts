import assert from "node:assert/strict";
import { test } from "node:test";
import { clearImportKey, clearKey, importFingerprint, pendingImportKey, pendingKey, type KeyStore } from "./idempotency.ts";
import { pollMs, progressText } from "./format.ts";

const store = (): KeyStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

test("double clicks, retries and reloads reuse one key until the search is accepted", () => {
  const s = store();
  const first = pendingKey(s, "list1234abcd", "initial", new Map());
  assert.match(first, /^op-[0-9a-f]{32}$/);
  assert.equal(pendingKey(s, "list1234abcd", "initial", new Map()), first, "a reload (new in-memory map) still gets the same key");
  assert.notEqual(pendingKey(s, "list1234abcd", "find_more", new Map()), first, "Find more is a different search");
  clearKey(s, "list1234abcd", "initial", new Map());
  assert.notEqual(pendingKey(s, "list1234abcd", "initial", new Map()), first, "after acceptance, the next click is a new search");
});

test("storage refusing writes falls back to memory for this tab", () => {
  const broken: KeyStore = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => undefined };
  const mem = new Map<string, string>();
  const a = pendingKey(broken, "list1234abcd", "initial", mem);
  assert.equal(pendingKey(broken, "list1234abcd", "initial", mem), a);
});

test("an import retries with the same key, including after reload, until it succeeds", async () => {
  const s = store();
  const request = JSON.stringify({ csv: "platform,handle\ninstagram,janedoe", name: "Brand A", acknowledgePartial: false });
  const fingerprint = await importFingerprint(request);
  const first = pendingImportKey(s, fingerprint, new Map());
  assert.equal(pendingImportKey(s, await importFingerprint(request), new Map()), first);
  assert.notEqual(pendingImportKey(s, await importFingerprint(request.replace("Brand A", "Brand B")), new Map()), first);
  clearImportKey(s, fingerprint, new Map());
  assert.notEqual(pendingImportKey(s, fingerprint, new Map()), first);
  assert.equal(s.data.has(`isl:pending-import:${fingerprint}`), true);
  assert.equal([...s.data.values()].some((value) => value.includes("janedoe")), false, "storage holds only a key, never CSV contents");
});

test("progress uses the real saved count; polling follows the source's interval and stops when finished", () => {
  assert.equal(progressText({ admittedCount: 3, targetCount: 5 }), "3 of 5 new creators");
  assert.equal(pollMs({ pollAfterSeconds: 3, status: "running" }), 3000);
  assert.equal(pollMs({ pollAfterSeconds: null, status: "partial" }), false);
  assert.equal(pollMs(null), false);
});
