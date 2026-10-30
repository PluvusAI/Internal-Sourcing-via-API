import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export const ARCHIVE_FEEDBACK_KEY = ["archive-feedback"] as const;
export interface ArchiveFeedbackState { id: string; name: string; archived: boolean }
export function clearArchiveFeedback(qc: QueryClient, listId: string): void {
  if (qc.getQueryData<ArchiveFeedbackState | null>(ARCHIVE_FEEDBACK_KEY)?.id === listId) qc.setQueryData(ARCHIVE_FEEDBACK_KEY, null);
}

/** Archive affects the library, detail views and which lists can be used as exclusions. */
export function useArchiveList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.archiveList(id, archived),
    onSuccess: async (list) => {
      qc.setQueryData<ArchiveFeedbackState>(ARCHIVE_FEEDBACK_KEY, { id: list.id, name: list.name, archived: Boolean(list.archivedAt) });
      // Discard reads started before this write, including reads from a just-opened archive view.
      await qc.cancelQueries({ queryKey: ["lists"] });
      await qc.cancelQueries({ queryKey: ["list", list.id] });
      qc.setQueryData(["list", list.id], list);
      // The write is complete. A slow library refresh must not keep Undo unavailable.
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["lists"] }),
        qc.invalidateQueries({ queryKey: ["list"] }),
        qc.invalidateQueries({ queryKey: ["picker"] }),
        qc.invalidateQueries({ queryKey: ["picker-ids"] }),
        qc.invalidateQueries({ queryKey: ["union"] }),
      ]).catch(() => undefined);
    },
  });
}
