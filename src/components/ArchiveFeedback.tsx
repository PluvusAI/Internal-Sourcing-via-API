import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Undo2, X } from "lucide-react";
import { ARCHIVE_FEEDBACK_KEY, type ArchiveFeedbackState, useArchiveList } from "../lib/archive";
import { linkHandler } from "../router";
import { Notice, Spinner } from "./ui";

/** Lives above the routes so archiving from a detail page keeps its Undo after navigation. */
export function ArchiveFeedback() {
  const qc = useQueryClient();
  const feedback = useQuery<ArchiveFeedbackState | null>({ queryKey: ARCHIVE_FEEDBACK_KEY, queryFn: async () => null, initialData: null, enabled: false, staleTime: Infinity, gcTime: Infinity });
  const archive = useArchiveList();
  const value = feedback.data;
  if (!value) return null;
  const href = value.archived ? "/?archived=1" : "/";
  return <div className="archive-feedback" aria-label="List archive notification">
    <span role="status"><strong>{value.name}</strong> {value.archived ? "moved to archive." : "restored to active lists."}</span>
    <div className="actions">
      {value.archived ? <button type="button" className="btn btn-sm" disabled={archive.isPending} onClick={() => archive.mutate({ id: value.id, archived: false })}>{archive.isPending ? <Spinner decorative /> : <Undo2 size={14} aria-hidden />}Undo archive</button> : null}
      <a className="btn btn-sm btn-ghost" href={href} onClick={linkHandler(href)}>{value.archived ? <Archive size={14} aria-hidden /> : null}{value.archived ? "View archive" : "View active lists"}</a>
      <button type="button" className="btn btn-sm btn-ghost" disabled={archive.isPending} onClick={() => qc.setQueryData(ARCHIVE_FEEDBACK_KEY, null)} aria-label="Dismiss archive notification"><X size={14} aria-hidden /></button>
    </div>
    {archive.isError ? <Notice tone="danger">{archive.error.message}</Notice> : null}
  </div>;
}
