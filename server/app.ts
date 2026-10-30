import express, { Router, type Express, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAuthGate, userOf, type Verify } from "./auth.js";
import type { AppConfig } from "./config.js";
import { AssistantError, createCriteriaAssistant, parseSuggestInput } from "./criteriaAssistant.js";
import { createInternalSourcingClient, InternalSourcingApiError, type InternalSourcingClient } from "./sourceClient.js";

// ---------------------------------------------------------------------------
// The internal sourcing app's server: one HTTP listener for the UI and its API
// ---------------------------------------------------------------------------
//   GET  /health                  liveness (no data, no sign-in)
//   GET  /api/session             who is signed in, the mode, and any setup problem (names only)
//   /api/...                      the UI's own endpoints — each one maps to ONE typed call on the
//                                 sourcing backend's internal API, with the service key added
//                                 here. There is no pass-through proxy: an endpoint the UI does
//                                 not need does not exist.
//   everything else               the built single-page app (production) or Vite (development)
//
// The browser never holds the service key, a provider key or a database URL, and never calls the
// sourcing backend itself. Long sourcing jobs run in the sourcing backend's own workers; nothing
// here keeps a timer or a job alive.

export interface AppDeps {
  /** The sourcing backend client: real (from config) or the mock (development/tests). */
  source: InternalSourcingClient | null;
  verify?: Verify;
  aiFetch?: typeof fetch;
  /** Directory of the built UI. Omitted in development (Vite serves it) and in API-only tests. */
  staticDir?: string | null;
}

const ID = /^[a-z0-9]{8,64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,199}$/;

const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const strQ = (v: unknown): string | undefined => (typeof v === "string" && v.length <= 200 ? v : undefined);
const numQ = (v: unknown): number | undefined => (typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : undefined);
const boolQ = (v: unknown): boolean => v === "1" || v === "true";

function idParam(req: Request, res: Response, name = "id"): string | null {
  const v = req.params[name] ?? "";
  if (ID.test(v)) return v;
  res.status(404).json({ error: { code: "not_found", message: "No such list." } });
  return null;
}

export function createApp(cfg: AppConfig, deps: AppDeps): Express {
  const app = express();
  const suggestCriteria = createCriteriaAssistant(cfg.ai, deps.aiFetch);
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env["TRUST_PROXY_HOPS"] ?? "1") || 0);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "internal-sourcing-app", timestamp: new Date().toISOString() });
  });

  const api = Router();
  api.use((_req, res, next) => {
    // API answers can hold creator data: nothing in between should keep a copy.
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  api.use(express.json({ limit: "6mb" }));

  // Before sign-in: what the UI must show (setup problems are variable NAMES, never values).
  api.get("/session/config", (_req, res) => {
    res.json({ sourceMode: cfg.sourceMode, authMode: cfg.authMode, setupProblems: cfg.problems });
  });

  api.use((_req, res, next) => {
    if (cfg.problems.length > 0 || (cfg.sourceMode === "live" && !deps.source)) {
      res.status(503).json({ error: { code: "setup_required", message: "This app is not fully configured yet.", problems: cfg.problems } });
      return;
    }
    next();
  });
  api.use(createAuthGate(cfg, { ...(deps.verify ? { verify: deps.verify } : {}) }));

  const source = (): InternalSourcingClient => deps.source!;
  const actor = (res: Response) => ({ userRef: userOf(res).userId });

  api.get("/session", (_req, res) => {
    res.json({ user: userOf(res), sourceMode: cfg.sourceMode, authMode: cfg.authMode });
  });

  api.get("/meta", asyncRoute(async (_req, res) => void res.json(await source().meta())));

  api.get(
    "/lists",
    asyncRoute(async (req, res) => {
      res.json(
        await source().searchLists({
          ...(strQ(req.query["q"]) !== undefined ? { q: strQ(req.query["q"])! } : {}),
          ...(numQ(req.query["page"]) !== undefined ? { page: numQ(req.query["page"])! } : {}),
          ...(numQ(req.query["pageSize"]) !== undefined ? { pageSize: numQ(req.query["pageSize"])! } : {}),
          eligible: boolQ(req.query["eligible"]),
          includeArchived: boolQ(req.query["includeArchived"]),
          archivedOnly: boolQ(req.query["archivedOnly"]),
        }),
      );
    }),
  );
  api.get(
    "/lists/matching-ids",
    asyncRoute(async (req, res) => {
      res.json(await source().matchingListIds({ ...(strQ(req.query["q"]) !== undefined ? { q: strQ(req.query["q"])! } : {}), eligible: boolQ(req.query["eligible"]) }));
    }),
  );
  api.post("/lists", asyncRoute(async (req, res) => void res.status(201).json(await source().createList(req.body, actor(res)))));
  api.get(
    "/lists/:id",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (id) res.json(await source().getList(id));
    }),
  );
  api.patch(
    "/lists/:id",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (id) res.json(await source().updateList(id, req.body, actor(res)));
    }),
  );
  api.post(
    "/lists/:id/archive",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (!id) return;
      const archived = (req.body as { archived?: unknown })?.archived;
      if (typeof archived !== "boolean") return void res.status(400).json({ error: { code: "invalid_request", message: "Send { archived: true | false }." } });
      res.json(await source().archiveList(id, archived, actor(res)));
    }),
  );
  api.delete("/lists/:id", asyncRoute(async (req, res) => {
    const id = idParam(req, res);
    if (id) res.json(await source().removeList(id, actor(res)));
  }));
  api.post("/lists/:id/members", asyncRoute(async (req, res) => {
    const id = idParam(req, res);
    if (id) res.json(await source().addCreator(id, req.body, actor(res)));
  }));
  api.patch("/lists/:id/members/:memberId", asyncRoute(async (req, res) => {
    const id = idParam(req, res);
    const memberId = id ? idParam(req, res, "memberId") : null;
    if (id && memberId) res.json(await source().updateCreator(id, memberId, req.body, actor(res)));
  }));
  api.delete("/lists/:id/members", asyncRoute(async (req, res) => {
    const id = idParam(req, res);
    const memberIds = (req.body as { memberIds?: unknown } | null)?.memberIds;
    if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > 20_000 || memberIds.some(v => typeof v !== "string" || !ID.test(v))) {
      return void res.status(400).json({ error: { code: "invalid_selection", message: "Select the creators to remove." } });
    }
    if (id) res.json(await source().removeCreators(id, memberIds as string[], actor(res)));
  }));
  api.get(
    "/lists/:id/members",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (!id) return;
      res.json(
        await source().members(id, {
          ...(numQ(req.query["page"]) !== undefined ? { page: numQ(req.query["page"])! } : {}),
          ...(numQ(req.query["pageSize"]) !== undefined ? { pageSize: numQ(req.query["pageSize"])! } : {}),
        }),
      );
    }),
  );
  api.get(
    "/lists/:id/selection",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (id) res.json(await source().selection(id));
    }),
  );
  api.put(
    "/lists/:id/selection",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (id) res.json(await source().setSelection(id, req.body));
    }),
  );
  api.post(
    "/lists/:id/operations",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (!id) return;
      const body = (req.body ?? {}) as { idempotencyKey?: unknown; kind?: unknown; targetCount?: unknown; baseRevision?: unknown };
      // The browser mints the key once per click and reuses it on every retry and reload.
      if (typeof body.idempotencyKey !== "string" || !KEY.test(body.idempotencyKey)) {
        return void res.status(400).json({ error: { code: "idempotency_key_required", message: "A search needs an idempotency key." } });
      }
      if (body.kind !== "initial" && body.kind !== "find_more") return void res.status(400).json({ error: { code: "invalid_request", message: "kind must be initial or find_more." } });
      const result = await source().startOperation(
        id,
        {
          idempotencyKey: body.idempotencyKey,
          kind: body.kind,
          ...(typeof body.targetCount === "number" ? { targetCount: body.targetCount } : {}),
          ...(typeof body.baseRevision === "number" ? { baseRevision: body.baseRevision } : {}),
        },
        actor(res),
      );
      res.status(202).json(result);
    }),
  );
  api.get(
    "/lists/:id/operations/:operationId",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      const op = id ? idParam(req, res, "operationId") : null;
      if (id && op) res.json(await source().getOperation(id, op));
    }),
  );
  api.post("/lists/:id/email-jobs/preview", asyncRoute(async (req, res) => {
    const id = idParam(req, res); if (id) res.json(await source().previewEmails(id, req.body));
  }));
  api.post("/lists/:id/email-jobs", asyncRoute(async (req, res) => {
    const id = idParam(req, res); if (!id) return;
    const { idempotencyKey, ...body } = req.body ?? {};
    if (typeof idempotencyKey !== "string" || !KEY.test(idempotencyKey)) return void res.status(400).json({ error: { code: "idempotency_key_required", message: "An email lookup needs an idempotency key." } });
    res.status(202).json(await source().startEmailJob(id, { ...body, idempotencyKey }, actor(res)));
  }));
  for (const path of ["/lists/:id/email-jobs", "/lists/:id/email-jobs/:jobId"]) api.get(path, asyncRoute(async (req, res) => {
    const id = idParam(req, res); if (!id) return;
    const jobId = req.params["jobId"] ? idParam(req, res, "jobId") : undefined;
    if (jobId === null) return;
    res.json(await source().emailJob(id, jobId));
  }));
  api.post(
    "/lists/:id/export",
    asyncRoute(async (req, res) => {
      const id = idParam(req, res);
      if (!id) return;
      const out = await source().exportList(id, req.body);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${out.filename.replace(/[^\w.-]/g, "_")}"`);
      res.setHeader("X-Export-Count", String(out.count));
      res.send(out.csv);
    }),
  );
  api.post("/exclusions/preview", asyncRoute(async (req, res) => void res.json(await source().previewExclusions((req.body as { listIds?: string[] })?.listIds ?? []))));
  api.post(
    "/imports/preview",
    asyncRoute(async (req, res) => {
      const body = (req.body ?? {}) as { csv?: unknown; mapping?: unknown };
      if (typeof body.csv !== "string") return void res.status(400).json({ error: { code: "invalid_import", message: "Choose a CSV file." } });
      res.json(await source().previewImport(body.csv, (body.mapping as never) ?? null));
    }),
  );
  api.post("/imports", asyncRoute(async (req, res) => {
    const key = req.headers["idempotency-key"];
    if (key !== undefined && (typeof key !== "string" || !KEY.test(key))) {
      return void res.status(400).json({ error: { code: "idempotency_key_invalid", message: "Send a valid Idempotency-Key header." } });
    }
    res.status(201).json(await source().commitImport(req.body, actor(res), key));
  }));
  api.get("/criteria/suggest/status", (_req, res) => {
    res.json({ available: Boolean(cfg.ai) || cfg.sourceMode === "mock", message: cfg.ai || cfg.sourceMode === "mock" ? null : "Add OPENROUTER_API_KEY to this app's Secrets and restart to enable AI suggestions. Manual criteria entry is always available." });
  });
  api.post("/criteria/suggest", asyncRoute(async (req, res) => {
    const input = parseSuggestInput(req.body);
    res.json(cfg.sourceMode === "mock" && !cfg.ai ? await source().suggestCriteria(input) : await suggestCriteria(input, userOf(res).userId));
  }));

  api.use((_req, res) => res.status(404).json({ error: { code: "not_found", message: "No such endpoint." } }));
  // The source's own error codes and messages reach the UI unchanged — except the ones that mean
  // THIS APP's connection to the source is misconfigured, which become an honest 503 setup error
  // (a source 401 must never look like the signed-in user's own session failing). Anything else
  // is generic.
  api.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AssistantError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err instanceof InternalSourcingApiError) {
      const setup = sourceSetupError(err, req.path);
      if (setup) {
        warnSetupOnce(setup.code);
        return void res.status(setup.status).json({ error: { code: setup.code, message: setup.message } });
      }
      const status = err.status === 0 ? 502 : err.status;
      if (err.retryAfterSeconds) res.setHeader("Retry-After", String(err.retryAfterSeconds));
      return void res.status(status).json({ error: { code: err.code, message: err.message, ...err.details } });
    }
    const type = (err as { type?: unknown } | null)?.type;
    if (type === "entity.too.large") return void res.status(413).json({ error: { code: "payload_too_large", message: "Files up to 5 MB can be imported." } });
    if (type === "entity.parse.failed") return void res.status(400).json({ error: { code: "invalid_json", message: "The request was not valid JSON." } });
    // Never the request body or a credential: only that something failed.
    console.error("[internal-sourcing-app] api error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: { code: "internal_error", message: "Something went wrong. Try again." } });
  });
  app.use("/api", api);

  if (deps.staticDir && existsSync(deps.staticDir)) {
    const dir = resolve(deps.staticDir);
    app.use(express.static(dir, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(resolve(dir, "index.html"));
    });
  }
  return app;
}

/**
 * A source answer that means the app ↔ source connection itself is wrong, as the error the UI
 * shows instead. Names variables, never values. Null for every ordinary answer (validation,
 * not-found list, conflicts, limits), which pass through unchanged.
 */
export function sourceSetupError(err: InternalSourcingApiError, path: string): { status: number; code: string; message: string } | null {
  if (err.status === 401 || err.status === 403) {
    return {
      status: 503,
      code: "source_auth_failed",
      message: "The sourcing service did not accept this app's key. SOURCING_INTERNAL_APP_API_KEY here must equal SOURCING_INTERNAL_APP_API_KEY on the sourcing backend (not the waitlist's SOURCING_SERVICE_API_KEY).",
    };
  }
  if (err.status === 503 && err.code === "not_configured") {
    return { status: 503, code: "source_not_configured", message: "The sourcing service has no internal app key configured. Set SOURCING_INTERNAL_APP_API_KEY on the sourcing backend and redeploy it." };
  }
  if (err.status === 400 && err.code === "https_required") {
    return { status: 503, code: "source_misconfigured", message: "The sourcing service must be reached over HTTPS. Check SOURCING_API_BASE_URL." };
  }
  if ((/^\/meta\/?$/i.test(path) && err.status === 404 && (err.code === "not_found" || err.code === "unexpected_response")) || err.status === 405) {
    return {
      status: 502,
      code: "source_misconfigured",
      message: "SOURCING_API_BASE_URL does not point at a sourcing backend with the internal sourcing API. Check the origin, and that the backend with PLU-505 is deployed.",
    };
  }
  return null;
}

const warned = new Set<string>();
function warnSetupOnce(code: string): void {
  if (warned.has(code)) return;
  warned.add(code);
  console.warn(`[internal-sourcing-app] the sourcing service connection is misconfigured (${code}); see README "Configuration".`);
}

/** The real sourcing backend client for a live configuration, or null when it is not configured. */
export function liveSource(cfg: AppConfig): InternalSourcingClient | null {
  return cfg.source ? createInternalSourcingClient({ baseUrl: cfg.source.baseUrl, apiKey: cfg.source.apiKey }) : null;
}
