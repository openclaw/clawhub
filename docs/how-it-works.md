---
summary: "How ClawHub listings, versions, installs, publishing, scans, and updates work."
read_when:
  - Understanding listings, versions, installs, publishing, and moderation
---

# How ClawHub Works

ClawHub is the registry layer for OpenClaw skills and plugins. It gives users a
place to discover packages, gives publishers a place to release versions, and
gives OpenClaw enough metadata to install and update those packages safely.

## Registry records

Each public listing is a registry record with:

- an owner and slug or package name
- one or more published versions
- metadata, summary, files, and source attribution
- changelog and tag information such as `latest`
- download, install, star, and comment signals
- security scan and moderation status

The listing page is the canonical place for users to inspect what a skill or
plugin claims to do before installing it.

## Skills

A skill is a versioned text bundle centered on `SKILL.md`. It can include
supporting files, examples, templates, and scripts.

ClawHub reads the `SKILL.md` frontmatter to understand the skill name,
description, requirements, environment variables, and metadata. Accurate
metadata matters because it helps users decide whether to install the skill and
helps automated scans detect mismatches between declared and observed behavior.

See [Skill format](./skill-format.md).

## Plugins

Plugins are packaged OpenClaw extensions. ClawHub stores package metadata,
compatibility information, source links, artifacts, and version records.

When OpenClaw installs a plugin from ClawHub, it checks advertised compatibility
metadata before installing. Package records can include API compatibility,
minimum gateway version, host targets, environment requirements, and artifact
digests.

Use an explicit ClawHub install source when you want the registry to be the
source of truth:

```bash
openclaw plugins install clawhub:<package>
```

## Publishing

Publishing creates a new immutable version record. Publishers use the `clawhub`
CLI for authenticated registry workflows:

```bash
clawhub skill publish ./my-skill
clawhub package publish <source> --family code-plugin --dry-run
clawhub package publish <source> --family code-plugin
```

Use dry runs to preview the resolved payload before upload. Public pages then
surface the published metadata, files, source attribution, and scan status.

## Installs and updates

OpenClaw install commands use ClawHub as a package source:

```bash
openclaw skills install <skill-slug>
openclaw plugins install clawhub:<package>
```

OpenClaw records install source metadata so updates can resolve the same
registry package later. The ClawHub CLI also supports direct skill install and
update workflows for users who want registry-managed skill folders outside a
full OpenClaw workspace.

## Security state

ClawHub is open to publishing, but releases are still subject to upload gates,
automated checks, user reports, and moderator action.

Public pages show scan summaries when available. Content that is held, hidden,
or blocked may disappear from public search and install flows while remaining
visible to the owner for diagnostics.

See [Security Audits](./security-audits.md),
[Moderation and Account Safety](./moderation.md), and
[Acceptable usage](./acceptable-usage.md).

## API access

ClawHub exposes public read APIs for discovery, search, package details, and
downloads. Third-party catalogs may use these APIs when they link back to the
canonical ClawHub listing, respect rate limits, and avoid implying endorsement.

See [Public API](./api.md) and [HTTP API](./http-api.md).
