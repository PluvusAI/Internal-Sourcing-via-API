# List archive and deletion verification

The archive view previously carried the active view’s search. Undo was stored in the library page’s mutation state, so navigating away lost it. Delete was hidden for active imported/finished lists, and the backend required those lists to be archived first.

The fix uses the existing Pluvus banner, buttons, modal, Notice and Spinner. It keeps one archive/restore notification above the routes, clears cross-view filters, and offers confirmed Delete for inactive lists. It retains creator records, sourcing history and exclusion references. Existing search/email-job locks still apply. No migration is required.

21st search references considered: [Animated Toast](https://21st.dev/@dev.shejanmahamud/components/animated-toast) and [Toast](https://21st.dev/@shugar/components/toast). The existing banner fits this persistent, actionable feedback; no new dependency was added.

Validation used a disposable local PGlite backend with fake providers; no production lists or paid provider calls were used.

- App: 56 tests, both TypeScript targets and production bundle checks passed.
- Backend: 33 HTTP/database journey tests passed, covering direct deletion, running-search refusal, preserved history/exclusions and archive filtering before pagination. Server TypeScript check passed.
- Browser: `scripts/e2e-list-lifecycle.mjs` passed archive visibility, cleared filters, Undo across routes, restore after reload, deletion of new/imported/completed/archived lists, cancellation and navigation during a pending archive request. No browser errors; 390px dark layout fits.
- `21st review` reported no findings in changed code. The existing inline rename input’s autofocus warning remains outside this change.

Screenshots: [Desktop archive and Undo](01-archived-visible-with-undo.png), [390px dark archive](02-archive-phone-dark.png).

Deploy the backend first, then the internal app. Existing archived lists are retained and become visible without carrying an unrelated search. Deployment and an authenticated production check remain separate from this local verification.
