import { useId } from "react";
import type { SourcingPlatform } from "../../server/sourceClient";
import { ALL_PLATFORMS, PLATFORM_LABELS, type CriteriaForm as Form, type FormProblems, type PlatformForm } from "../lib/criteria";
import { TagInput } from "./ui";

/**
 * The supported creator criteria, as the sourcing backend's request contract defines them.
 * Creator location (where the creator is based) is not audience geography, which the internal
 * API does not offer — it is never invented here.
 */
export function CriteriaFormFields({
  form,
  onChange,
  problems,
  showProblems,
  showTargetProblem,
  targetCount,
  onTargetCount,
  maxTarget,
}: {
  form: Form;
  onChange: (f: Form) => void;
  problems: FormProblems;
  showProblems: boolean;
  /** Show the count's problem even before a first attempt (it exceeds the backend's limit). */
  showTargetProblem?: boolean;
  targetCount: number | null;
  onTargetCount: (n: number | null) => void;
  maxTarget: number;
}) {
  const uid = useId();
  const err = (key: string) => (showProblems || (key === "targetCount" && showTargetProblem) ? problems[key] : undefined);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => onChange({ ...form, [k]: v });
  const togglePlatform = (p: SourcingPlatform): void => {
    const has = form.platforms.some((x) => x.platform === p);
    set("platforms", has ? form.platforms.filter((x) => x.platform !== p) : [...form.platforms, { platform: p, followersMin: "", followersMax: "", engagementMin: "", engagementMax: "" }]);
  };
  const setPlatform = (p: SourcingPlatform, patch: Partial<PlatformForm>): void => set("platforms", form.platforms.map((x) => (x.platform === p ? { ...x, ...patch } : x)));
  const field = (key: string, label: string, input: JSX.Element, hint?: string) => (
    <div className="field">
      <label htmlFor={`${uid}-${key}`}>{label}</label>
      {input}
      {hint ? <span className="hint" id={`${uid}-${key}-hint`}>{hint}</span> : null}
      {err(key) ? <span className="error">{err(key)}</span> : null}
    </div>
  );

  return (
    <div className="section">
      <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="field-label">Platforms</legend>
        <div className="row-gap">
          {ALL_PLATFORMS.map((p) => (
            <label key={p} className="inline">
              <input type="checkbox" className="checkbox" checked={form.platforms.some((x) => x.platform === p)} onChange={() => togglePlatform(p)} />
              {PLATFORM_LABELS[p]}
            </label>
          ))}
        </div>
        {err("platforms") ? <span className="error">{err("platforms")}</span> : null}
      </fieldset>

      {form.platforms.map((p) => (
        <div className="platform-block" key={p.platform}>
          <strong>{PLATFORM_LABELS[p.platform]}</strong>
          <div className="grid-4">
            {(
              [
                ["followersMin", "Min followers"],
                ["followersMax", "Max followers"],
                ["engagementMin", "Min engagement %"],
                ["engagementMax", "Max engagement %"],
              ] as const
            ).map(([k, label]) => (
              <div className="field" key={k}>
                <label htmlFor={`${uid}-${p.platform}-${k}`}>{label}</label>
                <input
                  id={`${uid}-${p.platform}-${k}`}
                  className="input"
                  inputMode={k.startsWith("followers") ? "numeric" : "decimal"}
                  value={p[k]}
                  aria-invalid={err(`${p.platform}.${k}`) ? true : undefined}
                  onChange={(e) => setPlatform(p.platform, { [k]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {(["followersMin", "followersMax", "engagementMin", "engagementMax"] as const).map((k) =>
            err(`${p.platform}.${k}`) ? (
              <span className="error" key={k}>
                {err(`${p.platform}.${k}`)}
              </span>
            ) : null,
          )}
        </div>
      ))}

      {field(
        "niche",
        "Niche / search query",
        <input id={`${uid}-niche`} className="input" value={form.niche} aria-invalid={err("niche") ? true : undefined} onChange={(e) => set("niche", e.target.value)} maxLength={150} />,
        "What the creators make content about. This is the provider search.",
      )}
      {field(
        "topicKeywords",
        "Topic keywords",
        <TagInput id={`${uid}-topicKeywords`} values={form.topicKeywords} onChange={(v) => set("topicKeywords", v)} max={12} placeholder="Type a keyword, press Enter" />,
        "Context for the fit check, not required words. Up to 12.",
      )}
      {field(
        "idealCreator",
        "Ideal creator",
        <textarea id={`${uid}-idealCreator`} className="textarea" value={form.idealCreator} maxLength={600} onChange={(e) => set("idealCreator", e.target.value)} />,
        "Content style and fit, in a sentence or two.",
      )}
      {field(
        "exclusions",
        "Fit restrictions",
        <TagInput id={`${uid}-exclusions`} values={form.exclusions} onChange={(v) => set("exclusions", v)} max={10} placeholder="e.g. medical claims" />,
        "Qualitative things to avoid. To skip specific creators, use exclusion lists instead.",
      )}
      <div className="grid-2">
        {field(
          "creatorLocations",
          "Creator location",
          <TagInput id={`${uid}-creatorLocations`} values={form.creatorLocations} onChange={(v) => set("creatorLocations", v)} max={20} placeholder="e.g. United States" />,
          "Where the creator is based (not their audience), as the provider names it.",
        )}
        {field(
          "profileLanguages",
          "Profile language",
          <TagInput id={`${uid}-profileLanguages`} values={form.profileLanguages} onChange={(v) => set("profileLanguages", v.map((x) => x.toLowerCase()))} max={20} placeholder="e.g. en" invalid={Boolean(err("profileLanguages"))} />,
          "Language codes.",
        )}
      </div>
      <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
        <legend className="field-label">Brand / product context (optional, public)</legend>
        <div className="grid-2">
          {field("brandName", "Brand", <input id={`${uid}-brandName`} className="input" value={form.brandName} maxLength={80} onChange={(e) => set("brandName", e.target.value)} />)}
          {field("brandProduct", "Product", <input id={`${uid}-brandProduct`} className="input" value={form.brandProduct} maxLength={120} onChange={(e) => set("brandProduct", e.target.value)} />)}
        </div>
        {field("brandDescription", "Description", <textarea id={`${uid}-brandDescription`} className="textarea" value={form.brandDescription} maxLength={400} onChange={(e) => set("brandDescription", e.target.value)} />)}
      </fieldset>
      {field(
        "targetCount",
        "New qualifying creators to find",
        <input
          id={`${uid}-targetCount`}
          className="input"
          style={{ maxWidth: 160 }}
          inputMode="numeric"
          value={targetCount ?? ""}
          aria-invalid={err("targetCount") ? true : undefined}
          onChange={(e) => onTargetCount(/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value === "" ? null : targetCount)}
        />,
        `Up to ${maxTarget} per search (the sourcing service’s current limit); Find more adds more later. Fewer may qualify; the list will say why.`,
      )}
    </div>
  );
}
