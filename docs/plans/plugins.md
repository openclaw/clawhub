---
summary: "Long-term plan for first-class OpenClaw plugin hosting on ClawHub."
read_when:
  - Planning ClawHub as an OpenClaw plugin registry
  - Defining plugin package verification or compatibility rules
  - Deciding between npm-compat and a native ClawHub plugin API
---

# Plugin Hosting Plan

## Goal

Grow ClawHub into the long-term home for **OpenClaw plugins**.

This should support:

- native OpenClaw plugin packages
- compatible bundle plugins (Codex, Claude, Cursor)
- first-class skills in the same overall namespace
- first-class capability visibility in ClawHub UI and API
- verification that a package is actually for OpenClaw
- compatibility checks against the OpenClaw plugin API boundary
- a clean install/update path for OpenClaw

This should **not** become a general-purpose npm clone for arbitrary packages.

## Decision

Canonical direction:

- **Option 3** is the product model:
  ClawHub becomes the authoritative **OpenClaw plugin registry** with a native
  ClawHub plugin API and first-class plugin metadata.
- **Option 2** is the compatibility layer:
  after the native model is stable, ClawHub may expose a restricted
  **npm-compatible read facade** for OpenClaw plugin packages only.

Why:

- Our real problems are not generic package-registry problems.
- We need strong answers for:
  - is this package actually an OpenClaw plugin?
  - what plugin id and capabilities does it expose?
  - what config schema and UI hints does it declare?
  - what setup/install behavior does it declare in package metadata?
  - what OpenClaw API boundary was it built against?
  - should OpenClaw allow installing it?
- A native ClawHub plugin model answers those directly.
- npm-compat can sit on top later as a transport adapter.

Additional product decision:

- ClawHub should expose **one package catalog** across skills, code plugins,
  and bundle plugins
- every published package must declare exactly one family
- OpenClaw should install both skills and plugins directly from ClawHub
- package identity should be unified, but public routes and install locators do
  **not** need to collapse into one literal slug format
- `package` can remain an internal catalog term; user-facing UX should prefer
  family-specific nouns such as `skill`, `plugin`, and `bundle`

## Constraints

### ClawHub today

ClawHub is currently a text-bundle registry for skills and souls.

Implications:

- it is optimized for versioned text bundles
- publish currently rejects non-text files
- search, moderation, install, and API contracts are skill-centric

That means native OpenClaw plugins do **not** fit the current ClawHub model
without first-class package/artifact support.

### OpenClaw today

OpenClaw plugins are currently two classes:

- **native plugins**
  - package-centric
  - installed from npm specs, local paths, archives, or marketplace sources
  - must ship `openclaw.plugin.json`
  - must declare `openclaw.extensions` in `package.json`
- **bundle plugins**
  - content/metadata packs
  - detected and normalized
  - only selected surfaces are mapped into runtime behavior

Current OpenClaw assumptions:

- native plugin packages are package artifacts first
- npm is the current community source of truth
- compatibility is enforced through docs, exported SDK surfaces, and tests
- there is not yet a clean explicit registry-friendly **plugin API version**

## Product Model

ClawHub should treat registry content as a first-class package catalog with one
shared identity layer.

Top-level families:

- `skills`
- `code plugins`
- `bundle plugins`
- `souls` may remain as a legacy/internal family if still needed, but they
  should not drive the long-term package model

This lets ClawHub support:

- installable OpenClaw skills
- package-backed native OpenClaw code plugins
- compatible Codex/Claude/Cursor bundles
- one shared namespace with clearly different install/runtime semantics

Namespace rules:

- one canonical package identity model across all families
- no separate catalog silo for skills vs plugins
- package names are globally unique across all families
- package names are case-insensitive
- every package needs a canonical normalized key, for example lowercase
- family is required metadata and part of every browse/search/install response
- no same-name package can exist once as a skill and once as a plugin
- the canonical package key is an internal distribution identity, not
  necessarily the only public URL or CLI locator
- public locators may stay family-specific:
  - skill pages can remain owner/slug-shaped
  - code plugins can remain package-name-shaped
  - install UX can still use family-aware commands

Package rules:

- one package belongs to exactly one family
- one code-plugin package maps to exactly one plugin id
- one plugin id maps to exactly one live code-plugin package identity
- if a publisher wants multiple code plugins, they publish multiple packages
- package display casing can be preserved for UI, but uniqueness and routing
  must use the canonical normalized package key
- if existing names collide under the new global case-insensitive namespace,
  the oldest publish wins unless a moderator explicitly intervenes
- plugin id transfer or replacement must be an explicit moderated workflow, not
  an accidental publish collision

Current OpenClaw evidence supports this:

- native plugin manifests are singular, with one required `id`
- install state is keyed by one `pluginId`
- the current `extensions/` tree uses one manifest per real plugin package

Current ClawHub gap:

- current skill flows already normalize many slugs to lowercase
- current uniqueness is still family-specific rather than global because skills
  and souls live in separate tables and routes
- moving to one case-insensitive global namespace will require a schema and
  data migration, not just UI changes
- current version handling in some skill flows still assumes semver, so
  publisher-defined version strings will require validation changes too

Important product rule:

- bundle plugins and code plugins must not blur together in install UX
- users must always be able to tell whether a plugin executes code or only
  contributes bundle content
- search results, detail pages, install commands, and trust labels must make
  that distinction obvious

Suggested UX:

- one top-level package namespace
- family tabs and filters inside that namespace
- separate browse tabs or routes for code plugins vs bundle plugins
- separate install commands in docs and UI
- separate filters in search
- explicit `Family: Skill`, `Family: Code Plugin`, or `Family: Bundle Plugin`
  on every detail page
- do not force skills and code plugins through one literal URL shape if that
  makes routing or naming ambiguous

Suggested storage model:

- keep one global package catalog and identity layer
- do **not** force all families through one identical publish/install model
- if needed, use separate release tables per family and unify only at the
  package/discovery layer

## Publishing Model

ClawHub should stay open to community publishing.

Policy:

- everyone can publish if they pass the existing GitHub account age checks and
  any current abuse controls
- publishing should not be restricted to trusted partners or official vendors
- trust is expressed through channels, verification, scans, provenance, and UI
  defaults, not by blocking public publishing

Implication:

- open publishing increases the importance of strong family labels, provenance,
  malware scanning, official-only filtering, and conservative code-plugin
  install UX

## Compatibility Model

Do **not** key install compatibility off daily OpenClaw release versions alone.

OpenClaw can release daily without changing the public plugin contract daily.

Use two separate version axes:

### 1. `pluginApiVersion`

Owned by OpenClaw core.

Properties:

- explicit
- stable
- represented as a SemVer string, not a bare integer
- bumped only when the public plugin contract changes in a breaking way
- used as the main compatibility gate

This is the version that matters for:

- install allow/deny decisions
- registry compatibility badges
- update safety

### 2. `builtWithOpenClawVersion`

Recorded by the plugin release.

Properties:

- exact build-time OpenClaw version
- diagnostic and support metadata
- useful for debugging and provenance
- not the main compatibility gate

### Optional 3. `minGatewayVersion`

Only for plugins that need runtime behavior beyond the stable plugin API
surface.

Use this sparingly.

Package version policy:

- package/release version strings are family-specific
- code-plugin package versions should be valid semver so npm compatibility stays
  real
- skill and bundle package versions can remain publisher-defined
- OpenClaw compatibility decisions should care about `pluginApiVersion`,
  `pluginApiRange`, and optional `minGatewayVersion`, not package version style
- npm-compatible flows for code plugins depend on semver package versions, but
  that is still separate from the core OpenClaw compatibility model
  compatibility model

## API Versioning Policy

Use **SemVer strings** for the plugin API contract.

Recommended format:

- OpenClaw reports a concrete version such as `1.2.0`
- plugin manifests and package metadata declare a compatibility range such as
  `^1.2.0`

Examples:

- OpenClaw runtime: `pluginApiVersion = 1.2.0`
- plugin release compatibility: `pluginApi = ^1.2.0`

Why this format:

- the Node ecosystem already understands SemVer ranges
- additive vs breaking changes are explicit
- ClawHub and OpenClaw can make deterministic allow/deny decisions
- daily OpenClaw release cadence stays decoupled from the contract version

Do **not** model the API contract as:

- a bare integer like `1`
- a date string
- the OpenClaw app version

Practical bump rules:

- breaking contract change: bump major
- additive contract change: bump minor
- docs or internal implementation changes: no API bump
- patch bumps are optional, but can be used if contract wording or edge-case
  behavior changes in a meaningful but compatible way

Keep one global `pluginApiVersion` first.

If the contract later becomes too broad, add capability flags before adding
multiple API version tracks.

## Recommended Metadata

Add plugin compatibility/build metadata to package metadata and extracted
registry metadata.

Example shape:

```json
{
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "compat": {
      "pluginApi": "^1.2.0",
      "minGatewayVersion": "2026.3.0"
    },
    "build": {
      "openclawVersion": "2026.3.14",
      "pluginSdkVersion": "2026.3.14"
    }
  }
}
```

Rules:

- `pluginApi` is required for native plugin packages once the new contract lands.
- `builtWithOpenClawVersion` is required for published releases.
- `pluginSdkVersion` is useful for diagnostics and build provenance.
- `minGatewayVersion` is optional.

Start with one global plugin API version.

Do **not** start with capability-specific API versions such as
`channelApiVersion` or `providerApiVersion`.

Those can be added later only if the single global API version proves too
coarse.

## Capability Metadata

Capability visibility should be a first-class product feature, not a derived
afterthought.

ClawHub should extract and persist a structured capability summary for every
installable package.

High-confidence capability extraction should focus on **declared** and
**registered** plugin surfaces, not speculative behavioral inference.

Minimum capability summary:

- whether the package executes code or is bundle-only
- plugin family and bundle format
- plugin id
- plugin kind when declared (`memory`, `context-engine`, future kinds)
- declared channel ids
- declared provider ids
- declared bundled skills
- declared hooks/settings files
- presence of `setupEntry`
- registered tool names
- registered typed hooks
- registered custom hooks/events
- registered commands/CLI commands/services/gateway methods
- registered HTTP route count
- package-level setup/catalog metadata from `package.json openclaw`
- config schema presence
- config UI hints presence
- whether the release materializes npm dependencies at install time
- whether verification is source-only or covers the dependency graph

Capability source inputs:

- `openclaw.plugin.json`
- package-level `openclaw` metadata in `package.json`
- normalized bundle manifests
- captured plugin registration data from a safe plugin snapshot load

Prompt/system guidance visibility:

- it is realistic to show that a plugin registers prompt-affecting hooks such as
  `before_prompt_build` or legacy `before_agent_start`
- it is realistic to show that a plugin can override provider/model via
  `before_model_resolve`
- it is **not** high-confidence to show the exact injected system prompt text
  unless the plugin explicitly declares it as metadata

Avoid in v1:

- claiming filesystem/network/native-dependency behavior from arbitrary code
  unless it is explicitly declared or clearly labeled as advisory analysis

UI requirements:

- cards and search rows should show a compact capability summary
- detail pages should show a dedicated capability section
- code plugins must always show `Executes code`
- bundle plugins must always show `Bundle content only`
- channel/provider capabilities should be visible before install
- capability data should power filters, not just badges

Suggested filters:

- family
- executes code
- official/community/private
- channel
- provider
- plugin kind
- has setup wizard
- has bundled skills
- verification tier

## Verification Model

ClawHub should not accept arbitrary packages just because they are npm-shaped.

A publishable native plugin package must pass OpenClaw-specific validation.

### Required publish signals

- for code plugins:
  - `package.json`
  - `openclaw.plugin.json`
  - `openclaw.extensions`
  - canonical plugin id
  - config schema
  - source repository URL
  - source commit or tag
  - artifact integrity hash
- for skills:
  - skill manifest/layout metadata
  - source repository URL when available
  - content integrity hash
- for bundle plugins:
  - bundle manifest or recognized bundle layout
  - declared host targets
  - source repository URL when available
  - artifact/content integrity hash

### Recommended package policy

- one published package release maps to one public plugin id
- any scope may be allowed
- official placement is a channel policy, not just a naming convention
- verification state must say whether it covers only the published artifact or
  the fully resolved runtime dependency graph

### Verification tiers

- `structural`
  - valid package
  - valid manifest
  - valid metadata
- `source-linked`
  - source repo, tag, and commit verified
- `provenance-verified`
  - published from CI with attestation
- `rebuild-verified`
  - independently rebuilt or reproduced artifact matches expected source output

Initial rollout policy:

- verification should launch on a small cohort of publisher accounts that
  ClawHub explicitly trusts
- this cohort can expand over time as the pipeline proves reliable
- verification should not require registry-wide rollout on day one
- unverified community plugins can still exist; they just should not look
  equivalent to cohort-verified releases

### Server-side checks

- package/manifest consistency
- plugin id / package name mapping checks
- global plugin id uniqueness checks for code plugins
- artifact boundary and path safety
- config schema presence and parseability
- package-level setup metadata extraction and validation
- dependency policy checks
- dependency graph capture or lockfile policy checks when runtime deps are
  materialized during install
- optional import and API surface linting
- optional contract smoke tests against supported `pluginApiVersion`
- malware and suspicious-behavior scanning for code plugins
- vulnerability enrichment from package advisories where available
- family-specific validation instead of one generic validator

Preferred publishing path:

- CI-driven publish with provenance

Fallback path:

- manual publish with reduced verification tier and lower default trust

Best-practice direction:

- support OIDC-based trusted publishing and provenance attestation for
  code-plugin packages
- keep room for independent rebuild verification of selected packages
- treat vulnerability scanning and suspicious-behavior scanning as separate
  concerns

Dependency/provenance rule:

- if OpenClaw installs additional npm dependencies after unpack, ClawHub must
  clearly label verification as covering only the top-level published artifact
  unless and until ClawHub adds a stronger dependency-aware verification model
- v1 should not require a persisted dependency snapshot/lockfile artifact just
  to ship verification for trusted accounts
- do not present `rebuild-verified` as stronger than the actual verification
  scope

## Trust Channels

ClawHub needs a first-class trust model that users can understand quickly.

Badges on individual packages are not enough.

We should introduce explicit **distribution channels**.

Suggested channels:

- `official`
  - packages from GitHub accounts/logins explicitly marked official by a
    moderator
  - examples may include large known vendors such as xAI or Tencent when
    their GitHub account/login is marked official
  - highest default trust
- `community`
  - public plugins that pass structural validation
- `private`
  - unlisted, org-scoped, or invite-only distribution

Channel rules:

- channel is assigned by ClawHub policy, not self-declared by the publisher
- `official` is a moderator-set flag on a GitHub account/login
- marking an account/login `official` applies to all existing and future
  packages from that account
- package channel derives from the publisher account/login plus package
  visibility state
- each release still has its own verification state
- `official` must never come from package metadata or publisher claims
- code plugins from non-official channels should never look visually equivalent
  to official code plugins in install UX
- UI must display both:
  - distribution channel
  - release verification tier

Examples:

- `official` + `provenance-verified`
- `community` + `structural`

Why channels matter:

- users need a fast trust heuristic before reading deep metadata
- official plugins should be easy to find and easy to default to
- search and install flows should be able to prefer trusted channels
- users need a one-click way to see only trusted official publishers before
  installing code
- policy can evolve without overloading package names or scopes

Recommended defaults:

- search defaults can boost `official`
- add an explicit `Official only` filter in browse/search UI
- code-plugin views should make `Official only` easy to toggle and persist
- non-official code plugins must always display a warning in browse/detail and
  install UX
- install flows for code plugins must require explicit user acceptance per
  non-official code plugin before installation
- OpenClaw should remember that acceptance locally per code plugin so repeat
  installs or updates do not reprompt unnecessarily
- install flows for code plugins can still show all packages by default, but
  official packages should be visually clearer and easier to filter to
- OpenClaw can support a policy mode that only allows installing official code
  plugins from ClawHub
- enterprise or locked-down environments can allow only selected channels

Do **not** encode trust only in:

- npm scope
- package naming
- publisher display name
- a single `official` boolean

## ClawHub Data Model

Add first-class package catalog tables.

Suggested model:

- `packages`
  - canonical package name
  - display package name
  - owner
  - source repo
  - family (`skill`, `code-plugin`, or `bundle-plugin`)
  - channel (`official`, `community`, `private`)
  - publisher login/account id
  - optional family-specific identity:
    - `pluginId` for code plugins
    - no plugin id for skills
    - normalized bundle id for bundle plugins when needed
- `packageReleases`
  - package version
  - dist-tags
  - tarball/archive
  - integrity
  - extracted package metadata
- `packageManifests`
  - extracted `openclaw.plugin.json`
  - extracted package-level `openclaw` metadata from `package.json`
  - normalized bundle manifest data when family is `bundle-plugin`
- `packageCompatibility`
  - `pluginApiRange`
  - `builtWithOpenClawVersion`
  - `pluginSdkVersion`
  - `minGatewayVersion`
- `packageCapabilities`
  - executes code vs bundle-only
  - plugin kind
  - channels
  - providers
  - hooks
  - bundled skills
  - setup/install capability summary
  - capability tags for filtering/search
- `packageVerification`
  - verification tier
  - verification scope
  - scans
  - provenance
- `packageDistTags`
  - `latest`
  - `beta`
  - other tags as needed

Index by both:

- canonical package name + version
- family
- channel
- plugin id for code plugins
- capability tags used in browse/search filters

Important distinction:

- canonical package name is the **distribution key**
- plugin id is the **runtime key**
- skill slug is the **skill runtime/content key**

Recommended implementation detail:

- skills, code plugins, and bundle plugins may eventually need separate
  family-specific release tables because their artifacts, compatibility rules,
  and moderation rules are different
- if that happens, keep a thin shared discovery projection instead of forcing a
  false one-table abstraction

## Discovery And Scale

The public ClawHub catalog will be read-heavy.

The Convex plan should assume:

- public browse/search/install metadata uses one-shot fetches where possible,
  not broad reactive subscriptions
- discovery pages read from compact digest/projection tables, not large source
  documents with joins
- high-traffic filters such as `family`, `channel`, `isOfficial`, and
  `isSuspicious` need compound indexes
- triggers and backfills must compare before writing so unchanged digests do
  not cause invalidation storms

Recommended projections:

- `packageSearchDigest`
  - canonical package name
  - display package name
  - family
  - channel
  - `isOfficial`
  - owner handle
  - lightweight description
  - latest version summary
  - supported host targets
  - compact capability tags
  - safety summary
- optional family-specific digest tables if one shared digest becomes too wide

Operational rules:

- no list view should join package -> owner -> release -> verification on the
  hot path
- no list view should recompute capability badges from raw manifests on the hot
  path
- no `.filter()` scans for official-only or family filtering when an index can
  answer it
- no trigger writes when denormalized values did not change
- backfills for new digest fields should be rate-controlled

## API Shape

ClawHub should expose a native plugin registry API before implementing full
npm-compat.

Suggested native endpoints:

- `GET /api/v1/packages`
- `GET /api/v1/packages/{packageName}`
- `GET /api/v1/packages/{packageName}/versions`
- `GET /api/v1/packages/{packageName}/versions/{version}`
- `GET /api/v1/packages/search`
- `POST /api/v1/packages`
- `POST /api/v1/packages/{packageName}/dist-tags/{tag}`
- family-specific helpers:
  - `GET /api/v1/skills`
  - `GET /api/v1/code-plugins`
  - `GET /api/v1/bundle-plugins`

Response data should include:

- package identity
- family
- family-specific runtime id
- channel
- `isOfficial`
- version/dist-tag info
- compatibility data
- verification state
- verification scope (`artifact-only` vs dependency-graph-aware`)
- install command suggestions
- capability summary

Later, ClawHub may add a restricted npm-compatible read surface for OpenClaw
code-plugin packages only.

API shape rule:

- shared `/packages` endpoints are for discovery and shared metadata
- family-specific endpoints are allowed for install and publish semantics
- code-plugin download/install endpoints must not be overloaded for bundle
  plugins
- bundle-plugin artifact endpoints must expose bundle-specific metadata instead
  of pretending they are npm-style packages
- list/search endpoints should support filtering by `family`, `channel`, and
  `isOfficial`
- list/search endpoints should support filtering by capability tags
- package lookup and routing should normalize names case-insensitively before
  querying storage

## npm Compatibility

ClawHub should be as npm-compatible as makes sense, without pretending every
family is an npm package in the same way.

Recommended policy:

- code plugins should get the strongest npm compatibility
- ClawHub should eventually support npm-compatible read/install flows for code
  plugins
- skills should use the native ClawHub API, not npm compatibility
- bundle plugins should not be forced into fake npm semantics if their real
  install/runtime model is different

Practical design:

- canonical API remains ClawHub-native
- npm facade is an adapter, not the source of truth
- official-only npm views or endpoints can exist later if OpenClaw needs a
  trusted-only install surface
- remote/virtual-repository-style composition is a good mental model for
  combining official and community sources behind one endpoint while retaining
  policy and priority controls

## OpenClaw Integration Plan

OpenClaw should gain a native ClawHub source.

Possible UX:

```bash
openclaw plugins install @scope/pkg --registry https://clawhub.ai
```

or:

```bash
openclaw plugins install clawhub:@scope/pkg
```

Skills should also install directly from ClawHub:

```bash
openclaw skills install owner/skill-name
```

Install/update flow:

1. Resolve package metadata from ClawHub.
2. Fetch tarball/archive + integrity.
3. Verify `pluginApiRange` against local `pluginApiVersion`.
4. Show capability summary and verification scope before install.
5. Record ClawHub source metadata in `plugins.installs`.
6. Install/update using the same local package install machinery.

This should coexist with current npm and marketplace flows during migration.

Bundle plugin flow should remain clearly separate:

1. Resolve bundle plugin metadata from ClawHub.
2. Download bundle artifact or expanded files.
3. Validate bundle schema and supported host targets.
4. Install using bundle-specific import/sync logic.

OpenClaw should not pretend that bundle plugin installs and code plugin
installs are the same operation, but bundle plugins should still be installable
in v1.

Policy integration:

- OpenClaw should be able to filter by family and channel during install
- OpenClaw should show all code-plugin results, but non-official installs must
  require an explicit warning acceptance step per code plugin
- OpenClaw should persist that acceptance locally per code plugin
- OpenClaw should expose a stricter mode that only installs official code
  plugins from ClawHub

## Rollout

### Phase 1. OpenClaw contract cleanup

- add explicit `pluginApiVersion` in OpenClaw core
- add plugin compatibility/build metadata to publishable packages
- decide on required package metadata fields
- decide shared package identity model across skills/code plugins/bundle plugins
- decide canonical internal package key vs public route/CLI locator rules
- decide canonical package-name normalization rules and reserved-name policy
- add global code-plugin `pluginId` uniqueness rules and transfer policy
- separate `pluginApiVersion` semver validation from publisher-defined package
  version validation
- require semver package versions for code-plugin publishing
- define capability extraction schema and dependency verification scope

### Phase 2. ClawHub native plugin registry

- add `packages` as a first-class catalog with family metadata
- add explicit channel policy and admin controls
- add moderator controls to set or unset `official` on publisher GitHub
  accounts/logins
- add clearly separated skill, code-plugin, and bundle-plugin release models
- add verification pipeline
- launch verification first for a small trusted publisher cohort
- add search/detail pages
- add capability extraction + capability-based filters/badges in browse/detail
- add `Official only` filtering in browse/search, especially for code plugins
- add warning/accept flow for non-official code-plugin installs
- add digest/projection tables and family/channel indexes up front
- add capability-tag indexes up front
- migrate existing family-specific identities into one global
  case-insensitive package catalog
- resolve collisions by oldest publish first, with moderator override support

### Phase 3. OpenClaw native ClawHub source

- add install/update support for ClawHub-hosted skills and native plugins
- surface compatibility and verification in CLI output
- add channel/family policy enforcement in install flows

### Phase 4. npm-compatible facade

- expose a limited npm-compatible layer where it materially helps OpenClaw
  tooling
- keep scope narrow: OpenClaw families only, not arbitrary npm packages
- prioritize code-plugin compatibility first

## Recommendation

Long-term recommendation:

- build the canonical product as a **constrained OpenClaw-native package registry**
- define **explicit plugin API versioning**
- separate **artifact version** from **API compatibility**
- add **npm compatibility as a transport adapter**, not as the core product model
- keep **official trust channels** and **family separation** visible everywhere
- optimize browse/search around **digest tables, indexes, and change-aware
  denormalization**

That gives ClawHub the control surface needed for trust, compatibility, and
product UX without forcing full npm-general behavior into the first iteration.

## Open Questions

- Should provenance-verified publishing be required for public listing, or only for higher trust badges?
- Should user-facing routes default to top-level `/skills`, `/plugins`, and
  `/bundles`, with any `/packages` surface kept internal or secondary?
- Should the internal canonical package key stay fully internal in v1, with
  only family-specific public locators exposed to users?
- What exact capability taxonomy should the UI expose in v1:
  - channels/providers/tools/prompt-hooks/skills/setup/install/runtime kind?
  - or only a smaller curated subset on cards with full detail on package pages?
- Should capability filters be discoverability-first (`channel`, `provider`,
  `executes code`) or trust-first (`official`, `verification scope`) by
  default?
- Should code-plugin pages show verification scope separately from verification
  tier?
- Should the trusted verification cohort be limited to `official` accounts at
  first, or allow a separate moderator-picked beta cohort?
- How much import/API-surface linting should ClawHub enforce at publish time versus reporting as advisory?
- Should `official` packages require provenance from day one, or can manual
  approval temporarily override missing provenance?
- For npm compatibility, how far do we want to mimic npm metadata and dist-tag
  behavior for code plugins in v1?
