import { createClerkClient, verifyToken } from "@clerk/backend";
import type { RequestHandler, Response } from "express";
import type { AppConfig, ClerkSettings } from "./config.js";

// ---------------------------------------------------------------------------
// Internal sign-in: a verified Clerk session, and an explicit server-side allowlist
// ---------------------------------------------------------------------------
// The browser signs in with Clerk and sends its short-lived session token as `Authorization:
// Bearer`. Here the token is verified against the configured Clerk instance (and the app's own
// origins), and the user must be allowlisted: an ACTIVE organization in INTERNAL_APP_ALLOWED_ORG_IDS
// or a user id in INTERNAL_APP_ALLOWED_USER_IDS. Organization membership is re-checked live with
// Clerk for every change, so removing someone from the organization stops their writes at once.
// Nothing about identity is ever read from a request body. Same pattern as the Pluvus operator
// dashboard's gate (server/src/middleware/requireOperatorClerk.ts in the workflow backend).

export interface InternalUser {
  /** Clerk user id, or "dev-user" in local development sign-in. Sent to the source as attribution only. */
  userId: string;
  orgId: string | null;
}

export type TokenVerdict = { ok: true; userId: string; orgId: string | null } | { ok: false; code: "session_invalid" | "session_expired"; message: string };
export type Verify = (token: string, s: ClerkSettings) => Promise<TokenVerdict>;
export type MembershipLookup = (userId: string, s: ClerkSettings) => Promise<string[]>;

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

export const liveMemberships: MembershipLookup = async (userId, s) => {
  const api = createClerkClient({ secretKey: s.secretKey });
  return (await api.users.getOrganizationMembershipList({ userId, limit: 100 })).data.map((m) => m.organization.id);
};

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function deny(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export function userOf(res: Response): InternalUser {
  const u = res.locals["user"] as InternalUser | undefined;
  if (!u) throw new Error("route reached without sign-in");
  return u;
}

export function createAuthGate(cfg: AppConfig, deps: { verify?: Verify; memberships?: MembershipLookup } = {}): RequestHandler {
  const verify = deps.verify ?? verifyClerkToken;
  const memberships = deps.memberships ?? liveMemberships;
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
      .then(async (v) => {
        if (!v.ok) return deny(res, 401, v.code, v.message);
        const byUser = clerk.allowedUserIds.includes(v.userId);
        const byOrg = v.orgId !== null && clerk.allowedOrgIds.includes(v.orgId);
        if (!byUser && !byOrg) {
          if (clerk.allowedOrgIds.length > 0 && v.orgId === null) return deny(res, 403, "organization_required", "Select your Pluvus organization, then try again.");
          return deny(res, 403, "not_allowed", "Your account is not allowed to use the sourcing app.");
        }
        if (!byUser && !SAFE.has(req.method)) {
          try {
            const orgs = await memberships(v.userId, clerk);
            if (!orgs.includes(v.orgId!)) return deny(res, 403, "membership_required", "You are no longer a member of the allowed organization.");
          } catch {
            return deny(res, 503, "membership_check_failed", "Could not confirm your organization membership. Try again.");
          }
        }
        res.locals["user"] = { userId: v.userId, orgId: v.orgId } satisfies InternalUser;
        next();
      })
      .catch(next);
  };
}
