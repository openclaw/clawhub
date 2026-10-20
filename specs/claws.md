# Experimental Claw packages

ClawHub's Claw support implements the registry side of the merged
[OpenClaw RFC 0016](https://github.com/openclaw/rfcs/blob/main/rfcs/0016-claws.md),
the experimental portable-core addendum in
[RFC #48](https://github.com/openclaw/rfcs/pull/48), and the application-layer
follow-up in [RFC #52](https://github.com/openclaw/rfcs/pull/52). A
Claw package describes one complete new agent using the grouped `CLAW.md`
schema. ClawHub owns publication, ownership, discovery, package detail APIs,
and hosted feed export. OpenClaw remains authoritative for local planning,
consent, mutation, provenance, update, and removal.

The YAML frontmatter is the portable manifest. A `CLAW.md` package envelope may
be frontmatter-only. When its body contains non-whitespace text, the exact body
text is the implicit managed `SOUL.md` workspace file; an empty or whitespace-only
body creates no implicit file. The manifest must not declare a workspace
destination that equals, contains, or is contained by that implicit `SOUL.md`
path. The exact `CLAW.md` bytes, including the body, remain in the immutable
artifact digest and provenance input. Grouped JSON has no body, creates no
implicit file, and may declare `SOUL.md` explicitly.

The portable agent object carries only identity and purpose. Harness-specific
settings live in package-local profiles discovered at conventional
`profiles/<harness>.yml` paths; the manifest contains no profile pointer.
`metadata.openclaw.config` is retired and rejected with migration guidance.

Profiles exist only inside the Claw package. ClawHub reserves the `profiles/`
namespace for lowercase, single-file harness profiles, requires each profile to
be a bounded UTF-8 JSON-compatible YAML mapping, and rejects aliases, anchors,
tags, merge keys, non-string mapping keys, and non-finite values. It validates
the strict profile-v1 structure of `profiles/openclaw.yml`, including the
built-in profile registry pinned by the conformance artifact, without
installing extensions or claiming compatibility beyond that pinned consumer.
Foreign profiles remain structurally validated but uninterpreted. Applying
harnesses discover only their own profile.

ClawHub validates `profiles/openclaw.yml` no more permissively than the pinned
shipped OpenClaw v1 consumer contract. Registered built-in profiles, bounded
tool grants, extension references, heartbeat settings, and their cross-field
rules must pass before publication. The representative vectors in
`fixtures/claws/conformance-v1/cases.json` record the consumer commit and keep
observable accepted/rejected behavior aligned across repository boundaries.

An optional package-root `BOOTSTRAP.md` carries reviewed first-run instructions.
It must be bounded, nonempty UTF-8 text and cannot also be targeted through the
portable workspace file map. Its presence is included in the bounded manifest
summary, while its contents remain only in the exact immutable artifact.
Schemas, templates, examples, fixtures, and static assets require no special
registry role: they remain ordinary declared `workspace.files` covered by the
artifact digest.

## Catalog artwork

A Claw may package `assets/icon.png` for its catalog artwork, independently of
its portable `agent.identity.avatar`. Publication validates the PNG bytes,
decodability, size and uploaded digest through the shared package-icon path.
Only the resulting content-addressed `/api/v1/skill-icons/<sha256>` asset is
projected into the Official Claw feed; arbitrary URLs are not accepted there.
Missing or invalid artwork preserves the consumer's fallback. Claws do not use
the bundled-plugin GitHub asset recovery path. Artifact and security gates are
unchanged, and catalog metadata becomes visible only after publication.

## Launch contract

- Backend Claw publication and exact-name reads are available by default.
- ClawHub remains headless for Claws. OpenClaw owns local Labs visibility,
  preview, consent, and installation.
- Claw publication still requires validation, moderation, ownership, and
  scanner checks.

The public catalog (package lists and search) includes eligible community and
official Claws. Every catalog read rechecks that the current publisher row is
active and its handle matches the package scope; cached search digest owner
fields are not sufficient after a publisher is deactivated, deleted, or renamed.
The existing publication, visibility, access, moderation, and scanner gates
still apply. Community entries carry creator attribution without an Official
badge. An Official designation is not required for community discovery.

The separate Official Claw feed contains only canonical `@openclaw/*` Claws
owned by the active OpenClaw publisher organization with a current Official
designation. Other publishers may publish Claws under their own scope and
their published Claws remain reachable by exact-name metadata and artifact
downloads, subject to the existing ownership, scanner, moderation, and access
rules. If a Claw has a publisher row, admission and finalization recheck that
it is active and matches the package scope. Legacy user-owned Claws without a
publisher row continue through the existing user-owner and scan path, but are
not admitted to the public Claw catalog. Losing an Official designation does
not by itself withdraw a published artifact, remove an otherwise eligible
Claw from community discovery, or prevent further publication.

The Claw feed is a stored snapshot, so a pre-policy snapshot must fail closed
after deployment. A new snapshot records the restricted policy version, entry
count, and current publisher identity. The HTTP feed returns no stored bytes
until that snapshot is built; if its publisher later loses active authority, it
fails closed again until an empty or newly authorized snapshot replaces it.
Rollout must refresh the feed with the production catalog publication workflow
and verify eligible community discovery, exclusion of private, pending, blocked,
and scope-mismatched packages, direct package continuity, and revoked Official
publisher effects on the separate feed.

There is no Claw feature flag to turn off for rollback. Revert or fix the
backend on `main` and run the production deploy workflow, retaining the
fail-closed Claw-feed read guard in the rollback build. A code deploy does not
restore or clear the stored feed snapshot. Rebuild it under the current policy,
or replace it with an empty policy-stamped snapshot and prevent the scheduled
publisher from repopulating it until the incident is resolved. Verify that
`/v1/feeds/claws` returns no old payload bytes before restoring catalog traffic.

## Staged implementation

1. Add the shared grouped manifest contract, safe summary, and storage model
   ([PR #3089](https://github.com/openclaw/clawhub/pull/3089)).
2. Add feature-gated authenticated publication, package-content validation,
   CLI authoring support, and authoring docs
   ([PR #3090](https://github.com/openclaw/clawhub/pull/3090)).
3. Add feature-gated search, detail, and API surfaces
   ([PR #3091](https://github.com/openclaw/clawhub/pull/3091)).
4. Add a separately gated hosted Claws feed and a repeatable published-package
   proof through OpenClaw `claws add --dry-run`
   ([PR #3092](https://github.com/openclaw/clawhub/pull/3092)).
5. Validate the portable `CLAW.md` prompt body, project it as managed
   `SOUL.md` capability metadata, and prove the feed-to-OpenClaw mapping
   ([PR #3262](https://github.com/openclaw/clawhub/pull/3262), stacked after
   PR #3092).
6. Adopt conventional harness profiles, package-root bootstrap, native
   OpenClaw extensions, and ordinary application assets
   ([PR #3328](https://github.com/openclaw/clawhub/pull/3328)).

The hosted projection uses the separate
[experimental Claw feed contract](experimental-claw-feed.md), not an extension
of the stable plugin/skill catalog feed v1 schema.

The shared validator follows the RFC's strict v1 contract: strings are not
trimmed into validity, MCP package selectors must resolve exact versions,
process environment keys follow OpenClaw's host-wide safety policy, and tool
filters accept only exact names plus `*` wildcards. Registry validation must
not accept a declaration that the applying OpenClaw client rejects.

`OPENCLAW_CLAW_HOST_ENV_POLICY_V1` is the versioned cross-repository
compatibility artifact for that environment policy. It records the exact
OpenClaw source path, consumer commit, and source-file SHA-256; ClawHub derives
its blocked-key lookups from the artifact and runs every key/prefix as a
conformance vector. A policy change requires a new reviewed artifact version or
an intentional update of the existing experimental v1 contract.

Manifest rejections expose stable `claw_v1_*` diagnostic codes with phase
`schema`, plus the field path and human-readable message. Consumers may branch
on the code and phase; messages are explanatory text rather than identifiers.

The durable version document stores only the bounded manifest summary. Its
field structure is built from `createClawManifestSummarySchema` in both the
public ArkType contract and the Convex storage validator. Convex cannot express
the summary text-length caps, so publication must validate or derive summaries
through the shared schema before storage.
New summaries also expose only the profile/extension footprint: total harness
profiles, conventional OpenClaw profiles, and OpenClaw-native extension count.
They never expose profile contents.

Claws use the existing package publication pipeline. `package.json` declares
the package identity, version, and package-relative `openclaw.claw` manifest
path. Publication parses `CLAW.md` YAML frontmatter or the JSON compatibility
form and validates the grouped manifest, referenced workspace files,
conventional harness profiles, and optional package-root bootstrap. A non-empty
Markdown body is the portable agent prompt and maps to managed `SOUL.md`;
publication rejects a body combined with any explicit `SOUL.md` workspace
declaration. The release retains the exact artifact and a bounded derived
summary, including implicit prompt and bootstrap presence, rather than
duplicating the full manifest, prompt body, profile, or bootstrap content into
Convex storage. The server rejects
`family: claw` before mutation when the experimental gate is disabled; the gate
does not bypass ownership, moderation, scanning, or release invariants when
enabled.

Experimental Claw publication is exact-artifact-only:

- The publisher must submit an already-built npm-pack `.tgz`; source folders,
  GitHub checkouts, extracted-file payloads, and the legacy public-action path
  cannot publish a Claw release.
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
- Retry compatibility is scoped to Claws. Existing non-Claw package behavior
  and historical attempt recovery remain unchanged unless they already carry
  the exact artifact metadata required by their own contract.
