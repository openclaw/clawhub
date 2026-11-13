---
summary: "How to author, publish, and discover experimental Template packages."
read_when:
  - Authoring a Template package
  - Publishing a Template to an experimental ClawHub deployment
  - Discovering published Templates through the package API
---

# Experimental Template packages

A Template is a versioned package that describes one complete OpenClaw agent and
the reusable resources it needs. ClawHub stores and scans the package;
OpenClaw owns local inspection, new-agent planning, consent, and addition.

Template publication and exact-name reads are available by default. Hosting a Template
does not enable local preview or installation in OpenClaw.

Add a published Template by its publisher-qualified reference, the same form
skills use:

```bash
openclaw templates add @publisher/slug
```

The reference is the package name when that name is already scoped. A Template
stored under an unscoped name, such as `release-brief` published by `maker`, is
also read as `@maker/release-brief`; responses keep the stored package name.

Package lists and search include eligible community and official Templates, subject
to the existing publication, visibility, scanning, moderation, and access rules.
A scoped package's current publisher must remain active and match its scope;
community entries show creator attribution without an Official badge.

The separate Official Template feed includes only canonical `@openclaw/*`
Templates owned by the active OpenClaw publisher organization with a current
Official designation. Revoking that designation does not by itself withdraw
published artifacts or otherwise eligible community catalog entries. A stored
feed without the current policy stamp is unavailable until a new snapshot is
published. If `@openclaw` loses Official status, an existing nonempty feed fails
closed with `503` and `Cache-Control: no-store`; publish a current empty or
newly authorized snapshot before serving it again.

## Package shape

A publishable Template is a normal package directory with a `package.json` that
points to its manifest:

```json
{
  "name": "@openclaw/github-triage",
  "version": "1.0.0",
  "openclaw": {
    "template": "CLAW.md"
  }
}
```

`CLAW.md` starts with the grouped Template manifest as YAML frontmatter. A non-empty
Markdown body is the portable agent prompt; OpenClaw applies its exact UTF-8
contents as the managed `SOUL.md` for the new agent.

```markdown
---
schemaVersion: 1
agent:
  id: github-triage
  name: GitHub Triage
  description: Reviews incoming issues.
categories: [engineering, productivity]
workspace:
  files:
    - source: workspace/reference.md
      path: reference.md
skills:
  - ref: "@acme/triage"
    version: 1.2.0
mcpServers: {}
automations: []
---

# GitHub Triage

Reviews and classifies incoming GitHub issues.
```

Declare scheduled work under `automations`. Set `enabled: false` to create a paused
job for onboarding; omission preserves enabled behavior. The retired `cronJobs` key
is rejected with migration guidance. Existing archives and digests are preserved.

`categories` is optional and accepts one to three distinct lowercase slugs.
ClawHub accepts these categories for new releases: `personal`, `health`,
`travel`, `productivity`, `research`, `engineering`, `governance`, `operations`,
`finance`, `sales`, `product`, and `people`. Declared categories take precedence;
ClawHub rejects unrecognized slugs. When omitted, ClawHub attempts to classify
the Template from its manifest and documentation and uses `Other` if classification
is unavailable. To correct an inferred category, add `categories` to `CLAW.md`
and publish a new release.

Template packages use `openclaw.template` pointing to a safe package-relative
`CLAW.md`. The retired `openclaw.claw` selector and JSON package manifests are
rejected, including metadata that declares both selectors. Regenerate first-party
packages as new versions rather than rewriting any published archive or digest.

Do not combine a non-empty `CLAW.md` body with an explicit workspace file whose
portable destination is `SOUL.md`. ClawHub rejects that ambiguous dual source.
Headings and task lists in the body are prompt text, not package-time commands.

Every `workspace.*.source` must name a file in the same package. Assets such as
schemas, templates, examples, and images are portable ordinary workspace files;
place them under paths such as `assets/`, `schemas/`, or `templates/` and declare
them in `workspace.files`. Package names and versions must match `package.json`,
dependency versions must be exact, and MCP environment values must remain
unresolved `${ENV_VAR}` references.

## Native settings and bootstrap

Keep native agent settings directly under `agent` in the same `CLAW.md` frontmatter.
Supported groups are `groupChat`, `sandbox`, `tools`, `memory`, `heartbeat`, and
`humanDelay`, alongside identity and purpose. `tools.profile` remains a native tool
policy selection; bounded tool-grant and memory-consent checks still apply.

```yaml
schemaVersion: 1
agent:
  id: github-triage
  tools:
    profile: coding
    allow: [read]
plugins:
  - ref: "@acme/issue-tools"
    version: 2.3.4
```

Declare dependencies in top-level `skills` and `plugins` arrays. Each entry is
either an exact ClawHub `{ref, version}` reference or a package-local `{path}`
directory. Do not combine both forms. The collection determines its kind;
duplicate references within one kind and overlapping bundled directories are rejected.

```yaml
skills:
  - path: skills/research
  - ref: "@acme/triage"
    version: 1.2.0
plugins:
  - path: plugins/alerts
```

A bundled skill includes its complete directory, including `SKILL.md`, scripts,
references and binary assets. Its `SKILL.md` must contain valid frontmatter and
a description. Plugin directories require an explicit supported native manifest:
`openclaw.plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`,
or `.cursor-plugin/plugin.json`. Bundle manifests declare a name; native code
plugins declare an id/config schema plus package metadata and loadable entrypoints.
The selected root agent-bundle `plugin.json` format is unsupported. Native format
selection prefers Codex, Cursor, Claude, then OpenClaw metadata; an unrelated
root `plugin.json` does not override them. OpenClaw's native installers still
own host compatibility, security review, consent and local activation.

Bundled contents exclude `.git` and `node_modules` segments using portable case
folding. Eligible contents must be regular files with safe, noncolliding paths:
at most 1 MiB per file, 20 MiB across dependencies, 4096 files in total, 4096
entries per directory tree and 16 path levels. Links and nonregular archive entries
are rejected by the package artifact boundary. Build with OpenClaw so its selected
directory membership and bytes are preserved in the exact artifact.

The `packages`, `extensions`, and `profiles` fields, package-local `profiles/`
files, and `metadata.openclaw.config` pointer are retired. Move settings into
`CLAW.md` `agent`, dependencies into `skills`/`plugins`, and scheduled work into
`automations`. This simplification keeps `schemaVersion: 1`; no compatibility
adapter interprets the retired forms.

An optional package-root `BOOTSTRAP.md` contains first-run instructions. It is
seeded once and remains separate from the reusable prompt in the `CLAW.md` body.
Do not declare root `BOOTSTRAP.md` as a workspace destination; the path is reserved.
ClawHub includes bootstrap presence, but never its contents, in the bounded summary.

## Validate, build, and publish

Validate the source project and build its deterministic artifact with
OpenClaw:

```bash
openclaw templates validate .
openclaw templates build . --out ./github-triage-1.0.0.tgz
```

Preview that exact artifact without uploading it, then publish it through the
existing authenticated package flow:

```bash
clawhub package publish ./github-triage-1.0.0.tgz --family template --dry-run
clawhub package publish ./github-triage-1.0.0.tgz --family template --wait
```

The CLI detects `family: template` when `package.json` contains `openclaw.template`, so
`--family template` is optional for a well-formed package.

Experimental Template publication accepts only an already-built npm-pack `.tgz`,
not a source directory or GitHub checkout. The CLI sends the local artifact
SHA-256 with the request; ClawHub verifies it against the uploaded bytes before
publication and returns the same digest through pending and final responses.

Publication rejects:

- a missing, invalid, or escaping `openclaw.template` path;
- a source folder instead of a built `.tgz`;
- package identity or version mismatches;
- a missing or mismatched expected artifact SHA-256;
- malformed `CLAW.md` frontmatter or manifest fields;
- a non-empty `CLAW.md` body combined with an explicit `SOUL.md` destination;
- missing workspace source files or portable path collisions;
- invalid package-root bootstrap instructions, retired profiles, or unsafe native agent settings;
- the retired `metadata.openclaw.config` pointer;
- floating skill/plugin versions and resolved MCP credentials.

Accepted packages continue through ClawHub's existing ownership, moderation,
security scanning, release, and artifact storage pipeline. The stored release
retains the exact artifact plus a non-sensitive summary and normalized dependency
inventory for later search and detail surfaces; downloads return those same bytes and digest, and ClawHub does
not duplicate the full manifest into Convex storage.

## Discover published Templates

ClawHub exposes Templates through the existing package API:

```bash
curl "https://clawhub.ai/api/v1/packages?family=template"
curl "https://clawhub.ai/api/v1/packages?family=template&category=travel"
curl "https://clawhub.ai/api/v1/packages/search?q=triage&family=template"
curl "https://clawhub.ai/api/v1/packages/search?q=trip&family=template&category=travel"
curl "https://clawhub.ai/api/v1/packages/@openclaw%2Fgithub-triage"
```

List and search results use the normal package summary fields. Package and
version detail responses may also include `templateManifestSummary`, which reports
the agent identity and declared resource counts. `templateInventory` identifies
each dependency as ClawHub (`ref`, exact `version`) or bundled (`path`, optional
metadata-derived `name`). The website shows bundled paths without inventing
registry versions. The full manifest and dependency bytes remain in the artifact.
The Template page also lists `workspace` files that land where OpenClaw
discovers them natively: `skills/**/SKILL.md` and `.agents/skills/**/SKILL.md`
under Skills, `.openclaw/extensions/<id>/openclaw.plugin.json` under Plugins, and
`HEARTBEAT.md` under Automations. These entries are labeled as workspace files
and are not part of `templateInventory` or the summary counts.
Projected bundled display names use the same 128-character bound as agent names.
The complete normalized dependency inventory is limited to 256 KiB for release
storage; this does not change the full native identity retained in the artifact.
Use `category=other` for Templates that could not be classified. Category filters
require `family=template`; unrecognized categories return a validation error.

Full manifests remain in exact artifacts and are never projected through public
release responses.

## Consume the experimental feed

ClawHub publishes eligible Official `@openclaw` Templates as a separate hosted feed:

```bash
curl "https://clawhub.ai/v1/feeds/templates"
```

This uses a dedicated experimental Template feed contract rather than extending
the stable plugin/skill catalog feed v1 schema.

Each entry provides the exact package version, artifact SHA-256, publisher
trust, and `templateManifestSummary`. Consumers resolve and verify that artifact,
unpack it as a normal Template package directory, and pass the directory to
OpenClaw for local inspection or `templates add --dry-run`. ClawHub does not bypass
OpenClaw's preview or consent boundary.

The feed route returns `503` until a current Official Template snapshot is published.

Run the repeatable registry-to-OpenClaw proof against an OpenClaw Templates
checkout with:

```bash
OPENCLAW_TEMPLATES_CHECKOUT=/path/to/openclaw \
  bunx vitest run scripts/templates-feed-openclaw-e2e.test.ts --maxWorkers=1
```

The proof serves a deterministic hosted feed and package artifact, verifies the
feed and downloaded digests, extracts the package, and invokes the actual
OpenClaw source CLI with `templates add --dry-run --json` in an isolated state
directory.
