import type { DraftCriteria, InternalSuggestion, SourcingPlatform } from "../../server/sourceClient";

// ---------------------------------------------------------------------------
// The criteria form: draft ⇄ form state, client-side hints, and suggestion merging
// ---------------------------------------------------------------------------
// Pure. The sourcing backend is the authority on what is valid (it validates again when a search
// starts); these hints only stop obvious mistakes early. A suggestion fills EMPTY fields only;
// a value the user typed is never replaced — a differing suggestion is offered for them to apply.

export const PLATFORM_LABELS: Record<SourcingPlatform, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", twitter: "X / Twitter" };
export const ALL_PLATFORMS: SourcingPlatform[] = ["instagram", "tiktok", "youtube", "twitter"];

export interface PlatformForm {
  platform: SourcingPlatform;
  followersMin: string;
  followersMax: string;
  engagementMin: string;
  engagementMax: string;
}

export interface CriteriaForm {
  platforms: PlatformForm[];
  niche: string;
  topicKeywords: string[];
  idealCreator: string;
  exclusions: string[];
  creatorLocations: string[];
  profileLanguages: string[];
  brandName: string;
  brandProduct: string;
  brandDescription: string;
}

const s = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v : "");

export function formFromDraft(d: DraftCriteria | null | undefined): CriteriaForm {
  return {
    platforms: (d?.platforms ?? []).map((p) => ({
      platform: p.platform,
      followersMin: s(p.followers?.min),
      followersMax: s(p.followers?.max),
      engagementMin: s(p.engagementPercent?.min),
      engagementMax: s(p.engagementPercent?.max),
    })),
    niche: d?.niche ?? "",
    topicKeywords: [...(d?.topicKeywords ?? [])],
    idealCreator: d?.idealCreator ?? "",
    exclusions: [...(d?.exclusions ?? [])],
    creatorLocations: [...(d?.creatorLocations ?? [])],
    profileLanguages: [...(d?.profileLanguages ?? [])],
    brandName: d?.brand?.name ?? "",
    brandProduct: d?.brand?.product ?? "",
    brandDescription: d?.brand?.description ?? "",
  };
}

const int = (v: string): number | null => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);
const pct = (v: string): number | null => (v.trim() !== "" && Number.isFinite(Number(v.trim())) ? Number(v.trim()) : null);
const range = (min: number | null, max: number | null) => (min === null && max === null ? null : { min, max });
const text = (v: string): string | null => (v.trim() ? v.trim() : null);

export function draftFromForm(f: CriteriaForm): DraftCriteria {
  const brandName = text(f.brandName);
  return {
    platforms: f.platforms.map((p) => ({
      platform: p.platform,
      followers: range(int(p.followersMin), int(p.followersMax)),
      engagementPercent: range(pct(p.engagementMin), pct(p.engagementMax)),
    })),
    niche: text(f.niche),
    topicKeywords: f.topicKeywords,
    idealCreator: text(f.idealCreator),
    exclusions: f.exclusions,
    creatorLocations: f.creatorLocations,
    profileLanguages: f.profileLanguages,
    brand: brandName || text(f.brandProduct) || text(f.brandDescription) ? { name: brandName, product: text(f.brandProduct), description: text(f.brandDescription) } : null,
  };
}

export type FormProblems = Partial<Record<string, string>>;

/** Obvious problems that would make the backend refuse the search. Empty when it can start. */
export function formProblems(f: CriteriaForm, targetCount: number | null, maxTarget: number): FormProblems {
  const out: FormProblems = {};
  if (f.platforms.length === 0) out["platforms"] = "Choose at least one platform.";
  for (const p of f.platforms) {
    const label = PLATFORM_LABELS[p.platform];
    for (const [k, v] of [["followersMin", p.followersMin], ["followersMax", p.followersMax]] as const) {
      if (v.trim() && int(v) === null) out[`${p.platform}.${k}`] = `${label}: followers must be a whole number.`;
    }
    const fmin = int(p.followersMin);
    const fmax = int(p.followersMax);
    if (fmin !== null && fmax !== null && fmin > fmax) out[`${p.platform}.followersMax`] = `${label}: the maximum is below the minimum.`;
    for (const [k, v] of [["engagementMin", p.engagementMin], ["engagementMax", p.engagementMax]] as const) {
      const n = pct(v);
      if (v.trim() && (n === null || n < 0 || n > 100)) out[`${p.platform}.${k}`] = `${label}: engagement is a percentage from 0 to 100.`;
    }
    const emin = pct(p.engagementMin);
    const emax = pct(p.engagementMax);
    if (emin !== null && emax !== null && emin > emax) out[`${p.platform}.engagementMax`] = `${label}: the maximum is below the minimum.`;
  }
  const niche = f.niche.trim();
  if (niche.length < 3) out["niche"] = "Describe the niche in at least 3 characters.";
  else if (niche.length > 150) out["niche"] = "Keep the niche under 150 characters.";
  if (f.topicKeywords.length > 12) out["topicKeywords"] = "At most 12 topic keywords.";
  if (f.idealCreator.length > 600) out["idealCreator"] = "Keep the description under 600 characters.";
  if (f.exclusions.length > 10) out["exclusions"] = "At most 10 fit restrictions.";
  if (f.creatorLocations.length > 20) out["creatorLocations"] = "At most 20 locations.";
  if (f.profileLanguages.some((l) => !/^[a-z]{2,3}$/.test(l))) out["profileLanguages"] = "Use language codes such as en or es.";
  if ((f.brandProduct.trim() || f.brandDescription.trim()) && !f.brandName.trim()) out["brandName"] = "Name the brand when giving product context.";
  if (targetCount === null || !Number.isInteger(targetCount) || targetCount < 1) out["targetCount"] = "Say how many new creators to find.";
  else if (targetCount > maxTarget) out["targetCount"] = `At most ${maxTarget} at a time.`;
  return out;
}

export interface PendingSuggestion {
  field: "niche" | "idealCreator" | "topicKeywords" | "exclusions" | "creatorLocations" | "profileLanguages";
  label: string;
  value: string | string[];
}

const FIELD_LABELS: Record<PendingSuggestion["field"], string> = {
  niche: "Niche / search query",
  idealCreator: "Ideal creator",
  topicKeywords: "Topic keywords",
  exclusions: "Fit restrictions",
  creatorLocations: "Creator locations",
  profileLanguages: "Profile languages",
};

/**
 * Merge a suggestion into the form: each EMPTY field takes the suggested value; a field the user
 * already filled keeps its value and the differing suggestion comes back as `pending`, to apply
 * explicitly. Follower ranges fill only platforms already chosen whose range is empty. Nothing
 * here touches the exclusion lists or starts a search.
 */
export function applySuggestion(f: CriteriaForm, sug: InternalSuggestion["suggestion"]): { form: CriteriaForm; filled: string[]; pending: PendingSuggestion[] } {
  const form: CriteriaForm = { ...f, platforms: f.platforms.map((p) => ({ ...p })) };
  const filled: string[] = [];
  const pending: PendingSuggestion[] = [];
  const scalar = (field: "niche" | "idealCreator", value: string | null): void => {
    if (!value) return;
    if (!form[field].trim()) {
      form[field] = value;
      filled.push(FIELD_LABELS[field]);
    } else if (form[field].trim() !== value.trim()) pending.push({ field, label: FIELD_LABELS[field], value });
  };
  const many = (field: "topicKeywords" | "exclusions" | "creatorLocations" | "profileLanguages", value: string[]): void => {
    if (value.length === 0) return;
    if (form[field].length === 0) {
      form[field] = [...value];
      filled.push(FIELD_LABELS[field]);
    } else if (value.some((v) => !form[field].includes(v))) pending.push({ field, label: FIELD_LABELS[field], value });
  };
  scalar("niche", sug.niche);
  scalar("idealCreator", sug.idealCreator);
  many("topicKeywords", sug.topicKeywords);
  many("exclusions", sug.exclusions);
  many("creatorLocations", sug.creatorLocations);
  many("profileLanguages", sug.profileLanguages);
  for (const p of form.platforms) {
    const r = sug.followerRanges[p.platform];
    if (r && !p.followersMin.trim() && !p.followersMax.trim()) {
      p.followersMin = r.min === null ? "" : String(r.min);
      p.followersMax = r.max === null ? "" : String(r.max);
      filled.push(`${PLATFORM_LABELS[p.platform]} followers`);
    }
  }
  return { form, filled, pending };
}

/** Apply one pending suggestion the user chose. */
export function applyPending(f: CriteriaForm, p: PendingSuggestion): CriteriaForm {
  return { ...f, [p.field]: Array.isArray(p.value) ? [...p.value] : p.value };
}

/** One line describing the criteria, for the list header. */
export function criteriaSummary(d: DraftCriteria | null | undefined): string {
  if (!d) return "No criteria yet";
  const parts: string[] = [];
  if (d.niche) parts.push(`“${d.niche}”`);
  const platforms = (d.platforms ?? []).map((p) => {
    const f = p.followers;
    const fol = f && (f.min != null || f.max != null) ? ` ${f.min != null ? compact(f.min) : "0"}–${f.max != null ? compact(f.max) : "∞"}` : "";
    return `${PLATFORM_LABELS[p.platform]}${fol}`;
  });
  if (platforms.length) parts.push(platforms.join(", "));
  if (d.creatorLocations?.length) parts.push(`based in ${d.creatorLocations.join(", ")}`);
  if (d.profileLanguages?.length) parts.push(d.profileLanguages.join("/"));
  return parts.join(" · ") || "No criteria yet";
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
