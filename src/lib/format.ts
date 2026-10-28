import type { ListStatus, OperationView } from "../../server/sourceClient";

export const STATUS_LABELS: Record<ListStatus, string> = {
  imported: "Imported",
  draft: "Draft",
  queued: "Queued",
  sourcing: "Sourcing",
  complete: "Complete",
  partial: "Partial",
  empty: "Empty",
  failed: "Failed",
};

export const STATUS_TONE: Record<ListStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  imported: "neutral",
  draft: "neutral",
  queued: "info",
  sourcing: "info",
  complete: "success",
  partial: "warning",
  empty: "warning",
  failed: "danger",
};

export const isActive = (s: ListStatus | null | undefined): boolean => s === "queued" || s === "sourcing";

export function count(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

export function percent(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${(Math.round(n * 100) / 100).toLocaleString("en-US")}%` : "—";
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** "3 of 5 new creators" — the real saved count, never the request rounded up. */
export function progressText(op: Pick<OperationView, "admittedCount" | "targetCount">): string {
  return `${count(op.admittedCount)} of ${count(op.targetCount)} new ${op.targetCount === 1 ? "creator" : "creators"}`;
}

/** The poll interval the source asked for, in ms; null when nothing is running. */
export function pollMs(op: Pick<OperationView, "pollAfterSeconds" | "status"> | null | undefined): number | false {
  if (!op || op.pollAfterSeconds === null) return false;
  return Math.max(2, op.pollAfterSeconds) * 1000;
}
