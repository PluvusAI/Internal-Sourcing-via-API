# Sourcing setup and archive redesign

Scope: the list library's archive controls, navigation back to the library, and sourcing setup steps 1–3. An operator creates a named creator list, chooses supported criteria and exclusions, reviews the requested count, and starts one search.

Preserved: Pluvus light/system-dark tokens, Inter/Fraunces fonts, Lucide icons, supported API fields, named lists, autosave and revision fencing, existing exclusion semantics, idempotent starts, backend-owned count limits, import/review/export/Find more. No new runtime dependencies.

Problems: Archive followed by Show archived mixed active and archived rows; archive mutations left detail/library/picker caches inconsistent; the final page could become empty; back links lost library state; the old side-by-side setup put the long criteria form beside later steps; field controls and suggestions lacked a consistent hierarchy.

## Mobbin Deep Research

All references below were returned by deep search and their images inspected. They lend structure; branding, colors, data and type are Pluvus's.

| Decision | Viewed evidence | Applied |
| --- | --- | --- |
| Distinct archive destination | [Zendesk](https://mobbin.com/screens/2e552329-c1cc-4132-9d4d-6734924091c6), [Matter](https://mobbin.com/screens/344f302f-87b5-47f5-bb73-3db1dda84227) | Active lists / Archived navigation, accurate server filtering and Restore |
| Setup with explicit stages and one forward action | [Apollo](https://mobbin.com/screens/78c77f00-7150-4bfb-9996-619b87b2c041), [Gusto](https://mobbin.com/screens/ea1a0dec-cb6a-4cab-9995-e0ddb3082700) | Criteria → Exclusions → Review & search |
| Group criteria by purpose with semantic filter icons | [Apollo](https://mobbin.com/screens/78c77f00-7150-4bfb-9996-619b87b2c041), [Clay](https://mobbin.com/screens/0586792a-9562-4e22-b4cc-c44bc3f38d72) | Platforms/ranges, content and fit, location/language, optional brand context |
| Explicit exclusion selection and retained picks | [Flodesk](https://mobbin.com/screens/7d397ccf-191d-4b63-80b1-bd4906855d90), [15Five](https://mobbin.com/screens/22d3c705-9098-4dc1-b16a-fc394fadb59b) | Selected lists above searchable checkbox rows; existing all-matching and unique-union behavior retained |
| Review suggested filters before replacement | [Apollo](https://mobbin.com/screens/ca9a3e08-dfba-47b7-bcc2-762f02f50ef9) | Explicit Use suggestion / Keep mine actions; suggested fields marked until edited |

Dropped: Coursera's centered single question (too sparse for this criteria form); Pin's decorative sidebar (not useful to the sourcing task); Luma AI's asset gallery (different job); Aboard/Tines archive captures added no decision beyond the selected archive references.

## 21st.dev component coverage

Retrieved source was inspected and adapted to the app's native controls and existing primitives. The app uses plain CSS, so copying Tailwind/Radix/motion implementations would add duplicate infrastructure.

| Region | 21st component | Implementation choice |
| --- | --- | --- |
| Step navigation | [Stepper with Square Badges](https://21st.dev/@shadcnspace/components/stepper-01) | Native keyboard-operable buttons, current-step state, URL navigation; no animation dependency |
| Platform selection and ranges | [Checkbox with expansion](https://21st.dev/@originui/components/checkbox) | Native checkboxes in selectable tiles with conditional range fields |
| Labels, inputs and descriptions | [Label with Helper Text](https://21st.dev/@cnippet-dev/components/v-label-9) | Existing input/textarea/TagInput, labelled and wired to hints/errors |
| Criteria suggestions | [AI Suggestions](https://21st.dev/@educalvolpz/components/ai-suggestions) | Explicit suggestion rows and acceptance; semantic icons and Sparkles provenance markers |
| Exclusion selection | [Combobox](https://21st.dev/@uvain/components/combobox-multi-create) | Existing persistent checkbox multiselect retained for preview, pagination and select-all-matching; selected chips moved beside summary |
| Archive navigation | [Segmented Tabs](https://21st.dev/@micka_design/components/tabs-base) | Native navigation controls with aria-current; archive is a URL-backed destination |
| Library actions | [Table Row Actions](https://21st.dev/@felipemenezes098/components/table-row-actions) (catalog metadata) | Kept Archive and Restore visible and labelled; compacted Use criteria, avoiding an unnecessary menu |

Review & search summarizes actual draft fields, platform ranges and exclusions beside the requested count. Existing Notice, Spinner, Pager, Modal and status badges are reused. Field-specific icons use the installed Lucide set; Camera, Music2, Video and Globe2 identify platform media types alongside names.

## Verification

- App typecheck, production build and secret scan.
- App test suite including archive filter forwarding, mock lifecycle and return-navigation safety.
- Real HTTP sourcing API suite against embedded Postgres, including archive-only pagination/totals, restore, exclusion snapshots and the legacy includeArchived flag.
- Focused browser regression: switching archive views during pending writes, restore/undo, last-page recovery, archived draft controls, preserved library state, step validation, suggestions, Back/Forward/reload, no horizontal overflow at 390px, and light/dark renders.
- Full built-UI journey against embedded Postgres: import, exclusion union, source, reload, drawer, selection, both export paths, Find more, reused criteria and library Back.
- Browser limit checks: initial and Find more forms, over-limit disabling and stale-limit refusals with unchanged saved counts.
- 21st local deterministic review: no errors. Findings concern existing CSS token definitions and pre-existing rename autofocus. CLI source was inspected after the initial approval rejection; the local review transmits only aggregate counts/rule IDs, not source code.

Deploy the backend's additive archivedOnly filter before or together with the app. No database migration is needed.
