import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { IdentityPlatform, ImportMapping, ImportReport } from "../../server/sourceClient";
import { api, ApiError } from "../api";
import { count } from "../lib/format";
import { navigate } from "../router";
import { Modal, Notice, Spinner, errorText, useDebounced } from "./ui";

const MAX_BYTES = 5 * 1024 * 1024;

const MAPPED: Array<{ key: Exclude<keyof ImportMapping, "perNetwork" | "defaultPlatform">; label: string; identity?: boolean }> = [
  { key: "platform", label: "Platform", identity: true },
  { key: "handle", label: "Handle", identity: true },
  { key: "profileUrl", label: "Profile URL", identity: true },
  { key: "providerUserId", label: "Provider ID (Influencers Club)", identity: true },
  { key: "creatorId", label: "Pluvus creator ID", identity: true },
  { key: "displayName", label: "Name" },
  { key: "email", label: "Email" },
  { key: "followers", label: "Followers" },
  { key: "engagement", label: "Engagement %" },
  { key: "location", label: "Location" },
  { key: "language", label: "Language" },
];

const PLATFORMS: Array<[IdentityPlatform, string]> = [
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["twitter", "X / Twitter"],
  ["twitch", "Twitch"],
];

/** Choose CSV → name → map identity columns → preview → confirm → open the saved list. */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const mappingKey = useDebounced(JSON.stringify(mapping), 300);

  const preview = useMutation({
    mutationFn: (v: { text: string; mapping: ImportMapping | null }) => api.previewImport(v.text, v.mapping),
    onSuccess: (r) => {
      setReport(r);
      setHeaders(r.headers);
      setMapping((cur) => cur ?? r.mapping);
      setAck(false);
    },
    onError: (err) => {
      setReport(null);
      if (err instanceof ApiError && err.code === "invalid_mapping") {
        setHeaders((err.details["headers"] as string[] | undefined) ?? headers);
        setMapping((cur) => cur ?? ((err.details["suggestedMapping"] as ImportMapping | undefined) ?? null));
      }
    },
  });

  // Re-preview whenever the mapping changes (the first preview uses the suggested mapping).
  useEffect(() => {
    // Skip the mapping the last preview already used (the suggested one, on first load).
    if (csv && mapping && JSON.stringify(report?.mapping ?? null) !== mappingKey) preview.mutate({ text: csv, mapping });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingKey]);

  const commit = useMutation({
    mutationFn: () => api.commitImport({ csv: csv!, name: name.trim(), mapping: mapping!, acknowledgePartial: ack }),
    onSuccess: ({ list }) => {
      void qc.invalidateQueries({ queryKey: ["lists"] });
      onClose();
      navigate(`/lists/${list.id}`);
    },
  });

  const onFile = async (file: File | undefined): Promise<void> => {
    setFileError(null);
    setReport(null);
    setMapping(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setFileError("The file is larger than 5 MB. Split it into smaller lists.");
    if (file.size === 0) return setFileError("The file is empty.");
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setFileError("The file could not be read.");
    }
    setFileName(file.name);
    setName((n) => n || file.name.replace(/\.(csv|tsv|txt)$/i, ""));
    setCsv(text);
    // The first preview uses the mapping the server suggests for these headers.
    preview.mutate({ text, mapping: null });
  };

  const c = report?.counts;
  const notImported = c ? c.invalid + c.ambiguous : 0;
  const canImport = Boolean(csv && mapping && report && c && c.valid > 0 && name.trim() && (!report.needsAcknowledgement || ack) && !preview.isPending);
  const problems = preview.error instanceof ApiError ? ((preview.error.details["problems"] as Array<{ field: string; message: string }> | undefined) ?? []) : [];

  return (
    <Modal
      wide
      title="Import list"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canImport || commit.isPending} onClick={() => commit.mutate()}>
            {commit.isPending ? <Spinner label="Importing" /> : null} Import {c ? count(c.valid) : ""} creators
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`${uid}-file`}>CSV file</label>
          <input id={`${uid}-file`} data-autofocus className="input" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" onChange={(e) => void onFile(e.target.files?.[0])} />
          <span className="hint">Exported from the database or Google Sheets. Up to 5 MB.</span>
          {fileError ? <span className="error">{fileError}</span> : null}
        </div>
        <div className="field">
          <label htmlFor={`${uid}-name`}>List name</label>
          <input id={`${uid}-name`} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Brand A - Existing creators" />
          <span className="hint">Include the brand or client name.</span>
        </div>
      </div>

      {csv && mapping ? (
        <section className="section">
          <div className="section-head">
            <h3>Map identity columns</h3>
            <span className="muted small">{fileName}</span>
          </div>
          <p className="muted small">A creator is identified by platform + handle or profile URL, or a stable ID. Names and emails never identify a creator; the same handle on two platforms is two creators.</p>
          <div className="grid-4">
            {MAPPED.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`${uid}-${f.key}`}>
                  {f.label}
                  {f.identity ? <span className="dim"> · identity</span> : null}
                </label>
                <select id={`${uid}-${f.key}`} className="select" value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })}>
                  <option value="">— not in file —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field">
              <label htmlFor={`${uid}-default`}>Platform for rows without one</label>
              <select id={`${uid}-default`} className="select" value={mapping.defaultPlatform ?? ""} onChange={(e) => setMapping({ ...mapping, defaultPlatform: (e.target.value || null) as IdentityPlatform | null })}>
                <option value="">— none (ask per row) —</option>
                {PLATFORMS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="inline">
            <input type="checkbox" className="checkbox" checked={mapping.perNetwork} onChange={(e) => setMapping({ ...mapping, perNetwork: e.target.checked })} />
            Also read per-platform columns (instagram_username, tiktok_link, …) as one creator per row
          </label>
          {problems.map((p) => (
            <span className="error" key={p.field}>
              {p.message}
            </span>
          ))}
        </section>
      ) : null}

      {preview.isPending ? <Spinner label="Checking rows" /> : null}
      {preview.isError && !(preview.error instanceof ApiError && preview.error.code === "invalid_mapping") ? <Notice tone="danger">{errorText(preview.error)}</Notice> : null}

      {report && c ? (
        <section className="section">
          <h3>Preview</h3>
          <div className="stats">
            <Stat label="Will be imported" value={c.valid} />
            <Stat label="Duplicates (counted once)" value={c.duplicate} />
            <Stat label="Invalid" value={c.invalid} />
            <Stat label="Ambiguous" value={c.ambiguous} />
            <Stat label="Rows in file" value={c.totalRows} />
          </div>
          {c.valid === 0 ? <Notice tone="danger">No row identifies a creator with this mapping, so nothing can be imported. Check the mapping.</Notice> : null}
          {report.rows.length > 0 ? (
            <div className="table-wrap card" style={{ maxHeight: 260, overflow: "auto", boxShadow: "none" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Result</th>
                    <th>Identity</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.row}>
                      <td className="num">{r.row}</td>
                      <td>
                        <span className={`badge ${r.status === "invalid" ? "badge-danger" : r.status === "ambiguous" ? "badge-warning" : ""}`}>{r.status === "valid" ? "valid (warning)" : r.status}</span>
                      </td>
                      <td>{r.identity}</td>
                      <td className="muted">{[r.reason, ...r.warnings].filter(Boolean).join(" ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {report.sample.length > 0 ? (
            <p className="muted small">
              First creators: {report.sample.slice(0, 6).map((s) => s.identity).join(", ")}
              {c.valid > 6 ? "…" : ""}
            </p>
          ) : null}
          {report.needsAcknowledgement && c.valid > 0 ? (
            <label className="inline notice notice-warning">
              <input type="checkbox" className="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Save the {count(c.valid)} usable creators and leave out {count(notImported)} unresolved {notImported === 1 ? "row" : "rows"}. They stay listed in this list’s import report.
            </label>
          ) : null}
        </section>
      ) : !csv ? (
        <div className="empty">
          <FileUp size={28} aria-hidden />
          <span>Choose a CSV to preview it. Nothing is saved until you import.</span>
        </div>
      ) : null}
      {commit.isError ? <Notice tone="danger">{errorText(commit.error)}</Notice> : null}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="v">{count(value)}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}
