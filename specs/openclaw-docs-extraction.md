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

These OpenClaw docs should eventually point to the ClawHub docs tab rather than
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

## Reviewer check

For this slice, the ClawHub repo owns the new canonical source file. The
OpenClaw worktree was read-only, so replacing OpenClaw sections with short links
is left to the OpenClaw-side worker.

## Published anchor contract

ClawHub owns incoming links in `docs/`; OpenClaw owns plugin target content and
`scripts/docs-link-audit.mts`; `openclaw/docs` owns the published renderer in
`scripts/docs-site/mdx-ish.mjs`. Repair links in their canonical source, never
in a generated mirror. The sync step rewrites relative page paths but preserves
fragments, so it cannot reconcile renderer differences.

The 2026-09-02 audit of ClawHub `d40547056deee00781721daa24cbc73c497cf2ba`
found 12 stale links in `docs/plugin-validation-fixes.md`. The published manifest
IDs are `manifest-versus-package.json` and
`package.json-fields-that-affect-discovery`. Session and transcript helpers live
under `runtime-namespaces` in the runtime reference, not `agent-session-state`.
Keep the precise published section links rather than dropping their fragments
or choosing checker-only spellings.

At that audit, the publisher used `markdown-it@15.0.0` and
`markdown-it-anchor@9.2.1`, while the core auditor pinned `mint@4.2.808`.
Mint predicts hyphens instead of dots for the manifest IDs and counts repeated
CLI GitHub Actions headings as `github-actions`, `github-actions-2`, and
`github-actions-3`; the publisher emits `github-actions`, `github-actions-1`,
and `github-actions-2`. Preserve the live-valid `#github-actions-1` links in
`docs/cli.md` and `docs/publishing.md`: changing them to `-2` sends readers to
the wrong section.

Renderer/auditor parity belongs to the core auditor and publisher owners, not
ClawHub link rewrites. With the 12 source repairs, the pinned Mint audit still
reports nine renderer-only findings (seven manifest links and two CLI links).
A parity fix must validate published IDs without hiding genuinely missing
anchors, with regression coverage for punctuation, duplicate heading order,
and unique target ownership. Recheck real rendered navigation when either
renderer or its dependencies change.
