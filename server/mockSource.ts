import { randomUUID } from "node:crypto";
import { MOCK_DEFAULT_HEADERS, MOCK_SHEETS_HEADERS } from "./mockHeaders.js";
import {
  InternalSourcingApiError,
  type DraftCriteria,
  type ExcludedListRef,
  type ImportMapping,
  type ImportReport,
  type InternalSourcingClient,
  type ListDetail,
  type ListStatus,
  type ListSummary,
  type MemberView,
  type OperationView,
} from "./sourceClient.js";

// ---------------------------------------------------------------------------
// MOCK sourcing backend — development and tests only
// ---------------------------------------------------------------------------
// An in-memory stand-in with the SAME typed interface as the real client, so the UI can be built
// and exercised without the sourcing backend. Its creators are invented sample rows named
// "sample_creator_N". It is used only when SOURCE_MODE=mock is explicitly set outside production
// (config.ts), and the UI labels every screen "Sample data". Its rules are simplified (identity
// is platform + lower-cased handle; a search admits up to two sample creators per status read);
// the real behaviour lives in the sourcing backend and is tested there.

const PLATFORMS = ["instagram", "tiktok", "youtube", "twitter"] as const;
type Platform = (typeof PLATFORMS)[number];

interface MockList {
  id: string;
  name: string;
  kind: "imported" | "sourced";
  criteria: DraftCriteria | null;
  targetCount: number | null;
  excludedListIds: string[];
  derivedFromListId: string | null;
  criteriaLockedAt: string | null;
  draftRevision: number;
  importReport: ListDetail["importReport"];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MockOp {
  view: OperationView;
  listId: string;
  key: string;
  hash: string;
  excluded: Set<string>;
}

const id = (): string => randomUUID().replace(/-/g, "").slice(0, 24);
const now = (): string => new Date().toISOString();
const keyOf = (m: { platform: string | null; handle: string | null }): string => `${m.platform}:${(m.handle ?? "").toLowerCase()}`;
const fail = (status: number, code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new InternalSourcingApiError(status, code, message, details);
};

/**
 * `maxTargetCount` stands in for the backend's per-search limit (SOURCING_INTERNAL_APP_MAX_TARGET_QUALIFIED
 * there). The mock reports it from meta and refuses a larger search exactly as the backend does;
 * `setMaxTargetCount` changes it at run time, the way a backend redeploy would.
 */
export function createMockSource(opts: { maxTargetCount?: number } = {}): InternalSourcingClient & { setMaxTargetCount(n: number): void } {
  let maxTarget = opts.maxTargetCount ?? 25;
  const lists = new Map<string, MockList>();
  const members = new Map<string, MemberView[]>();
  const ops = new Map<string, MockOp>();
  const deletedLists = new Set<string>();
  const removedRows = new Map<string, Map<string, MemberView>>();
  let sampleSeq = 0;

  const membersOf = (listId: string): MemberView[] => members.get(listId) ?? [];
  const latestOp = (listId: string): MockOp | null => [...ops.values()].filter((o) => o.listId === listId).at(-1) ?? null;
  const statusOf = (l: MockList): ListStatus => (l.kind === "imported" ? "imported" : latestOp(l.id)?.view.listStatus ?? "draft");
  const summary = (l: MockList): ListSummary => {
    const op = latestOp(l.id);
    const status = statusOf(l);
    const memberCount = membersOf(l.id).length;
    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      status,
      memberCount,
      eligibleForExclusion: l.archivedAt === null && memberCount > 0 && (l.kind === "imported" || ["complete", "partial", "empty", "failed"].includes(status)),
      latestOperation: op ? { id: op.view.id, kind: op.view.kind, status: op.view.status, targetCount: op.view.targetCount, admittedCount: op.view.admittedCount } : null,
      derivedFromListId: l.derivedFromListId,
      archivedAt: l.archivedAt,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    };
  };
  const ref = (listId: string): ExcludedListRef => {
    const l = lists.get(listId);
    if (!l) return { id: listId, name: null, kind: null, status: null, memberCount: 0, archived: false, missing: true };
    return { id: l.id, name: l.name, kind: l.kind, status: statusOf(l), memberCount: membersOf(l.id).length, archived: l.archivedAt !== null, missing: false };
  };
  const detail = (l: MockList): ListDetail => {
    const operations = [...ops.values()].filter((o) => o.listId === l.id).map((o) => o.view);
    return {
      ...summary(l),
      criteria: l.criteria,
      targetCount: l.targetCount,
      excludedListIds: l.excludedListIds,
      excludedLists: l.excludedListIds.map(ref),
      criteriaLocked: l.criteriaLockedAt !== null || l.kind !== "sourced",
      draftRevision: l.draftRevision,
      importReport: l.importReport,
      operations,
      activeOperationId: operations.find((o) => o.status === "queued" || o.status === "running")?.id ?? null,
    };
  };
  const get = (listId: string): MockList => (!deletedLists.has(listId) ? lists.get(listId) : null) ?? fail(404, "list_not_found", "No such list.");
  const editable = (listId: string): MockList => {
    const l = get(listId);
    if (["queued", "sourcing"].includes(statusOf(l))) fail(409, "operation_active", "Wait for the search to finish before editing creators.");
    if (l.archivedAt) fail(409, "list_archived", "Restore this list before editing creators.");
    return l;
  };
  const matches = (l: MockList, q: string | undefined, eligible: boolean | undefined, includeArchived: boolean | undefined, archivedOnly = false): boolean =>
    (!q || l.name.toLowerCase().includes(q.trim().toLowerCase())) && (archivedOnly ? l.archivedAt !== null : includeArchived || l.archivedAt === null) && (!eligible || summary(l).eligibleForExclusion);
  const sorted = (): MockList[] => [...lists.values()].filter(l => !deletedLists.has(l.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));

  /** One status read moves a running mock search on by up to two sample creators. */
  function advance(op: MockOp): void {
    const v = op.view;
    if (v.status === "completed" || v.status === "partial" || v.status === "failed") return;
    if (v.status === "queued") {
      v.status = "running";
      v.listStatus = "sourcing";
      v.pollAfterSeconds = 3;
      return;
    }
    const list = membersOf(op.listId);
    for (let i = 0; i < 2 && v.admittedCount < v.targetCount && sampleSeq < 60; i++) {
      const n = sampleSeq++;
      const platform: Platform = PLATFORMS[n % PLATFORMS.length]!;
      const handle = `sample_creator_${n}`;
      if (op.excluded.has(`${platform}:${handle}`)) {
        v.counters.excluded++;
        continue;
      }
      list.push({
        id: id(),
        source: "sourced",
        operationId: v.id,
        platform,
        handle,
        profileUrl: null,
        displayName: `Sample Creator ${n}`,
        followers: 10_000 + n * 1_000,
        engagementPercent: null,
        pictureUrl: null,
        reason: "Sample data: not a real fit evaluation.",
        email: null,
        location: null,
        language: null,
        accounts: [{ platform, handle, link: null, followers: 10_000 + n * 1_000, engagementPercent: null }],
        selected: false,
        importRow: null,
        createdAt: now(),
      });
      v.admittedCount++;
      v.counters.considered++;
    }
    members.set(op.listId, list);
    get(op.listId).updatedAt = now();
    if (v.admittedCount >= v.targetCount || sampleSeq >= 60) {
      const done = v.admittedCount >= v.targetCount;
      v.status = done ? "completed" : "partial";
      v.listStatus = done ? "complete" : v.admittedCount > 0 ? "partial" : "empty";
      v.outcome = done
        ? { code: "target_reached", message: "The requested number of qualified creators was found." }
        : { code: "search_exhausted", message: "No more creators match these criteria; fewer than requested qualified." };
      v.pollAfterSeconds = null;
      v.completedAt = now();
    }
  }

  function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    const split = (l: string): string[] => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const headers = split(lines[0] ?? "");
    return { headers, rows: lines.slice(1).map((l) => Object.fromEntries(split(l).map((c, i) => [headers[i] ?? `col${i}`, c]))) };
  }

  function report(csv: string, mapping: ImportMapping | null): { report: ImportReport; valid: Array<{ row: number; platform: string; handle: string; name: string | null; email: string | null }> } {
    const { headers, rows } = parseCsv(csv);
    if (headers.length === 0 || rows.length === 0) fail(400, "invalid_import", "The file has no creators.", { reason: "empty_file" });
    const find = (names: string[]): string | null => headers.find((h) => names.includes(h.toLowerCase().replace(/[\s_-]/g, ""))) ?? null;
    const m: ImportMapping = mapping ?? {
      platform: find(["platform", "network"]),
      handle: find(["handle", "username"]),
      profileUrl: find(["profileurl", "url", "link"]),
      providerUserId: null,
      creatorId: null,
      displayName: find(["name", "fullname", "displayname"]),
      email: find(["email"]),
      followers: null,
      engagement: null,
      location: null,
      language: null,
      perNetwork: false,
      defaultPlatform: null,
    };
    if (!m.handle && !m.profileUrl) fail(422, "invalid_mapping", "Map a handle or profile URL column.", { headers, suggestedMapping: m });
    const seen = new Map<string, number>();
    const out: ImportReport["rows"] = [];
    const valid: Array<{ row: number; platform: string; handle: string; name: string | null; email: string | null }> = [];
    const counts = { totalRows: rows.length, valid: 0, duplicate: 0, invalid: 0, ambiguous: 0, withWarnings: 0 };
    rows.forEach((r, i) => {
      const row = i + 2;
      const platform = (m.platform ? r[m.platform] : m.defaultPlatform)?.toLowerCase() ?? "";
      const handle = (m.handle ? r[m.handle] : "")?.replace(/^@/, "").toLowerCase() ?? "";
      if (!handle) {
        counts.invalid++;
        out.push({ row, status: "invalid", reason: "No handle.", warnings: [], identity: "(empty)" });
      } else if (!(PLATFORMS as readonly string[]).includes(platform)) {
        counts.ambiguous++;
        out.push({ row, status: "ambiguous", reason: "A handle without a supported platform.", warnings: [], identity: handle });
      } else if (seen.has(`${platform}:${handle}`)) {
        counts.duplicate++;
        out.push({ row, status: "duplicate", reason: `Same creator as row ${seen.get(`${platform}:${handle}`)}.`, warnings: [], identity: `${platform} @${handle}` });
      } else {
        seen.set(`${platform}:${handle}`, row);
        counts.valid++;
        valid.push({ row, platform, handle, name: m.displayName ? r[m.displayName] ?? null : null, email: m.email ? r[m.email] ?? null : null });
      }
    });
    return {
      report: {
        headers,
        delimiter: ",",
        mapping: m,
        counts,
        rows: out,
        needsAcknowledgement: counts.invalid + counts.ambiguous > 0,
        sample: valid.slice(0, 20).map((v) => ({ row: v.row, identity: `${v.platform} @${v.handle}`, displayName: v.name, email: v.email })),
      },
      valid,
    };
  }

  const csvCell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    const safe = /^\s*[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  return {
    setMaxTargetCount(n: number) {
      maxTarget = n;
    },
    async meta() {
      return {
        workspace: "mock-workspace",
        maxTargetCount: maxTarget,
        platforms: [...PLATFORMS],
        exportFormats: {
          default: { headers: MOCK_DEFAULT_HEADERS, filled: MOCK_DEFAULT_HEADERS },
          sheets: { headers: MOCK_SHEETS_HEADERS, filled: MOCK_SHEETS_HEADERS.slice(0, 40) },
        },
      };
    },
    async searchLists(p = {}) {
      const page = p.page ?? 1;
      const pageSize = p.pageSize ?? 25;
      const all = sorted().filter((l) => matches(l, p.q, p.eligible, p.includeArchived, p.archivedOnly));
      const anyMatch = sorted().filter((l) => matches(l, p.q, false, p.eligible ? false : p.includeArchived, p.archivedOnly)).length;
      return { q: (p.q ?? "").trim(), page, pageSize, total: all.length, matchingNotEligible: p.eligible ? anyMatch - all.length : 0, lists: all.slice((page - 1) * pageSize, page * pageSize).map(summary) };
    },
    async matchingListIds(p = {}) {
      const found = sorted().filter((l) => matches(l, p.q, p.eligible, false));
      return { q: (p.q ?? "").trim(), ids: found.map((l) => l.id), total: found.length, lists: found.map((l) => ({ id: l.id, name: l.name, memberCount: membersOf(l.id).length })) };
    },
    async createList(body) {
      let criteria = body.criteria ?? null;
      let targetCount = body.targetCount ?? null;
      let excludedListIds = body.excludedListIds ?? [];
      let derivedFromListId: string | null = null;
      if (body.deriveFromListId) {
        const from = get(body.deriveFromListId);
        criteria = from.criteria;
        targetCount = from.targetCount;
        excludedListIds = [...new Set([...from.excludedListIds, from.id])];
        derivedFromListId = from.id;
      }
      for (const x of excludedListIds) if (!lists.has(x)) fail(400, "invalid_selection", "Some selected exclusion lists do not exist.", { unknownListIds: [x] });
      const l: MockList = { id: id(), name: body.name, kind: "sourced", criteria, targetCount, excludedListIds, derivedFromListId, criteriaLockedAt: null, draftRevision: 0, importReport: null, archivedAt: null, createdAt: now(), updatedAt: now() };
      lists.set(l.id, l);
      return detail(l);
    },
    async getList(listId) {
      const l = get(listId);
      const op = latestOp(listId);
      if (op) advance(op);
      return detail(l);
    },
    async updateList(listId, patch) {
      const l = get(listId);
      if (patch.baseRevision !== undefined && patch.baseRevision !== l.draftRevision) fail(409, "draft_changed", "This draft was changed elsewhere. Reload to see the latest version.");
      const touches = patch.criteria !== undefined || patch.targetCount !== undefined || patch.excludedListIds !== undefined;
      if (touches && (l.criteriaLockedAt || l.kind !== "sourced")) fail(409, "criteria_locked", "Sourcing has started, so this list's criteria and exclusions are fixed.");
      if (patch.excludedListIds?.some((x) => !lists.has(x))) fail(400, "invalid_selection", "Some selected exclusion lists do not exist.");
      if (patch.name !== undefined) l.name = patch.name;
      if (patch.criteria !== undefined) l.criteria = patch.criteria;
      if (patch.targetCount !== undefined) l.targetCount = patch.targetCount;
      if (patch.excludedListIds !== undefined) l.excludedListIds = patch.excludedListIds;
      l.draftRevision++;
      l.updatedAt = now();
      return detail(l);
    },
    async archiveList(listId, archived) {
      const l = get(listId);
      l.archivedAt = archived ? now() : null;
      return detail(l);
    },
    async removeList(listId) {
      const l = get(listId);
      if (["queued", "sourcing"].includes(statusOf(l))) fail(409, "operation_active", "Wait for the search to finish.");
      if (statusOf(l) !== "draft" && !l.archivedAt) fail(409, "archive_required", "Archive this list before removing it.");
      deletedLists.add(listId); l.archivedAt ??= now();
      return { removed: true };
    },
    async addCreator(listId, body) {
      const l = editable(listId);
      let platform = body.platform ?? "";
      let handle = (body.handle ?? "").replace(/^@/, "").trim().toLowerCase();
      let profileUrl = body.profileUrl?.trim() || null;
      if (profileUrl) {
        try {
          const url = new URL(profileUrl);
          if (!["https:", "http:"].includes(url.protocol)) throw new Error();
          const host = url.hostname.replace(/^www\./, "");
          const site = host.endsWith("instagram.com") ? "instagram" : host.endsWith("tiktok.com") ? "tiktok" : host.endsWith("youtube.com") ? "youtube" : host.endsWith("twitch.tv") ? "twitch" : ["x.com", "twitter.com"].includes(host) ? "twitter" : "";
          if (!site) throw new Error();
          if (platform && platform !== site) fail(422, "invalid_creator", "The profile URL and platform do not match.");
          platform = site;
          handle ||= url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "").toLowerCase() ?? "";
        } catch { fail(422, "invalid_creator", "Use a creator profile URL from a supported platform."); }
      }
      if (!platform || !handle) fail(422, "invalid_creator", "Provide a profile URL or platform and handle.");
      const current = membersOf(listId).find(m => keyOf(m) === `${platform}:${handle}`);
      if (current) return { member: current, existing: true, restored: false };
      const removed = [...(removedRows.get(listId)?.values() ?? [])].find(m => keyOf(m) === `${platform}:${handle}`);
      if (removed) {
        removedRows.get(listId)!.delete(removed.id); members.set(listId, [...membersOf(listId), removed]);
        return { member: removed, existing: false, restored: true };
      }
      const member: MemberView = { id: id(), source: "import", operationId: null, platform, handle, profileUrl, displayName: body.displayName ?? null, followers: null, engagementPercent: null, pictureUrl: null, reason: null, email: body.email ?? null, location: body.location ?? null, language: body.language ?? null, accounts: [{ platform, handle, link: profileUrl, followers: null, engagementPercent: null }], selected: false, importRow: null, createdAt: now() };
      members.set(listId, [...membersOf(listId), member]); l.updatedAt = now();
      return { member, existing: false, restored: false };
    },
    async updateCreator(listId, memberId, body) {
      const l = editable(listId);
      const member = membersOf(listId).find(m => m.id === memberId) ?? fail(404, "member_not_found", "No such creator on this list.");
      Object.assign(member, body); l.updatedAt = now();
      return { member };
    },
    async removeCreators(listId, memberIds) {
      const l = editable(listId);
      const all = membersOf(listId);
      const ids = new Set(memberIds);
      const removed = removedRows.get(listId) ?? new Map<string, MemberView>();
      if ([...ids].some(id => !all.some(m => m.id === id) && !removed.has(id))) fail(400, "unknown_members", "Some creators are not on this list.");
      const rows = all.filter(m => ids.has(m.id));
      for (const row of rows) removed.set(row.id, { ...row, selected: false });
      removedRows.set(listId, removed); members.set(listId, all.filter(m => !ids.has(m.id))); l.updatedAt = now();
      return { removedCount: rows.length };
    },
    async members(listId, p = {}) {
      get(listId);
      const page = p.page ?? 1;
      const pageSize = p.pageSize ?? 50;
      const all = membersOf(listId);
      return { members: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, selectedCount: all.filter((m) => m.selected).length, page, pageSize };
    },
    async selection(listId) {
      const ids = membersOf(listId).filter((m) => m.selected).map((m) => m.id);
      return { memberIds: ids, selectedCount: ids.length };
    },
    async setSelection(listId, body) {
      const all = membersOf(listId);
      const ids = "all" in body ? null : new Set(body.memberIds);
      for (const m of all) if (!ids || ids.has(m.id)) m.selected = body.selected;
      return { selectedCount: all.filter((m) => m.selected).length };
    },
    async startOperation(listId, p) {
      const l = get(listId);
      const existing = [...ops.values()].find((o) => o.listId === listId && o.key === p.idempotencyKey);
      const targetCount = p.targetCount ?? l.targetCount ?? 0;
      const hash = `${p.kind}:${targetCount}`;
      if (existing) {
        if (existing.hash !== hash) fail(409, "idempotency_key_reused", "This Idempotency-Key was already used for a different search.");
        return { operation: existing.view, idempotentReplay: true };
      }
      const prior = latestOp(listId);
      if (prior && (prior.view.status === "queued" || prior.view.status === "running")) fail(409, "operation_active", "A search is already running for this list.");
      if (p.kind === "initial" && prior) fail(409, "already_started", "This list has already been sourced.");
      if (!l.criteria?.niche || !l.criteria.platforms?.length) fail(400, "invalid_criteria", "Some criteria are missing or not valid.", { issues: [{ path: "niche", message: "Required" }] });
      if (targetCount < 1) fail(400, "invalid_criteria", "Say how many new creators to find.", { issues: [{ path: "targetCount", message: "Required" }] });
      if (targetCount > maxTarget) fail(422, "target_exceeds_limit", `At most ${maxTarget} new creators can be requested at a time.`, { maxTargetQualified: maxTarget });
      const excluded = new Set<string>();
      for (const x of [...l.excludedListIds, l.id]) for (const m of membersOf(x)) excluded.add(keyOf(m));
      for (const m of removedRows.get(l.id)?.values() ?? []) excluded.add(keyOf(m));
      const view: OperationView = {
        id: id(),
        kind: p.kind,
        status: "queued",
        listStatus: "queued",
        targetCount,
        admittedCount: 0,
        excludedLists: l.excludedListIds.map((x) => ({ id: x, name: lists.get(x)?.name ?? "", memberCount: membersOf(x).length })),
        excludedCreatorCount: new Set(l.excludedListIds.flatMap((x) => membersOf(x).map(keyOf))).size,
        ownMemberCount: membersOf(l.id).length,
        outcome: null,
        counters: { excluded: 0, duplicates: 0, considered: 0 },
        criteria: l.criteria,
        pollAfterSeconds: 10,
        createdAt: now(),
        completedAt: null,
      };
      ops.set(view.id, { view, listId, key: p.idempotencyKey, hash, excluded });
      l.criteriaLockedAt ??= now();
      l.updatedAt = now();
      return { operation: view, idempotentReplay: false };
    },
    async getOperation(listId, operationId) {
      const op = ops.get(operationId);
      if (!op || op.listId !== listId) return fail(404, "operation_not_found", "No such operation.");
      advance(op);
      return { operation: op.view, memberCount: membersOf(listId).length };
    },
    async exportList(listId, body) {
      const l = get(listId);
      const all = membersOf(listId);
      const rows = body.scope === "all" ? all : all.filter((m) => body.memberIds.includes(m.id));
      if (rows.length === 0) fail(409, "empty_scope", "There are no creators in this selection to export.");
      const headers = body.format === "sheets" ? MOCK_SHEETS_HEADERS : MOCK_DEFAULT_HEADERS;
      const value = (m: MemberView, h: string): unknown => {
        if (h === "email") return m.email;
        if (h === "first_name") return m.displayName;
        const [platform, ...rest] = h.split("_");
        const field = rest.join("_");
        if (platform !== m.platform) return null;
        if (field === "username" || field === "custom_url") return m.handle;
        if (field === "follower_count" || field === "subscriber_count") return m.followers;
        return null;
      };
      const csv = "﻿" + [headers.join(","), ...rows.map((m) => headers.map((h) => csvCell(value(m, h))).join(","))].join("\r\n") + "\r\n";
      return { csv, count: rows.length, filename: `${l.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${body.scope}-sample.csv` };
    },
    async previewExclusions(listIds) {
      const unknown = listIds.filter((x) => !lists.has(x));
      if (unknown.length) fail(400, "invalid_selection", "Some selected exclusion lists do not exist.", { unknownListIds: unknown });
      const all = listIds.flatMap((x) => membersOf(x));
      return { lists: listIds.map(ref), uniqueCreatorCount: new Set(all.map(keyOf)).size, memberCount: all.length };
    },
    async previewImport(csv, mapping) {
      return report(csv, mapping ?? null).report;
    },
    async commitImport(body) {
      const { report: r, valid } = report(body.csv, body.mapping);
      if (valid.length === 0) fail(400, "invalid_import", "No row in this file identifies a creator, so nothing was imported.");
      if (r.needsAcknowledgement && !body.acknowledgePartial) fail(409, "partial_import_unacknowledged", "Some rows cannot be imported. Confirm that the list should be saved without them.", { report: r });
      const l: MockList = {
        id: id(),
        name: body.name,
        kind: "imported",
        criteria: null,
        targetCount: null,
        excludedListIds: [],
        derivedFromListId: null,
        criteriaLockedAt: null,
        draftRevision: 0,
        importReport: { counts: r.counts, rows: r.rows, mapping: r.mapping, headers: r.headers },
        archivedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      lists.set(l.id, l);
      members.set(
        l.id,
        valid.map((v) => ({
          id: id(),
          source: "import",
          operationId: null,
          platform: v.platform,
          handle: v.handle,
          profileUrl: null,
          displayName: v.name,
          followers: null,
          engagementPercent: null,
          pictureUrl: null,
          reason: null,
          email: v.email,
          location: null,
          language: null,
          accounts: [{ platform: v.platform, handle: v.handle, link: null, followers: null, engagementPercent: null }],
          selected: false,
          importRow: v.row,
          createdAt: now(),
        })),
      );
      return { list: detail(l), report: r };
    },
    async suggestCriteria(body) {
      const words = body.brief.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      return {
        ok: true,
        message: "Sample suggestion (mock mode).",
        suggestion: {
          niche: words.slice(0, 3).join(" ") || null,
          topicKeywords: words.slice(3, 6),
          idealCreator: null,
          exclusions: [],
          creatorLocations: [],
          profileLanguages: ["en"],
          followerRanges: {},
          reasons: {},
        },
      };
    },
  };
}
