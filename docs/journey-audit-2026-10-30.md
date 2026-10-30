# Creator sourcing journey audit — 30 October 2026

This review follows the active app from the list library through import, draft setup, exclusions,
sourcing, review, and export. It includes the app server and the companion internal sourcing API.

| Step | What was checked | Changes from this review |
| --- | --- | --- |
| 1. Find or create a list | Search, archived filter, paging, empty results, repeated submission | Previous search/page rows cannot be acted on while results change. Repeated Enter cannot create duplicate drafts. Pending dialogs show progress and disable their close controls. A request finishing after navigation cannot redirect the user back. |
| 2. Prepare and import a roster | File format, column mapping, identity rules, partial rows, duplicates, retries | Import uses a shared native dropdown adapted from 21st.dev. Issue filters separate invalid, ambiguous, duplicate, and warning rows. The UI explains the 500-issue preview limit and how to correct the source file. The template and identity guide remain visible before upload. |
| 3. Save the draft | Debounce, failed requests, conflicts, queued edits, leaving the page | A failed save stops retrying the same payload and exposes Retry. In-app navigation and browser Back save the latest edits first, with an explicit leave prompt if saving fails. |
| 4. Choose exclusions | Search across pages, select matching lists, deduplicated creator count, count errors | Stale picker rows cannot be selected under a new query/page. Selected chips remain visible. Counting failures are shown. |
| 5. Start and follow sourcing | Revision checks, duplicate start, operation locking, exclusion snapshot, ceilings, partial results | The backend locks the draft row while starting and retries a changed exclusion lock set in sorted order. A concurrent edit and start cannot snapshot inconsistent criteria. Existing operation keys, ceilings, worker recovery, and honest partial outcomes were checked in the API suite. |
| 6. Review and select creators | Paging, persistent selection, mobile bulk actions, creator details | Old-page rows are hidden during page changes. Mobile has a visible Select this page action and can reach Select all saved creators without tapping every row. |
| 7. Export or source another batch | Selected/all scopes, both CSV formats, escaping, exclusions after export | The API suite verifies exact scopes, headers, Unicode, formula protection, and that exporting a subset still leaves every list member available for exclusion. |

## Backend findings fixed

- Malformed percent escapes in a profile URL now produce an invalid-row result instead of failing the preview.
- Unknown or inaccessible Pluvus creator IDs are removed before duplicate detection. Two unrelated handles sharing an unknown ID remain separate creators.
- Imports accept an optional `Idempotency-Key`. The same workspace, key, and payload return the original list; a changed payload returns 409. Concurrent retries create one list.
- The browser retains an import retry key across timeout/reload, using a request fingerprint without storing the CSV. The app server forwards it to the source API.
- Migration `20261110120000_plu505_import_idempotency` adds the retry columns and unique index. The publish preflight checks the required columns and index definition.

## Design references

Mobbin Deep Search covered the individual journey steps. Screens inspected included
[Remote import review](https://mobbin.com/screens/d04c9f64-c644-4b9c-8e43-93de5b2fdbc0),
[Heidi list search](https://mobbin.com/screens/34925932-3925-444a-952e-5bff701fdca6),
[Calendly selected contacts](https://mobbin.com/screens/0b78c5b6-9e3f-4db6-b209-001ab3694d79),
[Juicebox search criteria](https://mobbin.com/screens/86b852b2-cb94-44fc-9e6f-87e53bdde9c3),
[Pipedrive export](https://mobbin.com/screens/7af8ac16-b490-4ec8-9b37-ec96b41630be),
[Render empty search](https://mobbin.com/screens/0da9bd06-539f-41e1-aa94-a8c78368e69a), and
[Squarespace unsaved changes](https://mobbin.com/screens/9825b5a3-da36-4ae9-8a15-7c9d78f08f1b).

21st.dev component sources were retrieved and adapted to the app's CSS tokens:
[Native Select](https://21st.dev/@wensity/components/native-select),
[Data Table Row Selection](https://21st.dev/@felipemenezes098/components/table-row-selection),
[CSV import review](https://21st.dev/@sean0205/components/reui-trace-15), and
[Alert Dialog](https://21st.dev/@shadcn/components/alert-dialog).

## Verification

The app is checked with TypeScript, its production build and bundle secret scan, the unit/HTTP
suite, and a local browser journey at a 390 px viewport. Browser checks include issue filtering,
mobile page selection, a failed draft save, explicit retry, quick field reversions, and completion
after browser Back without an unexpected redirect. No page errors or horizontal overflow occurred.
The full desktop browser journey also passes through the real local API and embedded Postgres:
three roster imports, brand search, exclusions, sourcing, reload, creator details, selected CSV
export, Find more, a derived second batch, and Back to the searched list library.
The backend's identity/import tests and embedded Postgres API tests cover imports, concurrent retry,
draft/start concurrency, exclusions, sourcing, selection, and both exports. Tests use a fake provider
and evaluator, so this audit makes no paid sourcing calls.

The local backend dependency symlink lacks Clerk and AWS packages; the final app-bootstrap test
and full backend typecheck require the repository's complete dependency installation in CI.
