// ---------------------------------------------------------------------------
// Configuration of the internal sourcing app's server — every secret stays here
// ---------------------------------------------------------------------------
// The browser bundle never sees anything in this file. It reads the environment once at start
// and reports problems by VARIABLE NAME only, never a value.
//
// Two honest modes, never a silent fallback:
//   live  the real sourcing backend (SOURCING_API_BASE_URL + SOURCING_INTERNAL_APP_API_KEY) and
//         Clerk sign-in (CLERK_SECRET_KEY + an allowlist). A missing piece makes every API call
//         answer 503 "setup_required" and the UI shows a setup screen — never sample data.
//   mock  in-memory sample data and a local development sign-in, for development and tests
//         only. It must be asked for explicitly (SOURCE_MODE=mock) and is refused when
//         NODE_ENV=production. The UI labels it on every screen.

export type SourceMode = "live" | "mock";
export type AuthMode = "clerk" | "dev";

export interface ClerkSettings {
  secretKey: string;
  jwtKey: string | null;
  /** Browser origins allowed to present tokens (the token's azp claim). */
  authorizedParties: string[];
  /** Clerk organization ids whose ACTIVE members may use the app. */
  allowedOrgIds: string[];
  /** Individual Clerk user ids allowed regardless of organization. */
  allowedUserIds: string[];
}

export interface AppConfig {
  production: boolean;
  port: number;
  host: string;
  sourceMode: SourceMode;
  authMode: AuthMode;
  source: { baseUrl: string; apiKey: string } | null;
  clerk: ClerkSettings | null;
  /** Variable names (never values) that block live use. Empty when the app is fully configured. */
  problems: string[];
}

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ORG_ID = /^org_[A-Za-z0-9]+$/;
const USER_ID = /^user_[A-Za-z0-9]+$/;
const MIN_KEY_LENGTH = 43;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env["NODE_ENV"] === "production";
  const problems: string[] = [];
  const port = Number(env["PORT"]) > 0 ? Number(env["PORT"]) : 5000;
  // Replit and most hosts route to 0.0.0.0; a local run can narrow it.
  const host = (env["HOST"] ?? "").trim() || "0.0.0.0";

  const requestedSource = (env["SOURCE_MODE"] ?? "live").trim().toLowerCase();
  let sourceMode: SourceMode = "live";
  if (requestedSource === "mock") {
    if (production) problems.push("SOURCE_MODE=mock is not allowed when NODE_ENV=production");
    else sourceMode = "mock";
  } else if (requestedSource !== "live") {
    problems.push("SOURCE_MODE must be live or mock");
  }

  const requestedAuth = (env["AUTH_MODE"] ?? "clerk").trim().toLowerCase();
  let authMode: AuthMode = "clerk";
  if (requestedAuth === "dev") {
    if (production) problems.push("AUTH_MODE=dev is not allowed when NODE_ENV=production");
    else authMode = "dev";
  } else if (requestedAuth !== "clerk") {
    problems.push("AUTH_MODE must be clerk or dev");
  }

  let source: AppConfig["source"] = null;
  if (sourceMode === "live") {
    const baseUrl = (env["SOURCING_API_BASE_URL"] ?? "").trim();
    const apiKey = (env["SOURCING_INTERNAL_APP_API_KEY"] ?? "").trim();
    if (!baseUrl) problems.push("SOURCING_API_BASE_URL is not set");
    else if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(baseUrl)) problems.push("SOURCING_API_BASE_URL must be an https origin");
    if (!apiKey) problems.push("SOURCING_INTERNAL_APP_API_KEY is not set");
    else if (apiKey.length < MIN_KEY_LENGTH) problems.push(`SOURCING_INTERNAL_APP_API_KEY is shorter than ${MIN_KEY_LENGTH} characters`);
    if (baseUrl && apiKey && problems.length === 0) source = { baseUrl, apiKey };
  }

  let clerk: ClerkSettings | null = null;
  if (authMode === "clerk") {
    const secretKey = (env["CLERK_SECRET_KEY"] ?? "").trim();
    const authorizedParties = list(env["CLERK_AUTHORIZED_PARTIES"]).map((s) => s.replace(/\/+$/, ""));
    const allowedOrgIds = list(env["INTERNAL_APP_ALLOWED_ORG_IDS"]);
    const allowedUserIds = list(env["INTERNAL_APP_ALLOWED_USER_IDS"]);
    const before = problems.length;
    if (!secretKey) problems.push("CLERK_SECRET_KEY is not set");
    if (production && authorizedParties.length === 0) problems.push("CLERK_AUTHORIZED_PARTIES is not set (the app's own https origin)");
    if (allowedOrgIds.length === 0 && allowedUserIds.length === 0) problems.push("INTERNAL_APP_ALLOWED_ORG_IDS or INTERNAL_APP_ALLOWED_USER_IDS must name who may sign in");
    if (allowedOrgIds.some((id) => !ORG_ID.test(id))) problems.push("INTERNAL_APP_ALLOWED_ORG_IDS must be Clerk organization ids (org_…)");
    if (allowedUserIds.some((id) => !USER_ID.test(id))) problems.push("INTERNAL_APP_ALLOWED_USER_IDS must be Clerk user ids (user_…)");
    if (problems.length === before) {
      clerk = { secretKey, jwtKey: (env["CLERK_JWT_KEY"] ?? "").trim() || null, authorizedParties, allowedOrgIds, allowedUserIds };
    }
  }

  return { production, port, host, sourceMode, authMode, source, clerk, problems };
}
