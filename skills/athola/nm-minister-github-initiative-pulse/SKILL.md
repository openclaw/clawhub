---
name: github-initiative-pulse
description: |
  Generate markdown digests and CSV exports for GitHub issues, PRs, and initiative health tracking
version: 1.8.1
triggers:
  - github
  - projects
  - reporting
  - status
  - dashboards
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/minister", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: minister
---

> **Night Market Skill** — ported from [claude-night-market/minister](https://github.com/athola/claude-night-market/tree/master/plugins/minister). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# GitHub Initiative Pulse

## Overview

Turns tracker data and GitHub board metadata into initiative-level summaries. Provides markdown helpers and CSV exports for pasting into issues, PRs, or Discussions.

## Ritual

1. Capture work via `tracker.py add` or sync from GitHub Projects.
2. Review blockers/highlights using the **Blocker Radar** table.
3. Generate GitHub comment via `tracker.py status --github-comment` or module snippets.
4. Cross-link the weekly Status Template and share with stakeholders.

## Key Metrics

| Metric | Description |
|--------|-------------|
| Completion % | Done tasks / total tasks per initiative. |
| Avg Task % | Mean completion percent for all in-flight tasks. |
| Burn Rate | Hours burned per week (auto-calculated). |
| Risk Hotlist | Tasks flagged `priority=High` or due date in past. |

## GitHub Integrations

- Links every task to an issue/PR URL.
- Supports auto-labeling by referencing `phase` in the tracker record.
- Encourages posting digests to coordination issues or PR timelines.

## Exit Criteria

- All initiatives represented with updated metrics.
- Markdown digest pasted into relevant GitHub thread.
- Risk follow-ups filed as issues with owners + due dates.
## Troubleshooting

### Common Issues

If metrics appear outdated, ensure `tracker.py` has successfully synced with GitHub. If the Markdown digest renders incorrectly in GitHub, check for unescaped characters in task titles or missing newlines between table rows.
