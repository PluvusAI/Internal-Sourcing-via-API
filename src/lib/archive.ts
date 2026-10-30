import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

/** Archive affects the library, detail views and which lists can be used as exclusions. */
export function useArchiveList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => api.archiveList(id, archived),
    onSuccess: async (list) => {
      // Discard reads started before this write, including reads from a just-opened archive view.
      await qc.cancelQueries({ queryKey: ["lists"] });
      await qc.cancelQueries({ queryKey: ["list", list.id] });
      qc.setQueryData(["list", list.id], list);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["lists"] }),
        qc.invalidateQueries({ queryKey: ["list"] }),
        qc.invalidateQueries({ queryKey: ["picker"] }),
        qc.invalidateQueries({ queryKey: ["picker-ids"] }),
        qc.invalidateQueries({ queryKey: ["union"] }),
      ]);
    },
  });
}
