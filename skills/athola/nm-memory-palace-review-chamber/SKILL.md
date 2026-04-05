---
name: review-chamber
description: Capture and retrieve PR review knowledge in project memory palaces
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.memory-palace:knowledge-intake", "night-market.sanctum:pr-review"]}}}
source: claude-night-market
source_plugin: memory-palace
---

> **Night Market Skill** — ported from [claude-night-market/memory-palace](https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Overview](#overview)
- [Room Structure](#room-structure)
- [Workflow Phases](#workflow-phases)
- [Phase 1: Knowledge Detection](#phase-1:-knowledge-detection)
- [Knowledge Detection Checklist](#knowledge-detection-checklist)
- [Phase 2: Classification](#phase-2:-classification)
- [Phase 3: Capture](#phase-3:-capture)
- [Decision Title](#decision-title)
- [Decision](#decision)
- [Context (from PR discussion)](#context-(from-pr-discussion))
- [Captured Knowledge](#captured-knowledge)
- [Connected Concepts](#connected-concepts)
- [Phase 4: Integration](#phase-4:-integration)
- [Usage Examples](#usage-examples)
- [Capture After PR Review](#capture-after-pr-review)
- [Search Past Decisions](#search-past-decisions)
- [Surface Relevant Knowledge](#surface-relevant-knowledge)
- [Relevant Review Knowledge](#relevant-review-knowledge)
- [Integration Points](#integration-points)
- [With sanctum:pr-review](#with-sanctum:pr-review)
- [With knowledge-intake](#with-knowledge-intake)
- [With knowledge-locator](#with-knowledge-locator)
- [Evaluation Rubric](#evaluation-rubric)
- [Worth Capturing (Score ≥ 60)](#worth-capturing-(score-≥-60))
- [Skip (Score < 60)](#skip-(score-<-60))
- [CLI Reference](#cli-reference)
- [Best Practices](#best-practices)


# PR Review Chamber Skill

Capture, organize, and retrieve knowledge from PR reviews within project memory palaces.


## When To Use

- Capturing PR review knowledge for future reference
- Building review pattern libraries from past reviews

## When NOT To Use

- Quick self-reviews of trivial changes
- Automated CI checks that cover the review scope

## Overview

The Review Chamber is a dedicated room within each project palace that stores valuable knowledge extracted from PR reviews. It transforms ephemeral PR discussions into persistent, searchable institutional memory.

## Room Structure

```
review-chamber/
├── decisions/      # Architectural choices from PR discussions
├── patterns/       # Recurring issues and their solutions
├── standards/      # Quality bar examples and coding conventions
└── lessons/        # Post-mortems and learnings
```
**Verification:** Run the command with `--help` flag to verify availability.

## Workflow Phases

### Phase 1: Knowledge Detection

After a PR review completes, evaluate findings for knowledge capture:

```markdown
## Knowledge Detection Checklist

For each finding from sanctum:pr-review, evaluate:

- [ ] **Novelty**: Is this a new pattern or first occurrence?
- [ ] **Applicability**: Will this affect future PRs in this area?
- [ ] **Durability**: Is this architectural (capture) or tactical (skip)?
- [ ] **Connectivity**: Does it link to existing palace rooms?
```
**Verification:** Run the command with `--help` flag to verify availability.

### Phase 2: Classification

Route findings to appropriate subrooms:

| Finding Type | Target Room | Criteria |
|-------------|-------------|----------|
| Architectural choice | `decisions/` | BLOCKING + architectural context |
| Recurring issue | `patterns/` | Seen before or likely to recur |
| Quality example | `standards/` | Exemplifies coding standards |
| Learning/insight | `lessons/` | Retrospective or post-mortem |

### Phase 3: Capture

Create structured entry with:

```yaml
---
source_pr: "#42 - Add authentication"
date: 2025-01-15
participants: [author, reviewer1, reviewer2]
palace_location: review-chamber/decisions
related_rooms: [workshop/auth-patterns, library/security-adr]
tags: [authentication, jwt, security]
---

## Decision Title

### Decision
Chose JWT tokens over server-side sessions.

### Context (from PR discussion)
- Reviewer asked: "Why not use sessions?"
- Author explained: stateless scaling requirements
- Discussion refined: added refresh token rotation

### Captured Knowledge
- **Pattern**: JWT + refresh tokens for stateless auth
- **Tradeoff**: Complexity vs. horizontal scaling
- **Application**: Use for all API authentication

### Connected Concepts
- [[auth-patterns]] - Updated with JWT best practices
- [[security-adr-003]] - Referenced this decision
```
**Verification:** Run the command with `--help` flag to verify availability.

### Phase 4: Integration

After capture, update related palace rooms:

1. Add bidirectional links to related entries
2. Update tags in project palace index
3. Notify if this contradicts existing entries

## Usage Examples

### Capture After PR Review

```bash
# Automatic: sanctum:pr-review triggers capture
/pr-review 42
# → Review posted to GitHub
# → Knowledge capture evaluates findings
# → Significant decisions stored in review-chamber

# Manual: Explicitly capture from PR
/review-room capture 42 --room decisions
```
**Verification:** Run the command with `--help` flag to verify availability.

### Search Past Decisions

```bash
# Find authentication decisions
/review-room search "authentication" --room decisions

# Find patterns in a specific area
/review-room search "error handling" --room patterns --tags api

# List recent entries
/review-room list --limit 10 --room standards
```
**Verification:** Run the command with `--help` flag to verify availability.

### Surface Relevant Knowledge

When starting work in a code area:

```markdown
## Relevant Review Knowledge

Starting work in `auth/` directory...

**Past Decisions:**
- [#42] JWT token decision → decisions/jwt-over-sessions
- [#67] Rate limiting pattern → patterns/api-throttling

**Quality Standards:**
- [#55] Error response format → standards/api-errors

**Known Patterns:**
- [#38] Token refresh edge case → patterns/token-refresh-race
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration Points

### With sanctum:pr-review

The review-chamber integrates after Phase 6 (Generate Report):

```
**Verification:** Run the command with `--help` flag to verify availability.
Phase 6: Generate Report
    ↓
[HOOK] Evaluate findings for knowledge capture
    ↓
    For each significant finding:
    ├── Classify into room type
    ├── Create ReviewEntry
    ├── Add to project palace
    └── Update connections
    ↓
Phase 7: Post to GitHub
```
**Verification:** Run the command with `--help` flag to verify availability.

### With knowledge-intake

Uses the same evaluation framework:

| Criterion | Weight | PR Review Application |
|-----------|--------|----------------------|
| Novelty | 25% | New pattern or first occurrence |
| Applicability | 30% | Affects future PRs in this area |
| Durability | 20% | Architectural vs tactical |
| Connectivity | 15% | Links to existing rooms |
| Authority | 10% | Senior reviewer or domain expert |

### With knowledge-locator

Extends search to include review-chamber:

```bash
python scripts/palace_manager.py search "authentication" \
  --palace project-name \
  --room review-chamber \
  --type semantic
```
**Verification:** Run `python --version` to verify Python environment.

## Evaluation Rubric

### Worth Capturing (Score ≥ 60)

- **Architectural decisions** with documented rationale
- **Recurring patterns** seen in 2+ PRs
- **Security/performance** critical findings
- **Domain knowledge** that explains business logic
- **Convention changes** that affect future code

### Skip (Score < 60)

- One-off tactical fixes
- Style preferences without rationale
- Obvious bugs without pattern
- External dependency issues
- Temporary workarounds

## CLI Reference

```bash
# Capture knowledge from PR
/review-room capture <pr_number> [--room <room_type>] [--tags <tags>]

# Search review chamber
/review-room search "<query>" [--room <room_type>] [--tags <tags>]

# List entries
/review-room list [--room <room_type>] [--limit N]

# View entry details
/review-room view <entry_id>

# Export for documentation
/review-room export [--format markdown|json] [--room <room_type>]

# Statistics
/review-room stats [--palace <palace_id>]
```
**Verification:** Run the command with `--help` flag to verify availability.

## Best Practices

1. **Capture decisions immediately** - Context is freshest right after review
2. **Link related entries** - Build the knowledge graph
3. **Use consistent tags** - Enable cross-project discovery
4. **Review periodically** - Prune outdated entries
5. **Surface proactively** - Show relevant knowledge when starting related work

## Module Reference

- See `modules/capture-workflow.md` for detailed capture process
- See `modules/evaluation-criteria.md` for knowledge worth assessment
- See `modules/search-patterns.md` for query optimization
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
