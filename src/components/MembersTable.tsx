import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MemberView } from "../../server/sourceClient";
import { api } from "../api";
import { PLATFORM_LABELS } from "../lib/criteria";
import { count, percent, when } from "../lib/format";
import { Drawer, Notice, Pager, Spinner } from "./ui";

const PAGE = 50;
const platformLabel = (p: string | null): string => (p && p in PLATFORM_LABELS ? PLATFORM_LABELS[p as keyof typeof PLATFORM_LABELS] : p === "twitch" ? "Twitch" : p ?? "—");

/**
 * A list's saved creators, page by page. Selection belongs to the saved rows (kept by the source,
 * by row id), so it survives paging, refresh, another session and Find more. "Select this page"
 * and "Select all N saved creators" are different actions with different labels.
 */
export function MembersTable({ listId, kind, live, onSelectionCount }: { listId: string; kind: "imported" | "sourced"; live: boolean; onSelectionCount: (n: number, total: number) => void }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<MemberView | null>(null);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["members", listId, page], queryFn: () => api.members(listId, { page, pageSize: PAGE }), placeholderData: keepPreviousData, refetchInterval: live ? 4000 : false });
  const data = q.data;
  useEffect(() => {
    if (data) onSelectionCount(data.selectedCount, data.total);
  }, [data, onSelectionCount]);

  // A click shows at once (a local overlay); the saved selection is the truth once the source answers.
  const [overlay, setOverlay] = useState<{ all: boolean | null; ids: Map<string, boolean> }>({ all: null, ids: new Map() });
  const select = useMutation({
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

  if (q.isLoading) return <div className="empty"><Spinner label="Loading creators" /></div>;
  if (q.isError) return <div className="card-pad"><Notice tone="danger">Could not load creators: {q.error.message}</Notice></div>;
  if (!data || data.total === 0) {
    return <div className="empty">{live ? "No creators saved yet. Qualified creators appear here as soon as they are saved." : kind === "sourced" ? "No creators were saved by this search." : "This list has no creators."}</div>;
  }
  const allSelected = data.selectedCount === data.total;

  return (
    <>
      {pageSelected === rows.length && rows.length > 0 && data.total > rows.length && !allSelected ? (
        <div className="select-banner" role="status">
          All {rows.length} creators on this page are selected.
          <button type="button" className="link-btn" onClick={() => select.mutate({ selected: true, all: true })}>
            Select all {count(data.total)} saved creators
          </button>
        </div>
      ) : null}
      {data.selectedCount > 0 ? (
        <div className="select-banner" role="status">
          {count(data.selectedCount)} of {count(data.total)} selected{allSelected ? " (all saved creators, across every page)" : ""}.
          <button type="button" className="link-btn" onClick={() => select.mutate({ selected: false, all: true })}>
            Clear selection
          </button>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="check">
                <input
                  ref={pageBox}
                  type="checkbox"
                  className="checkbox"
                  aria-label={pageSelected === rows.length ? "Unselect this page" : "Select this page"}
                  checked={pageSelected === rows.length && rows.length > 0}
                  onChange={() => select.mutate({ selected: pageSelected !== rows.length, memberIds: rows.map((m) => m.id) })}
                />
              </th>
              <th>Creator</th>
              <th>Platform · handle</th>
              <th>Profile</th>
              <th className="num">Followers</th>
              <th className="num">Engagement</th>
              <th>{kind === "sourced" ? "Why they fit" : "Email (from file)"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className={m.selected ? "is-selected" : undefined}>
                <td className="check">
                  <input type="checkbox" className="checkbox" aria-label={`Select ${m.displayName ?? m.handle ?? "creator"}`} checked={m.selected} onChange={() => select.mutate({ selected: !m.selected, memberIds: [m.id] })} />
                </td>
                <td className="name">
                  <button type="button" className="link-btn" style={{ textDecoration: "none", color: "var(--text)" }} onClick={() => setOpen(m)}>
                    {m.displayName ?? m.handle ?? "Unnamed"}
                  </button>
                  {m.accounts.length > 1 ? <div className="cell-sub">+{m.accounts.length - 1} more {m.accounts.length === 2 ? "account" : "accounts"}</div> : null}
                </td>
                <td>
                  {platformLabel(m.platform)} <span className="muted">@{m.handle ?? "—"}</span>
                </td>
                <td>
                  {m.profileUrl ? (
                    <a href={m.profileUrl} target="_blank" rel="noopener noreferrer" className="inline">
                      Open <ExternalLink size={12} aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td className="num">{count(m.followers)}</td>
                <td className="num">{percent(m.engagementPercent)}</td>
                <td className="reason">{kind === "sourced" ? m.reason ?? "—" : m.email ?? <span className="dim">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} label="Creator pages" />
      {open ? <CreatorDrawer m={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function CreatorDrawer({ m, onClose }: { m: MemberView; onClose: () => void }) {
  return (
    <Drawer title={m.displayName ?? `@${m.handle ?? "creator"}`} onClose={onClose}>
      <dl className="kv">
        <dt>Platform</dt>
        <dd>{platformLabel(m.platform)}</dd>
        <dt>Handle</dt>
        <dd>@{m.handle ?? "—"}</dd>
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
        <dt>Followers</dt>
        <dd>{count(m.followers)}</dd>
        <dt>Engagement</dt>
        <dd>{percent(m.engagementPercent)}</dd>
        {m.source === "sourced" ? (
          <>
            <dt>Why they fit</dt>
            <dd>{m.reason ?? "—"}</dd>
          </>
        ) : (
          <>
            <dt>Email (from file)</dt>
            <dd>{m.email ?? "—"}</dd>
            <dt>Location</dt>
            <dd>{m.location ?? "—"}</dd>
            <dt>Imported from row</dt>
            <dd>{m.importRow ?? "—"}</dd>
          </>
        )}
        <dt>Saved</dt>
        <dd>{when(m.createdAt)}</dd>
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
    </Drawer>
  );
}
