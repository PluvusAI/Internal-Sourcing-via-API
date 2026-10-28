import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPending, applySuggestion, criteriaSummary, draftFromForm, formFromDraft, formProblems } from "./criteria.ts";

const suggestion = {
  niche: "skincare routines",
  topicKeywords: ["barrier repair"],
  idealCreator: "Educational creators.",
  exclusions: ["medical claims"],
  creatorLocations: ["United States"],
  profileLanguages: ["en"],
  followerRanges: { instagram: { min: 10_000, max: 100_000 } },
  reasons: {},
};

test("a suggestion fills empty fields only; a typed value is kept and the suggestion offered", () => {
  const form = { ...formFromDraft(null), niche: "clean beauty", platforms: [{ platform: "instagram" as const, followersMin: "", followersMax: "", engagementMin: "", engagementMax: "" }] };
  const r = applySuggestion(form, suggestion);
  assert.equal(r.form.niche, "clean beauty", "never overwritten silently");
  assert.deepEqual(r.form.topicKeywords, ["barrier repair"]);
  assert.equal(r.form.platforms[0]!.followersMin, "10000");
  assert.deepEqual(r.pending.map((p) => p.field), ["niche"]);
  assert.equal(applyPending(r.form, r.pending[0]!).niche, "skincare routines", "applied only when chosen");
});

test("draft round-trips; blanks become absent, numbers stay numbers", () => {
  const draft = { platforms: [{ platform: "tiktok" as const, followers: { min: 5000, max: null }, engagementPercent: null }], niche: "home cooking", topicKeywords: [], idealCreator: null, exclusions: [], creatorLocations: ["Singapore"], profileLanguages: ["en"], brand: null };
  assert.deepEqual(draftFromForm(formFromDraft(draft)), draft);
});

test("form hints catch what the source would refuse", () => {
  const f = { ...formFromDraft(null), niche: "ab", profileLanguages: ["English"], platforms: [{ platform: "instagram" as const, followersMin: "500", followersMax: "100", engagementMin: "", engagementMax: "120" }] };
  const p = formProblems(f, 30, 25);
  assert.ok(p["niche"] && p["profileLanguages"] && p["instagram.followersMax"] && p["instagram.engagementMax"] && p["targetCount"]);
  assert.deepEqual(formProblems({ ...formFromDraft(null), niche: "skincare", platforms: [{ platform: "youtube", followersMin: "", followersMax: "", engagementMin: "", engagementMax: "" }] }, 5, 25), {});
});

test("criteria summary", () => {
  assert.equal(criteriaSummary({ niche: "skincare", platforms: [{ platform: "instagram", followers: { min: 10_000, max: 100_000 } }], creatorLocations: ["United States"] }), "“skincare” · Instagram 10k–100k · based in United States");
});
