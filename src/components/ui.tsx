import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => opener?.focus?.();
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
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

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const trap = useFocusTrap(onClose);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={trap.ref} onKeyDown={trap.onKeyDown}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">
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
    <div className="tags" aria-invalid={invalid ? true : undefined}>
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
