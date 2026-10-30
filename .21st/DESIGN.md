# Pluvus sourcing design context

React, TypeScript and Vite. Use the Pluvus light and system-dark tokens in `src/styles.css`, Inter for controls, and Fraunces for page titles. Native controls and existing primitives are preferred; no new runtime dependencies.

The sourcing editor has three steps: Criteria, Exclusions, Review & search. Each step owns one primary action. Platforms use checkbox tiles with optional range inputs. Every criterion has a labelled control and a semantic Lucide icon; suggestions are marked explicitly and existing values require acceptance before replacement.

The library has distinct Active lists and Archived views. Archive and Restore are labelled reversible actions. Filters are applied on the backend before pagination. Detail links retain their originating library URL.

Reference and component decisions: `artifacts/sourcing-redesign/research.md`.
