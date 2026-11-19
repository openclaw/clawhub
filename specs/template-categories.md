---
summary: "Template category taxonomy: one category per Template, first-declared-else-classify, removed slugs kept as read filters."
read_when:
  - Changing TEMPLATE_CATEGORY_DEFINITIONS or the Template classifier
  - Changing category validation in CLAW.md
  - Changing the Template list, search, or overview category filters
  - Rewriting stored Template categories
---

# Template categories

Decided 2026-11-18 after an audit of the community-published Templates. The earlier twelve
categories did not match what people publish: Personal had become a catch-all, and Governance,
People and Finance held no community Template.

## The set

Ten categories, in display order: Engineering, Operations, Household, Entertainment, Travel,
Productivity, Research, Health, Sales, Product. `other` is the internal uncategorized bucket and
comes last. The definitions live in `TEMPLATE_CATEGORY_DEFINITIONS` in
`packages/schema/src/catalogMetadata.ts`.

- Household covers home, family, pets, meals and household logistics.
- Entertainment covers games, music, hobbies and learning for fun. A tutor and a
  language-practice partner belong here.
- A personal job search belongs under Productivity.

Each definition's `description` is the classifier's entire guidance for that category. Keep the
ten distinguishable from each other when editing one. `icon` is a Lucide icon name for whichever
client draws the chips; the ClawHub site shows a Template's category as text only.

## One category per Template

A Template is listed under exactly one category. The stored and API field is still the
`categories` string array, now with one entry, so API clients written against the array keep
working.

Assignment at publish, in `classifyTemplateCategories`:

1. If `CLAW.md` declares `categories` and the first slug is in the current set, use it. Ignore
   the rest.
2. Otherwise classify the Template with the model, which returns one slug from the current set.
3. If classification is unavailable or returns anything else, store `other`.

Step 2 applies when `categories` is absent, when the first slug is unknown, and when it is a
removed slug. It never falls through to a later declared slug: an author who led with a category
ClawHub no longer has gets a fresh classification, not their second choice.

**A category never fails a publish.** Taxonomy membership is not validated anywhere on the
publish path.

**The manifest's structural limits stay.** `validateTemplateManifest` still requires one to three
unique lowercase slugs when `categories` is present. Released OpenClaw versions enforce the same
limits when a user adds a Template (`src/templates/schema.ts` in `openclaw/openclaw`), without
checking membership in any set. Accepting an empty list, four entries or duplicates here would
publish a Template those clients refuse to add. Do not relax these checks without first changing
the client. Every community Template published before the change still validates unchanged.

## Removed slugs

`personal`, `governance`, `finance` and `people` left the set. They are recorded in
`LEGACY_TEMPLATE_CATEGORY_DEFINITIONS`.

They remain valid **read filters**: `GET /api/v1/packages` and `/api/v1/packages/search` with
`family=template&category=<removed slug>` answer 200 with the Templates that still store that
slug. Two facts make this necessary:

- First-party Templates keep them in stored data (see below).
- Released OpenClaw versions hard-code chips for all twelve old slugs and request them by slug.
  Rejecting the slug would turn a chip into an error.

The filter is exact. A removed slug that nothing stores returns an empty page, never the
unfiltered catalog. A slug that was never a Template category still returns
`400 Invalid Template category`.

They are **not** accepted anywhere else:

- not as a declared category (the Template is classified instead);
- not offered to the classifier, and rejected if the model returns one;
- not a section of `GET /api/v1/templates/overview`, which iterates the current set plus `other`;
- not a chip on any ClawHub surface.

A Template that stores only removed slugs therefore appears in no overview section. It is still
listed, searchable, installable, and reachable through its removed-slug filter. The detail page
keeps a display label for a removed slug so it does not show a raw slug.

Released OpenClaw versions build their category rows from their own hard-coded chip list and
drop overview sections they do not recognize. Until OpenClaw ships the new chip list, those
versions show no row for Household or Entertainment. This is a client limitation, not something
the registry should paper over by reporting new categories under old names.

## First-party Templates are not rewritten

Listings owned by the `openclaw` publisher were out of scope for the change and keep whatever
they stored, including removed slugs and more than one category. Readers must tolerate both:
category filters match any stored entry, and the overview places a listing under each current
category it stores. Nothing reads a stored array as if it had exactly one entry.

## The 2026-11-18 backfill

Categories are stored on the package at publish time and projected by the package trigger into
`packageSearchDigest` and the `packageTopicSearchDigest` facet rows. Changing the definitions
moves no existing listing.

`maintenance:backfillTemplateCategoriesInternal` rewrites the 32 community listings named in
`convex/lib/templateCategoryBackfill.ts`. Twenty-one keep their first category, which is also
what republishing their unchanged `CLAW.md` assigns. Eleven led with a removed category and move
to a target the catalog owner chose by hand; those targets cannot be derived by rule (`tutor`
moves to Entertainment). Republishing one of those eleven is classified and may land elsewhere.
That is accepted.

Invariants for this and any later rewrite of stored Template categories:

- Patch `packages.categories` through a mutation from `convex/functions.ts` so the trigger
  rewrites every projection in the same transaction. Never patch a digest row directly.
- Guard on the stored value. A listing whose categories match neither the reviewed starting
  value nor the target is skipped and reported, because its author may have published since.
- Check the owner. Never rewrite a listing owned by `openclaw`, or one whose owner is no longer
  the publisher the mapping was reviewed against.
- Default to a dry run, require an explicit confirmation to write, and be safe to repeat.
- Do not bump `updatedAt`. The listing did not change, and that field orders "recently updated".
- Record each change in `auditLogs` under `package.template_categories.backfill`. Do not reuse
  `package.catalog_metadata.set`: `canonicalizePackageCatalogMetadata` reads that action as proof
  a publisher made their own choice.

A release that was pending its scan when the taxonomy deployed carries categories computed
under the old rules, and promotes them onto the package when the scan completes. If that happens
to a mapped listing after the backfill ran, its stored value returns to the reviewed starting
value, and running the backfill again corrects it.

The backfill function and mapping are temporary. Remove them in a follow-up once the production
run is verified.
