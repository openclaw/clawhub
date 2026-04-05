---
name: feature-review
description: |
  Review and prioritize features using RICE, WSJF, or Kano scoring frameworks, then create GitHub issues for suggestions
version: 1.8.1
triggers:
  - feature-review
  - prioritization
  - RICE
  - WSJF
  - Kano
  - roadmap
  - backlog
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/imbue", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.imbue:scope-guard", "night-market.imbue:review-core", "night-market.tome:research (optional, for --research flag)"]}}}
source: claude-night-market
source_plugin: imbue
---

> **Night Market Skill** — ported from [claude-night-market/imbue](https://github.com/athola/claude-night-market/tree/master/plugins/imbue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Philosophy](#philosophy)
- [When to Use](#when-to-use)
- [When NOT to Use](#when-not-to-use)
- [Quick Start](#quick-start)
- [1. Inventory Current Features](#1-inventory-current-features)
- [2. Score and Classify](#2-score-and-classify)
- [3. Generate Suggestions](#3-generate-suggestions)

## Verification

Run `make test-feature-review` to verify scoring logic after changes.
- [4. Upload to GitHub](#4-upload-to-github)
- [Workflow](#workflow)
- [Phase 1: Feature Discovery (`feature-review:inventory-complete`)](#phase-1:-feature-discovery-(feature-review:inventory-complete))
- [Phase 2: Classification (`feature-review:classified`)](#phase-2:-classification-(feature-review:classified))
- [Phase 3: Scoring (`feature-review:scored`)](#phase-3:-scoring-(feature-review:scored))
- [Phase 4: Tradeoff Analysis (`feature-review:tradeoffs-analyzed`)](#phase-4:-tradeoff-analysis-(feature-review:tradeoffs-analyzed))
- [Phase 5: Gap Analysis & Suggestions (`feature-review:suggestions-generated`)](#phase-5:-gap-analysis-&-suggestions-(feature-review:suggestions-generated))
- [Phase 6: GitHub Integration (`feature-review:issues-created`)](#phase-6:-github-integration-(feature-review:issues-created))
- [Configuration](#configuration)
- [Configuration File](#configuration-file)
- [Guardrails](#guardrails)
- [Required TodoWrite Items](#required-todowrite-items)
- [Integration Points](#integration-points)
- [Output Format](#output-format)
- [Feature Inventory Table](#feature-inventory-table)
- [Suggestion Report](#suggestion-report)
- [Feature Suggestions](#feature-suggestions)
- [High Priority (Score > 2.5)](#high-priority-(score->-25))
- [Related Skills](#related-skills)
- [Reference](#reference)


# Feature Review

Review implemented features and suggest new ones using evidence-based prioritization. Create GitHub issues for accepted suggestions.

## Philosophy

Feature decisions rely on data. Every feature involves tradeoffs that require evaluation. This skill uses hybrid RICE+WSJF scoring with Kano classification to prioritize work and generates actionable GitHub issues for accepted suggestions.

## When To Use

- Roadmap reviews (sprint planning, quarterly reviews).
- Retrospective evaluations.
- Planning new development cycles.

## When NOT To Use

- Emergency bug fixes.
- Simple documentation updates.
- Active implementation (use `scope-guard`).

## Quick Start

### 1. Inventory Current Features

Discover and categorize existing features:
```bash
/feature-review --inventory
```

### 2. Score and Classify

Evaluate features against the prioritization framework:
```bash
/feature-review
```

### 3. Generate Suggestions

Review gaps and suggest new features:
```bash
/feature-review --suggest
```

### 4. Research-Enriched Scoring

Use tome plugin to adjust scores with external evidence:
```bash
/feature-review --research
```

### 5. Upload to GitHub

Create issues for accepted suggestions:
```bash
/feature-review --suggest --create-issues
```

## Workflow

### Phase 1: Feature Discovery (`feature-review:inventory-complete`)

Identify features by analyzing:

1. **Code artifacts**: Entry points, public APIs, and configuration surfaces.
2. **Documentation**: README lists, CHANGELOG entries, and user docs.
3. **Git history**: Recent feature commits and branches.

**Output:** Feature inventory table.

### Phase 2: Classification (`feature-review:classified`)

Classify each feature along two axes:

**Axis 1: Proactive vs Reactive**

| Type | Definition | Examples |
|------|------------|----------|
| **Proactive** | Anticipates user needs. | Suggestions, prefetching. |
| **Reactive** | Responds to explicit input. | Form handling, click actions. |

**Axis 2: Static vs Dynamic**

| Type | Update Pattern | Storage Model |
|------|---------------|---------------|
| **Static** | Incremental, versioned. | File-based, cached. |
| **Dynamic** | Continuous, streaming. | Database, real-time. |

See [classification-system.md](modules/classification-system.md) for details.

### Phase 3: Scoring (`feature-review:scored`)

Apply hybrid RICE+WSJF scoring:

```
Feature Score = Value Score / Cost Score

Value Score = (Reach + Impact + Business Value + Time Criticality) / 4
Cost Score = (Effort + Risk + Complexity) / 3

Adjusted Score = Feature Score * Confidence
```

**Scoring Scale:** Fibonacci (1, 2, 3, 5, 8, 13).

**Thresholds:**
- **> 2.5**: High priority.
- **1.5 - 2.5**: Medium priority.
- **< 1.5**: Low priority.

See [scoring-framework.md](modules/scoring-framework.md) for the framework.

### Phase 4: Tradeoff Analysis (`feature-review:tradeoffs-analyzed`)

Evaluate each feature across quality dimensions:

| Dimension | Question | Scale |
|-----------|----------|-------|
| **Quality** | Does it deliver correct results? | 1-5 |
| **Latency** | Does it meet timing requirements? | 1-5 |
| **Token Usage** | Is it context-efficient? | 1-5 |
| **Resource Usage** | Is CPU/memory reasonable? | 1-5 |
| **Redundancy** | Does it handle failures gracefully? | 1-5 |
| **Readability** | Can others understand it? | 1-5 |
| **Scalability** | Will it handle 10x load? | 1-5 |
| **Integration** | Does it play well with others? | 1-5 |
| **API Surface** | Is it backward compatible? | 1-5 |

See [tradeoff-dimensions.md](modules/tradeoff-dimensions.md) for criteria.

### Phase 4.5: Research Enrichment (`feature-review:research-enriched`)

**Triggered by:** `--research` flag. Requires tome plugin.

Use tome's multi-source research to adjust scoring factors
with external evidence. This phase runs between tradeoff
analysis and gap analysis.

1. **Dispatch research**: For each feature, construct
   research topics and dispatch tome channels (code-search,
   discourse, papers, triz) in parallel.
2. **Synthesize findings**: Merge results across channels
   using `tome:synthesize`.
3. **Calculate deltas**: Map findings to scoring factor
   adjustments using channel-to-factor mapping.
4. **Apply deltas**: Adjust initial scores by research
   deltas, clamp to Fibonacci scale, respect max_delta.
5. **Present evidence**: Show adjustment table with
   evidence sources and rationale.

See [research-enrichment.md](modules/research-enrichment.md)
for the full enrichment protocol, delta calculation, and
graceful degradation behavior.

**Graceful degradation**: If tome is not installed, prints
a warning and proceeds with initial scores unchanged.

### Phase 5: Gap Analysis & Suggestions (`feature-review:suggestions-generated`)

1. **Identify gaps**: Missing Kano basics.
2. **Surface opportunities**: High-value, low-effort features.
3. **Flag technical debt**: Features with declining scores.
4. **Recommend actions**: Build, improve, deprecate, or maintain.

### Phase 6: GitHub Integration (`feature-review:issues-created`)

1. Generate issue title and body from suggestions.
2. Apply labels (feature, enhancement, priority/*).
3. Link to related issues.
4. Confirm with user before creation.

**Deferred capture for high-scoring suggestions:**
After the user confirms which suggestions to act on, any
high-scoring suggestion (score > 2.5) that is not acted on
should be preserved as a deferred item.
Run once per skipped high-scoring suggestion:

```bash
python3 scripts/deferred_capture.py \
  --title "<suggestion title>" \
  --source feature-review \
  --context "RICE score: <score>. <description>"
```

This runs automatically without prompting the user.
Suggestions with scores of 2.5 or below do not need
to be captured.

## Configuration

Feature-review uses opinionated defaults but allows customization.

### Configuration File

Create `.feature-review.yaml` in project root:

```yaml
# .feature-review.yaml
version: 1

# Scoring weights (must sum to 1.0)
weights:
  value:
    reach: 0.25
    impact: 0.30
    business_value: 0.25
    time_criticality: 0.20
  cost:
    effort: 0.40
    risk: 0.30
    complexity: 0.30

# Score thresholds
thresholds:
  high_priority: 2.5
  medium_priority: 1.5

# Tradeoff dimension weights (0.0 to disable)
tradeoffs:
  quality: 1.0
  latency: 1.0
  token_usage: 1.0
  resource_usage: 0.8
  redundancy: 0.5
  readability: 1.0
  scalability: 0.8
  integration: 1.0
  api_surface: 1.0
```

See [configuration.md](modules/configuration.md) for options.

### Guardrails

These rules apply to all configurations:

1. **Minimum dimensions**: Evaluate at least 5 tradeoff dimensions.
2. **Confidence requirement**: Review scores below 50% confidence.
3. **Breaking change warning**: Require acknowledgment for API surface changes.
4. **Backlog limit**: Limit suggestion queue to 25 items.

## Required TodoWrite Items

1. `feature-review:inventory-complete`
2. `feature-review:classified`
3. `feature-review:scored`
4. `feature-review:tradeoffs-analyzed`
5. `feature-review:research-enriched` (if `--research`)
6. `feature-review:suggestions-generated`
7. `feature-review:issues-created` (if requested)

## Integration Points

- **`imbue:scope-guard`**: Provides Worthiness Scores for suggestions.
- **`sanctum:do-issue`**: Prioritizes issues with high scores.
- **`superpowers:brainstorming`**: Evaluates new ideas against existing features.
- **`tome:research`**: Multi-source research for score enrichment (optional, `--research`).

## Output Format

### Feature Inventory Table

```markdown
| Feature | Type | Data | Score | Priority | Status |
|---------|------|------|-------|----------|--------|
| Auth middleware | Reactive | Dynamic | 2.8 | High | Stable |
| Skill loader | Reactive | Static | 2.3 | Medium | Needs improvement |
```

### Research-Enriched Table (with `--research`)

```markdown
| Feature | Type | Score | Adj. | Priority | Evidence |
|---------|------|-------|------|----------|----------|
| Auth    | R/D  | 2.8   | 3.1  | High     | 3 sources |
| Loader  | R/S  | 2.3   | 2.3  | Medium   | none      |

## Research Evidence

### Code Search (GitHub)
- 12 implementations, avg 340 stars
- **Reach**: +1 (broad adoption)

### Discourse (HN/Reddit)
- 47 mentions, 78% positive
- **Impact**: +1 (strong demand)
```

### Suggestion Report

```markdown
## Feature Suggestions

### High Priority (Score > 2.5)

1. **[Feature Name]** (Score: 2.7)
   - Classification: Proactive/Dynamic
   - Value: High reach
   - Cost: Moderate effort
   - Recommendation: Build in next sprint
```

## Related Skills

- `imbue:scope-guard`: Prevent overengineering.
- `imbue:review-core`: Structured review methodology.
- `sanctum:pr-review`: Code-level feature review.

## Reference

- **[scoring-framework.md](modules/scoring-framework.md)**: RICE+WSJF hybrid.
- **[classification-system.md](modules/classification-system.md)**: Axes definition.
- **[tradeoff-dimensions.md](modules/tradeoff-dimensions.md)**: Quality attributes.
- **[configuration.md](modules/configuration.md)**: Customization options.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
