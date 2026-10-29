import assert from "node:assert/strict";
import { test } from "node:test";
import { formFromDraft, formProblems } from "./criteria.ts";
import { findMoreDefault, isLimitError, limitFromError, targetProblem } from "./limits.ts";

const validForm = { ...formFromDraft(null), niche: "skincare routines", platforms: [{ platform: "instagram" as const, followersMin: "", followersMax: "", engagementMin: "", engagementMax: "" }] };

test("the backend's maximum alone decides the allowed count: 25, raised to 100, lowered to 5", () => {
  for (const [max, ok, tooMany] of [
    [25, 25, 26],
    [100, 100, 101],
    [5, 5, 6],
  ] as const) {
    assert.equal(targetProblem(ok, max), null, `${ok} is allowed under ${max}`);
    assert.match(targetProblem(tooMany, max)!, new RegExp(`At most ${max} new creators per search`));
    // The initial form uses the same rule.
    assert.equal(formProblems(validForm, ok, max)["targetCount"], undefined);
    assert.equal(formProblems(validForm, tooMany, max)["targetCount"], targetProblem(tooMany, max));
  }
  // Raising the limit makes a previously refused count valid with no other change.
  assert.ok(targetProblem(60, 25));
  assert.equal(targetProblem(60, 100), null);
});

test("a count is never trimmed: an over-limit value is reported, and stays what it was", () => {
  const saved = 80;
  const problem = targetProblem(saved, 25);
  assert.ok(problem);
  assert.equal(saved, 80);
  assert.equal(targetProblem(null, 25), "Say how many new creators to find.");
  assert.ok(targetProblem(0, 25));
  assert.ok(targetProblem(2.5, 25));
});

test("Find more starts at 10, or at a lower maximum", () => {
  assert.equal(findMoreDefault(25), 10);
  assert.equal(findMoreDefault(100), 10);
  assert.equal(findMoreDefault(5), 5);
  assert.equal(findMoreDefault(1), 1);
});

test("the source's refusal of a stale count is recognised, with the maximum it named", () => {
  const refusal = { code: "target_exceeds_limit", details: { maxTargetQualified: 5 } };
  assert.ok(isLimitError(refusal));
  assert.equal(limitFromError(refusal), 5);
  assert.equal(limitFromError({ code: "operation_active", details: {} }), null);
  assert.equal(isLimitError(new Error("x")), false);
});
