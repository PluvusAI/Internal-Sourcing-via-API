import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./api";
import { META_STALE_MS } from "./lib/limits";

// The sourcing backend's metadata — above all `maxTargetCount`, the most new creators one search
// may ask for. It is read through this one query everywhere, kept briefly, re-read on window focus
// and whenever a form opens, so a limit changed on the backend (raised to 100, or lowered for a
// test) reaches both the first search and Find more without a reload.

export const META_KEY = ["meta"] as const;

export function useMeta(opts: { fresh?: boolean } = {}) {
  return useQuery({ queryKey: META_KEY, queryFn: api.meta, staleTime: META_STALE_MS, refetchOnWindowFocus: true, ...(opts.fresh ? { refetchOnMount: "always" as const } : {}) });
}

/** Re-read the metadata now, e.g. after the backend refused a count above its current maximum. */
export function useRefreshMeta(): () => void {
  const qc = useQueryClient();
  return useCallback(() => void qc.invalidateQueries({ queryKey: META_KEY }), [qc]);
}
