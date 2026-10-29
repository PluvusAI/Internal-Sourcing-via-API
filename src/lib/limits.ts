// ---------------------------------------------------------------------------
// The per-search creator limit, as the sourcing backend reports it
// ---------------------------------------------------------------------------
// The backend is the only authority on how many new creators one search may ask for: it reports
// `maxTargetCount` from GET /meta and enforces it again when a search starts. Nothing here holds a
// number of its own. A value above the current maximum is reported, never trimmed, so a saved draft
// keeps what was entered when the backend's limit changes.

/** How long a fetched limit is trusted before it is read again (it is also re-read on focus). */
export const META_STALE_MS = 30_000;

/** Why a requested count cannot be searched under the current maximum, or null when it can. */
export function targetProblem(count: number | null, max: number): string | null {
  if (count === null || !Number.isInteger(count) || count < 1) return "Say how many new creators to find.";
  if (count > max) return `At most ${max} new creators per search. Lower the number, or use Find more afterwards for the rest.`;
  return null;
}

/** The number Find more starts with: 10, or the current maximum when that is lower. */
export function findMoreDefault(max: number): number {
  return Math.max(1, Math.min(10, max));
}

/** The source refused a count above its maximum (a page that loaded an older limit). */
export function isLimitError(err: unknown): err is { code: "target_exceeds_limit"; details: Record<string, unknown> } {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "target_exceeds_limit";
}

/** The maximum the source named in that refusal, when it named one. */
export function limitFromError(err: unknown): number | null {
  if (!isLimitError(err)) return null;
  const v = err.details["maxTargetQualified"];
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}
