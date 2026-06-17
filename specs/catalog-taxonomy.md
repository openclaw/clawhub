# Catalog Taxonomy Contract

## Categories

- Skills and plugins use separate controlled slug registries from `clawhub-schema`.
- Category slugs name one concept. Plugin categories mirror contribution slots; skill categories
  describe user intent.
- Each item stores up to three category slugs. Unknown slugs are rejected.
- `other` is a fallback and is removed whenever a specific category is present.
- Declaration precedence:
  1. Current publish input from CLI or UI.
  2. Existing stored categories.
  3. Controlled-slug inference.
  4. `other`.
- An explicit empty category array means `other`; only an omitted declaration enables inference.
- Skill inference uses title, summary, and slug. Plugin inference uses manifest contribution fields.
- Metadata files are not author-facing taxonomy declaration sources. Plugin manifests are only used
  for automatic contribution-slot inference.
- Inference only emits controlled slugs and only runs when categories were omitted.
- Backports and non-latest plugin releases do not replace current categories.
- Capability tags are not taxonomy inputs.
- Existing skills without stored categories use deterministic inference into controlled slugs.
- Existing plugins without stored categories remain in `other` until the follow-up corpus backfill.
- Backend deploys run the tracked package and skill catalog digest migrations before contract
  verification so retired category rows are deterministically replaced with controlled inference
  or `other`, and the indexed curated-skill projection is complete before browse traffic relies on
  it.

## Topics

- Authors may supply up to five topics through CLI or UI publish and edit surfaces.
- Stored topics preserve author-facing labels. Lookup uses normalized topic slugs.
- Reserved platform trust labels such as `official`, `featured`, and `verified` are rejected.
- Topics are separate from release tags and are available to browse and exact-topic global search.
- Authors can edit categories and topics from skill and plugin settings.
- Settings show no category override as Automatic; clearing categories removes the stored override.
- Plugin automatic categories are re-derived from the latest stored manifest on every digest sync.
  Legacy bundle releases keep their current category until republish stores that manifest.
- Backports and non-latest plugin releases do not replace current topics.

## Browse

- Skill and plugin browse paths remain separate.
- Public v1 plugin read endpoints accept the retired documented filter slugs as aliases to their
  closest controlled categories. These compatibility aliases never become stored or author-facing
  taxonomy values.
- Category browse places official or curated entries before community entries.
- Skill category browse paginates an indexed curated projection before community results; it does
  not cap the curated corpus or hydrate curated entries outside the requested page.
- Category and topic filters use per-value digest rows that preserve the selected browse sort.
- Publisher profiles group authored items by their first topic when multiple groups exist.

## Follow-Up

The corpus classification and resumable LLM backfill are a separate migration PR. It will populate
missing categories and topics without changing the author input surfaces above. The deploy-time
digest rebuild in this PR only reprojects current stored package data into the controlled taxonomy;
it does not classify the corpus.
