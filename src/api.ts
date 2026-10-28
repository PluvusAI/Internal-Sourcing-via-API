import type {
  DraftCriteria,
  ExclusionPreview,
  ExportRequest,
  ImportMapping,
  ImportReport,
  InternalSuggestion,
  ListDetail,
  ListSearchPage,
  MatchingLists,
  MemberPage,
  OperationView,
  SourceMeta,
  SourcingPlatform,
} from "../server/sourceClient";

// ---------------------------------------------------------------------------
// The browser's only API: this app's own server (/api). Types are imported from the server's
// typed client as TYPES ONLY — erased at build time, so no server code reaches the bundle.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
export const setTokenGetter = (fn: TokenGetter): void => {
  getToken = fn;
};

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the app server. Check your connection and try again.");
  }
  if (res.ok) return res;
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const err = ((parsed as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<string, unknown>;
  const { code, message, ...details } = err;
  throw new ApiError(res.status, typeof code === "string" ? code : "unexpected_response", typeof message === "string" ? message : `The server answered ${res.status}.`, details);
}

const json = async <T,>(method: string, path: string, body?: unknown): Promise<T> => (await send(method, path, body)).json() as Promise<T>;

const qs = (p: Record<string, string | number | boolean | undefined>): string => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && v !== false) u.set(k, v === true ? "1" : String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};

export interface SessionConfig {
  sourceMode: "live" | "mock";
  authMode: "clerk" | "dev";
  setupProblems: string[];
}

export const api = {
  sessionConfig: () => json<SessionConfig>("GET", "/session/config"),
  session: () => json<{ user: { userId: string }; sourceMode: string; authMode: string }>("GET", "/session"),
  meta: () => json<SourceMeta>("GET", "/meta"),
  searchLists: (p: { q?: string; page?: number; pageSize?: number; eligible?: boolean; includeArchived?: boolean }) => json<ListSearchPage>("GET", `/lists${qs(p)}`),
  matchingListIds: (p: { q?: string; eligible?: boolean }) => json<MatchingLists>("GET", `/lists/matching-ids${qs(p)}`),
  createList: (body: { name: string; deriveFromListId?: string; criteria?: DraftCriteria; targetCount?: number | null; excludedListIds?: string[] }) => json<ListDetail>("POST", "/lists", body),
  getList: (id: string) => json<ListDetail>("GET", `/lists/${id}`),
  updateList: (id: string, patch: { name?: string; criteria?: DraftCriteria; targetCount?: number | null; excludedListIds?: string[]; baseRevision?: number }) =>
    json<ListDetail>("PATCH", `/lists/${id}`, patch),
  archiveList: (id: string, archived: boolean) => json<ListDetail>("POST", `/lists/${id}/archive`, { archived }),
  members: (id: string, p: { page?: number; pageSize?: number }) => json<MemberPage>("GET", `/lists/${id}/members${qs(p)}`),
  selection: (id: string) => json<{ memberIds: string[]; selectedCount: number }>("GET", `/lists/${id}/selection`),
  setSelection: (id: string, body: { selected: boolean; all: true } | { selected: boolean; memberIds: string[] }) => json<{ selectedCount: number }>("PUT", `/lists/${id}/selection`, body),
  startOperation: (id: string, body: { idempotencyKey: string; kind: "initial" | "find_more"; targetCount?: number; baseRevision?: number }) =>
    json<{ operation: OperationView; idempotentReplay: boolean }>("POST", `/lists/${id}/operations`, body),
  previewExclusions: (listIds: string[]) => json<ExclusionPreview>("POST", "/exclusions/preview", { listIds }),
  previewImport: (csv: string, mapping: ImportMapping | null) => json<ImportReport>("POST", "/imports/preview", { csv, mapping }),
  commitImport: (body: { csv: string; name: string; mapping: ImportMapping; acknowledgePartial: boolean }) => json<{ list: ListDetail; report: ImportReport }>("POST", "/imports", body),
  suggest: (body: { brief: string; brandName?: string; product?: string; platforms: SourcingPlatform[] }) => json<InternalSuggestion>("POST", "/criteria/suggest", body),
  /** The file as a Blob, the row count the source wrote, and its name. */
  async exportList(id: string, body: ExportRequest): Promise<{ blob: Blob; count: number; filename: string }> {
    const res = await send("POST", `/lists/${id}/export`, body);
    const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "creators.csv";
    return { blob: await res.blob(), count: Number(res.headers.get("x-export-count") ?? "0"), filename };
  },
};
