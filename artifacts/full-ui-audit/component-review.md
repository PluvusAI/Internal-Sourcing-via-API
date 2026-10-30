# Second pass: every component and asynchronous state

30 October 2026. This pass checks each React component in the current app and deliberately holds requests open to inspect pending states. The initial audit is in `audit.md`.

## Fixed on this pass

- Loading creator tables and pages now show a visible spinner and action label alongside shimmer placeholders.
- Empty live results use a larger spinner. Existing rows remain visible during refresh, with an updating status; newly arriving rows enter briefly without restarting animations on existing rows.
- Refresh shows its pending state and disables repeated clicks. Creator totals remain visible beside the section title.
- Selection writes show a spinner; export waits until the selection is saved, so checked rows and downloaded rows agree.
- Profile pictures shimmer while their actual URL loads, then fade in. Missing/broken images keep initials.
- New list, import, creator editing, rename, Find more, CSV export and email lookup have action-specific pending text and spinners. Submitting dialogs lock relevant fields and dismissal; focus remains inside even when all buttons are disabled.
- Export formats, import validation, exclusion-union counts and email cost previews expose loading and error recovery. Import counts are hidden while their mapping is being rechecked.
- Email previews refresh on reopening, including after the saved selection changes; start stays disabled until the current preview is available.
- Creator pagination retains disabled navigation during loading and removes old actionable rows until the requested page arrives.
- Pending status dots, short row/notice/tag transitions and image transitions respect reduced motion. Spinner rotation was checked across actual rendered frames, not just by looking for a CSS class.
- Creator drawers no longer repeat platform, handle and audience metrics already shown in the profile header. Archived lists describe their read-only state accurately. Desktop row actions are compact, named and titled; mobile keeps their text labels.

## Component inventory

| Components | Review / expected feedback |
| --- | --- |
| App, ClerkGate, AppLoading, Shell, SetupRequired, Centered | Labelled initial/access loading; app-server retry; sticky shell/content alignment; explicit setup errors. External Clerk authentication is source-reviewed. |
| Spinner, LoadingStatus | Shared 21st border spinner; visible or accessible action name; larger empty-search variant; actual animation checked; none under reduced motion. |
| Skeleton, TableSkeleton, PageSkeleton | Shimmer placeholders plus visible spinner label, accessible status and stable data area; no nested status announcements in the page placeholder. |
| StatusBadge | Truthful state label; only queued/sourcing dots pulse. |
| Notice | Consistent semantic error/info/success treatment; short entry on mount. |
| ProgressSteps | Current/completed/upcoming stages follow import state; native semantics. |
| NativeSelect | Labelled native picker, consistent chevron/control geometry, disabled styling. |
| Modal, Drawer, useFocusTrap | Entry animation; Escape, backdrop, Tab/Shift+Tab, focus restore and body scroll lock; focus retained during submission. |
| TagInput | Enter/comma/blur commit and Backspace/remove behavior; labels/errors; wrapping and removal target; brief entry animation. |
| Pager | Accurate range, first/last disabled state; navigation retained and disabled while creator pages load. |
| CreatorAvatar | Actual image, loading shimmer/fade, failed/missing URL initials; decorative beside the creator's accessible name. |
| CreatorManagement | Saved total, live/archived copy, Refresh pending feedback, membership notices and email-job state. |
| MembersTable, CreatorDrawer | Initial loading, live empty state, incremental results, refresh, optimistic selection/save, page-vs-all selection, metrics, named actions, photo/profile, detail focus, complete fit reason in drawer. |
| CreatorDialog, RemoveCreatorsDialog, RemoveListDialog, RemoveListAction | Clear identity/details/confirmation forms, pending feedback, guarded submissions and dismissal, errors; destructive actions are not needed for the audit and are not submitted. |
| NewListDialog | Name validation, create spinner/text, disabled actions, guarded dismissal, success navigation/error. |
| FindMoreDialog | Current limit loading/error, preserved entered count, start spinner/text, readonly pending input, disabled dismissal. |
| ExportDialog | Metadata loading/retry, exact scope, locked format/scope during preparation, pending spinner/text and download confirmation. |
| ImportDialog, Stat | File validation, mapping, current-preview loading, row issue filters, partial acknowledgement, commit feedback and saved-report counts. |
| CriteriaFormFields | Labelled platform/range/content/location/language/brand controls, validation and suggestion provenance; static inputs remain usable without decorative loops. |
| ExclusionPicker, ListPreview | Search/loading/empty/error, retained selections, animated union counting, photo previews, paging and retry. |
| ListsHome | Active/archive/search states, loading/result/empty/error, safe actions, archive feedback and URL-backed navigation. |
| ListPage, ArchivedListBanner, DraftEditor, SaveIndicator | Detail loading/retry, restore pending, three steps, autosave/revision protection, suggestions, start state and navigation guard. |
| ListWorkspace, RenameTitle | Current operation; selection/export synchronization; rename pending/read-only/cancel; responsive action layout. |
| SourcedSummary, OperationFacts | Actual considered/qualified/excluded/duplicate counters, saved target progress, queued/running/complete/partial/failed messages, cumulative activity and history. |
| ImportSummary, Fact | Saved import counts and issue report use shared surfaces; static count data is not represented as an ongoing operation. |
| EmailCell, EmailProgress, FindEmailsDialog | Per-row pending indicators, job progress and terminal state, current cost/scope preview, pending start/dismissal lock and retry. Tests intercept email start/job responses; no paid lookup is made. |

## Verification and limits

- TypeScript, production build and bundle secret scan pass.
- `e2e-component-states.mjs` verifies slow page/table loads, actual spinner rotation, shimmer, photo arrival, row retention during refresh, selection/export ordering, submitting focus, rename, Find more, email preview/job lifecycle, import, create, autosave, suggestions, exclusion counting, pagination, reduced motion and widths 320/390/768/1440.
- `e2e-ui-audit.mjs` rechecks photos/fallbacks, counter labels, all search outcomes, drawer focus, dialogs, error recovery, mobile/dark mode and overflow.
- `e2e-sourcing-polish.mjs` rechecks archive races/restore/undo, library URL navigation, draft validation, suggestions/autosave, limits and responsive steps.
- 21st deterministic review: 0 errors; the existing rename autofocus warning remains intentional following the explicit Rename action. Original theme-token color suggestions remain informational.
- Release verification: all 52 app tests pass with `SOURCING_BACKEND_DIR=../creator-email-backend npm test`. The earlier mismatch came from comparing the app with an older backend checkout. The client is byte-identical to the matching backend dependency in PR #491; the contract guard is unchanged. The backend email DB scenarios and server typecheck also pass.

`component-states/` contains held-request screenshots. `second-pass/` contains the final layout/state captures. Live provider calls, real Clerk sign-in and production deployment are outside this local UI verification.
