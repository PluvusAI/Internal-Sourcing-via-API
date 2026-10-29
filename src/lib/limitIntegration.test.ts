import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMockSource } from "../../server/mockSource.js";
import { FindMoreDialog } from "../components/Dialogs.js";
import { ListPage } from "../pages/ListPage.js";
import { formFromDraft, formProblems } from "./criteria.js";

test("the saved initial target stays visible while the source metadata raises or lowers its maximum", async () => {
  const source = createMockSource();
  const draft = await source.createList({
    name: "Brand A - Batch 1",
    targetCount: 100,
    criteria: { niche: "skincare", platforms: [{ platform: "instagram" }] },
  });
  const sourceMeta = await source.meta();
  for (const maximum of [25, 100, 5]) {
    const qc = new QueryClient();
    qc.setQueryData(["meta"], { ...sourceMeta, maxTargetCount: maximum });
    qc.setQueryData(["list", draft.id], draft);
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(ListPage, { id: draft.id })));
    assert.match(html, new RegExp(`Up to ${maximum} per search`));
    assert.match(html, /value="100"/, "a newly lower limit must not silently rewrite the saved target");
    const problems = formProblems(formFromDraft(draft.criteria), draft.targetCount, maximum);
    assert.equal(Boolean(problems["targetCount"]), maximum < 100);
    qc.clear();
  }
});

test("Find more reads the same source maximum and starts at 10, or at a lower maximum", async () => {
  const sourceMeta = await createMockSource().meta();
  for (const maximum of [25, 100, 5]) {
    const qc = new QueryClient();
    qc.setQueryData(["meta"], { ...sourceMeta, maxTargetCount: maximum });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(FindMoreDialog, {
      listId: "abcdefgh1234",
      listName: "Brand A - Batch 1",
      onClose: () => {},
      onStarted: () => {},
    })));
    assert.match(html, new RegExp(`1 to ${maximum} per search`));
    assert.match(html, new RegExp(`value="${Math.min(10, maximum)}"`));
    assert.equal(/<button[^>]*disabled=""[^>]*>[\s\S]*?Find more<\/button>/.test(html), false, "the starting count is always allowed");
    qc.clear();
  }
});
