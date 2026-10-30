import { EmailCell } from "./EmailLookup";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Mail, ExternalLink, Pencil, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EmailScope, MemberView } from "../../server/sourceClient";
import { api } from "../api";
import { PLATFORM_LABELS } from "../lib/criteria";
import { count, percent, when } from "../lib/format";
import { Drawer, LoadingStatus, Notice, Pager, Spinner, TableSkeleton } from "./ui";
import { CreatorAvatar } from "./CreatorAvatar";
import { CreatorDialog, RemoveCreatorsDialog } from "./CreatorDialogs";

const PAGE = 50;
const platformLabel = (p: string | null): string => (p && p in PLATFORM_LABELS ? PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] : p === "twitch" ? "Twitch" : p ?? "—");

/**
 * A list's saved creators, page by page. Selection belongs to the saved rows (kept by the source,
 * by row id), so it survives paging, refresh, another session and Find more. "Select this page"
 * and "Select all N saved creators" are different actions with different labels.
 */
export function MembersTable({ listId, kind, live, emailBusy = false, onFindEmails, editable = true, listName = "this list", onSelectionCount, onExport, onMessage }: { listId: string; kind: "imported" | "sourced"; live: boolean; emailBusy?: boolean; onFindEmails?: (scope: EmailScope | { scope: "selection" }) => void; editable?: boolean; listName?: string; onSelectionCount: (n: number, total: number) => void; onExport: (n: number, total: number) => void; onMessage?: (message: string) => void }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<MemberView | null>(null);
  const [dialog, setDialog] = useState<{ kind: "edit"; member: MemberView } | { kind: "remove"; member: MemberView | null } | null>(null);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["members", listId, page], queryFn: () => api.members(listId, { page, pageSize: PAGE }), placeholderData: keepPreviousData, refetchInterval: live || emailBusy ? 3000 : false });
  // A page change may temporarily carry the previous page's data. Never make those rows
  // selectable under the new page number.
  const data = q.isPlaceholderData ? undefined : q.data;
  useEffect(() => {
    if (data) onSelectionCount(data.selectedCount, data.total);
  }, [data, onSelectionCount]);
  useEffect(() => { if (data && page > Math.max(1, Math.ceil(data.total / PAGE))) setPage(Math.max(1, Math.ceil(data.total / PAGE))); }, [data, page]);

  // A click shows at once (a local overlay); the saved selection is the truth once the source answers.
  const [overlay, setOverlay] = useState<{ all: boolean | null; ids: Map<string, boolean> }>({ all: null, ids: new Map() });
  const select = useMutation({
    mutationKey: ["selection", listId],
    mutationFn: (body: { selected: boolean; all: true } | { selected: boolean; memberIds: string[] }) => api.setSelection(listId, body),
    onMutate: (body) =>
      setOverlay((o) => ("all" in body ? { all: body.selected, ids: new Map() } : { all: o.all, ids: new Map([...o.ids, ...body.memberIds.map((id) => [id, body.selected] as const)]) })),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ["members", listId] });
      setOverlay({ all: null, ids: new Map() });
    },
  });

  const pageBox = useRef<HTMLInputElement>(null);
  const rows = (data?.members ?? []).map((m) => {
    const local = overlay.ids.get(m.id) ?? overlay.all;
    return local === null || local === undefined ? m : { ...m, selected: local };
  });
  const pageSelected = rows.filter((m) => m.selected).length;
  useEffect(() => {
    if (pageBox.current) pageBox.current.indeterminate = pageSelected > 0 && pageSelected < rows.length;
  }, [pageSelected, rows.length]);

  if (q.isLoading || q.isPlaceholderData) return <><TableSkeleton label="Loading creators" /><Pager key="creator-pages" page={page} pageSize={PAGE} total={q.data?.total ?? 0} onPage={setPage} label="Creator pages" loading /></>;
  if (q.isError) return <div className="card-pad"><Notice tone="danger">Could not load creators: {q.error.message}</Notice><button type="button" className="btn btn-sm retry-button" onClick={() => void q.refetch()}>Try again</button></div>;
  if (!data || data.total === 0) {
    return <div className="empty empty-state">{live ? <Spinner label="Searching for creators" large /> : <Users size={28} aria-hidden />}<strong>{live ? "Looking for creators" : "No creators saved"}</strong><span>{live ? "The search is running. Qualified creators appear here as they are saved; follow the counters above for progress." : editable ? "Add a creator to this list or use the sourcing controls to find new creators." : "This archived list has no saved creators. Restore it to add profiles."}</span></div>;
  }
  const allSelected = data.selectedCount === data.total;
  const fullPageSelected = rows.length > 0 && pageSelected === rows.length;
  const togglePage = (): void => select.mutate({ selected: !fullPageSelected, memberIds: rows.map((m) => m.id) });

  return (
    <>
      {live || q.isFetching || select.isPending ? <div className="creator-table-status"><LoadingStatus label={select.isPending ? "Saving selection" : q.isFetching ? "Updating saved creators" : "Search running"} />{live ? <span className="muted small">New matches are added automatically.</span> : null}</div> : null}
      <div className="mobile-page-select">
        <button type="button" className="btn btn-sm" disabled={select.isPending} onClick={togglePage}>
          {fullPageSelected ? "Unselect this page" : `Select this page (${count(rows.length)})`}
        </button>
      </div>
      {fullPageSelected && data.total > rows.length && !allSelected ? (
        <div className="select-banner" role="status">
          All {rows.length} creators on this page are selected.
          <button type="button" className="link-btn" disabled={select.isPending} onClick={() => select.mutate({ selected: true, all: true })}>
            Select all {count(data.total)} saved creators
          </button>
        </div>
      ) : null}
      {data.selectedCount > 0 ? (
        <div className="select-banner bulk-actions" role="status">
          <span>{count(data.selectedCount)} of {count(data.total)} selected{allSelected ? " (all saved creators, across every page)" : ""}.</span>
          <div className="actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={select.isPending} onClick={() => onExport(data.selectedCount, data.total)}><Download size={14} aria-hidden /> Export selected</button>
            {editable && onFindEmails ? <button type="button" className="btn btn-sm" disabled={select.isPending} onClick={() => onFindEmails({ scope: "selection" })}><Mail size={14} aria-hidden />Find selected emails</button> : null}
            {editable && !live ? <button type="button" className="btn btn-sm btn-danger" disabled={select.isPending} onClick={() => setDialog({ kind: "remove", member: null })}><Trash2 size={14} aria-hidden />Remove selected</button> : null}
            <button type="button" className="link-btn" disabled={select.isPending} onClick={() => select.mutate({ selected: false, all: true })}>
              Clear selection
            </button>
          </div>
        </div>
      ) : null}
      {select.isError ? <div className="card-pad"><Notice tone="danger" title="Selection could not be saved">{select.error.message}</Notice></div> : null}
      <div className="table-wrap" aria-busy={q.isFetching || select.isPending}>
        <table className="table members-table">
          <caption className="sr-only">Saved creators with selection, profile, audience metrics, and fit details</caption>
          <thead>
            <tr>
              <th className="check">
                <input
                  ref={pageBox}
                  type="checkbox"
                  className="checkbox"
                  aria-label={fullPageSelected ? "Unselect this page" : "Select this page"}
                  checked={fullPageSelected}
                  disabled={select.isPending}
                  onChange={togglePage}
                />
              </th>
              <th>Creator</th>
              <th>Platform</th>
              <th className="num">Followers</th>
              <th className="num">Engagement</th>
              <th>Email</th>
              {kind === "sourced" ? <th>Why they fit</th> : null}
              {editable && !live ? <th><span className="sr-only">Creator actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={`creator-row${m.selected ? " is-selected" : ""}`}>
                <td className="check">
                  <input type="checkbox" className="checkbox" aria-label={`Select ${m.displayName ?? m.handle ?? "creator"}`} checked={m.selected} disabled={select.isPending} onChange={() => select.mutate({ selected: !m.selected, memberIds: [m.id] })} />
                </td>
                <td className="name" data-label="Creator">
                  <div className="creator-cell">
                    <CreatorAvatar member={m} />
                    <div className="creator-identity">
                      <button type="button" className="creator-name" onClick={() => setOpen(m)}>{m.displayName ?? m.handle ?? "Unnamed"}</button>
                      {m.profileUrl ? <a href={m.profileUrl} target="_blank" rel="noopener noreferrer" className="creator-profile creator-handle">@{m.handle ?? "profile"}<ExternalLink size={12} aria-hidden /><span className="sr-only">Open profile (opens in a new tab)</span></a> : <span className="cell-sub creator-handle">{m.handle ? `@${m.handle}` : "No handle provided"}</span>}
                      {m.accounts.length > 1 ? <span className="cell-sub">+{m.accounts.length - 1} more {m.accounts.length === 2 ? "account" : "accounts"}</span> : null}
                    </div>
                  </div>
                </td>
                <td data-label="Platform"><span className="platform-badge">{platformLabel(m.platform)}</span></td>
                <td className="num" data-label="Followers">{count(m.followers)}</td>
                <td className="num" data-label="Engagement">{percent(m.engagementPercent)}</td>
                <td data-label="Email"><EmailCell member={m} /></td>
                {kind === "sourced" ? <td className="reason" data-label="Why they fit"><span className="reason-copy">{m.source === "import" ? "Added manually" : m.reason ?? "—"}</span></td> : null}
                {editable && !live ? <td className="row-actions" data-label="Actions"><div className="actions">{onFindEmails && !m.email ? <button type="button" className="btn btn-sm btn-ghost" title="Find email" aria-label={`Find email for ${m.displayName ?? m.handle ?? "creator"}`} onClick={() => onFindEmails({ scope: "selected", memberIds: [m.id] })}><Mail size={14} aria-hidden /><span className="row-action-label">Find email</span></button> : null}<button type="button" className="btn btn-sm btn-ghost" title="Edit creator" aria-label={`Edit ${m.displayName ?? m.handle ?? "creator"}`} onClick={() => setDialog({ kind: "edit", member: m })}><Pencil size={14} aria-hidden /><span className="row-action-label">Edit</span></button><button type="button" className="btn btn-sm btn-ghost btn-danger" title="Remove creator" aria-label={`Remove ${m.displayName ?? m.handle ?? "creator"}`} onClick={() => setDialog({ kind: "remove", member: m })}><Trash2 size={14} aria-hidden /><span className="row-action-label">Remove</span></button></div></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager key="creator-pages" page={page} pageSize={PAGE} total={data.total} onPage={setPage} label="Creator pages" />
      {open ? <CreatorDrawer m={data.members.find(m => m.id === open.id) ?? open} onClose={() => setOpen(null)} onEdit={editable && !live ? () => { setDialog({ kind: "edit", member: open }); setOpen(null); } : undefined} /> : null}
      {dialog?.kind === "edit" ? <CreatorDialog listId={listId} member={dialog.member} onClose={() => setDialog(null)} onSaved={message => onMessage?.(message)} /> : null}
      {dialog?.kind === "remove" ? <RemoveCreatorsDialog listId={listId} listName={listName} member={dialog.member} onClose={() => setDialog(null)} onRemoved={message => onMessage?.(message)} /> : null}
    </>
  );
}

function CreatorDrawer({ m, onClose, onEdit }: { m: MemberView; onClose: () => void; onEdit?: (() => void) | undefined }) {
  return (
    <Drawer title={m.displayName ?? `@${m.handle ?? "creator"}`} onClose={onClose}>
      <div className="creator-drawer-profile"><CreatorAvatar member={m} large /><div className="stack"><strong>{m.displayName ?? m.handle ?? "Creator"}</strong><span className="muted">{platformLabel(m.platform)} · @{m.handle ?? "—"}</span>{m.profileUrl ? <a className="creator-profile" href={m.profileUrl} target="_blank" rel="noopener noreferrer">View profile <ExternalLink size={13} aria-hidden /><span className="sr-only">(opens in a new tab)</span></a> : null}</div></div>
      <div className="creator-drawer-metrics"><div><strong>{count(m.followers)}</strong><span>Followers</span></div><div><strong>{percent(m.engagementPercent)}</strong><span>Engagement</span></div></div>
      <dl className="kv">
        <dt>Profile</dt>
        <dd>
          {m.profileUrl ? (
            <a href={m.profileUrl} target="_blank" rel="noopener noreferrer">
              {m.profileUrl}
            </a>
          ) : (
            "—"
          )}
        </dd>
        {m.source === "sourced" ? (
          <>
            <dt>Why they fit</dt>
            <dd>{m.reason ?? "—"}</dd>
          </>
        ) : (
          <>
            <dt>Added from</dt>
            <dd>{m.importRow === null ? "Manual entry" : `File row ${m.importRow}`}</dd>
          </>
        )}
        <dt>Saved</dt>
        <dd>{when(m.createdAt)}</dd>
        <dt>Email</dt><dd><EmailCell member={m} /></dd>
        {m.emailCheckedAt ? <><dt>Email checked</dt><dd>{when(m.emailCheckedAt)}</dd></> : null}
        <dt>Location</dt><dd>{m.location ?? "—"}</dd>
        <dt>Language</dt><dd>{m.language ?? "—"}</dd>
      </dl>
      {m.accounts.length > 1 ? (
        <section className="stack">
          <h3>Accounts on this row</h3>
          <ul>
            {m.accounts.map((a) => (
              <li key={`${a.platform}:${a.handle}`}>
                {platformLabel(a.platform)} @{a.handle}
                {a.followers !== null ? ` · ${count(a.followers)} followers` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="muted small">Unknown values are shown as “—”. Nothing here was estimated.</p>
      {onEdit ? <button type="button" className="btn" onClick={onEdit}><Pencil size={14} aria-hidden />Edit details</button> : null}
    </Drawer>
  );
}
