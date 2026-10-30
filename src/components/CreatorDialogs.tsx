import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { CreatorDetailsPatch, IdentityPlatform, ListDetail, ListSummary, MemberView } from "../../server/sourceClient";
import { api, ApiError } from "../api";
import { recordListDeletion } from "../lib/archive";
import { Trash2 } from "lucide-react";
import { count } from "../lib/format";
import { refreshListData } from "../lib/listUpdates";
import { LoadingStatus, Modal, NativeSelect, Notice, Spinner, errorText, useIsMounted } from "./ui";

/** Form and confirmation flow adapted from 21st.dev/@ruixen.ui/components/table-dialog. */
export function CreatorDialog({ listId, member = null, onClose, onSaved }: { listId: string; member?: MemberView | null; onClose: () => void; onSaved: (message: string) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const mounted = useIsMounted();
  const submitting = useRef(false);
  const [method, setMethod] = useState<"url" | "handle">("url");
  const [profileUrl, setProfileUrl] = useState("");
  const [platform, setPlatform] = useState<IdentityPlatform>("instagram");
  const [handle, setHandle] = useState("");
  const [details, setDetails] = useState({ displayName: member?.displayName ?? "", email: member?.email ?? "", location: member?.location ?? "", language: member?.language ?? "" });
  const changed = Object.entries(details).some(([key, value]) => value.trim() !== (member?.[key as keyof typeof details] ?? ""));
  const save = useMutation({
    mutationFn: async () => {
      if (member) {
        const patch: CreatorDetailsPatch = {};
        for (const key of Object.keys(details) as Array<keyof typeof details>) if (details[key].trim() !== (member[key] ?? "")) patch[key] = details[key].trim() || null;
        await api.updateCreator(listId, member.id, patch);
        return "Creator details updated.";
      }
      const result = await api.addCreator(listId, { ...(method === "url" ? { profileUrl: profileUrl.trim() } : { platform, handle: handle.trim() }), ...Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) });
      return result.existing ? "This creator was already saved. The list still contains one copy; use Edit to change their details." : result.restored ? "Creator restored to this list." : "Creator added to this list.";
    },
    onSuccess: (message) => { refreshListData(qc, listId); if (mounted.current) { onSaved(message); onClose(); } },
    onSettled: () => { submitting.current = false; },
  });
  const close = (): void => { if (!submitting.current) onClose(); };
  const ready = member ? changed : method === "url" ? Boolean(profileUrl.trim()) : Boolean(handle.trim());
  const submit = (): void => { if (!ready || submitting.current) return; submitting.current = true; save.mutate(); };
  return <Modal title={member ? "Edit creator details" : "Add a creator"} onClose={close} closeDisabled={save.isPending} footer={<>
    <button type="button" className="btn" onClick={close} disabled={save.isPending}>Cancel</button>
    <button type="submit" form={`${id}-form`} className="btn btn-primary" disabled={!ready || save.isPending}>{save.isPending ? <Spinner decorative /> : null}{save.isPending ? member ? "Saving changes…" : "Adding creator…" : member ? "Save changes" : "Add creator"}</button>
  </>}>
    <form id={`${id}-form`} className="stack" onSubmit={e => { e.preventDefault(); submit(); }}>
      {member ? <Notice tone="neutral">{member.platform} @{member.handle}. To correct the profile identity, remove this creator and add the correct profile. Search history stays attached to the original identity.</Notice> : <>
        <fieldset className="identity-method"><legend className="field-label">Identify the creator</legend><div className="actions">
          <label className="inline"><input type="radio" name={`${id}-method`} checked={method === "url"} disabled={save.isPending} onChange={() => setMethod("url")} />Profile URL</label>
          <label className="inline"><input type="radio" name={`${id}-method`} checked={method === "handle"} disabled={save.isPending} onChange={() => setMethod("handle")} />Platform + handle</label>
        </div></fieldset>
        {method === "url" ? <div className="field"><label htmlFor={`${id}-url`}>Profile URL</label><input id={`${id}-url`} data-autofocus className="input" type="url" required value={profileUrl} maxLength={2048} readOnly={save.isPending} placeholder="https://www.instagram.com/creator/" onChange={e => setProfileUrl(e.target.value)} /><span className="hint">Instagram, TikTok, YouTube, X, or Twitch. Use a profile, not a post.</span></div> : <div className="grid-2">
          <div className="field"><label htmlFor={`${id}-platform`}>Platform</label><NativeSelect id={`${id}-platform`} value={platform} disabled={save.isPending} onChange={e => setPlatform(e.target.value as IdentityPlatform)}><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="twitter">X / Twitter</option><option value="twitch">Twitch</option></NativeSelect></div>
          <div className="field"><label htmlFor={`${id}-handle`}>Handle</label><input id={`${id}-handle`} data-autofocus className="input" required value={handle} maxLength={200} readOnly={save.isPending} placeholder="@creator" onChange={e => setHandle(e.target.value)} /></div>
        </div>}
        <p className="muted small">Adding a saved profile keeps one copy. No profile or contact lookup is performed.</p>
      </>}
      <div className="grid-2">{([['displayName', 'Name', 200], ['email', 'Email', 254], ['location', 'Location', 100], ['language', 'Language', 100]] as const).map(([key, label, max]) => <div className="field" key={key}><label htmlFor={`${id}-${key}`}>{label} <span className="dim">(optional)</span></label><input id={`${id}-${key}`} className="input" type={key === "email" ? "email" : "text"} value={details[key]} maxLength={max} readOnly={save.isPending} onChange={e => setDetails(cur => ({ ...cur, [key]: e.target.value }))} /></div>)}</div>
      <span className="hint">Only enter details you already have. Your edits apply to this list and its exports.</span>
    </form>
    {save.isError ? <Notice tone="danger" title="Creator could not be saved">{errorText(save.error)}</Notice> : null}
  </Modal>;
}

export function RemoveCreatorsDialog({ listId, listName, member = null, onClose, onRemoved }: { listId: string; listName: string; member?: MemberView | null; onClose: () => void; onRemoved: (message: string) => void }) {
  const qc = useQueryClient();
  const mounted = useIsMounted();
  const submitting = useRef(false);
  const selection = useQuery({ queryKey: ["remove-selection", listId], queryFn: () => api.selection(listId), enabled: !member, staleTime: 0 });
  const ids = member ? [member.id] : selection.data?.memberIds ?? [];
  const remove = useMutation({
    mutationFn: () => { if (ids.length === 0) throw new ApiError(409, "empty_scope", "No creators are selected. Close this dialog and select the rows to remove."); return api.removeCreators(listId, ids); },
    onSuccess: ({ removedCount }) => { refreshListData(qc, listId); if (mounted.current) { onRemoved(`${count(removedCount)} ${removedCount === 1 ? "creator removed" : "creators removed"} from this list.`); onClose(); } },
    onSettled: () => { submitting.current = false; },
  });
  const close = (): void => { if (!submitting.current) onClose(); };
  return <Modal title={member ? `Remove ${member.displayName ?? member.handle ?? "creator"}?` : "Remove selected creators?"} onClose={close} closeDisabled={remove.isPending} footer={<>
    <button type="button" data-autofocus className="btn" disabled={remove.isPending} onClick={close}>Keep creators</button>
    <button type="button" className="btn btn-danger" disabled={ids.length === 0 || remove.isPending || (!member && selection.isFetching)} onClick={() => { if (!submitting.current) { submitting.current = true; remove.mutate(); } }}>{remove.isPending ? <Spinner label="Removing creators" /> : null}Remove {count(ids.length)} {ids.length === 1 ? "creator" : "creators"}</button>
  </>}>
    {!member && selection.isFetching ? <LoadingStatus label="Checking selected creators" /> : !member && selection.isError ? null : <p>Remove {count(ids.length)} {ids.length === 1 ? "creator" : "creators"} from <strong>{listName}</strong>? Other lists are unaffected. Removed profiles are skipped by future searches on this list; adding a profile again restores it.</p>}
    <Notice tone="neutral">Past search results and running exclusion snapshots are kept. Future searches that exclude this list use its remaining creators.</Notice>
    {selection.isError ? <Notice tone="danger">{errorText(selection.error)}</Notice> : null}
    {remove.isError ? <Notice tone="danger">{errorText(remove.error)}</Notice> : null}
  </Modal>;
}

export function RemoveListDialog({ list, onClose, onRemoved }: { list: Pick<ListSummary, "id" | "name">; onClose: () => void; onRemoved: () => void }) {
  const qc = useQueryClient();
  const mounted = useIsMounted();
  const submitting = useRef(false);
  // Library summaries omit email jobs. Read fresh state before enabling confirmation.
  const check = useQuery({ queryKey: ["delete-list-check", list.id], queryFn: () => api.getList(list.id), retry: false, gcTime: 0, refetchOnMount: "always", refetchInterval: q => listBusy(q.state.data) ? 3000 : false });
  const ready = check.isSuccess && !check.isFetching && !listBusy(check.data);
  const remove = useMutation({ mutationFn: () => api.removeList(list.id), onSuccess: () => { recordListDeletion(qc, list.id); refreshListData(qc, list.id); if (mounted.current) { onClose(); onRemoved(); } }, onSettled: () => { submitting.current = false; } });
  const close = (): void => { if (!submitting.current) onClose(); };
  return <Modal title="Delete this list?" onClose={close} closeDisabled={remove.isPending} footer={<>
    <button type="button" data-autofocus className="btn" disabled={remove.isPending} onClick={close}>Keep list</button>
    <button type="button" className="btn btn-danger" disabled={!ready || remove.isPending} onClick={() => { if (ready && !submitting.current) { submitting.current = true; remove.mutate(); } }}>{remove.isPending ? <Spinner label="Deleting list" /> : null}Delete list</button>
  </>}>
    <p><strong>{list.name}</strong> will be deleted from active and archived lists. Creator records, past searches, and existing exclusion references are kept.</p>
    {check.isFetching ? <LoadingStatus label="Checking list status" /> : null}
    {check.isSuccess && listBusy(check.data) ? <Notice tone="neutral">Wait for the current search or email lookup to finish before deleting this list.</Notice> : null}
    {check.isError ? <Notice tone="danger">{errorText(check.error)} <button type="button" className="link-btn" onClick={() => void check.refetch()}>Try again</button></Notice> : null}
    {remove.isError ? <Notice tone="danger">{errorText(remove.error)}</Notice> : null}
  </Modal>;
}

function listBusy(list: (Pick<ListSummary, "status"> & Pick<ListDetail, "emailJob">) | undefined): boolean {
  return list?.status === "queued" || list?.status === "sourcing" || list?.emailJob?.status === "queued" || list?.emailJob?.status === "running";
}

export function RemoveListAction({ list, onRemoved }: { list: ListSummary & Pick<ListDetail, "emailJob">; onRemoved?: () => void }) {
  const [open, setOpen] = useState(false);
  const busy = listBusy(list);
  return <><button type="button" className="btn btn-sm btn-ghost btn-danger" disabled={busy} title={busy ? "Wait for the current job to finish before deleting this list" : "Delete this list"} aria-label={`Delete list ${list.name}`} onClick={() => setOpen(true)}><Trash2 size={14} aria-hidden />Delete list</button>{open ? <RemoveListDialog list={list} onClose={() => setOpen(false)} onRemoved={() => onRemoved?.()} /> : null}</>;
}
