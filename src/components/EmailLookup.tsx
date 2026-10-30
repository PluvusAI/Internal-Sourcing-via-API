import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { EmailJobView, EmailScope, MemberView } from "../../server/sourceClient";
import { api } from "../api";
import { count } from "../lib/format";
import { browserKeyStore, clearImportKey, importFingerprint, pendingImportKey } from "../lib/idempotency";
import { refreshListData } from "../lib/listUpdates";
import { Modal, Notice, Spinner, errorText } from "./ui";

export const emailJobActive = (job: EmailJobView | null | undefined): boolean => job?.status === "queued" || job?.status === "running";
const statusLabels: Record<string, string> = { not_checked: "Not checked", not_found: "Email not found", cleared: "Cleared manually", failed: "Lookup failed", blocked: "Contact blocked", blocked_uncertain: "Lookup needs review", no_account: "Profile needed", not_processed: "Not processed", pending: "Waiting", running: "Finding email", skipped: "Skipped" };
export function EmailCell({ member }: { member: MemberView }) {
  const pending = member.emailLookupStatus === "pending" || member.emailLookupStatus === "running";
  return <span className="email-cell">{member.email ? <a href={`mailto:${member.email}`}>{member.email}</a> : <span className="inline muted">{pending ? <Spinner label="Working" /> : null}{statusLabels[member.emailLookupStatus ?? "not_checked"] ?? "Not checked"}</span>}{member.email ? <span className="cell-sub">{member.emailSource === "influencers_club" ? "Found via Influencers Club" : member.emailSource === "saved_contact" ? "Saved contact" : "Provided"}</span> : null}</span>;
}
const outcomes: Record<string, string> = { credit_ceiling: "The per-search credit cap was reached.", client_credit_ceiling: "The daily credit cap was reached.", billing_uncertain: "A provider response was lost. Review its billing before retrying.", provider_unavailable: "The email provider is unavailable.", provider_error: "The provider could not complete the lookup.", auth: "The provider connection needs attention.", quota: "The provider credit or usage limit was reached.", throttled: "The provider is busy. Try remaining creators later.", runtime_ceiling: "The processing time limit was reached.", not_processed: "The job could not start within its queue time limit." };
export function EmailProgress({ job }: { job: EmailJobView }) {
  const active = emailJobActive(job);
  const done = job.total - (job.counts.pending ?? 0) - (job.counts.running ?? 0) - (job.counts.not_processed ?? 0);
  return <div className="card-pad email-progress" aria-live="polite">
    <div className="inline">{active ? <Spinner label="Finding emails" /> : null}<strong>{active ? "Finding emails" : job.status === "partial" ? "Email lookup partially finished" : "Email lookup finished"}</strong><span className="muted small">{count(done)} of {count(job.total)} processed</span></div>
    {active ? <progress aria-label="Email lookup progress" max={job.total} value={done} /> : null}
    <p className="muted small">{count((job.counts.found ?? 0) + (job.counts.reused ?? 0))} available · {count(job.counts.not_found ?? 0)} not found · {count((job.counts.failed ?? 0) + (job.counts.blocked_uncertain ?? 0))} failed or need review · {count((job.counts.skipped ?? 0) + (job.counts.cleared ?? 0) + (job.counts.blocked ?? 0) + (job.counts.no_account ?? 0))} skipped · {count(job.counts.not_processed ?? 0)} not processed · {job.creditsSpent.toFixed(2)} credits spent{job.creditsHeld > job.creditsSpent ? `; ${(job.creditsHeld - job.creditsSpent).toFixed(2)} reserved` : ""}.</p>
    {job.outcome ? <p className="muted small">{outcomes[job.outcome] ?? "Some lookups could not finish."} Saved creators and results are kept. Another lookup starts only when you request it.</p> : null}
  </div>;
}
export function FindEmailsDialog({ listId, scope, onClose }: { listId: string; scope: EmailScope | { scope: "selection" }; onClose: () => void }) {
  const qc = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const preview = useQuery({ queryKey: ["email-preview", listId, scope], queryFn: async () => {
    const exact: EmailScope = scope.scope === "selection" ? { scope: "selected", memberIds: (await api.selection(listId)).memberIds } : scope;
    return api.previewEmails(listId, exact);
  }, retry: false, staleTime: 0, refetchOnMount: "always" });
  const start = useMutation({ mutationFn: async () => {
    const p = preview.data!;
    const fingerprint = `email-${await importFingerprint(JSON.stringify({ listId, ids: [...p.memberIds].sort(), cap: p.creditCap }))}`;
    const result = await api.startEmailJob(listId, { memberIds: p.memberIds, maxCredits: p.creditCap, idempotencyKey: pendingImportKey(browserKeyStore(), fingerprint, keys.current) });
    clearImportKey(browserKeyStore(), fingerprint, keys.current);
    return result;
  }, onSuccess: ({ job }) => { qc.setQueryData(["email-job", listId], { job }); refreshListData(qc, listId); onClose(); } });
  const p = preview.isFetching || preview.isError ? undefined : preview.data;
  return <Modal title="Find creator emails" onClose={onClose} closeDisabled={start.isPending} footer={<><button type="button" className="btn" disabled={start.isPending} onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={!p || start.isPending || p.eligible + p.reusable === 0} onClick={() => start.mutate()}>{start.isPending ? <Spinner label="Working" /> : null}{start.isPending ? "Starting lookup…" : "Find emails"}</button></>}>
    {preview.isFetching ? <Spinner label="Checking saved contacts and cost" /> : null}
    {p ? <><p>Find missing emails for <strong>{count(p.total)} saved creators</strong>. This selection is fixed when you start.</p><dl className="kv"><dt>Already available</dt><dd>{count(p.available)}</dd><dt>Saved contacts to reuse</dt><dd>{count(p.reusable)} · free</dd><dt>Eligible for lookup</dt><dd>{count(p.eligible)}</dd><dt>Previously not found</dt><dd>{count(p.cachedNotFound)} · checked within 30 days</dd><dt>Skipped</dt><dd>{count(p.skipped)} · manually cleared, blocked, or missing profile</dd><dt>Estimated maximum spend</dt><dd><strong>{p.estimatedMaxCredits.toFixed(2)} credits</strong></dd><dt>Per-search credit cap</dt><dd>{p.creditCap.toFixed(2)} credits</dd><dt>Daily credits remaining</dt><dd>{p.dailyRemaining.toFixed(2)}</dd></dl><Notice tone="info">A new valid email costs 0.2 credits. A lookup with no valid email is uncharged. Supplied emails and manual clears are preserved. Creators stay on your list when no email is found.</Notice>{p.eligible * 0.2 > p.estimatedMaxCredits ? <Notice tone="neutral">The cap may leave some creators unprocessed. Saved results are kept; you can request the remaining lookups later.</Notice> : null}</> : null}
    {preview.isError ? <Notice tone="danger">{errorText(preview.error)} <button type="button" className="link-btn" onClick={() => void preview.refetch()}>Try again</button></Notice> : null}
    {start.isError ? <Notice tone="danger">{errorText(start.error)} Retry uses the same request key.</Notice> : null}
  </Modal>;
}
