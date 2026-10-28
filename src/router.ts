import { useEffect, useSyncExternalStore } from "react";

// A tiny History-API router: two routes, URL-held state (search, page), and scroll restoration
// per entry, so Back / forward return to the same search, page and position.

export type Route = { name: "home" } | { name: "list"; id: string };

export function parseRoute(pathname: string): Route {
  const m = /^\/lists\/([a-z0-9]{8,64})\/?$/.exec(pathname);
  return m ? { name: "list", id: m[1]! } : { name: "home" };
}

const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());
if (typeof window !== "undefined") window.addEventListener("popstate", emit);

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
  if (!opts.replace) rememberScroll();
  if (opts.replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  if (!opts.replace) window.scrollTo(0, 0);
  emit();
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
  return (e: { preventDefault(): void; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; button?: number }): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || (e.button ?? 0) !== 0) return;
    e.preventDefault();
    navigate(href);
  };
}
