# OpenClaw Docs Extraction Notes

Context: CLAW-89 moves canonical ClawHub-owned documentation into the ClawHub
repo so OpenClaw's `/tools/clawhub` page is no longer the source of truth.

Source audited for this slice:

- OpenClaw `docs/tools/clawhub.md` in the sibling read-only worktree.
- OpenClaw docs-wide `ClawHub`/`clawhub` mentions for classification patterns.

## Moved into ClawHub docs

Canonical product and registry material now lives in `docs/clawhub.md`:

- What ClawHub is: public registry for OpenClaw skills and plugins.
- Native OpenClaw search/install/update examples for skills and plugins.
- ClawHub CLI purpose and common authenticated workflows.
- Skill and plugin publishing commands.
- Security scan summaries, reporting, appeals, and moderation overview.
- Versioning, lockfile, telemetry, and environment override guidance.

## Summarize or link from OpenClaw docs

These OpenClaw docs should eventually point to `https://clawhub.ai/docs` rather than
restate the whole registry guide:

- `docs/tools/clawhub.md`: keep as a concise bridge to ClawHub docs plus OpenClaw-native install examples.
- `docs/tools/skills.md`: keep OpenClaw skill-loading behavior inline; link to ClawHub for registry, publishing, security, and CLI details.
- `docs/tools/plugin.md` and `docs/plugins/community.md`: keep OpenClaw install/runtime behavior inline; link to ClawHub for registry/package publishing and moderation.
- `docs/plugins/building-plugins.md`: keep plugin authoring/runtime contract inline; link to ClawHub for publish command details.

## Leave in OpenClaw docs

These mentions are OpenClaw-owned integration/runtime material and should remain
in OpenClaw unless the owner explicitly asks for a separate extraction:

- OpenClaw CLI command behavior: `openclaw skills ...`, `openclaw plugins ...`, `/plugin install ...`.
- Plugin dependency resolution, package acceptance, Docker/E2E fixtures, release workflows, and testing references.
- Threat model references where ClawHub is one platform component inside a broader OpenClaw security model.
- Showcase or FAQ links that merely point users to live ClawHub pages.

## Plugin authoring mirror

The owner requested a ClawHub-local copy of the public plugin development
documentation so authors can move from runtime development to ClawHub
validation and publishing without switching documentation sites.

The imported mirror is sourced from OpenClaw `main` at
`d48b9274d819a369ed936bdcbee1ecdb42416703` and lives under `docs/plugins/`.
It includes the public first-plugin, plugin-type, manifest, compatibility, SDK,
setup, testing, hook, and permission-request guides selected in
`docs/plugin-development.md`.

Ownership remains split:

- OpenClaw remains canonical for plugin runtime and SDK behavior.
- ClawHub owns the mirrored navigation, registry-facing context, validation
  remediation links, Plugin Inspector author workflow, publishing flow, and
  skill-authoring guidance.
- ClawHub-facing examples must use ClawHub's real local-source publish syntax,
  make external publishers the default audience, and label OpenClaw
  repository-only commands and test helpers explicitly.
- Code-plugin publishing walkthroughs must declare and build the JavaScript
  runtime artifacts ClawHub validates; do not advertise pure ecosystem-bundle
  publishing until ClawHub can preserve OpenClaw bundle semantics.
- Links to OpenClaw runtime pages that are not mirrored stay absolute
  `https://docs.openclaw.ai/...` links.
- Do not copy generated per-plugin reference pages or OpenClaw operator and
  maintainer runbooks into ClawHub docs.

When refreshing the mirror, use a committed OpenClaw revision, exclude
uncommitted sibling-worktree edits, preserve ClawHub-local links between
mirrored pages, and rerun the ClawHub docs build, smoke test, and marker scan.

## Reviewer check

For this slice, the ClawHub repo owns the new canonical source file. The
OpenClaw worktree was read-only, so replacing OpenClaw sections with short links
is left to the OpenClaw-side worker.
