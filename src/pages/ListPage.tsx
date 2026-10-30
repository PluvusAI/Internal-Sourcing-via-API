import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Download, Pencil, RefreshCw, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ListDetail, OperationView, SourceMeta } from "../../server/sourceClient";
import { api, ApiError } from "../api";
import { CriteriaFormFields } from "../components/CriteriaForm";
import { ExportDialog, FindMoreDialog, NewListDialog } from "../components/Dialogs";
import { ExclusionPicker } from "../components/ExclusionPicker";
import { MembersTable } from "../components/MembersTable";
import { Modal, Notice, Spinner, StatusBadge, errorText } from "../components/ui";
import { applyPending, applySuggestion, criteriaSummary, draftFromForm, formFromDraft, formProblems, type CriteriaForm, type PendingSuggestion } from "../lib/criteria";
import { count, isActive, pollMs, progressText, when } from "../lib/format";
import { browserKeyStore, clearKey, pendingKey } from "../lib/idempotency";
import { fromIds, selectedIds, type Selection } from "../lib/selection";
import { isLimitError } from "../lib/limits";
import { useMeta, useRefreshMeta } from "../meta";
import { linkHandler, parseRoute, registerNavigationBlocker, type NavigationAttempt } from "../router";

export function ListPage({ id }: { id: string }) {
  const meta = useMeta();
  const list = useQuery({
    queryKey: ["list", id],
    queryFn: () => api.getList(id),
    refetchInterval: (q) => pollMs(q.state.data?.operations.find((o) => o.id === q.state.data?.activeOperationId) ?? null),
  });

  const back = (
    <a href="/" className="btn btn-ghost btn-sm" onClick={linkHandler("/")} style={{ marginBottom: 12 }}>
      <ArrowLeft size={14} aria-hidden /> All lists
    </a>
  );
  if (list.isLoading || meta.isLoading) return <div className="empty"><Spinner label="Loading list" /></div>;
  if (list.isError) {
    return (
      <>
        {back}
        <Notice tone="danger" title={list.error instanceof ApiError && list.error.status === 404 ? "List not found" : "The list could not be loaded"}>
          {list.error.message}
        </Notice>
      </>
    );
  }
  if (meta.isError) return <Notice tone="danger">{meta.error.message}</Notice>;
  const d = list.data!;
  return (
    <>
      {back}
      {d.kind === "sourced" && !d.criteriaLocked ? <DraftEditor key={d.id} list={d} meta={meta.data!} /> : <ListWorkspace list={d} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────── draft

type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";

function DraftEditor({ list, meta }: { list: ListDetail; meta: SourceMeta }) {
  const qc = useQueryClient();
  const uid = useId();
  const [name, setName] = useState(list.name);
  const [form, setForm] = useState<CriteriaForm>(() => formFromDraft(list.criteria));
  const [target, setTarget] = useState<number | null>(list.targetCount);
  const [selection, setSelection] = useState<Selection>(() => fromIds(list.excludedListIds, list.excludedLists));
  const [save, setSave] = useState<SaveState>("saved");
  const [tried, setTried] = useState(false);
  const revision = useRef(list.draftRevision);
  const keys = useRef(new Map<string, string>());

  // ── autosave: one save at a time, always of the latest edits, fenced by the draft revision
  const payload = useMemo(() => ({ name: name.trim(), criteria: draftFromForm(form), targetCount: target, excludedListIds: selectedIds(selection) }), [name, form, target, selection]);
  const payloadKey = JSON.stringify(payload);
  const savedKey = useRef<string | null>(payloadKey);
  const latestKey = useRef(payloadKey);
  const inFlight = useRef(false);
  const failedKey = useRef<string | null>(null);
  const conflicted = useRef(false);
  latestKey.current = payloadKey;
  useEffect(() => {
    // A failed payload stays failed even if the user briefly edits another field and returns to
    // it before the debounce expires. A known saved payload can return to Saved immediately.
    if (conflicted.current || inFlight.current) return;
    if (payloadKey === savedKey.current) setSave("saved");
    else if (payloadKey === failedKey.current) setSave("failed");
    else setSave("dirty");
  }, [payloadKey]);

  const flush = useCallback(async (): Promise<void> => {
    if (inFlight.current || conflicted.current) return;
    const key = latestKey.current;
    if (key === savedKey.current) {
      setSave((s) => s === "conflict" ? s : "saved");
      return;
    }
    const body = JSON.parse(key) as typeof payload;
    if (!body.name) return;
    inFlight.current = true;
    setSave("saving");
    let succeeded = false;
    try {
      const saved = await api.updateList(list.id, { ...body, baseRevision: revision.current });
      revision.current = saved.draftRevision;
      savedKey.current = key;
      failedKey.current = null;
      qc.setQueryData(["list", list.id], saved);
      setSave(latestKey.current === key ? "saved" : "dirty");
      succeeded = true;
    } catch (err) {
      const conflict = err instanceof ApiError && (err.code === "draft_changed" || err.code === "criteria_locked");
      // A lost response can follow a committed write. Even if the user reverted the field while
      // it was pending, retry must reconcile that value with the server before calling it saved.
      if (conflict) conflicted.current = true;
      else {
        savedKey.current = null;
        failedKey.current = key;
      }
      setSave(conflict ? "conflict" : "failed");
    } finally {
      inFlight.current = false;
    }
    // Drain edits queued during a successful save. A failed or conflicted save must wait for
    // an explicit retry or a later edit, rather than immediately repeating the same request.
    if (succeeded && latestKey.current !== savedKey.current) void flush();
  }, [list.id, qc]);
  useEffect(() => {
    // Schedule from each edit, even when the value returns to an earlier value before the delay.
    // The failed payload remains for an explicit Retry, while a different payload may autosave.
    const timer = window.setTimeout(() => {
      if (payloadKey !== failedKey.current && !conflicted.current) void flush();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [payloadKey, flush]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent): void => {
      if (inFlight.current || latestKey.current !== savedKey.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const [leaveAttempt, setLeaveAttempt] = useState<NavigationAttempt | null>(null);
  useEffect(() => registerNavigationBlocker((attempt) => {
    const next = parseRoute(new URL(attempt.href, window.location.origin).pathname);
    if (next.name === "list" && next.id === list.id) return true;
    if (!inFlight.current && latestKey.current === savedKey.current) return true;
    setLeaveAttempt(attempt);
    void flush();
    return false;
  }), [flush, list.id]);
  useEffect(() => {
    // A navigation requested while autosave was pending can continue once every edit is saved.
    if (leaveAttempt && save === "saved" && latestKey.current === savedKey.current) {
      setLeaveAttempt(null);
      leaveAttempt.proceed();
    }
  }, [leaveAttempt, save]);

  // ── suggestions: fill empty fields only; anything else is offered, never applied silently
  const [brief, setBrief] = useState("");
  const [filled, setFilled] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingSuggestion[]>([]);
  const suggest = useMutation({
    mutationFn: () =>
      api.suggest({
        brief: brief.trim(),
        platforms: form.platforms.map((p) => p.platform),
        ...(form.brandName.trim() ? { brandName: form.brandName.trim() } : {}),
        ...(form.brandProduct.trim() ? { product: form.brandProduct.trim() } : {}),
      }),
    onSuccess: (r) => {
      const merged = applySuggestion(form, r.suggestion);
      setForm(merged.form);
      setFilled(merged.filled);
      setPending(merged.pending);
    },
  });

  // ── start
  const refreshMeta = useRefreshMeta();
  const problems = formProblems(form, target, meta.maxTargetCount);
  // Over the limit is shown at once (other problems wait for a first attempt).
  const overLimit = target !== null && target > meta.maxTargetCount;
  const problemCount = Object.keys(problems).length + (name.trim() ? 0 : 1);
  const start = useMutation({
    mutationFn: () => api.startOperation(list.id, { idempotencyKey: pendingKey(browserKeyStore(), list.id, "initial", keys.current), kind: "initial", baseRevision: revision.current }),
    onSuccess: () => {
      clearKey(browserKeyStore(), list.id, "initial", keys.current);
      void qc.invalidateQueries({ queryKey: ["list", list.id] });
      void qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.code === "already_started" || err.code === "operation_active")) void qc.invalidateQueries({ queryKey: ["list", list.id] });
      // The backend's limit is lower than the one this page loaded: nothing started. Re-read it;
      // the saved count stays as entered and the form says what the limit is now.
      if (isLimitError(err)) refreshMeta();
    },
  });
  const startIssues = start.error instanceof ApiError ? ((start.error.details["issues"] as Array<{ path: string; message: string }> | undefined) ?? []) : [];
  const canStart = save === "saved" && problemCount === 0 && !start.isPending;

  return (
    <>
      <div className="page-head">
        <div className="field" style={{ flex: 1, maxWidth: 560 }}>
          <span className="eyebrow">New sourcing list / Draft</span>
          <label htmlFor={`${uid}-name`}>List name</label>
          <input id={`${uid}-name`} className="input" style={{ fontSize: 18, fontWeight: 700 }} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim()} />
          {!name.trim() ? <span className="error">A list name is required.</span> : <span className="hint">Draft · new sourcing list</span>}
        </div>
        <SaveIndicator state={save} onRetry={() => void flush()} />
      </div>
      {save === "conflict" ? (
        <Notice tone="warning" title="This draft changed somewhere else">
          Your latest edits were not saved. <button type="button" className="link-btn" onClick={() => window.location.reload()}>Reload the list</button> to see the saved version.
        </Notice>
      ) : null}

      <div className="layout-2" style={{ marginTop: 16 }}>
        <div className="card card-pad section">
          <div className="step-heading">
            <span className="step-index" aria-hidden>01</span>
            <div><h2>Define your ideal creators</h2><p className="muted small">Set the search and fit criteria for this batch.</p></div>
          </div>
          <details className="platform-block">
            <summary className="inline" style={{ cursor: "pointer", fontWeight: 600 }}>
              <Sparkles size={14} aria-hidden /> Suggest criteria (optional)
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <div className="field">
                <label htmlFor={`${uid}-brief`}>Short brief</label>
                <textarea id={`${uid}-brief`} className="textarea" value={brief} maxLength={1500} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Barrier cream for sensitive skin; educational creators who show real routines" />
                <span className="hint">Suggestions only fill empty fields. Review everything before you search; nothing starts by itself.</span>
              </div>
              <div className="actions">
                <button type="button" className="btn btn-sm" disabled={brief.trim().length < 10 || form.platforms.length === 0 || suggest.isPending} onClick={() => suggest.mutate()}>
                  {suggest.isPending ? <Spinner label="Suggesting" /> : <Sparkles size={14} aria-hidden />} Suggest
                </button>
                {form.platforms.length === 0 ? <span className="muted small">Choose platforms first.</span> : null}
              </div>
              {suggest.isError ? <Notice tone="danger">{errorText(suggest.error)}</Notice> : null}
              {suggest.data && !suggest.data.ok ? <Notice tone="warning">{suggest.data.message}</Notice> : null}
              {filled.length > 0 ? <Notice tone="success">Filled: {filled.join(", ")}. Review them below.</Notice> : null}
              {pending.map((p) => (
                <div className="notice" key={p.field}>
                  <div className="stack" style={{ gap: 2, flex: 1 }}>
                    <strong>{p.label}: you already entered a value.</strong>
                    <span className="muted">Suggested: {Array.isArray(p.value) ? p.value.join(", ") : p.value}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setForm(applyPending(form, p));
                      setPending(pending.filter((x) => x !== p));
                    }}
                  >
                    Use suggestion
                  </button>
                </div>
              ))}
            </div>
          </details>
          <CriteriaFormFields form={form} onChange={setForm} problems={problems} showProblems={tried} showTargetProblem={overLimit} targetCount={target} onTargetCount={setTarget} maxTarget={meta.maxTargetCount} />
        </div>

        <div className="section">
          <div className="card card-pad section">
            <div className="step-heading">
              <span className="step-index" aria-hidden>02</span>
              <div><h2>Exclude creators from these lists</h2><p className="muted small">Avoid overlap with rosters already in your workspace.</p></div>
            </div>
            <p className="muted small">Creators saved on the lists you select (counted once even if they appear in several), and every creator already on this list, are skipped. Lists you do not select are not excluded, whatever their name.</p>
            <ExclusionPicker selection={selection} onChange={setSelection} selfId={list.id} locked={false} />
          </div>
          <div className="card card-pad section">
            <div className="step-heading">
              <span className="step-index" aria-hidden>03</span>
              <div><h2>Start the search</h2><p className="muted small">Your criteria are fixed once the search starts.</p></div>
            </div>
            <p className="muted small">
              Starts one search for up to {target ? count(target) : "the requested number of"} new qualifying creators. It runs on the sourcing service; you can leave this page and come back.
            </p>
            {start.isError ? (
              <Notice tone="danger" title="The search did not start">
                {start.error.message}
                {startIssues.length > 0 ? (
                  <ul>
                    {startIssues.map((i) => (
                      <li key={i.path}>
                        {i.path}: {i.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Notice>
            ) : null}
            {tried && problemCount > 0 ? <Notice tone="warning">Fix the highlighted criteria first.</Notice> : null}
            {save === "failed" ? <Notice tone="danger">The draft is not saved, so the search cannot start. Retry saving first.</Notice> : null}
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canStart && !(problemCount > 0 && !tried)}
                onClick={() => {
                  setTried(true);
                  if (canStart) start.mutate();
                }}
              >
                {start.isPending ? <Spinner label="Starting" /> : <Search size={16} aria-hidden />} Find creators
              </button>
              {save === "dirty" || save === "saving" ? <span className="muted small">Waiting for the draft to save…</span> : null}
            </div>
          </div>
        </div>
      </div>
      {leaveAttempt ? (
        <Modal
          title="Leave this draft?"
          onClose={() => setLeaveAttempt(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setLeaveAttempt(null)}>Stay on draft</button>
              {save === "failed" ? <button type="button" className="btn" onClick={() => void flush()}>Retry save</button> : null}
              <button type="button" className="btn btn-danger" onClick={() => { const attempt = leaveAttempt; setLeaveAttempt(null); attempt.proceed(); }}>Leave without saving</button>
            </>
          }
        >
          {save === "failed" ? (
            <Notice tone="danger">Your latest changes could not be saved. Retry the save or stay on this draft to fix them.</Notice>
          ) : save === "conflict" ? (
            <Notice tone="warning">This draft changed somewhere else. Reload it to review the saved version, or leave without these edits.</Notice>
          ) : !name.trim() ? (
            <Notice tone="warning">Add a list name before these changes can be saved.</Notice>
          ) : (
            <p className="muted">Saving your latest changes. This page will close as soon as they are saved.</p>
          )}
        </Modal>
      ) : null}
    </>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "saving" || state === "dirty") return <span className="saving" aria-live="polite"><Spinner label="Saving" /> Saving…</span>;
  if (state === "failed") {
    return (
      <span className="saving failed" role="alert">
        Save failed. <button type="button" className="link-btn" onClick={onRetry}>Retry</button>
      </span>
    );
  }
  if (state === "conflict") return <span className="saving failed">Not saved</span>;
  return <span className="saving" aria-live="polite">Saved</span>;
}

// ─────────────────────────────────────────────────────────────── workspace

function ListWorkspace({ list }: { list: ListDetail }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<"export" | "more" | "derive" | null>(null);
  const [selected, setSelected] = useState({ n: 0, total: list.memberCount });
  const onSelectionCount = useCallback((n: number, total: number) => setSelected({ n, total }), []);
  const latest: OperationView | null = list.operations.at(-1) ?? null;
  const active = isActive(list.status);
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ["list", list.id] });
    void qc.invalidateQueries({ queryKey: ["members", list.id] });
  };
  // While a search runs the table refreshes too; one last refresh when it ends shows the final rows.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) void qc.invalidateQueries({ queryKey: ["members", list.id] });
    wasActive.current = active;
  }, [active, list.id, qc]);

  const archive = useMutation({ mutationFn: (archived: boolean) => api.archiveList(list.id, archived), onSuccess: (d) => qc.setQueryData(["list", list.id], d) });

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="eyebrow">Creator lists / {list.kind === "imported" ? "Imported roster" : "Sourcing workspace"}</span>
          <RenameTitle list={list} />
          <div className="context inline" style={{ flexWrap: "wrap" }}>
            <StatusBadge status={list.status} />
            <span>{list.kind === "imported" ? "Imported list" : "Sourced list"}</span>
            <span>·</span>
            <span>{count(list.memberCount)} saved creators</span>
            {list.archivedAt ? <span className="badge">Archived</span> : null}
            <span className="dim">· updated {when(list.updatedAt)}</span>
          </div>
        </div>
        <div className="actions">
          {list.kind === "sourced" ? (
            <>
              <button type="button" className="btn" disabled={active || Boolean(list.archivedAt)} onClick={() => setDialog("more")} title={active ? "Wait for the current search to finish" : undefined}>
                <Search size={16} aria-hidden /> Find more
              </button>
              <button type="button" className="btn" onClick={() => setDialog("derive")}>
                <Copy size={16} aria-hidden /> New list using these criteria
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={list.memberCount === 0} onClick={() => setDialog("export")}>
            <Download size={16} aria-hidden /> Export{selected.n > 0 ? ` selected (${count(selected.n)})` : ` all (${count(list.memberCount)})`}
          </button>
          <button type="button" className="btn btn-ghost" disabled={archive.isPending} onClick={() => archive.mutate(!list.archivedAt)}>
            {list.archivedAt ? "Unarchive" : "Archive"}
          </button>
        </div>
      </div>

      {list.kind === "sourced" ? <SourcedSummary list={list} latest={latest} /> : <ImportSummary list={list} />}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="toolbar">
          <h2>Creators</h2>
          <span className="muted small">{active ? "Qualified creators appear here as soon as they are saved." : `${count(list.memberCount)} saved`}</span>
          <span className="toolbar-spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={refresh}>
            <RefreshCw size={14} aria-hidden /> Refresh
          </button>
        </div>
        <MembersTable listId={list.id} kind={list.kind} live={active} onSelectionCount={onSelectionCount} onExport={(n, total) => { setSelected({ n, total }); setDialog("export"); }} />
      </div>

      {dialog === "export" ? <ExportDialog listId={list.id} listName={list.name} total={selected.total} selectedCount={selected.n} onClose={() => setDialog(null)} /> : null}
      {dialog === "more" ? <FindMoreDialog listId={list.id} listName={list.name} onClose={() => setDialog(null)} onStarted={refresh} /> : null}
      {dialog === "derive" ? <NewListDialog from={list} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function RenameTitle({ list }: { list: ListDetail }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(list.name);
  const uid = useId();
  const rename = useMutation({
    mutationFn: () => api.updateList(list.id, { name: value.trim() }),
    onSuccess: (d) => {
      qc.setQueryData(["list", list.id], d);
      void qc.invalidateQueries({ queryKey: ["lists"] });
      setEditing(false);
    },
  });
  if (!editing) {
    return (
      <div className="inline" style={{ gap: 8 }}>
        <h1 style={{ overflowWrap: "anywhere" }}>{list.name}</h1>
        <button type="button" className="btn btn-ghost icon-btn" aria-label="Rename list" onClick={() => { setValue(list.name); setEditing(true); }}>
          <Pencil size={14} />
        </button>
      </div>
    );
  }
  return (
    <form
      className="row-gap"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) rename.mutate();
      }}
    >
      <div className="field" style={{ minWidth: 280, flex: 1 }}>
        <label htmlFor={uid}>List name</label>
        <input id={uid} className="input" value={value} maxLength={120} autoFocus onChange={(e) => setValue(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={!value.trim() || rename.isPending}>
        Save
      </button>
      <button type="button" className="btn" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {rename.isError ? <span className="error-text">{rename.error.message}</span> : null}
      <span className="hint muted small" style={{ width: "100%" }}>Renaming keeps every saved exclusion that refers to this list.</span>
    </form>
  );
}

function SourcedSummary({ list, latest }: { list: ListDetail; latest: OperationView | null }) {
  return (
    <div className="layout-2">
      <div className="card card-pad section">
        <h2>Search</h2>
        <dl className="kv">
          <dt>Criteria</dt>
          <dd>{criteriaSummary(list.criteria)}</dd>
          {list.criteria?.idealCreator ? (
            <>
              <dt>Ideal creator</dt>
              <dd>{list.criteria.idealCreator}</dd>
            </>
          ) : null}
          {list.criteria?.exclusions?.length ? (
            <>
              <dt>Fit restrictions</dt>
              <dd>{list.criteria.exclusions.join("; ")}</dd>
            </>
          ) : null}
          <dt>Excluded lists</dt>
          <dd>
            {list.excludedLists.length === 0 ? (
              <span className="muted">None — creators from other lists could appear.</span>
            ) : (
              <div className="chips">
                {list.excludedLists.map((l) => (
                  <span className="chip" key={l.id} style={{ paddingRight: 10 }}>
                    {l.missing ? "Unavailable list" : l.name} <span className="dim">· {count(l.memberCount)}</span>
                    {l.archived ? <span className="dim"> · archived</span> : null}
                  </span>
                ))}
              </div>
            )}
          </dd>
        </dl>
        <p className="muted small">Criteria and exclusions are fixed once a search has started. To change them, start a new list using these criteria.</p>
      </div>
      <div className="card card-pad section">
        <h2>Latest search</h2>
        {latest ? <OperationFacts op={latest} /> : <span className="muted">No search yet.</span>}
        {list.operations.length > 1 ? (
          <details>
            <summary style={{ cursor: "pointer" }}>All searches on this list ({list.operations.length})</summary>
            <ul className="stack" style={{ paddingLeft: 18 }}>
              {list.operations.map((o) => (
                <li key={o.id}>
                  {o.kind === "initial" ? "First search" : "Find more"} · {when(o.createdAt)} · {progressText(o)} · <StatusBadge status={o.listStatus} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function OperationFacts({ op }: { op: OperationView }) {
  const running = op.status === "queued" || op.status === "running";
  return (
    <div className="stack">
      <div className="inline">
        <StatusBadge status={op.listStatus} />
        {running ? <Spinner label="Search in progress" /> : null}
        <strong>{progressText(op)}</strong>
      </div>
      {op.status === "queued" ? <span className="muted">Waiting for the sourcing service to start this search.</span> : null}
      {op.outcome ? <Notice tone={op.listStatus === "complete" ? "success" : op.listStatus === "failed" ? "danger" : "warning"}>{op.outcome.message}</Notice> : null}
      <dl className="kv">
        <dt>Excluded at start</dt>
        <dd>
          {count(op.excludedCreatorCount)} unique creators from {op.excludedLists.length} {op.excludedLists.length === 1 ? "list" : "lists"}, plus {count(op.ownMemberCount)} already on this list
        </dd>
        <dt>Skipped as excluded</dt>
        <dd>{count(op.counters.excluded)}</dd>
        <dt>Already on this list</dt>
        <dd>{count(op.counters.duplicates)}</dd>
        <dt>Considered</dt>
        <dd>{count(op.counters.considered)}</dd>
        <dt>Started</dt>
        <dd>{when(op.createdAt)}</dd>
        {op.completedAt ? (
          <>
            <dt>Finished</dt>
            <dd>{when(op.completedAt)}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function ImportSummary({ list }: { list: ListDetail }) {
  const r = list.importReport;
  if (!r) return null;
  const unresolved = r.rows.filter((x) => x.status === "invalid" || x.status === "ambiguous");
  return (
    <div className="card card-pad section">
      <h2>Import report</h2>
      <div className="stats">
        <Fact label="Imported" value={r.counts.valid} />
        <Fact label="Duplicates" value={r.counts.duplicate} />
        <Fact label="Invalid" value={r.counts.invalid} />
        <Fact label="Ambiguous" value={r.counts.ambiguous} />
        <Fact label="Rows in file" value={r.counts.totalRows} />
      </div>
      {unresolved.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer" }}>Rows not imported ({unresolved.length})</summary>
          <ul className="stack" style={{ paddingLeft: 18 }}>
            {unresolved.map((x) => (
              <li key={x.row}>
                Row {x.row} · {x.status}: {x.identity} — {x.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="v">{count(value)}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}
