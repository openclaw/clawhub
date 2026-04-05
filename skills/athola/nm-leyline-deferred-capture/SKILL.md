---
name: deferred-capture
description: |
  >- Contract for unified deferred-item capture across plugins. Defines CLI interface, issue template, label taxonomy, and compliance test
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Deferred Capture Contract

## When To Use

- Building a new plugin deferred-capture wrapper
- Validating an existing wrapper against the contract
- Adding new source labels or template fields

## When NOT To Use

- Capturing a deferred item at runtime (use the plugin
  wrapper directly, e.g. `scripts/deferred_capture.py`)
- Creating GitHub issues manually

Specification that all plugin deferred-capture wrappers implement.
Not a runtime dependency -- a convention.

## CLI Interface

Required arguments:

- `--title` (str): Concise description. Becomes issue title
  after `[Deferred]` prefix
- `--source` (str): Origin skill. One of: war-room, brainstorm,
  scope-guard, feature-review, review, regression, egregore
- `--context` (str): Why raised and why deferred

Optional arguments:

- `--labels` (str): Comma-separated additional labels beyond
  `deferred` + source
- `--session-id` (str): Session ID. Canonical source:
  `$CLAUDE_SESSION_ID` env var, fallback: UTC timestamp
  `YYYYMMDD-HHMMSS`
- `--artifact-path` (str): Absolute path or `$HOME`-based
  path to source artifact
- `--captured-by` (str): `explicit` (default) or `safety-net`
- `--dry-run` (flag): Print JSON output without creating issue

## Issue Template

Title: `[Deferred] <title>`

Labels: `deferred` + `<source>`

Body:

    ## Deferred Item

    **Source:** <source> (session <session-id>)
    **Captured:** <YYYY-MM-DD>
    **Branch:** <current git branch>
    **Captured by:** <explicit|safety-net>

    ### Context

    <context argument verbatim>

    ### Original Artifact

    <artifact-path if provided, otherwise "N/A">

    ### Next Steps

    - [ ] Evaluate feasibility in a future cycle
    - [ ] Link to related work if applicable

## Label Taxonomy

| Label | Color | Purpose |
|-------|-------|---------|
| `deferred` | `#7B61FF` | Universal query handle |
| `war-room` | `#B60205` | Source: war-room deliberation |
| `brainstorm` | `#1D76DB` | Source: brainstorming session |
| `scope-guard` | `#FBCA04` | Source: scope-guard deferral |
| `feature-review` | `#F9A825` | Source: feature-review |
| `review` | `#0E8A16` | Source: code/PR review |
| `regression` | `#D73A4A` | Source: skill regression |
| `egregore` | `#5319E7` | Source: autonomous agent |

## Duplicate Detection

Search: `gh issue list --search "<title> in:title"
--state open --json number,title`

Compare: exact title match after stripping `[Deferred]`
prefix and normalizing to lowercase.

Only open issues are checked. Re-filing a closed deferred
item is intentional.

## Output (JSON to stdout)

Created: `{"status": "created", "issue_url": "...", "number": 42}`
Duplicate: `{"status": "duplicate", "existing_url": "...", "number": 17}`
Error: `{"status": "error", "message": "..."}`

## Compliance Test

Any wrapper can verify conformance with:

    python3 scripts/deferred_capture.py \
      --title "Test: compliance check" \
      --source test \
      --context "Automated compliance verification" \
      --dry-run

Must output valid JSON with a `status` field.
