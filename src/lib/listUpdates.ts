import type { QueryClient } from "@tanstack/react-query";

/** Membership edits also change exclusion previews and library/picker counts. */
export function refreshListData(qc: QueryClient, listId: string): void {
  for (const queryKey of [["list"], ["lists"], ["members", listId], ["picker"], ["picker-ids"], ["union"], ["remove-selection", listId]]) {
    void qc.invalidateQueries({ queryKey });
  }
}
