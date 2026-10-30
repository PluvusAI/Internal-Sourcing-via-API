import assert from "node:assert/strict";
import { test } from "node:test";
import type { NavigationAttempt } from "../router";

test("blocked in-app and browser Back navigation can stay or resume without losing the history entry", async () => {
  type Entry = { href: string; state: unknown };
  const entries: Entry[] = [{ href: "/", state: null }];
  let position = 0;
  const handlers = new Set<(event: PopStateEvent) => void>();
  const location = { pathname: "/", search: "", href: "http://app.test/" };
  const syncLocation = (href: string): void => {
    const url = new URL(href, "http://app.test");
    location.pathname = url.pathname;
    location.search = url.search;
    location.href = url.href;
  };
  const dispatchPop = (): void => {
    const event = { state: entries[position]!.state } as PopStateEvent;
    for (const handler of handlers) handler(event);
  };
  const history = {
    get state(): unknown { return entries[position]!.state; },
    pushState(state: unknown, _unused: string, href: string): void {
      entries.splice(position + 1, entries.length, { href, state });
      position++;
      syncLocation(href);
    },
    replaceState(state: unknown, _unused: string, href: string): void {
      entries[position] = { href, state };
      syncLocation(href);
    },
    go(delta: number): void {
      const next = position + delta;
      if (next < 0 || next >= entries.length) return;
      position = next;
      syncLocation(entries[position]!.href);
      queueMicrotask(dispatchPop);
    },
  };
  const previousWindow = globalThis.window;
  Object.assign(globalThis, {
    window: {
      location,
      history,
      scrollY: 0,
      scrollTo: () => {},
      addEventListener: (name: string, handler: (event: PopStateEvent) => void) => { if (name === "popstate") handlers.add(handler); },
    },
  });
  try {
    const router = await import("../router.js");
    router.navigate("/lists/abcdefgh");
    const pending: { current: NavigationAttempt | null } = { current: null };
    const unblock = router.registerNavigationBlocker((next) => {
      pending.current = next;
      return false;
    });

    router.navigate("/");
    assert.equal(location.pathname, "/lists/abcdefgh", "an in-app link stays on the draft");
    assert.equal(pending.current?.href, "/");

    pending.current = null;
    history.go(-1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(location.pathname, "/lists/abcdefgh", "browser Back is restored while saving");
    assert.equal(position, 1, "the blocked Back did not add a duplicate history entry");

    const resumed = pending.current as NavigationAttempt | null;
    assert.ok(resumed);
    resumed.proceed();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(location.pathname, "/", "the original Back proceeds after saving");
    assert.equal(position, 0);
    unblock();

    // A tab can retain same-document history entries from before the router added indices.
    // Those entries must still pass through the unsaved-draft blocker.
    router.navigate("/lists/ijklmnop");
    const unblockUnindexed = router.registerNavigationBlocker((next) => {
      pending.current = next;
      return false;
    });
    entries[0]!.state = null;
    pending.current = null;
    history.go(-1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(location.pathname, "/lists/ijklmnop", "an unindexed Back is blocked");
    assert.equal(position, 1, "the current draft is restored after an unindexed Back");
    const unindexedAttempt = pending.current as NavigationAttempt | null;
    assert.ok(unindexedAttempt);
    assert.equal(unindexedAttempt.href, "/");
    unindexedAttempt.proceed();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(location.pathname, "/", "the unindexed Back can proceed after saving");
    assert.equal(position, 0);
    unblockUnindexed();

    router.navigate("/?q=Brand+A&page=2&archived=1");
    const firstLink = router.listHref("abcdefgh");
    assert.equal(new URL(firstLink, "http://app.test").searchParams.get("from"), "/?q=Brand+A&page=2&archived=1");
    router.navigate(firstLink);
    assert.equal(new URL(router.listHref("ijklmnop"), "http://app.test").searchParams.get("from"), "/?q=Brand+A&page=2&archived=1", "derived lists keep the original library view");
    assert.equal(router.libraryHref("//external.test/"), "/", "a copied return URL cannot navigate outside the app");
    assert.equal(router.libraryHref("/lists/abcdefgh"), "/", "the return destination must be a library view");
    assert.equal(router.libraryHref(null, "/?archived=1"), "/?archived=1", "direct archive links return to the archive view");
  } finally {
    Object.assign(globalThis, { window: previousWindow });
  }
});
