/**
 * The typed client is a byte-for-byte copy of the sourcing backend's
 * server/src/internalSourcing/client.ts (whose types the backend checks against its own contract).
 * While both live in the same repository this fails the moment they differ. Once this app has its
 * own repository, refresh the copy from the backend when the contract changes.
 *
 * Run:  npx tsx --test server/sourceClient.test.ts
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createInternalSourcingClient, internalSourcingClientFromEnv } from "./sourceClient.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const backendCopy = `${here}../../server/src/internalSourcing/client.ts`;

test("the client is identical to the backend's contract client", { skip: !existsSync(backendCopy) && "backend repository not alongside" }, () => {
  assert.equal(readFileSync(`${here}sourceClient.ts`, "utf8"), readFileSync(backendCopy, "utf8"));
});

test("the client refuses an insecure base URL and a missing key, and never follows redirects", async () => {
  assert.throws(() => createInternalSourcingClient({ baseUrl: "http://sourcing.example.test", apiKey: "x" }), /https/);
  assert.throws(() => internalSourcingClientFromEnv({ SOURCING_API_BASE_URL: "https://sourcing.example.test" }), /SOURCING_INTERNAL_APP_API_KEY/);
  let redirect: RequestRedirect | undefined;
  const client = createInternalSourcingClient({
    baseUrl: "https://sourcing.example.test",
    apiKey: "k".repeat(43),
    fetchImpl: (async (_u: string | URL | Request, init?: RequestInit) => {
      redirect = init?.redirect;
      return new Response(JSON.stringify({ q: "", ids: [], total: 0, lists: [] }), { status: 200 });
    }) as typeof fetch,
  });
  await client.matchingListIds({ q: "Brand A", eligible: true });
  assert.equal(redirect, "error");
});
