---
name: release-health-gates
description: |
  Standardize release approvals with GitHub-aware checklists and deployment gate validation
version: 1.8.1
triggers:
  - release
  - github
  - readiness
  - quality
  - governance
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/minister", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: minister
---

> **Night Market Skill** — ported from [claude-night-market/minister](https://github.com/athola/claude-night-market/tree/master/plugins/minister). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Release Health Gates

## Purpose

Standardize release approvals by expressing gates as GitHub-aware checklists. Ensure code, docs, comms, and observability items are green before deployment.

## Gate Categories

1. **Scope & Risk** – Are all blocking issues closed or deferred with owners?
2. **Quality Signals** – Are required checks, tests, and soak times satisfied?
3. **Comms & Docs** – Are docs merged and release notes posted?
4. **Operations** – Are runbooks, oncall sign-off, and rollback plans ready?

## Workflow

1. Load skill to access gate modules.
2. Attach Release Gate section to deployment PR.
3. Use tracker data to auto-fill blockers and highlight overdue tasks.
4. Update comment as gates turn green; require approvals for any waivers.

## Outputs

- Release Gate markdown snippet (embed in PR/issue).
- QA Handshake summary referencing GitHub Checks.
- Rollout scorecard that persists in tracker data for retros.

## Exit Criteria

- All release gates evaluated and documented.
- Any blocking gates have waiver approvals recorded.
- Deployment PR contains embedded Release Gate snippet.
- Rollout scorecard saved for post-release retrospective.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
