---
summary: "How to author, validate, and publish experimental Claw packages."
read_when:
  - Authoring a Claw package
  - Publishing a Claw to an experimental ClawHub deployment
---

# Experimental Claw packages

A Claw is a versioned package that describes one complete OpenClaw agent and
the reusable resources it needs. ClawHub stores and scans the package;
OpenClaw owns local preview, consent, apply, update, and removal.

Claw publication is experimental. The ClawHub deployment must set
`CLAWHUB_EXPERIMENTAL_CLAWS=1`; otherwise the server rejects publication.

## Package shape

A publishable Claw is a normal package directory with a `package.json` that
points to its manifest:

```json
{
  "name": "@acme/github-triage",
  "version": "1.0.0",
  "openclaw": {
    "claw": "CLAW.md"
  }
}
```

`CLAW.md` starts with the grouped Claw manifest as YAML frontmatter. Markdown
after the closing delimiter is author-facing documentation.

```markdown
---
schemaVersion: 1
agent:
  id: github-triage
  name: GitHub Triage
  description: Reviews incoming issues.
workspace:
  bootstrapFiles:
    SOUL.md:
      source: workspace/SOUL.md
  files:
    - source: workspace/reference.md
      path: reference.md
packages:
  - kind: skill
    source: clawhub
    ref: "@acme/triage"
    version: 1.2.0
mcpServers: {}
cronJobs: []
---

# GitHub Triage

Reviews and classifies incoming GitHub issues.
```

JSON manifests remain compatible. Set `openclaw.claw` to a package-relative
JSON file such as `openclaw.claw.json`.

Every `workspace.*.source` must name a file in the same package. Package names
and versions must match `package.json`, dependency versions must be exact, and
MCP environment values must remain unresolved `${ENV_VAR}` references.

## Validate and publish

Preview the package without uploading it:

```bash
clawhub package publish . --family claw --dry-run
```

When the target ClawHub deployment has experimental Claws enabled, publish
through the existing authenticated package flow:

```bash
clawhub package publish . --family claw
```

The CLI detects `family: claw` when `package.json` contains `openclaw.claw`, so
`--family claw` is optional for a well-formed package.

Publication rejects:

- a missing, invalid, or escaping `openclaw.claw` path;
- package identity or version mismatches;
- malformed `CLAW.md` frontmatter or manifest fields;
- missing workspace source files or portable path collisions;
- floating skill/plugin versions and resolved MCP credentials.

Accepted packages continue through ClawHub's existing ownership, moderation,
static scanning, release, and artifact storage pipeline. The stored release
retains the exact artifact plus a non-sensitive summary for later search and
detail surfaces; it does not duplicate the full manifest into Convex storage.
