// ---------------------------------------------------------------------------
// Internal sourcing API — typed server-side client (PLU-505)
// ---------------------------------------------------------------------------
// SELF-CONTAINED ON PURPOSE: no imports, standard `fetch` only. The internal sourcing app copies
// this one file into its BACKEND (Pluvus/Internal-Sourcing-via-API, server/sourceClient.ts) and uses it as is.
// It must never be bundled into browser code — it holds the internal app's service key.
//
//   const source = internalSourcingClientFromEnv(process.env); // SOURCING_API_BASE_URL + SOURCING_INTERNAL_APP_API_KEY
//   const page = await source.searchLists({ q: "Brand A" });
//
// Contract: docs/internal-sourcing-api.md. The types below are a hand-kept copy of
// server/src/internalSourcing/contract.ts; routes/internalSourcing.db.test.ts fails to compile if
// they drift.

export type SourcingPlatform = "instagram" | "tiktok" | "youtube" | "twitter";
export type IdentityPlatform = SourcingPlatform | "twitch";
export type ListStatus = "imported" | "draft" | "queued" | "sourcing" | "complete" | "partial" | "empty" | "failed";
export type OperationStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type OutcomeCode =
  | "target_reached"
  | "search_exhausted"
  | "credit_ceiling"
  | "client_credit_ceiling"
  | "candidate_ceiling"
  | "evaluation_ceiling"
  | "runtime_ceiling"
  | "provider_unavailable"
  | "evaluation_unavailable"
  | "not_processed"
  | "internal_error";

type Range = { min?: number | null | undefined; max?: number | null | undefined };

/** Draft criteria as a list stores them: every field optional until a search starts. */
export interface DraftCriteria {
  platforms?: Array<{ platform: SourcingPlatform; followers?: Range | null | undefined; engagementPercent?: Range | null | undefined }> | undefined;
  niche?: string | null | undefined;
  topicKeywords?: string[] | undefined;
  idealCreator?: string | null | undefined;
  /** Qualitative fit restrictions ("no medical claims"), never creator handles. */
  exclusions?: string[] | undefined;
  /** Where the creator is based (not their audience), as the provider's dictionary names it. */
  creatorLocations?: string[] | undefined;
  profileLanguages?: string[] | undefined;
  brand?: { name?: string | null | undefined; product?: string | null | undefined; description?: string | null | undefined } | null | undefined;
}

export interface LatestOperationSummary {
  id: string;
  kind: "initial" | "find_more";
  status: OperationStatus;
  targetCount: number;
  admittedCount: number;
}

export interface ListSummary {
  id: string;
  name: string;
  kind: "imported" | "sourced";
  status: ListStatus;
  memberCount: number;
  eligibleForExclusion: boolean;
  latestOperation: LatestOperationSummary | null;
  derivedFromListId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExcludedListRef {
  id: string;
  name: string | null;
  kind: "imported" | "sourced" | null;
  status: ListStatus | null;
  memberCount: number;
  archived: boolean;
  missing: boolean;
}

export interface OperationOutcome {
  code: OutcomeCode;
  message: string;
}

export interface OperationCounters {
  excluded: number;
  duplicates: number;
  considered: number;
}

export interface OperationView {
  id: string;
  kind: "initial" | "find_more";
  status: OperationStatus;
  listStatus: ListStatus;
  targetCount: number;
  admittedCount: number;
  excludedLists: Array<{ id: string; name: string; memberCount: number }>;
  excludedCreatorCount: number;
  ownMemberCount: number;
  outcome: OperationOutcome | null;
  counters: OperationCounters;
  criteria: unknown;
  pollAfterSeconds: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportMapping {
  platform: string | null;
  handle: string | null;
  profileUrl: string | null;
  providerUserId: string | null;
  creatorId: string | null;
  displayName: string | null;
  email: string | null;
  followers: string | null;
  engagement: string | null;
  location: string | null;
  language: string | null;
  perNetwork: boolean;
  defaultPlatform: IdentityPlatform | null;
}

export type ImportRowStatus = "valid" | "duplicate" | "invalid" | "ambiguous";

export interface ImportCounts {
  totalRows: number;
  valid: number;
  duplicate: number;
  invalid: number;
  ambiguous: number;
  withWarnings: number;
}

export interface ImportReportRow {
  row: number;
  status: ImportRowStatus;
  reason: string | null;
  warnings: string[];
  identity: string;
}

export interface ImportReport {
  headers: string[];
  delimiter: string;
  mapping: ImportMapping;
  counts: ImportCounts;
  rows: ImportReportRow[];
  needsAcknowledgement: boolean;
  sample: Array<{ row: number; identity: string; displayName: string | null; email: string | null }>;
}

export interface ImportReportView {
  counts: ImportCounts;
  rows: ImportReportRow[];
  mapping: ImportMapping;
  headers: string[];
}

export interface ListDetail extends ListSummary {
  criteria: DraftCriteria | null;
  targetCount: number | null;
  excludedListIds: string[];
  excludedLists: ExcludedListRef[];
  criteriaLocked: boolean;
  draftRevision: number;
  importReport: ImportReportView | null;
  operations: OperationView[];
  activeOperationId: string | null;
  emailJob?: EmailJobView | null;
}

export interface MemberAccount {
  platform: string;
  handle: string;
  link: string | null;
  followers: number | null;
  engagementPercent: number | null;
}

export interface MemberView {
  id: string;
  source: "import" | "sourced";
  operationId: string | null;
  platform: string | null;
  handle: string | null;
  profileUrl: string | null;
  displayName: string | null;
  followers: number | null;
  engagementPercent: number | null;
  pictureUrl: string | null;
  reason: string | null;
  email: string | null;
  emailLookupStatus?: string;
  emailSource?: string | null;
  emailCheckedAt?: string | null;
  location: string | null;
  language: string | null;
  accounts: MemberAccount[];
  selected: boolean;
  importRow: number | null;
  createdAt: string;
}

export interface MemberPage {
  members: MemberView[];
  total: number;
  selectedCount: number;
  page: number;
  pageSize: number;
}

export interface ExclusionPreview {
  lists: ExcludedListRef[];
  uniqueCreatorCount: number;
  memberCount: number;
}

export interface ListSearchPage {
  q: string;
  page: number;
  pageSize: number;
  total: number;
  /** For an eligible-only search: lists the same search matches that cannot be excluded yet. */
  matchingNotEligible: number;
  lists: ListSummary[];
}

/** Every list a search matches, across all pages: what "Select all N matching lists" captures. */
export interface MatchingLists {
  q: string;
  ids: string[];
  total: number;
  lists: Array<{ id: string; name: string; memberCount: number }>;
}

export interface InternalSuggestion {
  ok: boolean;
  message: string | null;
  suggestion: {
    niche: string | null;
    topicKeywords: string[];
    idealCreator: string | null;
    exclusions: string[];
    creatorLocations: string[];
    profileLanguages: string[];
    followerRanges: Partial<Record<SourcingPlatform, { min: number | null; max: number | null }>>;
    reasons: Partial<Record<"niche" | "idealCreator", string>>;
  };
}

export interface SourceMeta {
  workspace: string;
  maxTargetCount: number;
  platforms: SourcingPlatform[];
  exportFormats: Record<"default" | "sheets", { headers: string[]; filled: string[] }>;
}

export type ExportFormat = "default" | "sheets";
export type ExportRequest = { format: ExportFormat; scope: "all" } | { format: ExportFormat; scope: "selected"; memberIds: string[] };
export interface CreatorDetailsPatch { displayName?: string | null; email?: string | null; location?: string | null; language?: string | null }
export interface CreatorInput extends CreatorDetailsPatch { platform?: IdentityPlatform | null; handle?: string; profileUrl?: string }


export type EmailScope = { scope: "all" } | { scope: "selected"; memberIds: string[] };
export interface EmailPreview {
  memberIds: string[]; total: number; available: number; reusable: number; eligible: number;
  skipped: number; cachedNotFound: number; estimatedMaxCredits: number; creditCap: number; dailyRemaining: number;
}
export interface EmailJobView {
  id: string; status: "queued" | "running" | "completed" | "partial"; outcome: string | null;
  counts: Record<string, number>; total: number; creditsSpent: number; creditsHeld: number; creditCap: number;
  createdAt: string; completedAt: string | null; pollAfterSeconds: number | null;
}

export class InternalSourcingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "InternalSourcingApiError";
  }
}

export interface InternalSourcingClientOptions {
  /** Origin of the sourcing backend, https (http only for localhost). */
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Attribution for writes: an opaque id of the signed-in internal user. Never authorization. */
export interface Actor {
  userRef?: string | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function originOf(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("SOURCING_API_BASE_URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) throw new Error("SOURCING_API_BASE_URL must use https");
  if (url.username || url.password) throw new Error("SOURCING_API_BASE_URL must not contain credentials");
  return url.origin;
}

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export function createInternalSourcingClient(options: InternalSourcingClientOptions) {
  const origin = originOf(options.baseUrl);
  const apiKey = options.apiKey.trim();
  if (apiKey === "") throw new Error("SOURCING_INTERNAL_APP_API_KEY is not set");
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const base = "/api/v1/internal-sourcing";

  async function send(method: string, path: string, body: unknown, headers: Record<string, string>): Promise<Response> {
    try {
      return await doFetch(`${origin}${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Never follow a redirect: the key must not be replayed to wherever it points.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // No cause attached: nothing about the request, least of all its headers, leaks into logs.
      throw new InternalSourcingApiError(0, "upstream_unavailable", "The sourcing service could not be reached.");
    }
  }

  async function failure(res: Response): Promise<never> {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const err = (parsed as { error?: unknown } | null)?.error;
    const fields = err !== null && typeof err === "object" ? (err as Record<string, unknown>) : {};
    const { code, message, ...details } = fields;
    throw new InternalSourcingApiError(
      res.status,
      typeof code === "string" ? code : res.status >= 500 ? "upstream_unavailable" : "unexpected_response",
      typeof message === "string" ? message : `The sourcing service answered ${res.status}.`,
      details,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }

  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await send(method, path, body, headers);
    if (!res.ok) return failure(res);
    try {
      return (await res.json()) as T;
    } catch {
      throw new InternalSourcingApiError(res.status, "unexpected_response", "The sourcing service sent an unreadable answer.");
    }
  }

  const actorHeaders = (actor?: Actor): Record<string, string> => (actor?.userRef ? { "X-Internal-User": actor.userRef } : {});
  const id = (v: string): string => encodeURIComponent(v);

  return {
    meta: () => call<SourceMeta>("GET", "/meta"),
    searchLists: (p: { q?: string; page?: number; pageSize?: number; eligible?: boolean; includeArchived?: boolean; archivedOnly?: boolean } = {}) =>
      call<ListSearchPage>("GET", `/lists${qs({ q: p.q, page: p.page, pageSize: p.pageSize, eligible: p.eligible, includeArchived: p.includeArchived, archivedOnly: p.archivedOnly })}`),
    /** Every id the same search matches across all pages (what "Select all N matching lists" captures). */
    matchingListIds: (p: { q?: string; eligible?: boolean } = {}) => call<MatchingLists>("GET", `/lists/matching-ids${qs({ q: p.q, eligible: p.eligible })}`),
    createList: (
      body: { name: string; deriveFromListId?: string; criteria?: DraftCriteria; targetCount?: number | null; excludedListIds?: string[] },
      actor?: Actor,
    ) => call<ListDetail>("POST", "/lists", body, actorHeaders(actor)),
    getList: (listId: string) => call<ListDetail>("GET", `/lists/${id(listId)}`),
    updateList: (
      listId: string,
      patch: { name?: string; criteria?: DraftCriteria; targetCount?: number | null; excludedListIds?: string[]; baseRevision?: number },
      actor?: Actor,
    ) => call<ListDetail>("PATCH", `/lists/${id(listId)}`, patch, actorHeaders(actor)),
    archiveList: (listId: string, archived: boolean, actor?: Actor) => call<ListDetail>("POST", `/lists/${id(listId)}/archive`, { archived }, actorHeaders(actor)),
    removeList: (listId: string, actor?: Actor) => call<{ removed: boolean }>("DELETE", `/lists/${id(listId)}`, undefined, actorHeaders(actor)),
    addCreator: (listId: string, body: CreatorInput, actor?: Actor) => call<{ member: MemberView; existing: boolean; restored: boolean }>("POST", `/lists/${id(listId)}/members`, body, actorHeaders(actor)),
    updateCreator: (listId: string, memberId: string, body: CreatorDetailsPatch, actor?: Actor) => call<{ member: MemberView }>("PATCH", `/lists/${id(listId)}/members/${id(memberId)}`, body, actorHeaders(actor)),
    removeCreators: (listId: string, memberIds: string[], actor?: Actor) => call<{ removedCount: number }>("DELETE", `/lists/${id(listId)}/members`, { memberIds }, actorHeaders(actor)),
    members: (listId: string, p: { page?: number; pageSize?: number } = {}) => call<MemberPage>("GET", `/lists/${id(listId)}/members${qs({ page: p.page, pageSize: p.pageSize })}`),
    selection: (listId: string) => call<{ memberIds: string[]; selectedCount: number }>("GET", `/lists/${id(listId)}/selection`),
    setSelection: (listId: string, body: { selected: boolean; all: true } | { selected: boolean; memberIds: string[] }) =>
      call<{ selectedCount: number }>("PUT", `/lists/${id(listId)}/selection`, body),
    /** Start a search (HTTP 202). Retry with the SAME idempotency key after any failure; a new key is a new search. */
    startOperation: (listId: string, p: { idempotencyKey: string; kind: "initial" | "find_more"; targetCount?: number; baseRevision?: number }, actor?: Actor) => {
      const { idempotencyKey, ...body } = p;
      return call<{ operation: OperationView; idempotentReplay: boolean }>("POST", `/lists/${id(listId)}/operations`, body, { "Idempotency-Key": idempotencyKey, ...actorHeaders(actor) });
    },
    previewEmails: (listId: string, scope: EmailScope) => call<EmailPreview>("POST", `/lists/${id(listId)}/email-jobs/preview`, scope),
    startEmailJob: (listId: string, p: { memberIds: string[]; maxCredits: number; idempotencyKey: string }, actor?: Actor) => {
      const { idempotencyKey, ...body } = p;
      return call<{ job: EmailJobView; idempotentReplay: boolean }>("POST", `/lists/${id(listId)}/email-jobs`, body, { "Idempotency-Key": idempotencyKey, ...actorHeaders(actor) });
    },
    emailJob: (listId: string, jobId?: string) => call<{ job: EmailJobView | null }>("GET", `/lists/${id(listId)}/email-jobs${jobId ? `/${id(jobId)}` : ""}`),
    /** Reading never starts work and never spends. */
    getOperation: (listId: string, operationId: string) => call<{ operation: OperationView; memberCount: number }>("GET", `/lists/${id(listId)}/operations/${id(operationId)}`),
    /** The CSV text, the row count the source wrote, and its suggested file name. Never runs a search. */
    async exportList(listId: string, body: ExportRequest): Promise<{ csv: string; count: number; filename: string }> {
      const res = await send("POST", `/lists/${id(listId)}/export`, body, {});
      if (!res.ok) return failure(res);
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "creators.csv";
      return { csv: await res.text(), count: Number(res.headers.get("x-export-count") ?? "0"), filename };
    },
    previewExclusions: (listIds: string[]) => call<ExclusionPreview>("POST", "/exclusions/preview", { listIds }),
    previewImport: (csv: string, mapping?: ImportMapping | null) => call<ImportReport>("POST", "/imports/preview", { csv, mapping: mapping ?? null }),
    commitImport: (body: { csv: string; name: string; mapping: ImportMapping; acknowledgePartial?: boolean }, actor?: Actor, idempotencyKey?: string) =>
      call<{ list: ListDetail; report: ImportReport; idempotentReplay?: boolean }>("POST", "/imports", body, {
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...actorHeaders(actor),
      }),
    suggestCriteria: (body: { brief: string; brandName?: string; product?: string; platforms: SourcingPlatform[] }) => call<InternalSuggestion>("POST", "/criteria/suggest", body),
  };
}

export type InternalSourcingClient = ReturnType<typeof createInternalSourcingClient>;

/** Build the client from the two variables the internal app's backend configures. Throws when either is missing. */
export function internalSourcingClientFromEnv(
  env: Record<string, string | undefined>,
  overrides: Partial<Pick<InternalSourcingClientOptions, "fetchImpl" | "timeoutMs">> = {},
): InternalSourcingClient {
  const baseUrl = (env["SOURCING_API_BASE_URL"] ?? "").trim();
  if (baseUrl === "") throw new Error("SOURCING_API_BASE_URL is not set");
  return createInternalSourcingClient({ baseUrl, apiKey: env["SOURCING_INTERNAL_APP_API_KEY"] ?? "", ...overrides });
}
