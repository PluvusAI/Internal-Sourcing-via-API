import { verifyToken } from "@clerk/backend";
import type { RequestHandler, Response } from "express";
import type { AppConfig, ClerkSettings } from "./config.js";

// ---------------------------------------------------------------------------
// Internal sign-in: a verified Clerk session, and an explicit server-side allowlist
// ---------------------------------------------------------------------------
// The browser signs in with Clerk and sends its short-lived session token as `Authorization:
// Bearer`. Here the token is verified against the configured Clerk instance (and the app's own
// origins), and the user id must be in INTERNAL_APP_ALLOWED_USER_IDS. Organization
// membership never grants access and is not required for an approved user.
// Nothing about identity is ever read from a request body. Same pattern as the Pluvus operator
// dashboard's gate (server/src/middleware/requireOperatorClerk.ts in the workflow backend).

export interface InternalUser {
  /** Clerk user id, or "dev-user" in local development sign-in. Sent to the source as attribution only. */
  userId: string;
  orgId: string | null;
}

export type TokenVerdict = { ok: true; userId: string; orgId: string | null } | { ok: false; code: "session_invalid" | "session_expired"; message: string };
export type Verify = (token: string, s: ClerkSettings) => Promise<TokenVerdict>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Clerk session-token organization claims, v1 (org_id) and v2 (o.id). */
function orgOf(claims: Record<string, unknown>): string | null {
  const o = claims["o"] as { id?: unknown } | undefined;
  return o && typeof o === "object" ? str(o.id) : str(claims["org_id"]);
}

export const verifyClerkToken: Verify = async (token, s) => {
  try {
    const result = (await verifyToken(token, {
      secretKey: s.secretKey,
      ...(s.jwtKey ? { jwtKey: s.jwtKey } : {}),
      ...(s.authorizedParties.length ? { authorizedParties: s.authorizedParties } : {}),
    })) as unknown;
    const shaped = result as { data?: unknown } | null;
    const claims = (shaped && typeof shaped === "object" && "data" in shaped ? shaped.data : result) as Record<string, unknown> | null;
    const userId = claims ? str(claims["sub"]) : null;
    if (!claims || !userId) return { ok: false, code: "session_invalid", message: "Invalid session. Sign in again." };
    return { ok: true, userId, orgId: orgOf(claims) };
  } catch (err) {
    const reason = String((err as { reason?: unknown } | null)?.reason ?? "");
    return /expired/i.test(reason)
      ? { ok: false, code: "session_expired", message: "Your session expired. Sign in again." }
      : { ok: false, code: "session_invalid", message: "Invalid session. Sign in again." };
  }
};

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function userOf(res: Response): InternalUser {
  const u = res.locals["user"] as InternalUser | undefined;
  if (!u) throw new Error("route reached without sign-in");
  return u;
}

export function createAuthGate(cfg: AppConfig, deps: { verify?: Verify } = {}): RequestHandler {
  const verify = deps.verify ?? verifyClerkToken;
  return (req, res, next) => {
    if (cfg.authMode === "dev") {
      // Local development only (refused when NODE_ENV=production; see config.ts).
      res.locals["user"] = { userId: "dev-user", orgId: null } satisfies InternalUser;
      return next();
    }
    const clerk = cfg.clerk;
    if (!clerk) return deny(res, 503, "setup_required", "Sign-in is not configured on this server.");
    const m = /^Bearer\s+(.+)$/i.exec((req.headers.authorization ?? "").trim());
    if (!m) return deny(res, 401, "sign_in_required", "Sign in to use the sourcing app.");

    void verify(m[1]!, clerk)
      .then((v) => {
        if (!v.ok) return deny(res, 401, v.code, v.message);
        if (!clerk.allowedUserIds.includes(v.userId)) {
          return deny(res, 403, "not_allowed", "Your account is not allowed to use the sourcing app.");
        }
        res.locals["user"] = { userId: v.userId, orgId: v.orgId } satisfies InternalUser;
        next();
      })
      .catch(next);
  };
}
