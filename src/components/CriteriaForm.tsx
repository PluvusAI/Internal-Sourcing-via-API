import { cloneElement, useId, type ReactNode } from "react";
import { Building2, Camera, Globe2, Languages, MapPin, Music2, Package, Percent, Search, ShieldBan, Sparkles, Tags, UserRound, Users, Video, type LucideIcon } from "lucide-react";
import type { SourcingPlatform } from "../../server/sourceClient";
import { ALL_PLATFORMS, PLATFORM_LABELS, type CriteriaForm as Form, type FormProblems, type PlatformForm } from "../lib/criteria";
import { TagInput } from "./ui";

export const PLATFORM_ICONS: Record<SourcingPlatform, LucideIcon> = { instagram: Camera, tiktok: Music2, youtube: Video, twitter: Globe2 };
export const CRITERIA_ICONS: Record<string, LucideIcon> = { niche: Search, topicKeywords: Tags, idealCreator: UserRound, exclusions: ShieldBan, creatorLocations: MapPin, profileLanguages: Languages, brandName: Building2, brandProduct: Package, brandDescription: Building2 };

/** Supported creator criteria only; creator location is distinct from audience geography. */
export function CriteriaFormFields({ form, onChange, problems, showProblems, suggested = [], suggestion }: {
  form: Form;
  onChange: (f: Form) => void;
  problems: FormProblems;
  showProblems: boolean;
  suggested?: string[];
  suggestion?: ReactNode;
}) {
  const uid = useId();
  const err = (key: string) => showProblems ? problems[key] : undefined;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => onChange({ ...form, [k]: v });
  const togglePlatform = (platform: SourcingPlatform): void => {
    const has = form.platforms.some((x) => x.platform === platform);
    set("platforms", has ? form.platforms.filter((x) => x.platform !== platform) : [...form.platforms, { platform, followersMin: "", followersMax: "", engagementMin: "", engagementMax: "" }]);
  };
  const setPlatform = (p: SourcingPlatform, patch: Partial<PlatformForm>): void => set("platforms", form.platforms.map((x) => x.platform === p ? { ...x, ...patch } : x));
  const field = (key: string, label: string, input: JSX.Element, hint?: string, suggestionLabel = label) => {
    const issue = err(key);
    const describedBy = [hint ? `${uid}-${key}-hint` : null, issue ? `${uid}-${key}-error` : null].filter(Boolean).join(" ") || undefined;
    const control = input.type === TagInput
      ? cloneElement(input, { describedBy, invalid: Boolean(issue) })
      : cloneElement(input, { "aria-describedby": describedBy, "aria-invalid": issue ? true : undefined });
    const Icon = CRITERIA_ICONS[key] ?? Search;
    return <div className="field criteria-field">
      <div className="field-label-row">
        <label htmlFor={`${uid}-${key}`}><Icon size={15} aria-hidden />{label}</label>
        {suggested.includes(suggestionLabel) ? <span className="suggested-label"><Sparkles size={12} aria-hidden />Suggested</span> : null}
      </div>
      {control}
      {hint ? <span className="hint" id={`${uid}-${key}-hint`}>{hint}</span> : null}
      {issue ? <span className="error" id={`${uid}-${key}-error`}>{issue}</span> : null}
    </div>;
  };

  return <div className="criteria-fields">
    <fieldset className="criteria-group" aria-describedby={err("platforms") ? `${uid}-platforms-error` : undefined}>
      <legend>Platforms <span className="required-label">Required</span></legend>
      <div className="platform-options">
        {ALL_PLATFORMS.map((p) => {
          const checked = form.platforms.some((x) => x.platform === p);
          const Icon = PLATFORM_ICONS[p];
          return <label key={p} className="platform-option" data-selected={checked}>
            <Icon size={19} aria-hidden /><span>{PLATFORM_LABELS[p]}</span>
            <input type="checkbox" className="checkbox" checked={checked} onChange={() => togglePlatform(p)} />
          </label>;
        })}
      </div>
      {err("platforms") ? <span className="error-text" id={`${uid}-platforms-error`}>{err("platforms")}</span> : null}
      {form.platforms.map((p) => {
        const Icon = PLATFORM_ICONS[p.platform];
        return <div className="platform-ranges" key={p.platform}>
          <div className="range-title"><Icon size={16} aria-hidden /><strong>{PLATFORM_LABELS[p.platform]}</strong><span className="muted small">Optional ranges</span>
            {suggested.includes(`${PLATFORM_LABELS[p.platform]} followers`) ? <span className="suggested-label"><Sparkles size={12} aria-hidden />Suggested followers</span> : null}
          </div>
          <div className="grid-2">
            {([{ label: "Followers", icon: Users, keys: [["followersMin", "Min followers"], ["followersMax", "Max followers"]] }, { label: "Engagement", icon: Percent, keys: [["engagementMin", "Min engagement %"], ["engagementMax", "Max engagement %"]] }] as const).map((group) => <fieldset className="range-group" key={group.label}>
              <legend><group.icon size={14} aria-hidden />{group.label}</legend>
              <div className="range-inputs">
                {group.keys.map(([k, label], index) => <div className="field" key={k}>
                  <label htmlFor={`${uid}-${p.platform}-${k}`} className="sr-only">{label}</label>
                  <input id={`${uid}-${p.platform}-${k}`} className="input" inputMode={k.startsWith("followers") ? "numeric" : "decimal"} placeholder={index === 0 ? "Min" : "Max"} value={p[k]} aria-invalid={err(`${p.platform}.${k}`) ? true : undefined} aria-describedby={err(`${p.platform}.${k}`) ? `${uid}-${p.platform}-${k}-error` : undefined} onChange={(e) => setPlatform(p.platform, { [k]: e.target.value })} />
                </div>)}
              </div>
              {group.keys.map(([k]) => err(`${p.platform}.${k}`) ? <span className="error-text" id={`${uid}-${p.platform}-${k}-error`} key={k}>{err(`${p.platform}.${k}`)}</span> : null)}
            </fieldset>)}
          </div>
        </div>;
      })}
    </fieldset>

    {suggestion}

    <fieldset className="criteria-group">
      <legend>Content & fit</legend>
      {field("niche", "Niche / search query", <input id={`${uid}-niche`} className="input" value={form.niche} onChange={(e) => set("niche", e.target.value)} placeholder="e.g. Skincare routines" maxLength={150} />, "Required · What the creators make content about. Used to search.")}
      {field("idealCreator", "Ideal creator", <textarea id={`${uid}-idealCreator`} className="textarea" value={form.idealCreator} maxLength={600} onChange={(e) => set("idealCreator", e.target.value)} placeholder="Describe their content style and what makes them a fit." />)}
      <div className="grid-2">
        {field("topicKeywords", "Topic keywords", <TagInput id={`${uid}-topicKeywords`} values={form.topicKeywords} onChange={(v) => set("topicKeywords", v)} max={12} placeholder="Add a keyword, press Enter" />, "Fit context, not required words. Up to 12.")}
        {field("exclusions", "Fit restrictions", <TagInput id={`${uid}-exclusions`} values={form.exclusions} onChange={(v) => set("exclusions", v)} max={10} placeholder="e.g. Medical claims" />, "Content to avoid. Choose specific creators in step 2.")}
      </div>
    </fieldset>

    <fieldset className="criteria-group">
      <legend>Location & language</legend>
      <div className="grid-2">
        {field("creatorLocations", "Creator location", <TagInput id={`${uid}-creatorLocations`} values={form.creatorLocations} onChange={(v) => set("creatorLocations", v)} max={20} placeholder="e.g. United States" />, "Where the creator is based, rather than their audience.", "Creator locations")}
        {field("profileLanguages", "Profile language", <TagInput id={`${uid}-profileLanguages`} values={form.profileLanguages} onChange={(v) => set("profileLanguages", v.map((x) => x.toLowerCase()))} max={20} placeholder="e.g. en" />, "Language codes, such as en or es.", "Profile languages")}
      </div>
    </fieldset>

    <details className="brand-context" open={err("brandName") ? true : undefined}>
      <summary><Building2 size={16} aria-hidden /><span>Brand / product context</span><span className="muted small">Optional · public information</span></summary>
      <div className="stack">
        <div className="grid-2">
          {field("brandName", "Brand", <input id={`${uid}-brandName`} className="input" value={form.brandName} maxLength={80} onChange={(e) => set("brandName", e.target.value)} />)}
          {field("brandProduct", "Product", <input id={`${uid}-brandProduct`} className="input" value={form.brandProduct} maxLength={120} onChange={(e) => set("brandProduct", e.target.value)} />)}
        </div>
        {field("brandDescription", "Description", <textarea id={`${uid}-brandDescription`} className="textarea" value={form.brandDescription} maxLength={400} onChange={(e) => set("brandDescription", e.target.value)} />)}
      </div>
    </details>
  </div>;
}
