---
name: evaluation-rubric
description: Detailed criteria for evaluating external knowledge importance and storage decisions
category: evaluation
tags: [evaluation, criteria, scoring, decision-making]
dependencies: [knowledge-intake]
complexity: intermediate
estimated_tokens: 450
---

# Knowledge Evaluation Rubric

Systematic criteria for evaluating external resources and making storage decisions.

## The Five Criteria

### 1. Novelty (25%)

**Question**: Does this introduce new patterns, concepts, or perspectives?

| Score | Description |
|-------|-------------|
| 90-100 | Paradigm shift, fundamentally new approach |
| 70-89 | Novel technique or significant refinement |
| 50-69 | Useful variation on known patterns |
| 30-49 | Familiar with minor new details |
| 0-29 | Already well-known, no new insight |

**Signals of High Novelty**:
- "I never thought of it that way"
- Connects previously unrelated domains
- Challenges existing assumptions
- Provides new vocabulary for existing concepts

### 2. Applicability (30%)

**Question**: Can we apply this to current or near-term work?

| Score | Description |
|-------|-------------|
| 90-100 | Directly solves a current problem |
| 70-89 | Applicable to active project within days |
| 50-69 | Useful for upcoming work (weeks) |
| 30-49 | May be useful someday |
| 0-29 | Purely theoretical, no clear application |

**Signals of High Applicability**:
- Addresses a known pain point
- Provides actionable steps
- Includes working examples
- Matches current technology stack

### 3. Durability (20%)

**Question**: Will this remain relevant in 6+ months?

| Score | Description |
|-------|-------------|
| 90-100 | Timeless principle, decades of relevance |
| 70-89 | Core concept, 5+ years of relevance |
| 50-69 | Good for current technology generation |
| 30-49 | Version-specific, may need updates |
| 0-29 | Already dated or rapidly changing |

**Signals of High Durability**:
- Focuses on principles over implementations
- Based on fundamental constraints
- Historical precedent of longevity
- Independent of specific tools/versions

### 4. Connectivity (15%)

**Question**: Does it connect to multiple existing concepts?

| Score | Description |
|-------|-------------|
| 90-100 | Hub concept, connects 5+ domains |
| 70-89 | Strong connections to 3-4 areas |
| 50-69 | Connects to 2 related areas |
| 30-49 | Single domain, isolated knowledge |
| 0-29 | No clear connections to existing work |

**Signals of High Connectivity**:
- Mentions concepts we already track
- Bridges different skill domains
- Creates "aha" moments about existing knowledge
- Enables cross-referencing

### 5. Authority (10%)

**Question**: Is the source credible and well-reasoned?

| Score | Description |
|-------|-------------|
| 90-100 | Primary source, original research, proven expert |
| 70-89 | Respected practitioner, well-cited work |
| 50-69 | Reasonable analysis, some evidence |
| 30-49 | Opinion piece, limited evidence |
| 0-29 | Unknown source, unsubstantiated claims |

**Signals of High Authority**:
- Author has relevant experience
- Claims supported by evidence
- Acknowledges limitations
- Peer-reviewed or widely cited

## Weighted Calculation

```
Total = (Novelty × 0.25) + (Applicability × 0.30) +
        (Durability × 0.20) + (Connectivity × 0.15) +
        (Authority × 0.10)
```

## Decision Thresholds

| Score Range | Decision | Action |
|-------------|----------|--------|
| 80-100 | **Evergreen** | Store prominently, apply immediately |
| 60-79 | **Valuable** | Store in corpus, schedule application |
| 40-59 | **Seedling** | Lightweight storage, revisit later |
| 20-39 | **Reference** | Capture key quote only |
| 0-19 | **Skip** | Don't store, note why if asked |

## Quick Evaluation Heuristic

For rapid assessment, ask:
1. Would I regret NOT storing this in 3 months?
2. Can I explain why this matters in one sentence?
3. Does it change how I think or work?

**Yes to all 3** → Store as Evergreen
**Yes to 2** → Store as Valuable
**Yes to 1** → Store as Seedling
**No to all** → Skip or Reference only
