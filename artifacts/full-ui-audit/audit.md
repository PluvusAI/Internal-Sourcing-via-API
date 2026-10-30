# Creator sourcing UI audit and fixes

Audited 30 October 2026 in the active `Internal-Sourcing-via-API` checkout. The app has two routes, with draft, sourced, imported and archived states on list detail. Shared controls also cover sign-in/loading/setup screens.

## Findings and resolutions

| Priority | Finding | Resolution | Source |
| --- | --- | --- | --- |
| High | The API supplies `pictureUrl`, but creator rows and details never rendered it. | Shared photo/initials component in rows, drawer and exclusion previews; failed image URLs fall back without broken-image icons. | `src/components/CreatorAvatar.tsx:5`, `src/components/MembersTable.tsx:125`, `src/components/ExclusionPicker.tsx:191` |
| High | Considered, excluded and duplicate counts were buried in a key/value panel. | Prominent per-search metrics, saved/target progress, honest queued/running/completed/partial/failed states; total considered across searches in expandable activity. These are API counters, not simulated progress. | `src/pages/ListPage.tsx:565` |
| Medium | Generic `.section + .section` margin displaced the second grid panel. | Grid children reset the sibling margin; browser check asserts equal top coordinates. | `src/styles.css:140` |
| Medium | Data views collapsed to a tiny spinner, with little indication of what was loading. | 21st-based shimmer skeletons retain page/table structure; action spinners and visible import-check copy identify the pending work. | `src/components/ui.tsx:6`, `src/components/ImportDialog.tsx:270` |
| Medium | Separate profile/handle columns crowded the creator table and row controls. | Photo, name, handle and profile link share one identity cell; metrics align; mobile cards preserve labelled data and selection. | `src/components/MembersTable.tsx:123`, `src/styles.css:481` |
| Medium | Library, results and dialogs lacked a consistent layout rhythm. | Shared content edges, control heights, panel padding, table spacing and restrained shadows; list type icons and clearer hierarchy. | `src/styles.css:449` |
| Medium | Loading feedback and overlays lacked coherent motion. | Retrieved 21st spinner/skeleton patterns, short dialog/drawer/control transitions and actual progress-bar changes. All motion stops with reduced-motion preference. | `src/styles.css:550` |
| Medium | Failed library/member/detail loads offered no direct recovery action. | Explicit Try again controls beside the error. | `src/pages/ListsHome.tsx:120`, `src/components/MembersTable.tsx:57`, `src/pages/ListPage.tsx:44` |

## Page and state coverage

- Library: active, archived, search, no matches, loading and error/retry; archive/restore/undo, return URL and pagination.
- Search setup: criteria, platform ranges, suggestions, exclusions, review, autosave and limits; desktop/mobile, light/dark.
- Sourced results: queued, running, complete, partial and failed; per-search counters, saved target, expandable criteria/history, creator rows and empty state.
- Imported list: import report and the shared creator-management surface.
- Overlays: new list, import/file mapping/preview, creator details and edit, Find more and export. Removal confirmations retain the shared modal primitive and were source-reviewed; audit tests do not submit removal.
- Sign-in/access/setup: source-reviewed; shared loading treatment updated. The external Clerk sign-in flow was not exercised with a real account.

## 21st.dev source coverage

Retrieved code was inspected and adapted to the project's native React/plain-CSS primitives and Pluvus tokens; no runtime dependencies were added.

- [Animbits Spinner Loader](https://21st.dev/@animbits/components/loaders-spinner): circular border spinner.
- [Animbits Skeleton Loader](https://21st.dev/@animbits/components/loaders-skeleton): moving shimmer with layout placeholders.
- [Appica Avatar](https://21st.dev/@appica-dev/components/avatar): image and initials fallback.

Existing 21st stepper, native-select, field and checkbox patterns remain in use. `.21st/design.json` and `DESIGN.md` record the expanded design decisions.

## Verification

- TypeScript checks passed.
- All 50 app tests passed.
- Production build and browser-bundle secret scan passed; package dependencies unchanged.
- Existing sourcing-polish browser suite passed: archive races/restore/undo, last-page recovery, URL navigation, validation, suggestions, autosave, reload, count limits, mobile and dark mode.
- `scripts/e2e-ui-audit.mjs` passed on an isolated sample app: distinct API counter fixtures, valid/broken/absent photos, drawer focus restore/trapping, reduced motion, all search statuses, import preview, dialogs, loading, error/retry and no document overflow at 320/390/768/1440px.
- Full built-UI journey against the real local API and embedded Postgres passed: import/deduplication, brand search, exclusion union and retained selections, criteria/limits/autosave, sourcing, reload, creator drawer, selection, selected CSV download, Find more without duplicates, derived-list exclusions and library Back. Provider and evaluator were fakes, so no paid calls were made.
- 21st deterministic review: 0 errors before and after. One existing autofocus warning is intentional: the rename input only mounts following an explicit Rename action. The 51 informational color suggestions concern theme-token definitions and pre-existing overlay/hover values, not new arbitrary component colors. Reports: `review-before.json`, `review-after.json`.

Screenshots in `screens/`, `regression/`, and `journey/` are local test evidence with sample/fake providers. The photo and distinct counters in `screens/` are test fixtures. Real data continues to come from the existing API. No paid creator/model calls or production data changes were made. Changes have not been deployed.

## Second pass

See [component-review.md](component-review.md) for the current component inventory, slow-request animation verification, additional fixes and latest regression status. Release verification is 52/53 app tests against the matching email-backend dependency (PR #491); UI/typecheck/build checks pass. The previous contract mismatch was the older backend checkout, not the matching API client.
