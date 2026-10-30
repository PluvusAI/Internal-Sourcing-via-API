# Pluvus sourcing design context

React, TypeScript and Vite. Use the Pluvus light and system-dark tokens in `src/styles.css`, Inter for controls, and Fraunces for page titles. Native controls and existing primitives are preferred; no new runtime dependencies.

The sourcing editor has three steps: Criteria, Exclusions, Review & search. Each step owns one primary action. Platforms use checkbox tiles with optional range inputs. Every criterion has a labelled control and a semantic Lucide icon; suggestions are marked explicitly and existing values require acceptance before replacement.

The library has distinct Active lists and Archived views. Archive and Restore are labelled reversible actions. Filters are applied on the backend before pagination. Detail links retain their originating library URL.

Reference and component decisions: `artifacts/sourcing-redesign/research.md`.

All pages share a consistent content edge, control height and table rhythm. Search results lead with real per-search counters and target progress, followed by expandable criteria and activity. API profile photos appear in creator rows, details and exclusion previews, with initials when unavailable. 21st Animbits spinner and shimmer patterns are adapted to CSS; dialogs and drawers use short feedback transitions. Reduced motion disables all animations and transitions. See `artifacts/full-ui-audit/audit.md`.

Second-pass behavior: visible loading labels accompany skeletons, creator refresh retains rows, export waits for saved selection, pending dialogs keep focus and lock their inputs, and pictures show loading feedback before arrival. Component inventory and verification: `artifacts/full-ui-audit/component-review.md`.
