import { useEffect, useSyncExternalStore } from "react";

// A tiny History-API router: two routes, URL-held state (search, page), and scroll restoration
// per entry, so Back / forward return to the same search, page and position.

export type Route = { name: "home" } | { name: "list"; id: string };
export interface NavigationAttempt {
  href: string;
  proceed: () => void;
}
type NavigationBlocker = (attempt: NavigationAttempt) => boolean;

export function parseRoute(pathname: string): Route {
  const m = /^\/lists\/([a-z0-9]{8,64})\/?$/.exec(pathname);
  return m ? { name: "list", id: m[1]! } : { name: "home" };
}

const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());
const blockers = new Set<NavigationBlocker>();
const HISTORY_INDEX = "__islHistoryIndex";
const historyIndex = (state: unknown): number | null => {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[HISTORY_INDEX];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
};
const indexedState = (index: number): Record<string, unknown> => ({
  ...(typeof window !== "undefined" && window.history.state && typeof window.history.state === "object" ? window.history.state : {}),
  [HISTORY_INDEX]: index,
});
const allowed = (attempt: NavigationAttempt): boolean => {
  for (const blocker of blockers) if (!blocker(attempt)) return false;
  return true;
};
export const registerNavigationBlocker = (blocker: NavigationBlocker): (() => void) => {
  blockers.add(blocker);
  return () => blockers.delete(blocker);
};

let currentHref = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
let currentIndex = typeof window === "undefined" ? 0 : historyIndex(window.history.state) ?? 0;
let restoringPop = false;
let acceptNextPop = false;
let afterRestore: (() => void) | null = null;

if (typeof window !== "undefined") {
  if (historyIndex(window.history.state) === null) window.history.replaceState(indexedState(currentIndex), "", currentHref);
  window.addEventListener("popstate", (event) => {
    const href = snapshot();
    const targetIndex = historyIndex(event.state);
    if (restoringPop) {
      restoringPop = false;
      currentHref = href;
      currentIndex = targetIndex ?? currentIndex;
      emit();
      const resume = afterRestore;
      afterRestore = null;
      resume?.();
      return;
    }
    if (acceptNextPop || href === currentHref) {
      acceptNextPop = false;
      currentHref = href;
      currentIndex = targetIndex ?? currentIndex;
      emit();
      return;
    }
    if (targetIndex === null) {
      // A same-document entry made by an older app version has no index. Its direction cannot
      // be inferred, so keep the current draft by pushing it immediately after the target.
      // This may replace a forward entry, but never lets an unsaved draft disappear silently.
      let restored = false;
      let resumeRequested = false;
      const proceed = (): void => {
        if (!restored) { resumeRequested = true; return; }
        acceptNextPop = true;
        currentIndex -= 1;
        window.history.go(-1);
      };
      if (!allowed({ href, proceed })) {
        const restoredHref = currentHref;
        currentIndex += 1;
        window.history.pushState(indexedState(currentIndex), "", restoredHref);
        restored = true;
        emit();
        if (resumeRequested) proceed();
        return;
      }
      currentHref = href;
      emit();
      return;
    }
    const proceed = (): void => {
      const move = (): void => {
        acceptNextPop = true;
        window.history.go(targetIndex - currentIndex);
      };
      if (restoringPop) afterRestore = move;
      else move();
    };
    if (!allowed({ href, proceed })) {
      restoringPop = true;
      window.history.go(currentIndex - targetIndex);
      return;
    }
    currentHref = href;
    currentIndex = targetIndex;
    emit();
  });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = (): string => `${window.location.pathname}${window.location.search}`;

export function useLocation(): { route: Route; params: URLSearchParams; href: string } {
  const href = useSyncExternalStore(subscribe, snapshot, () => "/");
  const url = new URL(href, "http://x");
  return { route: parseRoute(url.pathname), params: url.searchParams, href };
}

const scrollKey = (href: string): string => `isl:scroll:${href}`;

function rememberScroll(): void {
  try {
    sessionStorage.setItem(scrollKey(snapshot()), String(window.scrollY));
  } catch {
    // storage unavailable: nothing to restore later
  }
}

export function navigate(href: string, opts: { replace?: boolean } = {}): void {
  if (href === snapshot()) return;
  const proceed = (): void => {
    if (!opts.replace) rememberScroll();
    const nextIndex = opts.replace ? currentIndex : currentIndex + 1;
    if (opts.replace) window.history.replaceState(indexedState(nextIndex), "", href);
    else window.history.pushState(indexedState(nextIndex), "", href);
    currentHref = href;
    currentIndex = nextIndex;
    if (!opts.replace) window.scrollTo(0, 0);
    emit();
  };
  if (allowed({ href, proceed })) proceed();
}

/** Restore this entry's scroll position once its content has rendered. */
export function useScrollRestoration(ready: boolean, href: string): void {
  useEffect(() => {
    if (!ready) return;
    let y: number | null = null;
    try {
      const v = sessionStorage.getItem(scrollKey(href));
      y = v === null ? null : Number(v);
    } catch {
      y = null;
    }
    if (y !== null && Number.isFinite(y)) window.scrollTo(0, y);
  }, [ready, href]);
  useEffect(() => {
    const save = (): void => rememberScroll();
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
}

/** Replace URL search params in place (no new history entry) — for search and page. */
export function setParams(update: Record<string, string | null>, opts: { push?: boolean } = {}): void {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(update)) {
    if (v === null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  navigate(`${url.pathname}${url.search}`, { replace: !opts.push });
}

export function linkHandler(href: string) {
  return (e: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number }): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button ?? 0) !== 0) return;
    e.preventDefault();
    navigate(href);
  };
}

/** A list carries its library location so its Back link survives refresh and copied URLs. */
export function libraryHref(from: string | null, fallback = "/"): string {
  if (!from?.startsWith("/")) return fallback;
  const url = new URL(from, "http://local");
  if (url.origin !== "http://local" || url.pathname !== "/") return fallback;
  return `${url.pathname}${url.search}`;
}

/** When a list changes library views, Back must show its destination without the old filters. */
export function listReturnHref(from: string | null, archived: boolean | undefined): string {
  if (archived === undefined) return libraryHref(from);
  const url = new URL(libraryHref(from, archived ? "/?archived=1" : "/"), "http://local");
  if ((url.searchParams.get("archived") === "1") !== archived) {
    url.searchParams.delete("q");
    url.searchParams.delete("page");
    if (archived) url.searchParams.set("archived", "1");
    else url.searchParams.delete("archived");
  }
  return `${url.pathname}${url.search}`;
}

export function listHref(id: string): string {
  const current = new URL(window.location.href);
  const from = current.pathname === "/" ? `${current.pathname}${current.search}` : libraryHref(current.searchParams.get("from"));
  return `/lists/${id}?${new URLSearchParams({ from })}`;
}
