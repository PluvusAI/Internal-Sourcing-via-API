import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ClipboardList, Copy, Plus, Search, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ListSummary } from "../../server/sourceClient";
import { api } from "../api";
import { NewListDialog } from "../components/Dialogs";
import { ImportDialog } from "../components/ImportDialog";
import { RemoveListAction } from "../components/CreatorDialogs";
import { Notice, Pager, Spinner, StatusBadge, TableSkeleton, useDebounced } from "../components/ui";
import { count, when } from "../lib/format";
import { useArchiveList } from "../lib/archive";
import { linkHandler, listHref, setParams, useLocation, useScrollRestoration } from "../router";

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

  // The search lives in the URL: Back from a list returns to the same search and page. Only what
  // the user TYPED is written back, so a pending keystroke never overrides a Back navigation.
  const typed = useRef(false);
  useEffect(() => {
    typed.current = false;
    setQ(urlQ);
  }, [urlQ, showArchived]);
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

  const openLibrary = (archived: boolean): void => {
    typed.current = false;
    setQ("");
    setParams({ archived: archived ? "1" : null, q: null, page: null }, { push: true });
  };

  const lists = useQuery({
    queryKey: ["lists", urlQ, page, showArchived],
    queryFn: () => api.searchLists({ q: urlQ, page, pageSize: PAGE, archivedOnly: showArchived }),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.lists.some((l) => l.status === "queued" || l.status === "sourcing") ? 5000 : false),
  });
  const resultsSettling = (typed.current && q.trim() !== urlQ) || lists.isPlaceholderData;
  useScrollRestoration(Boolean(lists.data) && !resultsSettling, href);

  const archive = useArchiveList();
  useEffect(() => {
    if (!lists.data || lists.isPlaceholderData || lists.isFetching) return;
    const last = Math.max(1, Math.ceil(lists.data.total / PAGE));
    if (page > last) setParams({ page: last === 1 ? null : String(last) });
  }, [lists.data, lists.isPlaceholderData, lists.isFetching, page]);

  // Search, page and archive filters share a query observer. Keep-previous-data must not leave
  // old rows actionable under a new URL while the matching result is still loading.
  const data = resultsSettling ? undefined : lists.data;
  useEffect(() => { if (data && page > Math.max(1, Math.ceil(data.total / PAGE))) setParams({ page: data.total <= PAGE ? null : String(Math.ceil(data.total / PAGE)) }); }, [data, page]);
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Workspace / Creator sourcing</span>
          <h1>{showArchived ? "Archived lists" : "Creator lists"}</h1>
          <p className="context">Find your next creators. Keep every roster and search in one place.</p>
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

      <nav className="library-nav" aria-label="List library">
        <button type="button" aria-current={!showArchived ? "page" : undefined} onClick={() => openLibrary(false)}>
          <ClipboardList size={16} aria-hidden /> Active lists
        </button>
        <button type="button" aria-current={showArchived ? "page" : undefined} onClick={() => openLibrary(true)}>
          <Archive size={16} aria-hidden /> Archived
        </button>
      </nav>

      <div className="card library-card" aria-busy={lists.isLoading || resultsSettling}>
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
        </div>

        {lists.isLoading || resultsSettling ? (
          <TableSkeleton label={typed.current && q.trim() !== urlQ ? "Searching lists" : "Loading lists"} />
        ) : lists.isError ? (
          <div className="card-pad">
            <Notice tone="danger" title="Lists could not be loaded">
              {lists.error.message}
            </Notice>
            <button type="button" className="btn btn-sm retry-button" onClick={() => void lists.refetch()}>Try again</button>
          </div>
        ) : data && data.total === 0 ? (
          urlQ ? (
            <div className="empty empty-state">
              <Search size={26} aria-hidden />
              <strong>{showArchived ? "No matching archived lists" : "No matching lists"}</strong>
              <span>{showArchived ? "No archived list" : "No list"} matches “{urlQ}”. Try another brand or list name.</span>
              <button type="button" className="btn" onClick={() => setParams({ q: null, page: null })}>
                {showArchived ? "View all archived lists" : "Clear search"}
              </button>
            </div>
          ) : showArchived ? (
            <div className="empty empty-state">
              <Archive size={28} aria-hidden />
              <strong>No archived lists</strong>
              <span>Lists you archive appear here. You can restore them at any time.</span>
              <button type="button" className="btn" onClick={() => openLibrary(false)}>Back to active lists</button>
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
                        <div className="list-identity"><span className={`list-icon ${l.kind === "sourced" ? "list-icon-sourced" : ""}`} aria-hidden>{l.kind === "imported" ? <Upload size={18} /> : <Search size={18} />}</span><div>
                        <a href={listHref(l.id)} onClick={linkHandler(listHref(l.id))}>
                          {l.name}
                        </a>
                        {l.archivedAt ? <div className="cell-sub">Archived</div> : null}
                        </div></div>
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
                          <a className="btn btn-sm" href={listHref(l.id)} onClick={linkHandler(listHref(l.id))} aria-label={`Open ${l.name}`}>
                            Open
                          </a>
                          {l.kind === "sourced" && l.status !== "draft" ? (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDialog({ kind: "derive", from: l })} aria-label={`New list using criteria from ${l.name}`} title="New list using these criteria">
                              <Copy size={14} aria-hidden /> Use criteria
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={l.archivedAt ? `Restore ${l.name}` : `Archive ${l.name}`}
                            title={l.archivedAt ? "Restore to active lists" : "Archive (keeps its creators and every reference to it)"}
                            disabled={archive.isPending}
                            onClick={() => archive.mutate({ id: l.id, archived: !l.archivedAt })}
                          >
                            {archive.isPending && archive.variables?.id === l.id ? <Spinner label={l.archivedAt ? "Restoring" : "Archiving"} /> : l.archivedAt ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
                            {l.archivedAt ? "Restore" : "Archive"}
                          </button>
                          <RemoveListAction list={l} />
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
