# Internal Sourcing via API

Internal creator sourcing app for Pluvus (PLU-505), used by Ricky and Calvin: import named creator
lists, source new named lists that exclude explicitly selected lists, review results, and export
CSVs. A small React/TypeScript UI plus a thin server (backend-for-frontend) in **one deployment**.

```
browser ──► this app's server (/api, sign-in, typed client) ──► sourcing backend /api/v1/internal-sourcing ──► engine + Postgres
```

## Two projects

| | Owns |
|---|---|
| **This app** (this repository, `PluvusAI/Internal-Sourcing-via-API`) | Sign-in and allowlist, the screens, import/export dialogs, and server-to-server calls with the typed client (`server/sourceClient.ts`). No database, no provider keys, no sourcing logic, no background jobs. |
| **Sourcing backend** (`PluvusAI/pluvus-workflow-prototype`, `server/`) | Durable lists and membership, import parsing and identity matching, exclusion snapshots, sourcing operations (existing worker + recovery), provider/cache/fit evaluation, CSV rendering. Contract: [`docs/internal-sourcing-api.md`](https://github.com/PluvusAI/pluvus-workflow-prototype/blob/plu-505-internal-sourcing/docs/internal-sourcing-api.md) in that repository. |

The app talks only to its own server; its server talks only to the sourcing backend's internal API
with a dedicated key. The browser never sees that key, a provider key or a database URL
(`npm run build` fails if a secret appears in the bundle).

The app was built as `internal-sourcing-app/` in the backend's repository (PLU-505, PLU-509) and
moved here with its history. The backend side of PLU-505 is on that repository's
`plu-505-internal-sourcing` branch until it merges; the links to it below point there.

## What it does

- **Lists home** — one searchable library (“Search lists by brand or list name”, case-insensitive
  “name contains”), with type, creator count, status and last update; search and page live in the
  URL so Back returns to them. New sourcing list · Import list · Open · New list using these
  criteria · Archive (no delete).
- **Import list** — choose CSV → name → map identity columns (platform, handle, profile URL, provider
  ID, Pluvus creator ID; or the Sheets per-platform columns) → preview valid / duplicate / invalid /
  ambiguous rows → acknowledge a partial import → open the saved list. Nothing is saved before Import.
  The dialog includes a downloadable [CSV template](public/creator-list-template.csv). Its header row
  names the common columns; add one creator per row. The simplest usable row has `platform` and
  `handle` (for example, `instagram,janedoe`). A profile URL, provider ID, creator ID, or recognised
  per-platform columns can also identify a creator. Names and emails alone cannot. The backend
  suggests mappings from other header names, previews every row, and enforces the import rules.
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

Copy names from [`.env.example`](.env.example) (names and placeholders only). For deployed use the
modes stay at their defaults, `SOURCE_MODE=live` and `AUTH_MODE=clerk`; `mock` / `dev` are
development-only and are refused when `NODE_ENV=production`.

| Variable | Where | Value |
|---|---|---|
| `SOURCING_API_BASE_URL` | server | The deployed workflow backend's **origin only**: `https://<host>`, no `/api/v1…` path (a path is reported as a setup error rather than silently ignored). |
| `SOURCING_INTERNAL_APP_API_KEY` | server secret | **Exactly the same value** as `SOURCING_INTERNAL_APP_API_KEY` on the sourcing backend (the existing PLU-505 internal key). Never the waitlist's `SOURCING_SERVICE_API_KEY`. Never a `VITE_*` variable. |
| `VITE_CLERK_PUBLISHABLE_KEY` | build time (public) | Publishable key of the chosen Clerk application. Read by Vite at **build** time: rebuild after changing it. |
| `CLERK_SECRET_KEY` | server secret | Secret key of the **same** Clerk application. |
| `CLERK_AUTHORIZED_PARTIES` | server | This app's own https origin(s), comma-separated (e.g. the Replit deployment URL). Required in production. |
| `INTERNAL_APP_ALLOWED_USER_IDS` | server | Required approved Clerk user ids (`user_…`), comma-separated. Access is user-only; organization settings are ignored. |
| `OPENROUTER_API_KEY` | optional server secret | Enables the criteria assistant directly in this app. Add it to this app's Secrets and restart; never use a `VITE_*` name. |
| `OPENROUTER_MODEL` | optional server | Model slug supporting structured outputs. Defaults to `openai/gpt-4.1-mini`; another compatible OpenRouter model can be selected here. |
| `PORT`, `HOST` | platform | Defaults 5000 / 0.0.0.0. |

The optional OpenRouter key is used only for the criteria assistant. Creator-provider keys,
database/Redis URLs, and sourcing limits belong to the sourcing backend.

### AI criteria suggestions

Set `OPENROUTER_API_KEY` in **this app's** Secrets, then restart/redeploy it. The workflow backend's
separate AI-agent service is not needed for this button. Missing AI configuration leaves the rest
of the app usable and is explained beside the assistant. The default model is
[`openai/gpt-4.1-mini`](https://openrouter.ai/openai/gpt-4.1-mini); `OPENROUTER_MODEL` can select any
model/provider combination supporting [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

Only a click on Suggest criteria makes a model request. Requests have a 20-second timeout and
1,400-token output limit; overlapping identical requests share work and successful retries are
cached briefly per user. Responses are validated against the chosen platforms and form limits.
Suggestions fill empty fields and offer replacements for existing values for review. They never
start sourcing, change exclusion lists, or overwrite a typed value automatically.

### Limits live on the sourcing backend

How many new creators one search may ask for — and every spend, page, candidate, model and runtime
ceiling — is configured **only on the sourcing backend** (PLU-509: the
`SOURCING_INTERNAL_APP_MAX_*` settings, documented in
[`docs/internal-sourcing-api.md`](https://github.com/PluvusAI/pluvus-workflow-prototype/blob/plu-505-internal-sourcing/docs/internal-sourcing-api.md)). The app learns the current
maximum from the backend (`GET /api/meta` → backend `GET /api/v1/internal-sourcing/meta` →
`maxTargetCount`) and never holds a number of its own:

- the first-search form and Find more both show and check that maximum; it is re-read when Find more
  opens, when the window regains focus, and every 30 seconds while the tab is visible, so raising it
  from 25 to 100 (or lowering it for a test) reaches visible pages without a reload;
- a count above it is flagged, never trimmed: a saved draft keeps what was entered;
- a page that still holds an older, higher maximum is refused by the backend
  (`target_exceeds_limit`); nothing starts, the refusal is shown, and the page re-reads the limit.
  The backend is the final enforcement point either way;
- one search asks for at most the maximum; a saved list grows beyond it only through explicit
  **Find more**. A search that stops at a spend, model, runtime or candidate ceiling keeps its rows
  and shows its real reason; the app never starts another search by itself. Reopening, refreshing,
  polling and exporting never start sourcing.

### When setup is wrong

| Situation | What the app does |
|---|---|
| A required variable is missing or malformed (e.g. a base URL with a path) | Every API call answers `503 setup_required`; the UI shows a setup screen naming the variables (never their values). |
| `SOURCING_INTERNAL_APP_API_KEY` here differs from the backend's | `503 source_auth_failed`; a banner says the key does not match. It is not shown as a sign-in problem. |
| The backend has no internal key configured | `503 source_not_configured`. |
| `SOURCING_API_BASE_URL` is not the backend (or the backend lacks the internal API) | `502 source_misconfigured`. |

Sample data is never shown instead.

**Sign-in.** Clerk, verified on the server for every API call, plus the individual-user
allowlist above. Approved users do not need an active organization. Organization
membership never grants access. You can reuse the operator dashboard's Clerk application
and explicitly allowlist the intended users.

### On the sourcing backend

1. Merge branch `plu-505-internal-sourcing` and apply migration
   `20261109120000_plu505_internal_sourcing_lists` (development via the post-merge setup; production
   via Publish — check `npm run db:check-publish` first, as the backend README describes).
2. Set `SOURCING_INTERNAL_APP_API_KEY` in the backend's Secrets — reuse the existing internal key;
   generate one (`openssl rand -base64 32`) only if none exists — and the same value here. Keep
   `SOURCING_INTERNAL_APP_CLIENT_ID` at its current value (default `internal-sourcing`).
3. Once the backend's limit settings land, set the internal limits **on the backend** (PLU-509)
   and redeploy it. Explicit values are bounded by the backend's hard maxima; unset ones inherit
   its general sourcing settings. The proposed operating profile (backend settings, not app ones):

   ```dotenv
   SOURCING_INTERNAL_APP_MAX_TARGET_QUALIFIED=100
   SOURCING_INTERNAL_APP_MAX_CANDIDATES_PER_REQUEST=1000
   SOURCING_INTERNAL_APP_MAX_EVIDENCE_LOOKUPS_PER_REQUEST=200
   SOURCING_INTERNAL_APP_MAX_CREDITS_PER_REQUEST=10
   SOURCING_INTERNAL_APP_MAX_CREDITS_PER_DAY=50
   SOURCING_INTERNAL_APP_MAX_LLM_USD_PER_REQUEST=0.50
   SOURCING_INTERNAL_APP_MAX_PAGES_PER_REQUEST=40
   SOURCING_INTERNAL_APP_MAX_PAGE_SIZE=25
   SOURCING_INTERNAL_APP_MAX_RUNTIME_SECONDS=1200
   SOURCING_INTERNAL_APP_MAX_QUEUE_WAIT_SECONDS=3600
   SOURCING_INTERNAL_APP_MAX_ACTIVE_REQUESTS=2
   ```

   Start with the small envelope in [First live check](#first-live-check) instead. The existing
   worker and scheduler run internal operations; nothing else to start, and nothing to change in
   this app.

## Development

```bash
npm ci
```

```bash
SOURCE_MODE=mock AUTH_MODE=dev npm run dev
```

opens on http://localhost:5000 with in-memory **sample data** (labelled on every screen) and a local
development sign-in. Both modes are refused when `NODE_ENV=production`. `MOCK_MAX_TARGET_COUNT=5`
(or `100`) makes the sample backend report and enforce another per-search limit.

To run against the **real** internal API, database layer and worker runner (with the backend's fake
provider and evaluator, embedded Postgres, nothing paid), start the backend's local stack from a checkout of
`PluvusAI/pluvus-workflow-prototype` and point the app at it:

```bash
cd <backend checkout>/server && LOCAL_STACK_KEY=<43+ throwaway chars> npx tsx scripts/internalSourcingLocalStack.ts
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

`scripts/e2e-limits.mjs` (same usage) checks that both forms follow the backend's current maximum,
including a page that still holds an older, higher one.

## Hosting on Replit

The app is one web server: `npm run build` then `npm run start` (one listener on `PORT`, serves the
UI and `/api`). Sourcing jobs run on the sourcing backend's own workers, so an **Autoscale**
deployment fits (no in-memory jobs; scaling to zero loses nothing). Lists stay in the sourcing
backend's production database.

1. Import this repository into Replit.
2. Secrets: `SOURCING_API_BASE_URL`, `SOURCING_INTERNAL_APP_API_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` (the deployment's https URL),
   `INTERNAL_APP_ALLOWED_USER_IDS`.
3. Publish → Autoscale. `.replit` already sets build `npm ci && npm run build`, run `npm run start`,
   port 5000 → 80.
4. Open `/health`, then sign in. A setup screen names anything still missing.

See https://docs.replit.com/features/publishing/deployment-types.

### First live check

Before real use, following PLU-509: on the **backend**, set a small test envelope of internal
limits and redeploy it before starting the search, so the operation records those limits. PLU-509
suggests target 5, candidates 50, evidence lookups 20, 1 provider credit per request and per day,
and USD 0.10 of model spend per request. Then:

1. Check that the app's first-search form and Find more both say "Up to 5" / "1 to 5".
2. Import the real creator CSV, and start one 5-creator search with a representative exclusion list.
   A partial result is valid; do not restart a ceiling-limited search.
3. Reopen, refresh and export the list: no new search may appear.
4. Review real usage on the backend, then set the operating limits there and redeploy the backend.
   The app picks up the new maximum by itself.

Nothing in this repository has made a live provider or model call.

## Keeping the client in step with the backend

`server/sourceClient.ts` is a byte-for-byte copy of the backend's
`server/src/internalSourcing/client.ts`. Whenever the backend's contract changes, copy that file
over this one. `npm test` checks the two are identical when it can find the backend: a checkout of
`pluvus-workflow-prototype` next to this one, or the one `SOURCING_BACKEND_DIR` names. Without
either, that one check is skipped and says so.

```bash
SOURCING_BACKEND_DIR=../pluvus-workflow-prototype npm test
```
