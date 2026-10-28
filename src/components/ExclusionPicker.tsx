import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { count } from "../lib/format";
import { addAll, matchState, removeAll, selectedIds, summaryText, toggle, type Selection } from "../lib/selection";
import { Notice, Pager, Spinner, StatusBadge, useDebounced } from "./ui";

const PAGE = 8;

/**
 * "Exclude creators from these lists". A searchable multi-select of saved lists, by stable id.
 * The search uses exactly the Lists home search (the same server query); the picker only adds
 * "can be excluded" (imported, or sourced and finished, with saved rows).
 */
export function ExclusionPicker({ selection, onChange, selfId, locked }: { selection: Selection; onChange: (s: Selection) => void; selfId: string; locked: boolean }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const debounced = useDebounced(q.trim(), 250);
  const searchId = useId();
  useEffect(() => setPage(1), [debounced]);

  const results = useQuery({
    queryKey: ["picker", debounced, page],
    queryFn: () => api.searchLists({ q: debounced, page, pageSize: PAGE, eligible: true }),
    placeholderData: keepPreviousData,
    enabled: !locked,
  });
  const matching = useQuery({ queryKey: ["picker-ids", debounced], queryFn: () => api.matchingListIds({ q: debounced, eligible: true }), enabled: !locked, retry: false });

  const ids = selectedIds(selection);
  const sortedKey = [...ids].sort().join(",");
  const debouncedKey = useDebounced(sortedKey, 300);
  const union = useQuery({
    queryKey: ["union", debouncedKey],
    queryFn: () => api.previewExclusions(debouncedKey ? debouncedKey.split(",") : []),
    enabled: debouncedKey.length > 0,
    placeholderData: keepPreviousData,
  });
  // Only a count for exactly the current selection is shown; a late answer for an older one is not.
  const unique = ids.length === 0 ? 0 : union.data && debouncedKey === sortedKey && !union.isPlaceholderData ? union.data.uniqueCreatorCount : null;

  const matchIds = (matching.data?.lists ?? []).filter((l) => l.id !== selfId).map((l) => l.id);
  const state = matchState(selection, matchIds);
  const headerBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = state === "some";
  }, [state]);

  const rows = (results.data?.lists ?? []).filter((l) => l.id !== selfId);
  const total = matchIds.length;
  const wholeWorkspace = debounced === "";
  const tooMany = matching.error instanceof ApiError && matching.error.code === "too_many_matches";

  const selectAllMatching = (): void => {
    if (!matching.data) return;
    onChange(addAll(selection, matching.data.lists.filter((l) => l.id !== selfId)));
  };
  const clearMatching = (): void => onChange(removeAll(selection, matchIds));

  return (
    <div className="picker">
      {!locked ? (
        <>
          <div className="search" style={{ maxWidth: "none" }}>
            <Search size={16} aria-hidden />
            <label htmlFor={searchId} className="sr-only">
              Search lists by brand or list name
            </label>
            <input id={searchId} className="input" type="search" placeholder="Search lists by brand or list name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="picker-results">
            <div className="picker-head">
              <input
                ref={headerBox}
                type="checkbox"
                className="checkbox"
                aria-label={state === "all" ? `Clear all ${total} matching lists` : `Select all ${total} matching lists`}
                checked={state === "all"}
                disabled={total === 0 || !matching.data}
                onChange={() => (state === "all" ? clearMatching() : selectAllMatching())}
              />
              <span className="muted small" aria-live="polite">
                {matching.isLoading ? "Counting matching lists…" : tooMany ? "Too many lists match to select at once — narrow the search." : `${total} matching ${total === 1 ? "list" : "lists"}${wholeWorkspace ? " in the whole workspace" : ""}`}
              </span>
              {total > 0 && matching.data && state !== "all" ? (
                <button type="button" className="link-btn" onClick={selectAllMatching}>
                  {wholeWorkspace ? `Select all ${total} lists in the workspace` : `Select all ${total} matching lists`}
                </button>
              ) : null}
              {state !== "none" ? (
                <button type="button" className="link-btn" onClick={clearMatching}>
                  Clear {state === "all" ? "these" : "selected matching"} lists
                </button>
              ) : null}
              {results.isFetching ? <Spinner label="Searching" /> : null}
            </div>
            {results.isError ? (
              <div className="picker-row">
                <span className="error-text">Could not load lists: {results.error.message}</span>
              </div>
            ) : rows.length === 0 && !results.isLoading ? (
              <div className="picker-row muted">
                {debounced ? `No list that can be excluded matches “${debounced}”.` : "No imported or finished lists yet."}{" "}
                {debounced ? (
                  <button type="button" className="link-btn" onClick={() => setQ("")}>
                    Clear search
                  </button>
                ) : null}
              </div>
            ) : (
              rows.map((l) => {
                const checked = selection.has(l.id);
                return (
                  <div key={l.id}>
                    <div className="picker-row">
                      <label>
                        <input type="checkbox" className="checkbox" checked={checked} onChange={() => onChange(toggle(selection, { id: l.id, name: l.name, memberCount: l.memberCount }))} />
                        <span className="name">{l.name}</span>
                      </label>
                      <span className="muted small">{count(l.memberCount)} creators</span>
                      <StatusBadge status={l.status} />
                      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>
                        {open === l.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Preview
                      </button>
                    </div>
                    {open === l.id ? <ListPreview listId={l.id} /> : null}
                  </div>
                );
              })
            )}
            <Pager page={page} pageSize={PAGE} total={results.data?.total ?? 0} onPage={setPage} label="Exclusion list pages" />
          </div>
          {results.data && results.data.matchingNotEligible > 0 ? (
            <p className="muted small">
              {results.data.matchingNotEligible} more matching {results.data.matchingNotEligible === 1 ? "list is" : "lists are"} a draft, still sourcing, empty or archived, so not offered as a complete exclusion set.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="stack">
        <div className="section-head">
          <span className="field-label">Selected exclusion lists</span>
          {ids.length > 0 && !locked ? (
            <button type="button" className="link-btn" onClick={() => onChange(new Map())}>
              Clear selection
            </button>
          ) : null}
        </div>
        {ids.length > 0 ? (
          <div className="chips" aria-label="Selected exclusion lists">
            {[...selection.values()].map((l) => (
              <span className="chip" key={l.id}>
                {l.name} <span className="dim">· {count(l.memberCount)}</span>
                {!locked ? (
                  <button type="button" aria-label={`Remove ${l.name}`} onClick={() => onChange(toggle(selection, l))}>
                    <X size={12} />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}
        <p className="summary-line" aria-live="polite">
          {summaryText(ids.length, unique)}
        </p>
        {union.isError ? <Notice tone="danger">{union.error.message}</Notice> : null}
      </div>
    </div>
  );
}

function ListPreview({ listId }: { listId: string }) {
  const q = useQuery({ queryKey: ["preview", listId], queryFn: () => api.members(listId, { page: 1, pageSize: 8 }) });
  if (q.isLoading) return <div className="preview-list">Loading…</div>;
  if (q.isError) return <div className="preview-list error-text">{q.error.message}</div>;
  const d = q.data!;
  return (
    <div className="preview-list">
      {d.members.map((m) => `${m.platform ?? "?"} @${m.handle ?? "?"}`).join(", ")}
      {d.total > d.members.length ? ` and ${count(d.total - d.members.length)} more` : ""}
    </div>
  );
}
