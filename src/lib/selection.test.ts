import assert from "node:assert/strict";
import { test } from "node:test";
import { addAll, emptySelection, fromIds, matchState, removeAll, selectedIds, summaryText, toggle } from "./selection.ts";

const l = (id: string, name: string, memberCount = 10) => ({ id, name, memberCount });

test("select all matching adds every matching list (all pages) and keeps earlier selections", () => {
  let sel = toggle(emptySelection(), l("b1", "Brand B - Existing creators"));
  // "Brand A" matches three lists across pages; the server resolved all three ids.
  const brandA = [l("a1", "Brand A - Existing creators"), l("a2", "Brand A - Batch 1"), l("a3", "Brand A - Batch 2")];
  sel = addAll(sel, brandA);
  assert.deepEqual(selectedIds(sel), ["b1", "a1", "a2", "a3"]);
  assert.equal(matchState(sel, brandA.map((x) => x.id)), "all");
  // Searching another brand never deselects anything.
  assert.equal(matchState(sel, ["c1"]), "none");
  assert.deepEqual(selectedIds(sel), ["b1", "a1", "a2", "a3"]);
});

test("tri-state reflects all / some / none of the current matching set", () => {
  const sel = addAll(emptySelection(), [l("a1", "A1")]);
  assert.equal(matchState(sel, ["a1", "a2"]), "some");
  assert.equal(matchState(sel, ["a1"]), "all");
  assert.equal(matchState(sel, []), "none");
  assert.equal(matchState(removeAll(sel, ["a1"]), ["a1", "a2"]), "none");
});

test("a selection is ids captured at the time: a list created later is not in it", () => {
  const captured = addAll(emptySelection(), [l("a1", "Brand A - Existing creators"), l("a2", "Brand A - Batch 1")]);
  const laterMatches = ["a1", "a2", "a9"]; // "Brand A - Batch 3" created afterwards
  assert.equal(matchState(captured, laterMatches), "some");
  assert.ok(!captured.has("a9"));
});

test("selected lists keep their names even when they are outside the current search", () => {
  const sel = fromIds(["a1", "gone"], [{ id: "a1", name: "Brand A - Existing creators", memberCount: 550 }]);
  assert.equal(sel.get("a1")!.name, "Brand A - Existing creators");
  assert.equal(sel.get("gone")!.name, "(unavailable list)", "an unreadable id stays visible, never silently dropped");
});

test("summary text", () => {
  assert.equal(summaryText(0, 0), "No exclusion lists selected; creators from existing lists may appear again.");
  assert.equal(summaryText(3, 550), "3 lists selected; 550 unique creators excluded");
  assert.equal(summaryText(1, null), "1 list selected; counting unique creators…");
});
