import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { ARCHIVE_FEEDBACK_KEY, clearArchiveFeedback, publishArchiveFeedback, recordListDeletion } from "./archive.js";
import { listReturnHref } from "../router.js";

test("list return links follow archive/restore without carrying a filter from the other view", () => {
  assert.equal(listReturnHref("/?q=Old+brand&page=4", true), "/?archived=1");
  assert.equal(listReturnHref("/?archived=1&q=Old+brand&page=2", false), "/");
  assert.equal(listReturnHref("/?archived=1&q=Brand&page=2", true), "/?archived=1&q=Brand&page=2");
  assert.equal(listReturnHref("/?q=Brand&page=2", false), "/?q=Brand&page=2");
  assert.equal(listReturnHref("/?archived=1&q=Brand&page=2", undefined), "/?archived=1&q=Brand&page=2");
  assert.equal(listReturnHref(null, true), "/?archived=1");
  assert.equal(listReturnHref("//untrusted.example/", true), "/?archived=1");
});

test("deleting the archived list clears its shared Undo; deleting another list preserves it", () => {
  const qc = new QueryClient();
  const feedback = { id: "archived123", name: "Archived list", archived: true };
  qc.setQueryData(ARCHIVE_FEEDBACK_KEY, feedback);
  clearArchiveFeedback(qc, "other123");
  assert.deepEqual(qc.getQueryData(ARCHIVE_FEEDBACK_KEY), feedback);
  clearArchiveFeedback(qc, feedback.id);
  assert.equal(qc.getQueryData(ARCHIVE_FEEDBACK_KEY), null);
  qc.clear();
});

test("a delayed archive response cannot restore feedback after the same list was deleted", () => {
  const qc = new QueryClient();
  const archived = { id: "deleted123", name: "Deleted list", archived: true };
  recordListDeletion(qc, archived.id);
  assert.equal(publishArchiveFeedback(qc, archived), false);
  assert.equal(qc.getQueryData(ARCHIVE_FEEDBACK_KEY), undefined);
  const other = { ...archived, id: "retained123" };
  assert.equal(publishArchiveFeedback(qc, other), true);
  assert.deepEqual(qc.getQueryData(ARCHIVE_FEEDBACK_KEY), other);
  qc.clear();
});
