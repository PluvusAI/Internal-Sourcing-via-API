# Creator editing and AI assistant

| List stage | Available journey |
| --- | --- |
| Draft | Edit criteria/name/exclusions, add/edit/remove known creators, archive, or remove the list. Added creators are skipped when the first search finds additional profiles. |
| Searching | Read progress/results and export saved rows. Wait for the search to finish before changing membership or removing the list. |
| Finished | Add/edit/remove creators, rename/export, Find more, or create a new draft using the saved criteria. Changed search criteria belong to the new draft so old fit decisions keep their meaning. |
| Archived | Review/export, restore to edit, or remove from the library. |

Adding a creator accepts a profile URL or platform + handle. A duplicate returns the existing row;
explicitly adding a removed profile restores it. Editable details are name, supplied email,
location, and language. Identity corrections use remove + add so a sourced fit reason cannot
silently become attached to a different profile.

Single-row and bulk removal use a confirmation showing the exact scope. Other lists are not
changed. Removed profiles stay excluded from future searches on this same list. Existing running
searches keep their snapshots; future searches that exclude an edited list use its current visible
members. Removing a draft/archived list hides it from the library while preserving historical
searches and existing exclusion references. This is not a personal-data erasure operation.

The criteria assistant calls OpenRouter from the app server after `OPENROUTER_API_KEY` is added to
this app's Secrets. `OPENROUTER_MODEL` is optional. The UI explains missing configuration; model
errors, credits, timeouts, and invalid output have distinct messages. No key or model response is
logged, and model output never starts a search or silently replaces entered values.

Components adapt 21st.dev's [Table Dialog](https://21st.dev/@ruixen.ui/components/table-dialog),
[Table Row Actions](https://21st.dev/@felipemenezes098/components/table-row-actions), and
[AI Assistant Card](https://21st.dev/@ahmedmayara/components/ai-assistant-card) to existing app tokens.
Mobbin references inspected include [Lightfield contact removal](https://mobbin.com/screens/2668cfe1-73f2-4237-9731-f5e93cf6bfe9)
and [Whop archive confirmation](https://mobbin.com/screens/4f8e97a0-0e59-4ef9-87eb-2126c4f5b39d).
