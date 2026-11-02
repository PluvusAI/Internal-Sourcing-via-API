import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationView } from "../../server/sourceClient";
import { credits, creditsPerSaved, sourceTotals, spendingAhead } from "./searchSpend";

const op = (used: number, admitted: number, target = 100, database: { checked: number; matched: number } | null = { checked: 0, matched: 0 }): OperationView =>
  ({ targetCount: target, admittedCount: admitted, sources: { database, influencersClub: { calls: 10, discoveryCalls: 2, evidenceCalls: 8, creatorsPulled: 50, credits: used, creditLimit: 20 } } }) as unknown as OperationView;

test("the prompt appears only when credits are running ahead of creators found", () => {
  assert.equal(spendingAhead(op(4, 0)), false, "under a quarter of the credits: too early to say");
  assert.equal(spendingAhead(op(5, 10)), true, "a quarter of the credits for a tenth of the creators");
  assert.equal(spendingAhead(op(10, 80)), false, "half the credits for most of the creators is fine");
  assert.equal(spendingAhead(op(10, 50)), false, "keeping pace is fine");
  assert.equal(spendingAhead({ ...op(10, 0), sources: { database: null, influencersClub: { calls: 0, discoveryCalls: 0, evidenceCalls: 0, creatorsPulled: 0, credits: 10, creditLimit: 0 } } }), false, "no limit to measure against");
});

test("cost per saved creator needs a saved creator", () => {
  assert.equal(creditsPerSaved(op(2, 0)), null);
  assert.equal(creditsPerSaved(op(2, 4)), 0.5);
  assert.equal(credits(0.5), "0.50");
});

test("a list's totals add its searches, keep Find emails separate and say what was not recorded", () => {
  const totals = sourceTotals({ operations: [op(1, 1, 100, { checked: 30, matched: 4 }), op(2, 2, 100, null)], emailLookups: { calls: 5, credits: 1 } });
  assert.deepEqual(totals, { searchCalls: 20, searchCredits: 3, creatorsPulled: 100, databaseChecked: 30, unrecordedSearches: 1, emailCalls: 5, emailCredits: 1 });
});
