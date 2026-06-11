---
summary: "Start using ClawHub: find, install, update, and publish skills or plugins."
read_when:
  - First time using ClawHub
  - Installing a skill or plugin from the registry
  - Publishing to ClawHub
---

# Quickstart

ClawHub is a registry for OpenClaw skills and plugins.

Use OpenClaw when you are installing things into OpenClaw. Use the `clawhub` CLI
when you are signing in, publishing, managing your own listings, or using
registry-specific workflows.

## Find and install a skill

Search from OpenClaw:

```bash
openclaw skills search "calendar"
```

Install a skill:

```bash
openclaw skills install <skill-slug>
```

Update installed skills:

```bash
openclaw skills update --all
```

OpenClaw records where the skill came from so later updates can continue to
resolve through ClawHub.

## Find and install a plugin

Search from OpenClaw:

```bash
openclaw plugins search "calendar"
```

Install a ClawHub-hosted plugin with an explicit ClawHub source:

```bash
openclaw plugins install clawhub:<package>
```

Update installed plugins:

```bash
openclaw plugins update --all
```

Use the `clawhub:` prefix when you want OpenClaw to resolve the package through
ClawHub rather than npm or another source.

## Sign in for publishing

Install the ClawHub CLI:

```bash
npm i -g clawhub
# or
pnpm add -g clawhub
```

Sign in with GitHub:

```bash
clawhub login
clawhub whoami
```

Headless environments can use an API token from the ClawHub web UI:

```bash
clawhub login --token clh_...
```

## Publish a skill

A skill is a folder with a required `SKILL.md` file and optional supporting
files.

```bash
clawhub skill publish ./my-skill \
  --slug my-skill \
  --name "My Skill" \
  --version 1.0.0 \
  --changelog "Initial release"
```

Before publishing, check the metadata in `SKILL.md`. Declare required
environment variables, tools, and permissions so users can understand what the
skill needs before they install it. See [Skill format](./skill-format.md).

## Publish a plugin

Publish a plugin from a local folder, a GitHub repo, a GitHub ref, or an
existing archive:

```bash
clawhub package publish <source> --family code-plugin --dry-run
clawhub package publish <source> --family code-plugin
```

Use `--dry-run` first to preview the resolved package metadata, compatibility
fields, source attribution, and upload plan without publishing.

Code plugins must include OpenClaw compatibility metadata in `package.json`,
including `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion`.

## Sync skills you maintain

`sync` scans skill folders and publishes new or changed skills that are not
already synchronized.

```bash
clawhub sync --all --dry-run
clawhub sync --all
```

For catalog repos, ClawHub also provides a reusable GitHub workflow. By
default it scans `skills/`; pass `skill_path` to process one folder.

```yaml
jobs:
  dry-run:
    uses: openclaw/clawhub/.github/workflows/skill-publish.yml@v1
    with:
      owner: nvidia
      dry_run: true
```

## Inspect before installing

Before installing, use the ClawHub web page or CLI detail commands to inspect
metadata, source links, versions, changelogs, and scan status:

```bash
clawhub inspect <skill-slug>
clawhub package inspect <package>
```

Public listings show the latest scan state. Releases that are held or blocked by
moderation may be hidden from search and install surfaces until resolved.
