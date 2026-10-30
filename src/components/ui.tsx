import { AlertTriangle, CheckCircle2, ChevronDown, Info, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import type { ListStatus } from "../../server/sourceClient";
import { STATUS_LABELS, STATUS_TONE } from "../lib/format";

/** 21st.dev @animbits/loaders-spinner, adapted to CSS and reduced motion. */
export function Spinner({ label = "Loading", large = false, decorative = false }: { label?: string; large?: boolean; decorative?: boolean }) {
  return (
    <span className="inline loading-indicator" role={decorative ? undefined : "status"} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined}>
      <span className={`loader-spinner${large ? " loader-spinner-large" : ""}`} aria-hidden />
    </span>
  );
}

export function LoadingStatus({ label }: { label: string }) {
  return <span className="loading-status" role="status" aria-label={label}><Spinner decorative /><span>{label}…</span></span>;
}

/** 21st.dev @animbits/loaders-skeleton shimmer, using the existing theme. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function TableSkeleton({ label = "Loading", rows = 5 }: { label?: string; rows?: number }) {
  return <div className="table-skeleton" role="status" aria-label={label}>
    <span className="loading-status table-loading-label"><Spinner decorative /><span>{label}…</span></span>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index} aria-hidden="true">
      <Skeleton className="skeleton-avatar" />
      <span className="stack skeleton-identity"><Skeleton /><Skeleton className="skeleton-short" /></span>
      <Skeleton className="skeleton-detail" /><Skeleton className="skeleton-detail" />
    </div>)}
  </div>;
}

export function PageSkeleton({ label = "Loading workspace" }: { label?: string }) {
  return <div className="page-skeleton" role="status" aria-label={label}>
    <span className="loading-status"><Spinner decorative /><span>{label}…</span></span>
    <div className="stack skeleton-heading" aria-hidden="true"><Skeleton className="skeleton-short" /><Skeleton /><Skeleton /></div>
    <div className="metric-grid" aria-hidden="true">{[0, 1, 2, 3].map(i => <div className="card card-pad stack" key={i}><Skeleton className="skeleton-short" /><Skeleton /></div>)}</div>
    <div className="card" aria-hidden="true"><TableSkeleton label="Loading creator data" /></div>
  </div>;
}

export function StatusBadge({ status }: { status: ListStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`badge ${tone === "neutral" ? "" : `badge-${tone}`} ${status === "queued" || status === "sourcing" ? "badge-pending" : ""}`}>
      <span className="dot" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Compact, read-only progress list adapted to the app's tokens from 21st.dev's Stepper pattern. */
export function ProgressSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="progress-steps" aria-label="Import progress">
      {steps.map((step, index) => (
        <li key={step} className={index < current ? "is-complete" : index === current ? "is-current" : "is-upcoming"} aria-current={index === current ? "step" : undefined}>
          <span className="progress-marker" aria-hidden>{index < current ? <CheckCircle2 size={15} /> : index + 1}</span>
          <span>{step}</span>
          <span className="sr-only">{index < current ? ", complete" : index === current ? ", current" : ", upcoming"}</span>
        </li>
      ))}
    </ol>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warning" | "danger" | "success" | "neutral"; children: ReactNode; title?: string }) {
  const Icon = tone === "danger" || tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={`notice ${tone === "neutral" ? "" : `notice-${tone}`}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon size={16} aria-hidden />
      <div className="stack" style={{ gap: 2 }}>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Native picker and chevron layout adapted from 21st.dev/@wensity/components/native-select. */
export function NativeSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="native-select">
      <select className={`select ${className}`} {...props} />
      <ChevronDown size={16} aria-hidden />
    </span>
  );
}

export function useIsMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(onClose: () => void, closeDisabled = false) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const available = (el: HTMLElement) => !el.matches(":disabled") && el.getClientRects().length > 0;
    const first = [...(ref.current?.querySelectorAll<HTMLElement>("[data-autofocus]") ?? [])].find(available) ?? [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find(available);
    if (first) first.focus();
    else ref.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (closeDisabled && (!ref.current?.contains(document.activeElement) || document.activeElement?.matches(":disabled"))) ref.current?.focus();
  }, [closeDisabled]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!closeDisabled) onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.matches(":disabled") && el.getClientRects().length > 0);
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return { ref, onKeyDown };
}

export function Modal({ title, onClose, children, footer, wide, closeDisabled = false }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; closeDisabled?: boolean }) {
  const titleId = useId();
  const trap = useFocusTrap(onClose, closeDisabled);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}>
      <div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={trap.ref} onKeyDown={trap.onKeyDown}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close" disabled={closeDisabled}>
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const trap = useFocusTrap(onClose);
  return (
    <>
      <div className="drawer-backdrop" onMouseDown={onClose} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={trap.ref} onKeyDown={trap.onKeyDown}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

/** A list of short text values: Enter or comma adds, Backspace on empty removes the last. */
export function TagInput({ id, values, onChange, placeholder, max, invalid, describedBy }: { id: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number; invalid?: boolean; describedBy?: string }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string): void => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...values];
    for (const p of parts) if (!next.includes(p) && (max === undefined || next.length < max)) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div className="tags" data-invalid={invalid ? "true" : undefined}>
      {values.map((v) => (
        <span className="tag" key={v}>
            <span>{v}</span>
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={values.length === 0 ? placeholder : ""}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (draft.trim()) add(draft);
          } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage, label, loading = false }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label: string; loading?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="pager" aria-label={label} aria-busy={loading}>
      <span className="muted small">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-US")}
      </span>
      <button type="button" className="btn btn-sm" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button type="button" className="btn btn-sm" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
