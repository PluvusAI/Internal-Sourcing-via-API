import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ClipboardList, Copy, Plus, Search, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ListSummary } from "../../server/sourceClient";
import { api } from "../api";
import { NewListDialog } from "../components/Dialogs";
import { ImportDialog } from "../components/ImportDialog";
import { Notice, Pager, Spinner, StatusBadge, useDebounced } from "../components/ui";
import { count, when } from "../lib/format";
import { linkHandler, setParams, useLocation, useScrollRestoration } from "../router";

const PAGE = 25;

export function ListsHome() {
  const { params, href } = useLocation();
  const urlQ = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const showArchived = params.get("archived") === "1";
  const [q, setQ] = useState(urlQ);
  const debounced = useDebounced(q, 250);
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "import" } | { kind: "derive"; from: ListSummary } | null>(null);
  const searchId = useId();
  const qc = useQueryClient();

  // The search lives in the URL: Back from a list returns to the same search and page. Only what
  // the user TYPED is written back, so a pending keystroke never overrides a Back navigation.
  const typed = useRef(false);
  useEffect(() => {
    typed.current = false;
    setQ(urlQ);
  }, [urlQ]);
  useEffect(() => {
    if (typed.current && debounced.trim() !== urlQ) {
      typed.current = false;
      setParams({ q: debounced.trim() || null, page: null });
    }
  }, [debounced, urlQ]);
  const type = (v: string): void => {
    typed.current = true;
    setQ(v);
  };

  const lists = useQuery({
    queryKey: ["lists", urlQ, page, showArchived],
    queryFn: () => api.searchLists({ q: urlQ, page, pageSize: PAGE, includeArchived: showArchived }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.lists.some((l) => l.status === "queued" || l.status === "sourcing") ? 5000 : false),
  });
  const resultsSettling = (typed.current && q.trim() !== urlQ) || lists.isPlaceholderData;
  useScrollRestoration(Boolean(lists.data) && !resultsSettling, href);

  const archive = useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => api.archiveList(v.id, v.archived),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["lists"] }),
  });

  // Search, page and archive filters share a query observer. Keep-previous-data must not leave
  // old rows actionable under a new URL while the matching result is still loading.
  const data = resultsSettling ? undefined : lists.data;
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Workspace / Creator sourcing</span>
          <h1>Creator lists</h1>
          <p className="context">Imported rosters and sourced batches, named by brand. Pick any of them as exclusions when you source a new list.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => setDialog({ kind: "import" })}>
            <Upload size={16} aria-hidden /> Import list
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "new" })}>
            <Plus size={16} aria-hidden /> New sourcing list
          </button>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="search">
            <Search size={16} aria-hidden />
            <label htmlFor={searchId} className="sr-only">
              Search lists by brand or list name
            </label>
            <input id={searchId} className="input" type="search" placeholder="Search lists by brand or list name" value={q} onChange={(e) => type(e.target.value)} onKeyDown={(e) => e.key === "Escape" && type("")} />
          </div>
          <span className="muted small" aria-live="polite">
            {data ? `${count(data.total)} ${data.total === 1 ? "list" : "lists"}${urlQ ? ` match “${urlQ}”` : ""}` : ""}
          </span>
          {lists.isFetching && data ? <Spinner label="Refreshing" /> : null}
          <span className="toolbar-spacer" />
          <label className="inline small">
            <input type="checkbox" className="checkbox" checked={showArchived} onChange={(e) => setParams({ archived: e.target.checked ? "1" : null, page: null })} /> Show archived
          </label>
        </div>

        {lists.isLoading || resultsSettling ? (
          <div className="empty">
            <Spinner label={typed.current && q.trim() !== urlQ ? "Searching lists" : "Loading lists"} />
          </div>
        ) : lists.isError ? (
          <div className="card-pad">
            <Notice tone="danger" title="Lists could not be loaded">
              {lists.error.message}
            </Notice>
          </div>
        ) : data && data.total === 0 ? (
          urlQ ? (
            <div className="empty empty-state">
              <Search size={26} aria-hidden />
              <strong>No matching lists</strong>
              <span>No list matches “{urlQ}”. Try another brand or list name.</span>
              <button type="button" className="btn" onClick={() => setParams({ q: null, page: null })}>
                Clear search
              </button>
            </div>
          ) : (
            <div className="empty empty-state">
              <ClipboardList size={28} aria-hidden />
              <strong>Your creator lists start here</strong>
              <span>Import an existing roster or create a sourcing list to find new creators.</span>
              <div className="actions">
                <button type="button" className="btn" onClick={() => setDialog({ kind: "import" })}>Import list</button>
                <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "new" })}>New sourcing list</button>
              </div>
            </div>
          )
        ) : data ? (
          <>
            <div className="table-wrap">
              <table className="table lists-table">
                <caption className="sr-only">Creator lists and their current sourcing status</caption>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th className="num">Creators</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.lists.map((l) => (
                    <tr key={l.id}>
                      <td className="name" data-label="Name">
                        <a href={`/lists/${l.id}`} onClick={linkHandler(`/lists/${l.id}`)}>
                          {l.name}
                        </a>
                        {l.archivedAt ? <div className="cell-sub">Archived</div> : null}
                      </td>
                      <td data-label="Type">{l.kind === "imported" ? "Imported" : "Sourced"}</td>
                      <td className="num" data-label="Creators">{count(l.memberCount)}</td>
                      <td data-label="Status">
                        <StatusBadge status={l.status} />
                        {l.latestOperation && (l.status === "sourcing" || l.status === "queued") ? (
                          <div className="cell-sub">
                            {count(l.latestOperation.admittedCount)} of {count(l.latestOperation.targetCount)} new
                          </div>
                        ) : null}
                      </td>
                      <td className="muted" data-label="Updated">{when(l.updatedAt)}</td>
                      <td className="row-actions">
                        <div className="actions">
                          <a className="btn btn-sm" href={`/lists/${l.id}`} onClick={linkHandler(`/lists/${l.id}`)}>
                            Open
                          </a>
                          {l.kind === "sourced" && l.status !== "draft" ? (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: "derive", from: l })} aria-label={`New list using criteria from ${l.name}`} title="New list using these criteria">
                              <Copy size={14} aria-hidden /> <span className="label-desktop">New list using these criteria</span><span className="label-mobile">Use criteria</span>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost icon-btn"
                            aria-label={l.archivedAt ? `Unarchive ${l.name}` : `Archive ${l.name}`}
                            title={l.archivedAt ? "Unarchive" : "Archive (keeps its creators and every reference to it)"}
                            disabled={archive.isPending}
                            onClick={() => archive.mutate({ id: l.id, archived: !l.archivedAt })}
                          >
                            {l.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={PAGE} total={data.total} onPage={(p) => setParams({ page: p === 1 ? null : String(p) }, { push: true })} label="List pages" />
          </>
        ) : null}
        {archive.isError ? (
          <div className="card-pad">
            <Notice tone="danger">{archive.error.message}</Notice>
          </div>
        ) : null}
      </div>

      {dialog?.kind === "new" ? <NewListDialog from={null} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "derive" ? <NewListDialog from={dialog.from} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "import" ? <ImportDialog onClose={() => setDialog(null)} /> : null}
    </>
  );
}
