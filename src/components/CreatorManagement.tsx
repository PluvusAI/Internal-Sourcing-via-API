import { api } from "../api";
import { EmailProgress, FindEmailsDialog, emailJobActive } from "./EmailLookup";
import { useCallback, useEffect, useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Plus, RefreshCw } from "lucide-react";
import type { EmailScope, ListDetail } from "../../server/sourceClient";
import { count, isActive } from "../lib/format";
import { refreshListData } from "../lib/listUpdates";
import { CreatorDialog } from "./CreatorDialogs";
import { ExportDialog } from "./Dialogs";
import { MembersTable } from "./MembersTable";
import { Notice, Spinner } from "./ui";

export function CreatorManagement({ list, onSelectionCount, onExport }: { list: ListDetail; onSelectionCount?: (n: number, total: number) => void; onExport?: (n: number, total: number) => void }) {
  const qc = useQueryClient();
  const fetchingCreators = useIsFetching({ queryKey: ["members", list.id] }) > 0;
  const [dialog, setDialog] = useState<"add" | "export" | null>(null);
  const [selection, setSelection] = useState({ n: 0, total: list.memberCount });
  const [message, setMessage] = useState("");
  const [emailScope, setEmailScope] = useState<EmailScope | { scope: "selection" } | null>(null);
  const emailQuery = useQuery({ queryKey: ["email-job", list.id], queryFn: () => api.emailJob(list.id), refetchInterval: q => emailJobActive(q.state.data?.job) ? 3000 : false, retry: false });
  const job = emailQuery.data?.job ?? list.emailJob;
  const emailBusy = emailJobActive(job);
  useEffect(() => { if (emailQuery.data?.job) refreshListData(qc, list.id); }, [emailQuery.data, qc, list.id]);
  const active = isActive(list.status);
  const editable = !active && !emailBusy && !list.archivedAt;
  const reportSelection = useCallback((n: number, total: number) => { setSelection({ n, total }); onSelectionCount?.(n, total); }, [onSelectionCount]);
  return <section className="card creator-management" aria-label="Saved creators">
    <div className="toolbar"><div><h2>Creators <span className="creator-count">{count(list.memberCount)}</span></h2><p className="muted small">{list.archivedAt ? "Saved creators are available to review and export. Restore this list to edit." : active ? "Qualified creators appear as they are saved." : `${count(list.memberCount)} saved. Add profiles you already know, edit details, or remove rows.`}</p></div><span className="toolbar-spacer" />
      <button type="button" className="btn btn-sm" disabled={!editable} title={list.archivedAt ? "Restore the list to edit creators" : active ? "Wait for the search to finish" : undefined} onClick={() => setDialog("add")}><Plus size={14} aria-hidden />Add creator</button>
      <button type="button" className="btn btn-sm" disabled={!editable || list.memberCount === 0} onClick={() => setEmailScope({ scope: "all" })}><Mail size={14} aria-hidden />Find emails</button>
      <button type="button" className="btn btn-sm btn-ghost" disabled={fetchingCreators} aria-busy={fetchingCreators} onClick={() => refreshListData(qc, list.id)}>{fetchingCreators ? <Spinner label="Refreshing creators" /> : <RefreshCw size={14} aria-hidden />}{fetchingCreators ? "Refreshing…" : "Refresh"}</button>
    </div>
    {message ? <div className="card-pad" role="status"><Notice tone="success">{message}</Notice></div> : null}
    {list.status === "draft" ? <div className="creator-edit-hint muted small">Creators you add here are already saved on this list. Your first search finds additional creators and skips these profiles.</div> : null}
    {job ? <EmailProgress job={job} /> : null}
    {emailQuery.isError ? <div className="card-pad"><Notice tone="danger">Email lookup status could not be loaded: {emailQuery.error.message}</Notice></div> : null}
    <MembersTable listId={list.id} listName={list.name} kind={list.kind} live={active} emailBusy={emailBusy} editable={editable} onFindEmails={setEmailScope} onSelectionCount={reportSelection} onExport={(n, total) => { setSelection({ n, total }); if (onExport) onExport(n, total); else setDialog("export"); }} onMessage={setMessage} />
    {emailScope ? <FindEmailsDialog listId={list.id} scope={emailScope} onClose={() => setEmailScope(null)} /> : null}
    {dialog === "add" ? <CreatorDialog listId={list.id} onClose={() => setDialog(null)} onSaved={setMessage} /> : null}
    {dialog === "export" ? <ExportDialog listId={list.id} listName={list.name} total={selection.total} selectedCount={selection.n} onClose={() => setDialog(null)} /> : null}
  </section>;
}
