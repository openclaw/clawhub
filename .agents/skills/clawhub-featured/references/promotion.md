# Authorized Featured promotion

Require an explicit request to feature an exact item. Record the request reference,
requester, item identity, and reason in the existing review evidence. Resolve any
ambiguity about the identity or requested operation before writing. Read the
deployed `clawhub-moderation` skill for staff-operation rules and use the existing
authenticated admin CLI.

## One item

Re-read the public listing, current version/security/installability, current
Featured membership, and current slot capacity. Prefer the current recommendation
report; refresh evidence when it is stale. A report is evidence, not authorization.
If already featured, report that state without removing and adding it again.

These existing commands apply immediately; they have no dry-run, `--yes`, or
`--reason` option. Run only the exact authorized command after review:

```sh
bun run admin -- packages feature '@owner/package' --json
bun run admin -- skills feature '@owner/slug' --json
bun run admin -- skills feature 'skills-sh:owner/repo/slug' --json
```

Native skill slugs are not globally unique: use the owner-qualified ref. External
skills keep their `skills-sh:` provenance and need an existing public installable
mirror entry. Preserve all server checks and staff audit logging. A full shelf or
security refusal goes back to the requester; it does not authorize unfeaturing
another item, clearing a verdict, restoring hidden content, or changing account
state.
The `promotions` command group manages different platform records; use `feature`
for Featured membership.

After a successful command, read back the exact listing and public Featured shelf
and, where available, its staff audit record. Report the command result,
verification, and request reference. A membership command may trigger the existing
skill Featured notification.
If the command outcome is uncertain, inspect membership/audit before retrying.

## Complete selection

Only use `featured publish` for an explicitly requested complete replacement,
including removals. Obtain the exact-selection approval required by current
repository policy (`specs/search-insights.md` → “Featured selection”) from its
designated owner before applying. A general staff request or API token does not
substitute for that owner approval. Asking to feature one candidate does not
authorize publishing the report's complete lineup.

Use the saved report's exact identities, versions, order, reasons, install counts,
period, and baseline to construct the existing publication schema. Read current
editorial/publication revisions and preserve pending reservations and external
selections. Consult `docs/http-api.md` → “Staff Featured curation” and
`packages/schema/src/featuredSelections.ts` in the deployed checkout for the exact
schema; do not invent a publication payload.

```sh
bun run admin -- featured publish plugin approved-plugins.json
bun run admin -- featured publish plugin approved-plugins.json --apply
```

The first command is the existing dry-run. Apply only after the required owner
approval covers that exact complete set. Any expired evidence, changed version,
revision conflict, or changed selection requires fresh evidence and review before
applying. Use the equivalent `skill` command only for an explicitly approved skill
selection. Verify the resulting shelf and staff audit evidence and report the
outcome.
