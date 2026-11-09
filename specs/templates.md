# Experimental Template packages

ClawHub's Template support implements the registry side of the merged
[OpenClaw RFC 0016](https://github.com/openclaw/rfcs/blob/main/rfcs/0016-templates.md),
the experimental portable-core addendum in
[RFC #48](https://github.com/openclaw/rfcs/pull/48), and the application-layer
follow-up in [RFC #52](https://github.com/openclaw/rfcs/pull/52). A
Template package describes one complete new agent using the grouped `CLAW.md`
schema. ClawHub owns publication, ownership, discovery, package detail APIs,
and hosted feed export. OpenClaw remains authoritative for local planning,
consent, new-agent addition, and provenance.

The YAML frontmatter is the portable manifest. A `CLAW.md` package envelope may
be frontmatter-only. When its body contains non-whitespace text, the exact body
text is the implicit managed `SOUL.md` workspace file; an empty or whitespace-only
body creates no implicit file. The manifest must not declare a workspace
destination that equals, contains, or is contained by that implicit `SOUL.md`
path. The exact `CLAW.md` bytes, including the body, remain in the immutable
artifact digest and provenance input. Grouped JSON has no body, creates no
implicit file, and may declare `SOUL.md` explicitly.

`CLAW.md` is the single configuration entry point, retaining `schemaVersion: 1`.
Its `agent` object carries identity and purpose plus supported native `groupChat`,
`sandbox`, `tools`, `memory`, `heartbeat`, and `humanDelay` settings. Native
`tools.profile` selects a bounded tool policy. The existing bounded tool, memory
consent, path and environment restrictions remain enforced.

Top-level `skills` and `plugins` contain exact `{ref, version}` ClawHub references.
A single source-aware inventory (`kind`, `source`, `ref`, `version`) drives
validation output, bounded summary counts, release detail APIs and website lists.
Template version and artifact SHA-256 remain on the existing release envelope;
declared dependencies do not imply installed or connected state.

Retired `packages`, `profiles`, `extensions`, `cronJobs`, `profiles/` files and
`metadata.openclaw.config` fail with migration guidance. There is no profile
compatibility mode or grandfathered publication exception. Existing archives and
ordinary agents remain unchanged. Bundled path installation belongs to the next
slice and is not accepted by this reference-only stage.

Scheduled work uses `automations`. Optional `enabled: false` preserves a paused
declaration for the native scheduler; omission retains enabled behavior. Summary
`cronJobCount` counts all declarations, including paused jobs.

The representative vectors in `fixtures/templates/conformance-v1/cases.json`
keep observable native agent/tool/heartbeat acceptance aligned with OpenClaw.

An optional package-root `BOOTSTRAP.md` carries reviewed first-run instructions.
It must be bounded, nonempty UTF-8 text and cannot also be targeted through the
portable workspace file map. Its presence is included in the bounded manifest
summary, while its contents remain only in the exact immutable artifact.
Schemas, templates, examples, fixtures, and static assets require no special
registry role: they remain ordinary declared `workspace.files` covered by the
artifact digest.

## Detail description disclosure

Template detail headers show at most two lines of the description by default so
long summaries do not push the publisher and installation surface down the page.
When the rendered text overflows two lines, a keyboard-accessible “Read more”
button reveals the complete, unchanged description; “Show less” collapses it
again. Short descriptions have no disclosure control. Overflow is measured from
the actual layout and rechecked on resize and font readiness, not inferred from
character count. Route metadata and registry descriptions remain untruncated.

## Catalog artwork

A Template may package `assets/icon.png` for its catalog artwork, independently of
its portable `agent.identity.avatar`. Publication validates the PNG bytes,
decodability, size and uploaded digest through the shared package-icon path.
Only the resulting content-addressed `/api/v1/skill-icons/<sha256>` asset is
projected into the Official Template feed; arbitrary URLs are not accepted there.
Missing or invalid artwork preserves the consumer's fallback. Templates do not use
the bundled-plugin GitHub asset recovery path. Artifact and security gates are
unchanged, and catalog metadata becomes visible only after publication.

## Launch contract

- Backend Template publication and exact-name reads are available by default.
- ClawHub exposes scoped detail pages at `/<owner>/templates/<slug>`. There are
  no dedicated browse, upload, or settings tabs for Templates. OpenClaw owns
  local Labs visibility, inspection, consent, and new-agent addition.
- Template publication still requires validation, moderation, ownership, and
  scanner checks.
- Detail pages present release security-audit status and details in the Security
  audit sidebar, not repeated as inline subtext beneath the install command. This is
  presentational only: CLI and prompt copy remain unavailable unless the package
  scan status is clean and a current release exists. Missing, pending, not-run,
  suspicious, and malicious scan states do not become ready to add.

The public catalog (package lists and search) includes eligible community and
official Templates. Every catalog read rechecks that the current publisher row is
active and its handle matches the package scope; cached search digest owner
fields are not sufficient after a publisher is deactivated, deleted, or renamed.
The existing publication, visibility, access, moderation, and scanner gates
still apply. Community entries carry creator attribution without an Official
badge. An Official designation is not required for community discovery.

The separate Official Template feed contains only canonical `@openclaw/*` Templates
owned by the active OpenClaw publisher organization with a current Official
designation. Other publishers may publish Templates under their own scope and
their published Templates remain reachable by exact-name metadata and artifact
downloads, subject to the existing ownership, scanner, moderation, and access
rules. If a Template has a publisher row, admission and finalization recheck that
it is active and matches the package scope. Legacy user-owned Templates without a
publisher row continue through the existing user-owner and scan path, but are
not admitted to the public Template catalog. Losing an Official designation does
not by itself withdraw a published artifact, remove an otherwise eligible
Template from community discovery, or prevent further publication.

The Template feed is a stored snapshot, so a pre-policy snapshot must fail closed
after deployment. A new snapshot records the restricted policy version, entry
count, and current publisher identity. The HTTP feed returns no stored bytes
until that snapshot is built; if its publisher later loses active authority, it
fails closed again until an empty or newly authorized snapshot replaces it.
Rollout must refresh the feed with the production catalog publication workflow
and verify eligible community discovery, exclusion of private, pending, blocked,
and scope-mismatched packages, direct package continuity, and revoked Official
publisher effects on the separate feed.

There is no Template feature flag to turn off for rollback. Revert or fix the
backend on `main` and run the production deploy workflow, retaining the
fail-closed Template-feed read guard in the rollback build. A code deploy does not
restore or clear the stored feed snapshot. Rebuild it under the current policy,
or replace it with an empty policy-stamped snapshot and prevent the scheduled
publisher from repopulating it until the incident is resolved. Verify that
`/v1/feeds/templates` returns no old payload bytes before restoring catalog traffic.

## Implementation history

The linked stages record earlier implementation work. Deployment feature flags
used in those stages are no longer present; the launch contract above describes
current publication and discovery behavior.

1. Add the shared grouped manifest contract, safe summary, and storage model
   ([PR #3089](https://github.com/openclaw/clawhub/pull/3089)).
2. Add feature-gated authenticated publication, package-content validation,
   CLI authoring support, and authoring docs
   ([PR #3090](https://github.com/openclaw/clawhub/pull/3090)).
3. Add feature-gated search, detail, and API surfaces
   ([PR #3091](https://github.com/openclaw/clawhub/pull/3091)).
4. Add a separately gated hosted Templates feed and a repeatable published-package
   proof through OpenClaw `templates add --dry-run`
   ([PR #3092](https://github.com/openclaw/clawhub/pull/3092)).
5. Validate the portable `CLAW.md` prompt body, project it as managed
   `SOUL.md` capability metadata, and prove the feed-to-OpenClaw mapping
   ([PR #3262](https://github.com/openclaw/clawhub/pull/3262), stacked after
   PR #3092).
6. Adopt conventional harness profiles, package-root bootstrap, native
   OpenClaw extensions, and ordinary application assets
   ([PR #3328](https://github.com/openclaw/clawhub/pull/3328)).

The hosted projection uses the separate
[experimental Template feed contract](experimental-template-feed.md), not an extension
of the stable plugin/skill catalog feed v1 schema.

The shared validator follows the RFC's strict v1 contract: strings are not
trimmed into validity, MCP package selectors must resolve exact versions,
process environment keys follow OpenClaw's host-wide safety policy, and tool
filters accept only exact names plus `*` wildcards. Registry validation must
not accept a declaration that the applying OpenClaw client rejects.

`OPENCLAW_TEMPLATE_HOST_ENV_POLICY_V1` is the versioned cross-repository
compatibility artifact for that environment policy. It records the exact
OpenClaw source path, consumer commit, and source-file SHA-256; ClawHub derives
its blocked-key lookups from the artifact and runs every key/prefix as a
conformance vector. A policy change requires a new reviewed artifact version or
an intentional update of the existing experimental v1 contract.

Manifest rejections expose stable `template_v1_*` diagnostic codes with phase
`schema`, plus the field path and human-readable message. Consumers may branch
on the code and phase; messages are explanatory text rather than identifiers.

The durable version document stores the bounded manifest summary and normalized
dependency inventory. Its
field structure is built from `createTemplateManifestSummarySchema` in both the
public ArkType contract and the Convex storage validator. Convex cannot express
the summary text-length caps, so publication must validate or derive summaries
through the shared schema before storage.
Templates use the existing package publication pipeline. `package.json` declares
the package identity, version, and package-relative `openclaw.template` manifest
path. Publication parses `CLAW.md` YAML frontmatter and validates the manifest, native
agent settings, exact dependency references, workspace files and optional bootstrap. A non-empty
Markdown body is the portable agent prompt and maps to managed `SOUL.md`;
publication rejects a body combined with any explicit `SOUL.md` workspace
declaration. The release retains the exact artifact and a bounded derived
summary, including implicit prompt and bootstrap presence, rather than
duplicating the full manifest, prompt body, profile, or bootstrap content into
Convex storage. There is no ClawHub deployment flag for Template publication.
The `family: template` path preserves ownership, moderation, scanning, and release
invariants. OpenClaw independently controls local discovery and addition through
Settings > Labs (`gateway.controlUi.experimental.templates`).

Experimental Template publication is exact-artifact-only:

- The publisher must submit an already-built npm-pack `.tgz`; source folders,
  GitHub checkouts, extracted-file payloads, and the legacy public-action path
  cannot publish a Template release.
- The publisher supplies the canonical lowercase SHA-256 of that tarball.
  ClawHub recomputes the digest from the uploaded bytes before mutation and
  rejects a missing or mismatched digest.
- The verified tarball digest remains the artifact identity through staged
  scanning, finalization, publication status responses, and exact-byte
  download.
- Staged retry identity includes the actor, owner, package name, version, and
  verified artifact digest. Only an exact retry may reuse the same active
  pending attempt or active published release. A different actor, owner, or
  digest, a terminal attempt, or a deleted, blocked, quarantined, revoked, or
  malicious release remains a version conflict.
- Retry compatibility is scoped to Templates. Existing non-Template package behavior
  and historical attempt recovery remain unchanged unless they already carry
  the exact artifact metadata required by their own contract.

## Canonical format and independent persisted storage

Template authoring and registry import use package.json.openclaw.template pointing
to CLAW.md. The retired openclaw.claw selector is rejected, including packages
that also declare the canonical selector. There is no historical archive-reader
exception. All 150 first-party experimental Templates are owned and unused
externally; regeneration is an explicitly owned catalog task, not a reason to
retain obsolete format admission.

This format decision does not rename the database. Physical family: "claw",
clawProfilePolicyVersion, clawManifestSummary and the feed claw* marker columns
remain the persisted storage contract, including package digest indexes. New
public filters/DTOs remain canonical Template names; ordinary plugin and skill
rows and their authority rules are unchanged.

The dedicated feed keeps its physical row ID and sequence. Serving requires a
canonical Template wire payload, its exact stored checksum/count, and current
publisher/policy authority. Old-format snapshots fail closed rather than being
projected. The existing normal publication owner writes canonical payloads into
the same row; no new migration, backfill or runtime policy/configuration is added.

Published package/version/digest coordinates remain immutable. Regeneration must
produce new artifact identities/versions under the catalog owner's authority;
this source cleanup does not authorize rewriting existing bytes, republishing,
deploying or mutating production. Generic archive safety, ownership, scanning,
trust and installability checks remain mandatory and independent of this format.
