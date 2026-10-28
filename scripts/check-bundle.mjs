// Fails the build if the browser bundle (dist/) contains anything secret.
//
// 1. The VALUE of every server-side secret present in this environment (when set) — so a key
//    copied into a VITE_ variable, or imported into browser code, is caught by its actual value.
// 2. Patterns no browser file may contain: Clerk secret keys, the source credential's variable
//    name, database URLs, provider key names.
// The Clerk PUBLISHABLE key (pk_…) is public by design and is allowed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SECRET_VARS = ["SOURCING_INTERNAL_APP_API_KEY", "CLERK_SECRET_KEY", "CLERK_JWT_KEY", "DATABASE_URL", "INFLUENCERS_CLUB_API_KEY", "SOURCING_SERVICE_API_KEY", "OPERATOR_API_KEY"];
const PATTERNS = [
  [/sk_(live|test)_[A-Za-z0-9]{10,}/, "a Clerk secret key"],
  [/SOURCING_INTERNAL_APP_API_KEY/, "the source credential's variable name"],
  [/postgres(ql)?:\/\/[^\s"']+/, "a database URL"],
  [/INFLUENCERS_CLUB_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY/, "a provider key name"],
  [/Bearer [A-Za-z0-9_\-]{30,}/, "a bearer credential"],
];

function files(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (/\.(js|css|html|map|json|txt)$/.test(name)) out.push(p);
  }
  return out;
}

let list;
try {
  list = files(DIST);
} catch {
  console.error("check-bundle: dist/ not found — run vite build first.");
  process.exit(1);
}
const problems = [];
for (const file of list) {
  const text = readFileSync(file, "utf8");
  for (const name of SECRET_VARS) {
    const value = (process.env[name] ?? "").trim();
    if (value.length >= 12 && text.includes(value)) problems.push(`${file}: contains the value of ${name}`);
  }
  for (const [re, what] of PATTERNS) if (re.test(text)) problems.push(`${file}: contains ${what}`);
}
if (problems.length > 0) {
  console.error(`check-bundle: the browser bundle must not contain secrets:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-bundle: ${list.length} browser files checked, no secrets found.`);
