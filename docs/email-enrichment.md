# Creator email enrichment

Find emails is an explicit action for a row, selected saved rows across all pages, or the whole list. Its dialog previews the fixed scope, existing/reusable contacts, eligible lookups, cached misses, skipped rows, estimated maximum credits and current per-search/daily caps. It uses the existing Modal, Notice, table selection and progress primitives; no new runtime dependencies. 21st catalog dialog references were reviewed; project primitives fit this flow.

The app calls its own authenticated proxy, then the backend internal API. Provider keys, jobs, cache and credit accounting remain on the backend. A valid profile email costs 0.2 provider credits; `must_have` misses are uncharged. Saving, refreshing, opening drawers and exporting never buy contacts. Both CSV layouts keep their existing headers and include saved enrichment emails.

Export defaults to Full details, the existing 93-column Sheets template. With the profile-export backend update, it includes all available matching fields from the paid lookup: bios, social accounts, follower/engagement metrics, posting statistics, commercial flags and bio/external links. Compact remains available with 20 columns. Manual edits and clears win; unavailable details and outreach columns remain blank. Downloading adds no calls or credits. The backend must apply `20261113120000_internal_email_profile_export` and deploy the API and email worker first. Earlier jobs retained only email, so their discarded profile details cannot be recovered by downloading again.

Run migration `20261112120000_internal_email_enrichment` through the backend's normal development migration flow, run its `db:check-publish`, and deploy the backend (API, worker and scheduler) before deploying this app. The backend's existing `INFLUENCERS_CLUB_API_KEY` is used; no new key is needed here. Email jobs inherit the resolved sourcing per-search credit cap and share its daily bucket. If a limit stops a job, results remain saved and another explicit job is needed. An uncertain billing result must be reconciled on the provider ledger before retrying that identity.

For the first live check, select five creators, review the displayed cap (maximum one provider credit for five new matches), start once, compare actual provider charges with the job and ledger, then refresh/export both formats and confirm zero additional calls.

Verification:

- `SOURCING_BACKEND_DIR=../creator-email-backend npm test` checks proxy authentication, retry headers, sample behavior and byte-identical client contract, alongside the existing app tests.
- `npm run typecheck` and `npm run build` check types and the browser bundle for secrets.
- Backend `server/src/internalSourcing/emails.db.test.ts` exercises embedded Postgres and a fake provider; existing internal API and provider suites cover regressions.
- `scripts/e2e-email-enrichment.mjs` drives the real local stack with fake contacts: selected/single/all actions, reload persistence, preservation, both exports, desktop and phone/dark-mode screenshots. Run only with the backend's isolated local stack and a development-sign-in app; pass the Playwright installation via `NODE_PATH`. `SOURCING_TEST_BACKEND_BASE` selects its local origin (defaults to `http://127.0.0.1:3917`).

Backend dependency: [pluvus-workflow-prototype PR #491](https://github.com/PluvusAI/pluvus-workflow-prototype/pull/491), branch `feat/internal-email-enrichment` (`../creator-email-backend` locally). Merge/deploy the backend dependency before deploying this app; an older backend does not expose the email endpoints.
