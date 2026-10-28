# pluvus-internal-sourcing

Internal creator sourcing app for Pluvus (PLU-505), used by Ricky and Calvin: import named creator
lists, source new named lists that exclude explicitly selected lists, review results, and export
CSVs. A small React/TypeScript UI plus a thin server (backend-for-frontend) in **one deployment**.

```
browser ──► this app's server (/api, sign-in, typed client) ──► sourcing backend /api/v1/internal-sourcing ──► engine + Postgres
```

## Two projects

| | Owns |
|---|---|
| **This app** (`internal-sourcing-app/`, proposed repo/Replit project `pluvus-internal-sourcing`) | Sign-in and allowlist, the screens, import/export dialogs, and server-to-server calls with the typed client (`server/sourceClient.ts`). No database, no provider keys, no sourcing logic, no background jobs. |
| **Sourcing backend** (`PluvusAI/pluvus-workflow-prototype`, `server/`) | Durable lists and membership, import parsing and identity matching, exclusion snapshots, sourcing operations (existing worker + recovery), provider/cache/fit evaluation, CSV rendering. Contract: [`docs/internal-sourcing-api.md`](../docs/internal-sourcing-api.md). |

The app talks only to its own server; its server talks only to the sourcing backend's internal API
with a dedicated key. The browser never sees that key, a provider key or a database URL
(`npm run build` fails if a secret appears in the bundle).

This directory currently lives in the sourcing backend's repository on branch
`plu-505-internal-sourcing`, because a separate repository could not be created from the session that
built it. It is self-contained (its own `package.json`, lockfile, `.replit`); see
[Moving to its own repository](#moving-to-its-own-repository).

## What it does

- **Lists home** — one searchable library (“Search lists by brand or list name”, case-insensitive
  “name contains”), with type, creator count, status and last update; search and page live in the
  URL so Back returns to them. New sourcing list · Import list · Open · New list using these
  criteria · Archive (no delete).
- **Import list** — choose CSV → name → map identity columns (platform, handle, profile URL, provider
  ID, Pluvus creator ID; or the Sheets per-platform columns) → preview valid / duplicate / invalid /
  ambiguous rows → acknowledge a partial import → open the saved list. Nothing is saved before Import.
- **New sourcing list** — autosaved draft (Saving / Saved / Save failed; a stale tab cannot overwrite a
  newer draft), supported criteria only (platforms with follower/engagement ranges, creator location —
  not audience —, language, niche, topic keywords, ideal creator, qualitative fit restrictions, brand
  context), requested count (up to the source's maximum), optional **Suggest criteria** that fills
  empty fields only and offers the rest.
- **Exclude creators from these lists** — searchable multi-select of saved lists by stable id, with
  member preview, **Select all N matching lists** across every page (the server resolves the ids),
  selections kept when the search changes, chips for everything selected, and the unique-creator count
  of the union (“3 lists selected; 550 unique creators excluded”). Only imported or finished lists
  with rows are offered; running lists are not a complete exclusion set.
- **Find creators** — one idempotent search (the key is kept across double clicks, retries and
  reloads). The list page then shows real job state and saved rows as they arrive, the criteria and
  exclusion snapshot, and the honest outcome and counters (excluded / already on list / considered).
- **Review** — table with page-vs-all selection (kept on the server, so it survives paging, refresh,
  another session and Find more), profile links, a detail drawer that returns to the same place.
- **Find more** — adds N more with the same criteria and exclusions, always skipping the list's own
  rows. **New list using these criteria** — copies criteria and exclusions and adds the previous list.
- **Export** — selected (N) or all (N), compact 20-column or exact 93-column Sheets template with the
  column order shown; never searches, looks up contacts or creates a saved subset.

## Configuration

Copy names from [`.env.example`](.env.example) (names and placeholders only).

| Variable | Where | Notes |
|---|---|---|
| `SOURCING_API_BASE_URL` | server secret | The sourcing backend's https origin. |
| `SOURCING_INTERNAL_APP_API_KEY` | server secret, **new** | Same value as the backend's `SOURCING_INTERNAL_APP_API_KEY`. Not the waitlist key. |
| `VITE_CLERK_PUBLISHABLE_KEY` | build time (public) | Clerk publishable key; rebuild after changing. |
| `CLERK_SECRET_KEY` | server secret | Same Clerk application. |
| `CLERK_AUTHORIZED_PARTIES` | server | This app's https origin(s). Required in production. |
| `INTERNAL_APP_ALLOWED_ORG_IDS` | server | Clerk organization ids whose members may sign in (their active organization). |
| `INTERNAL_APP_ALLOWED_USER_IDS` | server | Individual Clerk user ids allowed. At least one of the two allowlists is required. |
| `PORT`, `HOST` | platform | Defaults 5000 / 0.0.0.0. |

Missing or invalid configuration never falls back to sample data: `/health` still answers, every API
call returns `503 setup_required`, and the UI shows a setup screen naming the missing variables.

**Sign-in.** Clerk, verified on the server for every API call, plus the allowlist above; organization
membership is re-checked live with Clerk for every change. The Pluvus operator dashboard uses the same
pattern. One option is to reuse the operator dashboard's Clerk application and set
`INTERNAL_APP_ALLOWED_ORG_IDS` to the organization the backend already allowlists as
`OPERATOR_CLERK_ORG_IDS`; or allowlist Ricky's and Calvin's Clerk user ids. (This repository does
not record their ids.)

### On the sourcing backend

1. Merge branch `plu-505-internal-sourcing` and apply migration
   `20261109120000_plu505_internal_sourcing_lists` (development via the post-merge setup; production
   via Publish — check `npm run db:check-publish` first, as the backend README describes).
2. Generate a key (`openssl rand -base64 32`) and set it as `SOURCING_INTERNAL_APP_API_KEY` in the
   backend's Secrets (and here). Optionally `SOURCING_INTERNAL_APP_MAX_CREDITS_PER_REQUEST` /
   `_PER_DAY` to cap the internal app's provider spend below the service ceilings.
3. Redeploy. The existing worker and scheduler run internal operations; nothing else to start.

## Development

```bash
npm ci
```

```bash
SOURCE_MODE=mock AUTH_MODE=dev npm run dev
```

opens on http://localhost:5000 with in-memory **sample data** (labelled on every screen) and a local
development sign-in. Both modes are refused when `NODE_ENV=production`.

To run against the **real** internal API, database layer and worker runner (with the backend's fake
provider and evaluator, embedded Postgres, nothing paid), start the backend's local stack and point the
app at it:

```bash
cd ../server && LOCAL_STACK_KEY=<43+ throwaway chars> npx tsx scripts/internalSourcingLocalStack.ts
```

```bash
SOURCING_API_BASE_URL=http://127.0.0.1:3901 SOURCING_INTERNAL_APP_API_KEY=<same> AUTH_MODE=dev npm run dev
```

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

`npm test` covers the server (setup errors, sign-in and allowlist, the explicit API surface with no
pass-through, error mapping, client drift) and the UI's pure logic (exclusion selection, criteria
merge, idempotency keys). `npm run build` ends with `scripts/check-bundle.mjs`, which fails if the
bundle contains a secret value or pattern. `scripts/e2e-journey.mjs` drives the whole journey in
Chromium against a running app (development sign-in), e.g. the local stack above:

```bash
CHROMIUM_PATH=/path/to/chrome node scripts/e2e-journey.mjs http://127.0.0.1:5000 ./e2e-shots
```

## Hosting on Replit

The app is one web server: `npm run build` then `npm run start` (one listener on `PORT`, serves the
UI and `/api`). Sourcing jobs run on the sourcing backend's own workers, so an **Autoscale**
deployment fits (no in-memory jobs; scaling to zero loses nothing). Lists stay in the sourcing
backend's production database.

1. Create the Replit project from this directory's own repository (below), or import it.
2. Secrets: `SOURCING_API_BASE_URL`, `SOURCING_INTERNAL_APP_API_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` (the deployment's https URL),
   `INTERNAL_APP_ALLOWED_ORG_IDS` and/or `INTERNAL_APP_ALLOWED_USER_IDS`.
3. Publish → Autoscale. `.replit` already sets build `npm ci && npm run build`, run `npm run start`,
   port 5000 → 80.
4. Open `/health`, then sign in. A setup screen names anything still missing.

See https://docs.replit.com/features/publishing/deployment-types.

### First live check

Before real use: import the real creator CSV, set a hard spend ceiling on the backend
(`SOURCING_INTERNAL_APP_MAX_CREDITS_PER_REQUEST` / `_PER_DAY`, values chosen by the product owner),
and run one small batch (e.g. 2–3 creators). Nothing in this repository has made a live provider or
model call.

## Moving to its own repository

```bash
git subtree split --prefix internal-sourcing-app -b internal-sourcing-app-only
```

```bash
git push git@github.com:<org>/pluvus-internal-sourcing.git internal-sourcing-app-only:main
```

After the split, `server/sourceClient.test.ts` skips its drift check; refresh `server/sourceClient.ts`
from the backend's `server/src/internalSourcing/client.ts` whenever the contract changes.
