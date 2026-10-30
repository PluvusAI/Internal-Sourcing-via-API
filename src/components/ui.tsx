import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import type { ListStatus } from "../../server/sourceClient";
import { STATUS_LABELS, STATUS_TONE } from "../lib/format";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline" role="status">
      <Loader2 size={16} className="spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function StatusBadge({ status }: { status: ListStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`badge ${tone === "neutral" ? "" : `badge-${tone}`}`}>
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
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!closeDisabled) onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
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
      <div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={trap.ref} onKeyDown={trap.onKeyDown}>
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
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={trap.ref} onKeyDown={trap.onKeyDown}>
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
          {v}
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

export function Pager({ page, pageSize, total, onPage, label }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="pager" aria-label={label}>
      <span className="muted small">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString("en-US")}
      </span>
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}
