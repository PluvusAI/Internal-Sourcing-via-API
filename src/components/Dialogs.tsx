import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ExportFormat, ListSummary } from "../../server/sourceClient";
import { api, ApiError } from "../api";
import { count } from "../lib/format";
import { clearKey, pendingKey, browserKeyStore } from "../lib/idempotency";
import { findMoreDefault, isLimitError, targetProblem } from "../lib/limits";
import { useMeta, useRefreshMeta } from "../meta";
import { listHref, navigate } from "../router";
import { Modal, Notice, Spinner, errorText, useIsMounted } from "./ui";

/** "New sourcing list", or "New list using these criteria" when `from` is a sourced list. */
export function NewListDialog({ from, onClose }: { from: Pick<ListSummary, "id" | "name"> | null; onClose: () => void }) {
  const [name, setName] = useState(from ? suggestNextName(from.name) : "");
  const id = useId();
  const qc = useQueryClient();
  const mounted = useIsMounted();
  const submitting = useRef(false);
  const create = useMutation({
    mutationFn: () => api.createList({ name: name.trim(), ...(from ? { deriveFromListId: from.id } : {}) }),
    onSuccess: (list) => {
      void qc.invalidateQueries({ queryKey: ["lists"] });
      if (!mounted.current) return;
      onClose();
      navigate(listHref(list.id));
    },
    onSettled: () => { submitting.current = false; },
  });
  const submit = (): void => {
    if (!name.trim() || submitting.current) return;
    submitting.current = true;
    create.mutate();
  };
  const close = (): void => {
    if (!submitting.current) onClose();
  };
  return (
    <Modal
      title={from ? "New list using these criteria" : "New sourcing list"}
      onClose={close}
      closeDisabled={create.isPending}
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={create.isPending}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={submit}>
            {create.isPending ? <Spinner label="Creating" /> : null} Create list
          </button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label htmlFor={id}>List name</label>
          <input id={id} data-autofocus className="input" value={name} maxLength={120} readOnly={create.isPending} onChange={(e) => setName(e.target.value)} placeholder="Brand A - Batch 1" />
          <span className="hint">Include the brand or client name so the list is easy to find, e.g. “Brand A - Batch 2”.</span>
        </div>
      </form>
      {create.isPending ? <Notice tone="info">Creating this list. This dialog will open the new draft when it is ready.</Notice> : null}
      {from ? (
        <Notice tone="info">
          Copies the criteria and exclusion lists of <strong>{from.name}</strong>, and also excludes <strong>{from.name}</strong> itself. Its creators are not copied. You can review and edit everything before starting.
        </Notice>
      ) : null}
      {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
    </Modal>
  );
}

/** "Brand A - Batch 1" → "Brand A - Batch 2". Only a suggestion for the name field. */
export function suggestNextName(name: string): string {
  const m = /^(.*?)(\d+)\s*$/.exec(name);
  return m ? `${m[1]}${Number(m[2]) + 1}` : `${name} (next batch)`;
}

/**
 * Find more: a new search on the same list for up to the backend's CURRENT maximum. The limit is
 * re-read when the dialog opens; a number above it is shown as a problem, never trimmed. If a page
 * that loaded an older limit still sends too many, the backend refuses it (nothing starts), the
 * refusal is shown and the limit is read again.
 */
export function FindMoreDialog({ listId, listName, onClose, onStarted }: { listId: string; listName: string; onClose: () => void; onStarted: () => void }) {
  const meta = useMeta({ fresh: true });
  const refreshMeta = useRefreshMeta();
  const max = meta.data?.maxTargetCount ?? null;
  const [n, setN] = useState<string | null>(null);
  const id = useId();
  const keys = useRef(new Map<string, string>());
  const text = n ?? (max === null ? "" : String(findMoreDefault(max)));
  const value = /^\d+$/.test(text) ? Number(text) : null;
  const problem = max === null ? null : targetProblem(value, max);
  const start = useMutation({
    mutationFn: () => api.startOperation(listId, { idempotencyKey: pendingKey(browserKeyStore(), listId, "find_more", keys.current), kind: "find_more", targetCount: value! }),
    onSuccess: () => {
      clearKey(browserKeyStore(), listId, "find_more", keys.current);
      onStarted();
      onClose();
    },
    onError: (err) => {
      // Nothing started. Learn the current maximum; the number typed stays as it is.
      if (isLimitError(err)) refreshMeta();
    },
  });
  return (
    <Modal
      title="Find more creators"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={max === null || problem !== null || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Spinner label="Starting" /> : null} Find more
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor={id}>Additional new creators</label>
        <input id={id} data-autofocus className="input" style={{ maxWidth: 160 }} inputMode="numeric" value={text} onChange={(e) => setN(e.target.value)} aria-invalid={problem !== null} aria-describedby={`${id}-hint${problem && text !== "" ? ` ${id}-error` : ""}`} />
        <span className="hint" id={`${id}-hint`}>
          {meta.isLoading ? "Checking the current limit…" : max !== null ? `1 to ${max} per search (the sourcing service’s current limit).` : null}
        </span>
        {problem && text !== "" ? <span className="error" id={`${id}-error`}>{problem}</span> : null}
      </div>
      {meta.isError ? <Notice tone="danger">The current limit could not be read: {errorText(meta.error)}</Notice> : null}
      <Notice tone="info">
        Uses this list’s saved criteria and selected exclusion lists (their current membership), and always skips every creator already saved on <strong>{listName}</strong>. New creators are added to this list, however many it already holds.
      </Notice>
      {start.isError ? (
        <Notice tone="danger" {...(isLimitError(start.error) ? { title: "Nothing was started" } : {})}>
          {errorText(start.error)}
          {isLimitError(start.error) && max !== null ? ` The limit is now ${max}.` : ""}
        </Notice>
      ) : null}
    </Modal>
  );
}

export function ExportDialog({ listId, listName, total, selectedCount, onClose }: { listId: string; listName: string; total: number; selectedCount: number; onClose: () => void }) {
  const meta = useMeta();
  const [format, setFormat] = useState<ExportFormat>("default");
  const [scope, setScope] = useState<"selected" | "all">(selectedCount > 0 ? "selected" : "all");
  const [done, setDone] = useState<{ filename: string; count: number } | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      if (scope === "selected") {
        // The exact ids, across every page, as saved — never "what the browser has loaded".
        const sel = await api.selection(listId);
        if (sel.memberIds.length === 0) throw new ApiError(409, "empty_scope", "No rows are selected. Select rows, or export all.");
        return api.exportList(listId, { format, scope: "selected", memberIds: sel.memberIds });
      }
      return api.exportList(listId, { format, scope: "all" });
    },
    onSuccess: ({ blob, filename, count: n }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone({ filename, count: n });
    },
  });
  const headers = meta.data?.exportFormats[format].headers ?? [];
  return (
    <Modal
      title={`Export ${listName}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </button>
          <button type="button" className="btn btn-primary" disabled={run.isPending || (scope === "selected" && selectedCount === 0)} onClick={() => run.mutate()}>
            {run.isPending ? <Spinner label="Preparing" /> : <Download size={16} />} Download CSV
          </button>
        </>
      }
    >
      <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="field-label">Rows</legend>
        <label className="inline">
          <input type="radio" name="scope" checked={scope === "selected"} disabled={selectedCount === 0} onChange={() => setScope("selected")} /> Export selected ({count(selectedCount)})
        </label>
        <label className="inline">
          <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} /> Export all ({count(total)})
        </label>
      </fieldset>
      <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="field-label">Format</legend>
        <label className="inline">
          <input type="radio" name="format" checked={format === "default"} onChange={() => setFormat("default")} /> Compact — 20 columns (default)
        </label>
        <label className="inline">
          <input type="radio" name="format" checked={format === "sheets"} onChange={() => setFormat("sheets")} /> Existing Sheets template — 93 columns
        </label>
        <span className="field-label small">Columns, in order ({headers.length})</span>
        {meta.isLoading ? <Spinner /> : <code className="headers">{headers.join(", ")}</code>}
        <span className="hint muted small">Unknown values are left blank. Emails include supplied addresses and saved Find emails results. A download never looks up contacts or runs a search.</span>
      </fieldset>
      <Notice tone="neutral">
        Exporting does not change the list: all {count(total)} saved creators stay on <strong>{listName}</strong>, and a later search that excludes this list excludes all of them — not only the rows you download.
      </Notice>
      {run.isError ? <Notice tone="danger">{errorText(run.error)}</Notice> : null}
      {done ? (
        <Notice tone="success">
          Download started: {done.filename} ({count(done.count)} rows). Check your browser’s downloads to confirm it was saved.
        </Notice>
      ) : null}
    </Modal>
  );
}
