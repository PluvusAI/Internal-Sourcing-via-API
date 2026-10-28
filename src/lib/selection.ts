// ---------------------------------------------------------------------------
// Exclusion-list selection: explicit, stable list ids — never a saved text query
// ---------------------------------------------------------------------------
// Pure, so the picker's rules are tested without a browser:
//   - searching never selects anything;
//   - "Select all N matching lists" adds every id the search matches across ALL pages (the
//     server resolves them), and keeps everything selected before, under any other search;
//   - a list created later is never added by an earlier "select all";
//   - the header checkbox shows all / some / none of the CURRENT matching set.

export interface PickedList {
  id: string;
  name: string;
  memberCount: number;
}

export type Selection = ReadonlyMap<string, PickedList>;

export const emptySelection = (): Selection => new Map();

export function fromIds(ids: readonly string[], known: ReadonlyArray<PickedList | { id: string; name: string | null; memberCount: number }>): Selection {
  const byId = new Map(known.map((k) => [k.id, k]));
  return new Map(ids.map((id) => [id, { id, name: byId.get(id)?.name ?? "(unavailable list)", memberCount: byId.get(id)?.memberCount ?? 0 }]));
}

export function toggle(sel: Selection, list: PickedList): Selection {
  const next = new Map(sel);
  if (next.has(list.id)) next.delete(list.id);
  else next.set(list.id, list);
  return next;
}

/** Add every list of a resolved matching set. Earlier selections stay. */
export function addAll(sel: Selection, lists: readonly PickedList[]): Selection {
  const next = new Map(sel);
  for (const l of lists) next.set(l.id, l);
  return next;
}

export function removeAll(sel: Selection, ids: readonly string[]): Selection {
  const next = new Map(sel);
  for (const id of ids) next.delete(id);
  return next;
}

export type MatchState = "all" | "some" | "none";

/** How much of the current search's full matching set is selected. */
export function matchState(sel: Selection, matchingIds: readonly string[]): MatchState {
  if (matchingIds.length === 0) return "none";
  const n = matchingIds.filter((id) => sel.has(id)).length;
  return n === 0 ? "none" : n === matchingIds.length ? "all" : "some";
}

/** Ids in selection order, ready to save on the draft. */
export const selectedIds = (sel: Selection): string[] => [...sel.keys()];

export function summaryText(listCount: number, uniqueCreators: number | null): string {
  if (listCount === 0) return "No exclusion lists selected; creators from existing lists may appear again.";
  const lists = `${listCount} ${listCount === 1 ? "list" : "lists"} selected`;
  if (uniqueCreators === null) return `${lists}; counting unique creators…`;
  return `${lists}; ${uniqueCreators.toLocaleString("en-US")} unique ${uniqueCreators === 1 ? "creator" : "creators"} excluded`;
}
